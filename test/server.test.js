'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { build } = require('../server');

/**
 * End-to-end tests over the real HTTP + SSE surface. These are the ones that
 * catch what unit tests cannot: two phones acting at the same instant, a
 * double-tapped button, a stream dropping and coming back.
 */

// -- Harness -----------------------------------------------------------------

async function startServer(options = {}) {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'blob-test-'));
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
          resolve({ status: res.statusCode, body: json, text, headers: res.headers });
        });
      }
    );
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

/** A minimal EventSource: opens the stream and collects `state` events. */
class Stream {
  constructor(base, { gameId, playerId, token }) {
    this.states = [];
    this.waiters = [];
    this.buffer = '';
    this.closed = false;
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
    let split;
    while ((split = this.buffer.indexOf('\n\n')) !== -1) {
      const raw = this.buffer.slice(0, split);
      this.buffer = this.buffer.slice(split + 2);
      const dataLine = raw.split('\n').find((l) => l.startsWith('data: '));
      if (!dataLine) continue;
      const state = JSON.parse(dataLine.slice(6));
      this.states.push(state);
      this.waiters = this.waiters.filter((w) => {
        if (!w.predicate(state)) return true;
        w.resolve(state);
        return false;
      });
    }
  }

  /** The most recent state received. */
  get latest() {
    return this.states[this.states.length - 1];
  }

  /** Wait for a state matching `predicate` (checking what has already arrived). */
  async waitFor(predicate, label = 'state', timeout = 4000) {
    const existing = [...this.states].reverse().find(predicate);
    if (existing) return existing;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`timed out waiting for ${label}`)), timeout);
      this.waiters.push({
        predicate,
        resolve: (s) => {
          clearTimeout(timer);
          resolve(s);
        },
      });
    });
  }

  close() {
    this.closed = true;
    this.req.destroy();
    if (this.res) this.res.destroy();
  }

  /** Answer the server's heartbeat, the way the real client does. */
  async pong(app, session) {
    await request(app.base, 'POST', '/api/ping', {
      gameId: session.gameId,
      playerId: session.playerId,
      token: session.token,
    });
  }
}

let cmdSeq = 0;
async function send(app, session, command, cmdId) {
  cmdSeq += 1;
  return request(app.base, 'POST', '/api/command', {
    gameId: session.gameId,
    playerId: session.playerId,
    token: session.token,
    cmdId: cmdId || `cmd-${cmdSeq}`,
    command,
  });
}

async function createGame(app, name, handSize = 3) {
  const res = await request(app.base, 'POST', '/api/games', { name, handSize });
  assert.equal(res.status, 201, res.text);
  return res.body;
}

async function joinGame(app, code, name) {
  const res = await request(app.base, 'POST', `/api/games/${code}/join`, { name });
  assert.equal(res.status, 201, res.text);
  return res.body;
}

/** A game with `names.length` players, all streaming, started. */
async function tableOf(app, names, handSize = 3) {
  const host = await createGame(app, names[0], handSize);
  const sessions = [host];
  for (const name of names.slice(1)) sessions.push(await joinGame(app, host.code, name));
  const streams = [];
  for (const s of sessions) streams.push(await new Stream(app.base, s).ready);
  await send(app, host, { type: 'game/start' });
  for (const stream of streams) await stream.waitFor((s) => s.phase === 'bidding', 'bidding');
  return { host, sessions, streams };
}

/**
 * Play a started table all the way through, with everyone bidding and winning
 * zero. Every wait is pinned to a round NUMBER, not just a phase — a phase
 * name repeats every round, and `Stream.waitFor` returns the first match it
 * has ever seen, so an unpinned wait would happily return round 1's reveal
 * forever after.
 */
async function playToComplete(app, sessions, streams, host, totalRounds) {
  let state;
  for (let round = 1; round <= totalRounds; round++) {
    await streams[0].waitFor((s) => s.phase === 'bidding' && s.round && s.round.number === round, 'bidding');
    for (const session of sessions) {
      await send(app, session, { type: 'bid/submit', playerId: session.playerId, value: 0 });
    }
    await streams[0].waitFor((s) => s.phase === 'reveal' && s.round.number === round, 'reveal');
    const tricks = {};
    sessions.forEach((s) => {
      tricks[s.playerId] = 0;
    });
    await send(app, host, { type: 'results/submit', tricks, force: true });
    await streams[0].waitFor((s) => s.phase === 'summary' && s.round.number === round, 'summary');
    await send(app, host, { type: 'round/next' });
    state = await streams[0].waitFor(
      (s) => (s.phase === 'bidding' && s.round.number === round + 1) || s.phase === 'complete',
      'next round or the end'
    );
  }
  return state;
}

// -- Tests -------------------------------------------------------------------

test('a game can be created, joined and streamed', async (t) => {
  const app = await startServer();
  t.after(() => app.stop());

  const host = await createGame(app, 'Seb', 7);
  assert.match(host.code, /^\d{4}$/);
  assert.equal(host.state.you.isMaster, true);
  assert.equal(host.state.phase, 'lobby');

  const lookup = await request(app.base, 'GET', `/api/games/${host.code}`);
  assert.equal(lookup.status, 200);
  assert.equal(lookup.body.open, true);
  assert.equal(lookup.body.masterName, 'Seb');

  const stream = await new Stream(app.base, host).ready;
  t.after(() => stream.close());
  const first = await stream.waitFor(() => true, 'first state');
  assert.equal(first.code, host.code);

  const james = await joinGame(app, host.code, 'James');
  const withJames = await stream.waitFor((s) => s.players.length === 2, 'James joining');
  assert.deepEqual(withJames.players.map((p) => p.name), ['Seb', 'James']);
  assert.equal(withJames.canStart, true);
  assert.equal(james.state.you.isMaster, false);
});

test('a wrong game code is refused kindly', async (t) => {
  const app = await startServer();
  t.after(() => app.stop());
  const res = await request(app.base, 'POST', '/api/games/9999/join', { name: 'Nobody' });
  assert.equal(res.status, 404);
  assert.match(res.body.error.message, /couldn't find a game/);
  assert.equal(/stack|Error:/.test(res.text), false, 'no technical detail leaks to the player');
});

test('commands without a valid session are rejected', async (t) => {
  const app = await startServer();
  t.after(() => app.stop());
  const host = await createGame(app, 'Seb');
  await joinGame(app, host.code, 'James');

  const forged = await send(app, { ...host, token: 'not-the-token' }, { type: 'game/start' });
  assert.equal(forged.status, 401);
  assert.match(forged.body.error.message, /verify it was you/);

  const stranger = await send(app, { ...host, playerId: 'p_nobody' }, { type: 'game/start' });
  assert.equal(stranger.status, 401);
});

test('bids submitted at the same instant lock the round exactly once', async (t) => {
  const app = await startServer();
  t.after(() => app.stop());
  const { sessions, streams } = await tableOf(app, ['Seb', 'James', 'Alex', 'Tom']);
  t.after(() => streams.forEach((s) => s.close()));

  // All four fire together, with no ordering between them.
  const responses = await Promise.all(
    sessions.map((session, i) =>
      send(app, session, { type: 'bid/submit', playerId: session.playerId, value: i % 4 })
    )
  );
  assert.deepEqual(responses.map((r) => r.status), [200, 200, 200, 200]);

  const locked = await streams[0].waitFor((s) => s.phase === 'reveal', 'the reveal');
  assert.equal(locked.round.locked, true);
  assert.equal(locked.round.bidsIn, 4);
  assert.deepEqual(locked.players.map((p) => p.bid), [0, 1, 2, 3], 'every bid landed exactly once');

  // The lock happened once: exactly one state carried the transition.
  const transitions = streams[0].states.filter((s) => s.phase === 'reveal' && s.round.bidsIn === 4);
  const versions = new Set(transitions.map((s) => s.version));
  assert.equal(versions.size, 1, 'one and only one locking version');
});

test('a repeated command id is applied once', async (t) => {
  const app = await startServer();
  t.after(() => app.stop());
  const { host, sessions, streams } = await tableOf(app, ['Seb', 'James']);
  t.after(() => streams.forEach((s) => s.close()));

  for (const session of sessions) {
    await send(app, session, { type: 'bid/submit', playerId: session.playerId, value: 1 });
  }
  await streams[0].waitFor((s) => s.phase === 'reveal', 'reveal');

  const tricks = { [sessions[0].playerId]: 1, [sessions[1].playerId]: 2 };
  const cmdId = 'the-same-tap';
  const first = await send(app, host, { type: 'results/submit', tricks }, cmdId);
  const second = await send(app, host, { type: 'results/submit', tricks }, cmdId);

  assert.equal(first.status, 200);
  assert.equal(second.status, 200, 'the retry is answered, not re-applied');
  const summary = await streams[0].waitFor((s) => s.phase === 'summary', 'summary');
  assert.equal(summary.leaderboard.find((p) => p.id === sessions[0].playerId).total, 11);
  assert.equal(summary.round.number, 1, 'still on round one');
});

test('a second Submit Results without a command id is refused, not double-counted', async (t) => {
  const app = await startServer();
  t.after(() => app.stop());
  const { host, sessions, streams } = await tableOf(app, ['Seb', 'James']);
  t.after(() => streams.forEach((s) => s.close()));

  for (const session of sessions) {
    await send(app, session, { type: 'bid/submit', playerId: session.playerId, value: 1 });
  }
  await streams[0].waitFor((s) => s.phase === 'reveal', 'reveal');

  const tricks = { [sessions[0].playerId]: 1, [sessions[1].playerId]: 2 };
  await send(app, host, { type: 'results/submit', tricks }, 'tap-1');
  const again = await send(app, host, { type: 'results/submit', tricks }, 'tap-2');
  assert.equal(again.status, 409);
  assert.equal(again.body.error.code, 'results-in');

  const state = await streams[0].waitFor((s) => s.phase === 'summary', 'summary');
  assert.equal(state.leaderboard.find((p) => p.id === sessions[0].playerId).total, 11, 'scored once');
});

test('a player cannot bid for anybody else', async (t) => {
  const app = await startServer();
  t.after(() => app.stop());
  const { sessions, streams } = await tableOf(app, ['Seb', 'James', 'Alex']);
  t.after(() => streams.forEach((s) => s.close()));

  const res = await send(app, sessions[1], { type: 'bid/submit', playerId: sessions[2].playerId, value: 3 });
  assert.equal(res.status, 409);
  assert.equal(res.body.error.code, 'not-allowed');
});

test('other players bid values never reach the wire before the lock', async (t) => {
  const app = await startServer();
  t.after(() => app.stop());
  const { sessions, streams } = await tableOf(app, ['Seb', 'James', 'Alex']);
  t.after(() => streams.forEach((s) => s.close()));

  await send(app, sessions[0], { type: 'bid/submit', playerId: sessions[0].playerId, value: 3 });
  const seen = await streams[1].waitFor((s) => s.round && s.round.bidsIn === 1, 'first bid registered');
  assert.equal(seen.players[0].hasBid, true);
  assert.equal(seen.players[0].bid, null);
  assert.equal(JSON.stringify(seen).includes('"bid":3'), false, 'the value is simply not in the payload');
});

test('reconnecting gives you the current screen, not the beginning', async (t) => {
  const app = await startServer();
  t.after(() => app.stop());
  const { host, sessions, streams } = await tableOf(app, ['Seb', 'James']);

  for (const session of sessions) {
    await send(app, session, { type: 'bid/submit', playerId: session.playerId, value: 1 });
  }
  await streams[0].waitFor((s) => s.phase === 'reveal', 'reveal');
  await send(app, host, {
    type: 'results/submit',
    tricks: { [sessions[0].playerId]: 1, [sessions[1].playerId]: 2 },
  });
  await streams[0].waitFor((s) => s.phase === 'summary', 'summary');

  streams[1].close();
  const revived = await new Stream(app.base, sessions[1]).ready;
  t.after(() => {
    revived.close();
    streams[0].close();
  });

  const state = await revived.waitFor((s) => s.phase === 'summary', 'summary after reconnect');
  assert.equal(state.round.number, 1, 'straight back into the round that is running');
  assert.equal(state.you.bid, 1);
  assert.equal(state.you.tricks, 2);
  assert.equal(state.you.madeBid, false);
  assert.equal(state.you.roundScore, 0, 'James bid 1 and won 2, so scored nothing');
  assert.equal(state.players.find((p) => p.name === 'Seb').roundScore, 11);
});

test('a submitted bid survives a disconnection, and the Master covers only after the grace window', async (t) => {
  const app = await startServer();
  t.after(() => app.stop());
  const { host, sessions, streams } = await tableOf(app, ['Seb', 'James', 'Alex']);
  t.after(() => streams.forEach((s) => s.close()));

  await send(app, sessions[1], { type: 'bid/submit', playerId: sessions[1].playerId, value: 2 });
  streams[1].close();

  const dropped = await streams[0].waitFor(
    (s) => s.players.find((p) => p.id === sessions[1].playerId).connected === false,
    'James dropping'
  );
  assert.equal(dropped.players.find((p) => p.id === sessions[1].playerId).hasBid, true, 'his bid is still there');

  // Alex drops without having bid: after the grace window the Master may cover him.
  streams[2].close();
  const takeover = await streams[0].waitFor(
    (s) => s.players.find((p) => p.id === sessions[2].playerId).awaitingTakeover === true,
    'Alex needing cover'
  );
  assert.deepEqual(takeover.you.canBidFor.map((p) => p.reason), ['disconnected']);

  const covered = await send(app, host, { type: 'bid/submit', playerId: sessions[2].playerId, value: 0 });
  assert.equal(covered.status, 200);
  await send(app, host, { type: 'bid/submit', playerId: host.playerId, value: 1 });
  const revealed = await streams[0].waitFor((s) => s.phase === 'reveal', 'reveal');
  assert.equal(revealed.players.find((p) => p.id === sessions[2].playerId).bidEnteredBy, 'master');
  assert.equal(revealed.players.find((p) => p.id === sessions[1].playerId).bid, 2, 'the survived bid is intact');
});

test('an offline player bids privately on the Master phone', async (t) => {
  const app = await startServer();
  t.after(() => app.stop());
  const host = await createGame(app, 'Seb', 3);
  await joinGame(app, host.code, 'James');
  await send(app, host, { type: 'player/addOffline', name: 'Grandad' });
  const stream = await new Stream(app.base, host).ready;
  t.after(() => stream.close());
  await send(app, host, { type: 'game/start' });

  const bidding = await stream.waitFor((s) => s.phase === 'bidding', 'bidding');
  const grandad = bidding.players.find((p) => p.name === 'Grandad');
  assert.equal(grandad.isOffline, true);
  assert.deepEqual(bidding.you.canBidFor.map((p) => p.name), ['Grandad']);

  const res = await send(app, host, { type: 'bid/submit', playerId: grandad.id, value: 2 });
  assert.equal(res.status, 200);
  const after = await stream.waitFor((s) => s.round && s.round.bidsIn === 1, 'the offline bid');
  assert.equal(after.you.canBidFor.length, 0);
});

test('losing the Master triggers an election, and the winner runs the rest of the game', async (t) => {
  const app = await startServer();
  t.after(() => app.stop());
  const { sessions, streams } = await tableOf(app, ['Seb', 'James', 'Alex']);
  t.after(() => streams.forEach((s) => s.close()));

  streams[0].close(); // the Master's phone goes

  const voting = await streams[1].waitFor((s) => s.election && !s.election.resolved, 'the election opening');
  assert.equal(voting.election.forPlayerName, 'Seb');
  assert.equal(voting.election.youCanVote, true);
  assert.deepEqual(voting.election.candidates.map((c) => c.name).sort(), ['Alex', 'James']);

  await send(app, sessions[1], { type: 'election/vote', candidateId: sessions[2].playerId });
  await send(app, sessions[2], { type: 'election/vote', candidateId: sessions[1].playerId });

  // Neither can vote for themselves, so this ties and resolves on seniority.
  const settled = await streams[1].waitFor((s) => s.election && s.election.resolved, 'the result', 6000);
  assert.ok(settled.election.winnerId);
  assert.equal(settled.masterId, settled.election.winnerId);

  const newMaster = sessions.find((s) => s.playerId === settled.masterId);
  const bid = await send(app, newMaster, { type: 'bid/submit', playerId: newMaster.playerId, value: 1 });
  assert.equal(bid.status, 200, 'the new Master carries on as a normal player too');
});

test('a finished game is scored, saved and readable from history', async (t) => {
  const app = await startServer();
  t.after(() => app.stop());
  const { host, sessions, streams } = await tableOf(app, ['Seb', 'James'], 3);
  t.after(() => streams.forEach((s) => s.close()));
  const [seb, james] = sessions;

  for (let round = 0; round < 5; round++) {
    const state = await streams[0].waitFor(
      (s) => s.phase === 'bidding' && s.round && s.round.number === round + 1,
      'bidding'
    );
    const handSize = state.round.handSize;
    await send(app, seb, { type: 'bid/submit', playerId: seb.playerId, value: handSize });
    await send(app, james, { type: 'bid/submit', playerId: james.playerId, value: 0 });
    await streams[0].waitFor((s) => s.phase === 'reveal' && s.round.number === round + 1, 'reveal');
    await send(app, host, {
      type: 'results/submit',
      tricks: { [seb.playerId]: handSize, [james.playerId]: 0 },
    });
    await streams[0].waitFor((s) => s.phase === 'summary' && s.round.number === round + 1, 'summary');
    await send(app, host, { type: 'round/next' });
  }

  const done = await streams[0].waitFor((s) => s.phase === 'complete', 'the end of the game');
  assert.deepEqual(done.winners, [seb.playerId]);
  assert.equal(done.leaderboard[0].total, 61);
  assert.equal(done.leaderboard[1].total, 50);

  await new Promise((resolve) => setTimeout(resolve, 120));
  const list = await request(app.base, 'GET', '/api/history');
  assert.equal(list.status, 200);
  assert.equal(list.body.games.length, 1);
  assert.deepEqual(list.body.games[0].winners, ['Seb']);

  const record = await request(app.base, 'GET', `/api/history/${done.id}`);
  assert.equal(record.status, 200);
  assert.equal(record.body.rounds.length, 5);
  assert.deepEqual(record.body.sequence, [3, 2, 1, 2, 3]);
  assert.equal(record.body.rounds[0].players[0].enteredBy, 'self');
  assert.equal(record.body.rounds[4].players[0].runningTotal, 61);
});

test('games in progress survive a server restart', async (t) => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'blob-restart-'));
  t.after(() => fs.rmSync(dataDir, { recursive: true, force: true }));

  const first = await build({ dataDir, graceMs: 120, electionMs: 400 });
  await new Promise((resolve) => first.server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${first.server.address().port}`;

  const host = await (async () => {
    const res = await request(base, 'POST', '/api/games', { name: 'Seb', handSize: 3 });
    return res.body;
  })();
  const james = (await request(base, 'POST', `/api/games/${host.code}/join`, { name: 'James' })).body;
  await request(base, 'POST', '/api/command', {
    gameId: host.gameId,
    playerId: host.playerId,
    token: host.token,
    cmdId: 'start',
    command: { type: 'game/start' },
  });
  await new Promise((resolve) => setTimeout(resolve, 600)); // let the debounced save land
  await first.close();

  const second = await build({ dataDir, graceMs: 120, electionMs: 400 });
  await new Promise((resolve) => second.server.listen(0, '127.0.0.1', resolve));
  t.after(() => second.close());
  const base2 = `http://127.0.0.1:${second.server.address().port}`;

  assert.equal(second.restored, 1);
  const stream = await new Stream(base2, james).ready;
  t.after(() => stream.close());
  const state = await stream.waitFor((s) => s.phase === 'bidding', 'the game we left');
  assert.equal(state.code, host.code);
  assert.equal(state.players.length, 2);
  assert.equal(state.you.name, 'James', 'the old session still works');
});

test('the last bid and the Master covering a dropped player can land together', async (t) => {
  // Spec section 37's awkward case: the Master submits for a player whose phone
  // has gone at the same instant the last connected player submits their own.
  // Both must land, and the round must lock exactly once.
  const app = await startServer();
  t.after(() => app.stop());
  const { host, sessions, streams } = await tableOf(app, ['Seb', 'James', 'Alex', 'Tom']);
  t.after(() => streams.forEach((s) => s.close()));

  await send(app, host, { type: 'bid/submit', playerId: host.playerId, value: 1 });
  await send(app, sessions[1], { type: 'bid/submit', playerId: sessions[1].playerId, value: 1 });

  streams[2].close(); // Alex's phone goes, before he has bid
  await streams[0].waitFor(
    (s) => s.players.find((p) => p.id === sessions[2].playerId).awaitingTakeover === true,
    'Alex needing cover'
  );

  const [covered, own] = await Promise.all([
    send(app, host, { type: 'bid/submit', playerId: sessions[2].playerId, value: 1 }),
    send(app, sessions[3], { type: 'bid/submit', playerId: sessions[3].playerId, value: 0 }),
  ]);
  assert.equal(covered.status, 200);
  assert.equal(own.status, 200);

  const locked = await streams[0].waitFor((s) => s.phase === 'reveal', 'the reveal');
  assert.equal(locked.round.bidsIn, 4);
  assert.deepEqual(locked.players.map((p) => p.bid), [1, 1, 1, 0]);
  assert.equal(locked.players[2].bidEnteredBy, 'master');
  assert.equal(locked.players[3].bidEnteredBy, 'self');

  const lockingStates = streams[0].states.filter((s) => s.phase === 'reveal' && s.round.bidsIn === 4);
  assert.equal(new Set(lockingStates.map((s) => s.version)).size, 1, 'locked exactly once');
});

test('a game that has been finished can no longer be played', async (t) => {
  const app = await startServer();
  t.after(() => app.stop());
  const { host, sessions, streams } = await tableOf(app, ['Seb', 'James'], 3);
  t.after(() => streams.forEach((s) => s.close()));

  for (let round = 0; round < 5; round++) {
    const state = await streams[0].waitFor(
      (s) => s.phase === 'bidding' && s.round && s.round.number === round + 1,
      'bidding'
    );
    const handSize = state.round.handSize;
    await send(app, sessions[0], { type: 'bid/submit', playerId: sessions[0].playerId, value: 0 });
    await send(app, sessions[1], { type: 'bid/submit', playerId: sessions[1].playerId, value: handSize });
    await streams[0].waitFor((s) => s.phase === 'reveal' && s.round.number === round + 1, 'reveal');
    await send(app, host, {
      type: 'results/submit',
      tricks: { [sessions[0].playerId]: 0, [sessions[1].playerId]: handSize },
    });
    await streams[0].waitFor((s) => s.phase === 'summary' && s.round.number === round + 1, 'summary');
    await send(app, host, { type: 'round/next' });
  }
  await streams[0].waitFor((s) => s.phase === 'complete', 'the end');

  const late = await send(app, sessions[1], { type: 'bid/submit', playerId: sessions[1].playerId, value: 1 });
  assert.equal(late.status, 409);
  assert.match(late.body.error.message, /closed/);

  const join = await request(app.base, 'POST', `/api/games/${sessions[0].code}/join`, { name: 'Latecomer' });
  assert.equal(join.status, 409);
  assert.equal(join.body.error.code, 'already-started');
});

test('two players called Alex both get in, and can be told apart', async (t) => {
  const app = await startServer();
  t.after(() => app.stop());
  const host = await createGame(app, 'Alex');
  const second = await joinGame(app, host.code, 'Alex');
  const third = await joinGame(app, host.code, 'alex');

  assert.deepEqual(host.state.players.length, 1);
  assert.equal(second.state.you.name, 'Alex 2');
  assert.equal(third.state.you.name, 'alex 3');
  assert.notEqual(second.playerId, third.playerId);
});

test('the deck warning reaches the Master and never blocks the game', async (t) => {
  const app = await startServer();
  t.after(() => app.stop());
  const host = await createGame(app, 'Seb', 7);
  const stream = await new Stream(app.base, host).ready;
  t.after(() => stream.close());

  // Eight players at seven cards needs 56 cards, and a deck holds 52.
  for (const name of ['B', 'C', 'D', 'E', 'F', 'G', 'H']) await joinGame(app, host.code, name);
  const warned = await stream.waitFor((s) => s.deck.exceeds, 'the deck warning');
  assert.equal(warned.deck.cardsNeeded, 56);
  assert.equal(warned.deck.decksNeeded, 2);
  assert.match(warned.deck.message, /56 cards/);
  assert.equal(warned.deck.acknowledged, false);

  // It is a warning, so the game starts regardless of whether it was seen.
  const started = await send(app, host, { type: 'game/start' });
  assert.equal(started.status, 200);
  const playing = await stream.waitFor((s) => s.phase === 'bidding', 'bidding');
  assert.equal(playing.round.handSize, 7);
  assert.equal(playing.deck.exceeds, true, 'and the warning is still true while they play');
});

test('a phone that stops answering is treated as gone, even with its socket still open', async (t) => {
  // The case a closed socket cannot catch: a phone drives into a tunnel and the
  // connection stays half-open, so the server's writes keep succeeding into a
  // buffer nobody is reading. Only a missing pong reveals it.
  const app = await startServer({ presenceMs: 300, presenceSweepMs: 60 });
  t.after(() => app.stop());
  const { sessions, streams } = await tableOf(app, ['Seb', 'James', 'Alex']);
  t.after(() => streams.forEach((s) => s.close()));

  // Seb and James keep answering; Alex's phone goes quiet without hanging up.
  const keepAlive = setInterval(() => {
    streams[0].pong(app, sessions[0]);
    streams[1].pong(app, sessions[1]);
  }, 80);
  t.after(() => clearInterval(keepAlive));

  const dropped = await streams[0].waitFor(
    (s) => s.players.find((p) => p.id === sessions[2].playerId).connected === false,
    'Alex being noticed as gone'
  );
  assert.equal(dropped.players.find((p) => p.id === sessions[0].playerId).connected, true, 'Seb is still here');
  assert.equal(dropped.players.find((p) => p.id === sessions[1].playerId).connected, true, 'James is still here');

  // And the game works around him exactly as it would for a clean disconnect.
  const coverable = await streams[0].waitFor(
    (s) => s.you.canBidFor.some((target) => target.id === sessions[2].playerId),
    'the Master being offered his bid'
  );
  assert.equal(coverable.you.canBidFor[0].reason, 'disconnected');
});

test('a pong needs a valid session', async (t) => {
  const app = await startServer();
  t.after(() => app.stop());
  const host = await createGame(app, 'Seb');
  const bad = await request(app.base, 'POST', '/api/ping', {
    gameId: host.gameId,
    playerId: host.playerId,
    token: 'not-the-token',
  });
  assert.equal(bad.status, 401);
  const good = await request(app.base, 'POST', '/api/ping', {
    gameId: host.gameId,
    playerId: host.playerId,
    token: host.token,
  });
  assert.equal(good.status, 200);
});

// -- Rematch ------------------------------------------------------------------
// "Same people, next game" without everyone re-entering a code.

async function rematch(app, session) {
  return request(app.base, 'POST', `/api/games/${session.gameId}/rematch`, {
    playerId: session.playerId,
    token: session.token,
  });
}

async function rematchSession(app, oldGameId, session) {
  return request(app.base, 'POST', `/api/games/${oldGameId}/rematch-session`, {
    playerId: session.playerId,
    token: session.token,
  });
}

test('the Master can start a rematch and everyone connected is carried straight in', async (t) => {
  const app = await startServer();
  t.after(() => app.stop());
  const { host, sessions, streams } = await tableOf(app, ['Seb', 'James', 'Alex'], 3);
  t.after(() => streams.forEach((s) => s.close()));
  await playToComplete(app, sessions, streams, host, 5);
  await streams[0].waitFor((s) => s.phase === 'complete', 'the end');

  const rematchRes = await rematch(app, host);
  assert.equal(rematchRes.status, 201, JSON.stringify(rematchRes.body));
  assert.notEqual(rematchRes.body.gameId, host.gameId, 'a genuinely new game');
  assert.equal(rematchRes.body.state.phase, 'lobby');
  assert.equal(rematchRes.body.state.startHandSize, 3, 'the hand size carries over');
  assert.equal(rematchRes.body.state.you.isMaster, true);

  // The old game announces where the new one is, to everyone still watching it.
  const announced = await streams[1].waitFor((s) => Boolean(s.rematchGameId), 'the rematch pointer');
  assert.equal(announced.rematchGameId, rematchRes.body.gameId);
  assert.equal(announced.rematchCode, rematchRes.body.code);

  // James and Alex each fetch their own seat with their OLD credentials.
  const jamesSeat = await rematchSession(app, host.gameId, sessions[1]);
  assert.equal(jamesSeat.status, 200, JSON.stringify(jamesSeat.body));
  assert.equal(jamesSeat.body.gameId, rematchRes.body.gameId);
  assert.equal(jamesSeat.body.state.you.name, 'James');
  assert.equal(jamesSeat.body.state.you.isMaster, false);
  assert.notEqual(jamesSeat.body.playerId, sessions[1].playerId, 'a genuinely new player id in the new game');

  const alexSeat = await rematchSession(app, host.gameId, sessions[2]);
  assert.equal(alexSeat.status, 200);
  assert.equal(alexSeat.body.state.you.name, 'Alex');

  // The new lobby has everyone, nobody typed a code, and nobody scored a point.
  const newLobby = jamesSeat.body.state;
  assert.deepEqual(
    newLobby.players.map((p) => p.name).sort(),
    ['Alex', 'James', 'Seb']
  );
  assert.ok(newLobby.players.every((p) => p.total === 0));
});

test('a no-phone player is carried into the rematch automatically', async (t) => {
  const app = await startServer();
  t.after(() => app.stop());
  const host = await createGame(app, 'Seb', 3);
  const james = await joinGame(app, host.code, 'James');
  await send(app, host, { type: 'player/addOffline', name: 'Grandad' });

  const streams = [await new Stream(app.base, host).ready, await new Stream(app.base, james).ready];
  t.after(() => streams.forEach((s) => s.close()));
  await send(app, host, { type: 'game/start' });
  for (const stream of streams) await stream.waitFor((s) => s.phase === 'bidding', 'bidding');

  const sessions = [host, james];
  // Grandad's bid is entered by the Master, exactly as it would be at the table.
  const grandadId = streams[0].latest.players.find((p) => p.name === 'Grandad').id;
  for (let round = 1; round <= 5; round++) {
    await streams[0].waitFor((s) => s.phase === 'bidding' && s.round.number === round, 'bidding');
    for (const session of sessions) {
      await send(app, session, { type: 'bid/submit', playerId: session.playerId, value: 0 });
    }
    await send(app, host, { type: 'bid/submit', playerId: grandadId, value: 0 });
    await streams[0].waitFor((s) => s.phase === 'reveal' && s.round.number === round, 'reveal');
    await send(app, host, {
      type: 'results/submit',
      tricks: { [host.playerId]: 0, [james.playerId]: 0, [grandadId]: 0 },
      force: true,
    });
    await streams[0].waitFor((s) => s.phase === 'summary' && s.round.number === round, 'summary');
    await send(app, host, { type: 'round/next' });
  }
  await streams[0].waitFor((s) => s.phase === 'complete', 'the end');

  const rematchRes = await rematch(app, host);
  assert.equal(rematchRes.status, 201, JSON.stringify(rematchRes.body));
  const newLobby = rematchRes.body.state;
  const grandad = newLobby.players.find((p) => p.name === 'Grandad');
  assert.ok(grandad, 'Grandad is already in the new lobby without anyone touching a code');
  assert.equal(grandad.isOffline, true);
});

test('a player who was not connected is left off, with the code as their way back in', async (t) => {
  const app = await startServer();
  t.after(() => app.stop());
  const { host, sessions, streams } = await tableOf(app, ['Seb', 'James', 'Alex'], 3);
  t.after(() => streams.forEach((s) => s.close()));
  await playToComplete(app, sessions, streams, host, 5);
  await streams[0].waitFor((s) => s.phase === 'complete', 'the end');

  streams[2].close(); // Alex wanders off before the rematch starts
  await streams[0].waitFor(
    (s) => s.players.find((p) => p.id === sessions[2].playerId).connected === false,
    'Alex marked as gone'
  );

  const rematchRes = await rematch(app, host);
  assert.equal(rematchRes.status, 201);
  assert.deepEqual(
    rematchRes.body.state.players.map((p) => p.name).sort(),
    ['James', 'Seb'],
    'Alex is not in the new lobby - nothing is listening on his behalf'
  );

  const alexSeat = await rematchSession(app, host.gameId, sessions[2]);
  assert.equal(alexSeat.status, 404, 'no automatic seat for him');

  // But he can still get in the old-fashioned way, using the code the old
  // game's own state now shows.
  const oldState = await streams[0].waitFor((s) => Boolean(s.rematchCode), 'the fallback code');
  const joined = await request(app.base, 'POST', `/api/games/${oldState.rematchCode}/join`, { name: 'Alex' });
  assert.equal(joined.status, 201);
  assert.equal(joined.body.gameId, rematchRes.body.gameId);
});

test('a double-tapped "Play again" produces one rematch, not two', async (t) => {
  const app = await startServer();
  t.after(() => app.stop());
  const { host, sessions, streams } = await tableOf(app, ['Seb', 'James'], 3);
  t.after(() => streams.forEach((s) => s.close()));
  await playToComplete(app, sessions, streams, host, 5);
  await streams[0].waitFor((s) => s.phase === 'complete', 'the end');

  const [first, second] = await Promise.all([rematch(app, host), rematch(app, host)]);
  assert.equal(first.status, 201);
  assert.equal(second.status, 201);
  assert.equal(first.body.gameId, second.body.gameId, 'the same rematch, handed back twice');

  // And a third, later call agrees too.
  const third = await rematch(app, host);
  assert.equal(third.body.gameId, first.body.gameId);
});

test('only the Master can start a rematch, and only once the game has ended', async (t) => {
  const app = await startServer();
  t.after(() => app.stop());
  const { host, sessions, streams } = await tableOf(app, ['Seb', 'James'], 3);
  t.after(() => streams.forEach((s) => s.close()));

  const tooEarly = await rematch(app, host);
  assert.equal(tooEarly.status, 409);
  assert.equal(tooEarly.body.error.code, 'not-finished');

  await playToComplete(app, sessions, streams, host, 5);
  await streams[0].waitFor((s) => s.phase === 'complete', 'the end');

  const wrongPerson = await rematch(app, sessions[1]);
  assert.equal(wrongPerson.status, 409);
  assert.equal(wrongPerson.body.error.code, 'not-master');
});

test('rematch endpoints refuse a bad session', async (t) => {
  const app = await startServer();
  t.after(() => app.stop());
  const host = await createGame(app, 'Seb', 3);
  const forged = await rematch(app, { ...host, token: 'nope' });
  assert.equal(forged.status, 401);
  const forgedSession = await rematchSession(app, host.gameId, { ...host, token: 'nope' });
  assert.equal(forgedSession.status, 401);
});

// ── Online mode over the wire ────────────────────────────────────────────────

/** An online game with `names.length` players, all streaming, started and dealt. */
async function onlineTable(app, names, handSize = 3) {
  const created = await request(app.base, 'POST', '/api/games', { name: names[0], handSize, mode: 'online' });
  assert.equal(created.status, 201, created.text);
  const host = created.body;
  const sessions = [host];
  for (const name of names.slice(1)) sessions.push(await joinGame(app, host.code, name));
  const streams = [];
  for (const s of sessions) streams.push(await new Stream(app.base, s).ready);
  await send(app, host, { type: 'game/start' });
  for (const stream of streams) await stream.waitFor((s) => s.phase === 'bidding', 'bidding');
  return { host, sessions, streams };
}

test('a hand never reaches anybody else, and a card played does', async (t) => {
  const app = await startServer();
  t.after(() => app.stop());
  const { host, sessions, streams } = await onlineTable(app, ['Seb', 'James', 'Alex']);
  t.after(() => streams.forEach((s) => s.close()));

  for (const session of sessions) await send(app, session, { type: 'bid/submit', playerId: session.playerId, value: 0 });

  const views = [];
  for (const stream of streams) views.push(await stream.waitFor((s) => s.phase === 'playing', 'playing'));

  const hands = views.map((v) => v.you.hand);
  views.forEach((view, i) => {
    assert.equal(view.mode, 'online');
    assert.equal(hands[i].length, 3, 'you can see your own three cards');
    const payload = JSON.stringify(view);
    hands.forEach((hand, j) => {
      if (i === j) return;
      for (const card of hand) {
        assert.ok(!payload.includes(`"${card}"`), `${sessions[j].playerId}'s ${card} reached ${sessions[i].playerId}`);
      }
    });
    for (const seat of view.players) {
      if (seat.id === sessions[i].playerId) continue;
      assert.equal(seat.cardsHeld, 3, 'how many cards someone holds is public');
      assert.equal(seat.card, null, 'which cards they are is not');
    }
  });

  // Whoever is on lead plays; the card is face up for everybody after that.
  const turn = views.findIndex((v) => v.you.yourTurn);
  assert.ok(turn > -1, 'somebody has to be on lead');
  const cardId = views[turn].you.playable[0];
  const played = await send(app, sessions[turn], { type: 'trick/play', cardId });
  assert.equal(played.status, 200, played.text);

  for (const stream of streams) {
    const after = await stream.waitFor((s) => s.round && s.round.trick && s.round.trick.plays.length === 1, 'a card on the table');
    assert.equal(after.round.trick.plays[0].cardId, cardId);
    assert.equal(after.round.trick.plays[0].playerId, sessions[turn].playerId);
    assert.equal(after.round.trick.winningPlayerId, sessions[turn].playerId);
  }

  const leader = await streams[turn].waitFor((s) => s.you.cardsHeld === 2, 'the card left your hand');
  assert.ok(!leader.you.hand.includes(cardId));
  assert.equal(host.gameId, sessions[0].gameId);
});

test('an online game cannot be asked for typed-in results', async (t) => {
  const app = await startServer();
  t.after(() => app.stop());
  const { host, sessions, streams } = await onlineTable(app, ['Seb', 'James']);
  t.after(() => streams.forEach((s) => s.close()));

  for (const session of sessions) await send(app, session, { type: 'bid/submit', playerId: session.playerId, value: 0 });
  await streams[0].waitFor((s) => s.phase === 'playing', 'playing');

  const tricks = {};
  sessions.forEach((s) => {
    tricks[s.playerId] = 0;
  });
  const res = await send(app, host, { type: 'results/submit', tricks, force: true });
  assert.equal(res.status, 409, res.text);
  assert.match(res.text, /already knows who won what/);
});

test('a phone that goes mid-trick puts the choice in front of the Master', async (t) => {
  // A short stall window so the test is not sat waiting ten real seconds.
  const app = await startServer({ stallMs: 120 });
  t.after(() => app.stop());
  const { host, sessions, streams } = await onlineTable(app, ['Seb', 'James', 'Alex']);
  t.after(() => streams.forEach((s) => s.close()));

  for (const session of sessions) await send(app, session, { type: 'bid/submit', playerId: session.playerId, value: 0 });
  const opened = await streams[0].waitFor((s) => s.phase === 'playing', 'playing');

  // The Master leads, so the next player to act is somebody else — then their
  // phone goes, mid-trick, with everyone else sat waiting.
  assert.equal(opened.round.trick.turnId, host.playerId);
  await send(app, host, { type: 'trick/play', cardId: opened.you.playable[0] });
  const waiting = await streams[0].waitFor((s) => s.round && s.round.trick && s.round.trick.plays.length === 1, 'one card down');
  const missingIndex = sessions.findIndex((s) => s.playerId === waiting.round.trick.turnId);
  assert.ok(missingIndex > 0);
  streams[missingIndex].close();

  const offered = await streams[0].waitFor((s) => s.you.canSkipTurnsFor, 'the skip offer');
  assert.equal(offered.you.canSkipTurnsFor.id, sessions[missingIndex].playerId);

  // Nobody else is offered it.
  const bystander = sessions.findIndex((s, i) => i !== 0 && i !== missingIndex);
  const theirView = await streams[bystander].waitFor((s) => s.round && s.round.trick && s.round.trick.plays.length === 1, 'same moment');
  assert.equal(theirView.you.canSkipTurnsFor, null);

  await send(app, host, { type: 'trick/skipTurns', playerId: sessions[missingIndex].playerId });
  const played = await streams[0].waitFor(
    (s) => s.round && s.round.trick && s.round.trick.plays.length >= 2,
    'played for them'
  );
  assert.equal(played.round.trick.plays[1].playerId, sessions[missingIndex].playerId);
  assert.equal(played.players[missingIndex].skipped, true);
  assert.equal(played.you.canSkipTurnsFor, null, 'and the offer is spent');
});
