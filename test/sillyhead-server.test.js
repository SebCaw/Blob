'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { build } = require('../server');

/**
 * Silly Head over the real HTTP and SSE surface.
 *
 * The unit tests prove the rules; these prove that the SERVER both games share
 * actually routes to them — one room, one command queue, one set of sessions —
 * and, the part worth having a real socket for, that the payload leaving the
 * process is already redacted. A hand that is absent here is absent on the wire.
 */

async function startServer(options = {}) {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sillyhead-test-'));
  const app = await build({ dataDir, graceMs: 120, electionMs: 400, ...options });
  await new Promise((resolve) => app.server.listen(0, '127.0.0.1', resolve));
  const { port } = app.server.address();
  return {
    ...app,
    dataDir,
    port,
    base: `http://127.0.0.1:${port}`,
    async stop() {
      await app.close();
      fs.rmSync(dataDir, { recursive: true, force: true });
    },
  };
}

function request(base, method, urlPath, body) {
  return new Promise((resolve, reject) => {
    const payload = body === undefined ? null : Buffer.from(JSON.stringify(body));
    const req = http.request(
      `${base}${urlPath}`,
      { method, headers: payload ? { 'content-type': 'application/json', 'content-length': payload.length } : {} },
      (res) => {
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => {
          const text = Buffer.concat(chunks).toString('utf8');
          let json = null;
          try {
            json = JSON.parse(text);
          } catch {
            /* not json */
          }
          resolve({ status: res.statusCode, body: json, text });
        });
      }
    );
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

/** A minimal EventSource that keeps every `state` frame, raw text and parsed. */
class Stream {
  constructor(base, { gameId, playerId, token }) {
    this.frames = [];
    this.waiters = [];
    this.buffer = '';
    const url = `${base}/api/stream?gameId=${gameId}&playerId=${playerId}&token=${encodeURIComponent(token)}`;
    this.ready = new Promise((resolve, reject) => {
      this.req = http.get(url, (res) => {
        this.res = res;
        if (res.statusCode !== 200) return reject(new Error(`stream status ${res.statusCode}`));
        res.setEncoding('utf8');
        res.on('data', (chunk) => this._consume(chunk));
        res.on('error', () => {});
        return resolve(this);
      });
      this.req.on('error', reject);
    });
  }

  _consume(chunk) {
    this.buffer += chunk;
    let at;
    while ((at = this.buffer.indexOf('\n\n')) !== -1) {
      const block = this.buffer.slice(0, at);
      this.buffer = this.buffer.slice(at + 2);
      const isState = block.split('\n').some((line) => line.trim() === 'event: state');
      if (!isState) continue;
      const data = block
        .split('\n')
        .filter((line) => line.startsWith('data:'))
        .map((line) => line.slice(5).trim())
        .join('');
      if (!data) continue;
      const frame = { text: data, state: JSON.parse(data) };
      this.frames.push(frame);
      this.waiters.splice(0).forEach((fn) => fn(frame));
    }
  }

  get last() {
    return this.frames[this.frames.length - 1];
  }

  /**
   * Wait for a frame matching `predicate`, checking what has already arrived.
   *
   * Generous, because `npm test` runs the files in parallel and the bot duels
   * next door will happily eat every core. A slow machine is not a bug in the
   * server, and a test that says it is would be noise.
   */
  async until(predicate, ms = 15000) {
    const hit = [...this.frames].reverse().find((f) => predicate(f.state));
    if (hit) return hit;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('timed out waiting for a state')), ms);
      const check = (frame) => {
        if (!predicate(frame.state)) {
          this.waiters.push(check);
          return;
        }
        clearTimeout(timer);
        resolve(frame);
      };
      this.waiters.push(check);
    });
  }

  close() {
    if (this.req) this.req.destroy();
    if (this.res) this.res.destroy();
  }
}

let cmdSeq = 0;
function send(app, session, command) {
  cmdSeq += 1;
  return request(app.base, 'POST', '/api/command', {
    gameId: session.gameId,
    playerId: session.playerId,
    token: session.token,
    cmdId: `sh-${cmdSeq}`,
    command,
  });
}

/** A dealt Silly Head game with everyone streaming. */
async function dealtGame(app, names) {
  const created = await request(app.base, 'POST', '/api/games', { name: names[0], game: 'sillyhead' });
  assert.equal(created.status, 201, created.text);
  const sessions = [created.body];
  for (const name of names.slice(1)) {
    const joined = await request(app.base, 'POST', `/api/games/${created.body.code}/join`, { name });
    assert.equal(joined.status, 201, joined.text);
    sessions.push(joined.body);
  }
  const streams = [];
  for (const session of sessions) streams.push(await new Stream(app.base, session).ready);
  const started = await send(app, sessions[0], { type: 'game/start' });
  assert.equal(started.status, 200, started.text);
  for (const stream of streams) await stream.until((s) => s.phase === 'sort');
  return { sessions, streams, code: created.body.code };
}

test('a Silly Head game is created, joined and dealt over the real server', async (t) => {
  const app = await startServer();
  t.after(() => app.stop());

  const created = await request(app.base, 'POST', '/api/games', { name: 'Seb', game: 'sillyhead' });
  assert.equal(created.status, 201, created.text);
  assert.equal(created.body.game, 'sillyhead');
  assert.equal(created.body.state.game, 'sillyhead');
  assert.equal(created.body.state.phase, 'lobby');

  const lookup = await request(app.base, 'GET', `/api/games/${created.body.code}`);
  assert.equal(lookup.body.game, 'sillyhead');

  const joined = await request(app.base, 'POST', `/api/games/${created.body.code}/join`, { name: 'Alex' });
  assert.equal(joined.status, 201);
  assert.equal(joined.body.state.players.length, 2);
});

test('asking for no particular game still gets you Blob', async (t) => {
  const app = await startServer();
  t.after(() => app.stop());
  const created = await request(app.base, 'POST', '/api/games', { name: 'Seb', handSize: 3 });
  assert.equal(created.body.game, 'blob');
  assert.equal(created.body.state.game, 'blob');
});

test('the deal reaches each phone with only its own cards in it', async (t) => {
  const app = await startServer();
  t.after(() => app.stop());
  const { streams } = await dealtGame(app, ['Seb', 'Alex']);
  t.after(() => streams.forEach((s) => s.close()));

  const mine = streams[0].last.state;
  const theirs = streams[1].last.state;
  assert.equal(mine.you.hand.length, 3);
  assert.equal(mine.you.downLeft.length, 3);

  // My hand is not in their payload — absent, not hidden.
  for (const card of mine.you.hand) {
    assert.ok(!streams[1].last.text.includes(card), `their phone should never see ${card}`);
  }
  // And how many I hold is public, because you can count that at a table.
  assert.equal(theirs.players.find((p) => p.name === 'Seb').cardsHeld, 3);
});

test('nobody is sent a face-down card, not even their own', async (t) => {
  const app = await startServer();
  t.after(() => app.stop());
  const { streams } = await dealtGame(app, ['Seb', 'Alex']);
  t.after(() => streams.forEach((s) => s.close()));

  // Everything a phone legitimately knows about: its own hand, and everybody's
  // face-up cards. Anything else that looks like a card is a leak.
  for (const stream of streams) {
    const state = stream.last.state;
    const allowed = new Set([...state.you.hand, ...state.players.flatMap((p) => p.up.flat())]);
    const found = stream.last.text.match(/"(?:[2-9]|10|[JQKA])[SHDC]#\d+"/g) || [];
    for (const quoted of found) {
      const card = quoted.slice(1, -1);
      assert.ok(allowed.has(card), `${card} should not have been sent to ${state.you.name}`);
    }
    assert.deepEqual(state.you.downLeft, [true, true, true]);
  }
});

test('both phones sort, play starts, and a card played lands on every screen', async (t) => {
  const app = await startServer();
  t.after(() => app.stop());
  const { sessions, streams } = await dealtGame(app, ['Seb', 'Alex']);
  t.after(() => streams.forEach((s) => s.close()));

  for (const session of sessions) {
    const done = await send(app, session, { type: 'sort/done' });
    assert.equal(done.status, 200, done.text);
  }
  for (const stream of streams) await stream.until((s) => s.phase === 'playing');

  const state = streams[0].last.state;
  const seat = state.players.findIndex((p) => p.id === state.turnId);
  const stream = streams[seat];
  const you = stream.last.state.you;
  assert.ok(you.playable.length, 'whoever leads an empty pile can play anything');

  const played = await send(app, sessions[seat], { type: 'play/cards', cardIds: [you.playable[0]] });
  assert.equal(played.status, 200, played.text);
  for (const s of streams) await s.until((v) => v.pile.top === you.playable[0]);
});

test('the same room refuses a command from the wrong game', async (t) => {
  const app = await startServer();
  t.after(() => app.stop());
  const { sessions, streams } = await dealtGame(app, ['Seb', 'Alex']);
  t.after(() => streams.forEach((s) => s.close()));
  const out = await send(app, sessions[0], { type: 'bid/submit', value: 1 });
  assert.equal(out.body.error.code, 'unknown-command');
});
