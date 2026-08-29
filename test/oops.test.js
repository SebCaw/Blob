'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { build } = require('../server');

/**
 * The error reporter, from the server's side.
 *
 * It exists so that a fault on somebody else's phone stops being silent - see
 * `public/errors.js`. Being the only endpoint that takes a write from a caller
 * who has not joined anything, it is also the one most worth being careful
 * about, and these are the things that carefulness means:
 *
 *   - it never fails in a way the page has to handle
 *   - it never says anything back that could be used to probe the server
 *   - it cannot be used to fill the log
 *
 * What it writes is checked by capturing `console.error`, because the log IS the
 * feature. A reporter that accepts everything and records nothing would pass a
 * test that only looked at status codes.
 */

async function startServer() {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'blob-oops-'));
  const app = await build({ dataDir });
  await new Promise((resolve) => app.server.listen(0, '127.0.0.1', resolve));
  const { port } = app.server.address();
  return {
    ...app,
    base: `http://127.0.0.1:${port}`,
    async stop() {
      await app.close();
      fs.rmSync(dataDir, { recursive: true, force: true });
    },
  };
}

/**
 * Run a test against a server that is ALWAYS shut down afterwards.
 *
 * The obvious shape - start, assert, stop - leaks a listening server the moment
 * an assertion fails, and `node --test` then waits for an event loop that will
 * never drain. The whole suite hangs, and the reason is nowhere near the
 * message. Once was enough.
 */
async function withServer(fn) {
  const app = await startServer();
  try {
    return await fn(app);
  } finally {
    await app.stop();
  }
}

/**
 * A POST that treats a dropped connection as an ANSWER rather than a crash.
 *
 * The server answers an oversized body with 413 and then destroys the socket, so
 * the sending side gets ECONNRESET - sometimes instead of the reply, sometimes
 * just after it. Rejecting on that made the error surface as an unhandled
 * failure attributed to whichever test happened to be running, which is a long
 * way from the cause. It is also exactly why the real reporter never waits on
 * the response: see `public/errors.js`.
 */
function post(base, urlPath, body, raw) {
  return new Promise((resolve) => {
    const payload = raw !== undefined ? Buffer.from(raw) : Buffer.from(JSON.stringify(body));
    let settled = false;
    const done = (value) => {
      if (settled) return;
      settled = true;
      resolve(value);
    };
    const req = http.request(
      `${base}${urlPath}`,
      { method: 'POST', headers: { 'content-type': 'application/json', 'content-length': payload.length } },
      (res) => {
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('error', (err) => done({ status: res.statusCode || 0, text: '', dropped: err.code }));
        res.on('end', () => done({ status: res.statusCode, text: Buffer.concat(chunks).toString('utf8') }));
      }
    );
    req.on('error', (err) => done({ status: 0, text: '', dropped: err.code }));
    req.write(payload);
    req.end();
  });
}

/** Run something with `console.error` captured rather than printed. */
async function capturing(fn) {
  const lines = [];
  const real = console.error;
  console.error = (...args) => lines.push(args.map(String).join(' '));
  try {
    await fn();
  } finally {
    console.error = real;
  }
  return lines;
}

test('a reported error reaches the log with its context', async () => {
  const lines = await withServer((app) => capturing(async () => {
    const res = await post(app.base, '/api/oops', {
      where: 'window',
      message: 'kitchen table exploded',
      stack: 'Error: kitchen table exploded\n  at somewhere',
      game: 'cheat',
      screen: 'lobby',
      build: 'blob-shell-v56',
    });
    assert.equal(res.status, 204, 'the page is told nothing, successfully');
    assert.equal(res.text, '', 'and nothing comes back that could be probed');
  }));

  const line = lines.find((l) => l.includes('kitchen table exploded'));
  assert.ok(line, 'the error never reached the log, which is the whole point');
  assert.ok(line.includes('"screen":"lobby"'), 'and it says where somebody was');
  assert.ok(line.includes('"build":"blob-shell-v56"'), 'and which shell they were running');
});

test('an empty report is dropped rather than logged', async () => {
  // A page can throw something with no message at all. There is nothing to act
  // on, and a log full of blanks is worse than a log without them.
  const lines = await withServer((app) => capturing(async () => {
    const res = await post(app.base, '/api/oops', { where: 'window', message: '' });
    assert.equal(res.status, 204);
  }));
  assert.equal(lines.filter((l) => l.includes('a phone reported an error')).length, 0);
});

test('nonsense in the body does not take the endpoint down', async () => {
  await withServer(async (app) => {
    const res = await post(app.base, '/api/oops', undefined, 'this is not json at all');
    // Whatever it answers, it must answer - the important thing is that the next
    // request still works.
    assert.ok(res.status >= 200 && res.status < 500, `unexpected ${res.status}`);
    const after = await capturing(() => post(app.base, '/api/oops', { message: 'still here' }));
    assert.ok(after.some((l) => l.includes('still here')), 'the endpoint stopped working after bad input');
  });
});

test('a long report is cut down before it is written', async () => {
  // A stack can be enormous. The log is a shared resource on a small server, so
  // what arrives is trimmed rather than written out in full. Sized to fit inside
  // the body limit on purpose: this is testing the trimming, not the limit.
  const lines = await withServer((app) => capturing(async () => {
    await post(app.base, '/api/oops', {
      where: 'window',
      message: 'x'.repeat(2000),
      stack: 'y'.repeat(6000),
    });
  }));

  const line = lines.find((l) => l.includes('a phone reported an error'));
  assert.ok(line, 'nothing was logged');
  assert.ok(line.length < 3000, `the log line was not trimmed (${line.length} chars)`);
  assert.ok(!line.includes('x'.repeat(400)), 'the message went in at full length');
});

test('a report too big to be sensible is refused outright', async () => {
  // Past the body limit nothing is even parsed: the server answers 413 and drops
  // the connection, so the sending side may well see a reset rather than a
  // reply. That is fine and is why the reporter never waits on the response.
  // What matters is that nothing was logged and the server is still there.
  await withServer(async (app) => {
    const lines = await capturing(async () => {
      const res = await post(app.base, '/api/oops', { where: 'window', message: 'z'.repeat(40_000) });
      // Either a 413 or a dropped connection. Both are the server saying no.
      assert.ok(res.status === 413 || res.dropped, `unexpected ${res.status} ${res.text}`);
    });
    const after = await capturing(() => post(app.base, '/api/oops', { message: 'still here' }));

    assert.equal(lines.filter((l) => l.includes('a phone reported an error')).length, 0);
    assert.ok(after.some((l) => l.includes('still here')), 'the endpoint stopped working afterwards');
  });
});

test('a phone throwing over and over cannot fill the log', async () => {
  const lines = await withServer((app) => capturing(async () => {
    for (let i = 0; i < 60; i += 1) {
      // Each one different, so client-side de-duplication is not what is being
      // measured here - this is the server's own limit.
      await post(app.base, '/api/oops', { where: 'window', message: `fault number ${i}` });
    }
  }));

  const written = lines.filter((l) => l.includes('a phone reported an error')).length;
  assert.ok(written > 0, 'nothing got through at all');
  assert.ok(written < 60, `every single one was written (${written}), so nothing is limiting it`);
});
