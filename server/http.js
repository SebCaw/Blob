'use strict';

const http = require('http');
const fsp = require('fs/promises');
const path = require('path');

const { MIN_HAND_SIZE } = require('../lib/rounds');
const { knownEngine, DEFAULT_ENGINE } = require('../lib/engines');

/**
 * The HTTP surface: a handful of JSON endpoints, one Server-Sent Events stream,
 * and the static app.
 *
 * Push uses SSE rather than WebSockets on purpose. The browser reconnects an
 * EventSource by itself, it survives phone networks and proxies well, and the
 * command rate here (a bid, a result, a round) never needed a duplex socket.
 * Commands travel the other way as ordinary POSTs.
 */

const MAX_BODY_BYTES = 16 * 1024;
/**
 * How often the server pings each phone. The client answers every one, and the
 * presence timeout is derived from this — the two move together on purpose.
 */
const HEARTBEAT_MS = Number(process.env.BLOB_HEARTBEAT_MS) || 10000;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
};

const SECURITY_HEADERS = {
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'same-origin',
  'X-Frame-Options': 'SAMEORIGIN',
  'Content-Security-Policy':
    "default-src 'self'; img-src 'self' data:; style-src 'self'; script-src 'self'; " +
    "connect-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'self'",
};

/**
 * @param {{rooms:object, store:object, publicDir:string}} deps
 * @returns {import('http').Server}
 */
function createServer({ rooms, store, publicDir, alerter }) {
  const limiter = new RateLimiter();

  const server = http.createServer(async (req, res) => {
    try {
      await route(req, res, { rooms, store, publicDir, limiter, alerter });
    } catch (err) {
      console.error('[blob] request failed', req.method, req.url, err);
      if (!res.headersSent) {
        sendJson(res, 500, { error: { code: 'server', message: 'Something went wrong at our end.' } });
      } else {
        res.end();
      }
    }
  });
  // SSE streams are long-lived by design, so Node's keep-alive timeout must not
  // cut them off mid-game.
  server.keepAliveTimeout = 0;
  server.headersTimeout = 60000;
  server.requestTimeout = 0;
  return server;
}

async function route(req, res, deps) {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const pathname = url.pathname;

  if (req.method === 'OPTIONS') return send(res, 204, {}, '');

  if (pathname === '/api/stream' && req.method === 'GET') return streamHandler(req, res, url, deps);
  if (pathname === '/api/games' && req.method === 'POST') return createGameHandler(req, res, deps);
  if (pathname === '/api/command' && req.method === 'POST') return commandHandler(req, res, deps);
  if (pathname === '/api/ping' && req.method === 'POST') return pingHandler(req, res, deps);
  if (pathname === '/api/oops' && req.method === 'POST') return oopsHandler(req, res, deps);
  if (pathname === '/api/history' && req.method === 'GET') return historyListHandler(res, deps);
  if (pathname === '/healthz') return sendJson(res, 200, { ok: true, games: deps.rooms.byId.size });

  let match = pathname.match(/^\/api\/games\/(\d{4,6})\/join$/);
  if (match && req.method === 'POST') return joinHandler(req, res, match[1], deps);

  match = pathname.match(/^\/api\/games\/(\d{4,6})$/);
  if (match && req.method === 'GET') return lookupHandler(res, match[1], deps);

  // Rematch routes go by game ID, not code — the caller already holds a
  // session for the game that just finished.
  match = pathname.match(/^\/api\/games\/([a-zA-Z0-9_]+)\/rematch$/);
  if (match && req.method === 'POST') return rematchHandler(req, res, match[1], deps);

  match = pathname.match(/^\/api\/games\/([a-zA-Z0-9_]+)\/rematch-session$/);
  if (match && req.method === 'POST') return rematchSessionHandler(req, res, match[1], deps);

  match = pathname.match(/^\/api\/history\/([a-zA-Z0-9_]+)$/);
  if (match && req.method === 'GET') return historyOneHandler(res, match[1], deps);

  if (pathname.startsWith('/api/')) {
    return sendJson(res, 404, { error: { code: 'not-found', message: 'That is not something Blob offers.' } });
  }

  return staticHandler(res, pathname, deps.publicDir);
}

// -- Endpoints ---------------------------------------------------------------

/** Create a game. The caller becomes the first player and the Master. */
async function createGameHandler(req, res, { rooms, limiter }) {
  if (!limiter.allow(clientKey(req))) return tooMany(res);
  const body = await readJson(req, res);
  if (body === undefined) return undefined;

  const hostName = cleanName(body.name);
  if (!hostName) return sendJson(res, 400, badRequest('Pop your name in first.'));

  // Which game off the shelf. Anything unrecognised is Blob, which is what a
  // client that predates the shelf is asking for anyway.
  const gameId = knownEngine(body.game) ? body.game : DEFAULT_ENGINE;

  const handSize = Number.isInteger(body.handSize) ? body.handSize : 7;
  if (gameId === 'blob' && handSize < MIN_HAND_SIZE) {
    return sendJson(res, 400, badRequest(`The starting hand needs to be at least ${MIN_HAND_SIZE} cards.`));
  }

  // Anything other than an explicit 'online' is a game round a table, which is
  // both the original mode and the one we would rather people played.
  const mode = body.mode === 'online' ? 'online' : 'table';

  const { room, player, token } = rooms.create({
    game: gameId,
    hostName,
    startHandSize: handSize,
    mode,
    quick: Boolean(body.quick),
  });
  return sendJson(res, 201, {
    gameId: room.state.id,
    game: room.state.game || DEFAULT_ENGINE,
    code: room.state.code,
    playerId: player.id,
    token,
    state: room.viewFor(player.id),
  });
}

/** Join an existing lobby by its code. */
async function joinHandler(req, res, code, { rooms, limiter }) {
  if (!limiter.allow(clientKey(req))) return tooMany(res);
  const body = await readJson(req, res);
  if (body === undefined) return undefined;

  const name = cleanName(body.name);
  if (!name) return sendJson(res, 400, badRequest('Pop your name in first.'));

  const room = rooms.byGameCode(code);
  if (!room) return sendJson(res, 404, badRequest("We couldn't find a game with that code. Check the digits?"));

  const outcome = await room.dispatch({ type: 'player/join', name }, { actorId: null });
  if (!outcome.ok) return sendJson(res, 409, { error: outcome.error });

  const player = outcome.result.player;
  const token = room.issueSession(player.id);
  return sendJson(res, 201, {
    gameId: room.state.id,
    code: room.state.code,
    playerId: player.id,
    token,
    state: room.viewFor(player.id),
  });
}

/** Does this code exist, and is it still open? Used by the join screen. */
function lookupHandler(res, code, { rooms }) {
  const room = rooms.byGameCode(code);
  if (!room) return sendJson(res, 404, badRequest("We couldn't find a game with that code."));
  return sendJson(res, 200, {
    code: room.state.code,
    game: room.state.game || DEFAULT_ENGINE,
    phase: room.state.phase,
    mode: room.state.mode || 'table',
    players: room.state.players.length,
    // An online game stays open once it has started: a latecomer is dealt in from
    // the next hand. Round a table the cards are already out, so it does not.
    open: room.state.phase === 'lobby' || (room.state.mode === 'online' && room.state.phase !== 'complete'),
    started: room.state.phase !== 'lobby',
    masterName: (room.state.players.find((p) => p.id === room.state.masterId) || {}).name || null,
  });
}

/**
 * Every game action goes through here. The body carries who is asking and the
 * session token proving it; the server decides whether they may.
 */
async function commandHandler(req, res, { rooms, limiter }) {
  if (!limiter.allow(clientKey(req), 200)) return tooMany(res);
  const body = await readJson(req, res);
  if (body === undefined) return undefined;

  const { gameId, playerId, token, cmdId, command } = body;
  const room = rooms.get(String(gameId || ''));
  if (!room) return sendJson(res, 404, badRequest('That game has finished or is no longer available.'));
  if (!room.authenticate(String(playerId || ''), String(token || ''))) {
    return sendJson(res, 401, { error: { code: 'auth', message: "We couldn't verify it was you. Try rejoining." } });
  }
  if (!command || typeof command.type !== 'string') return sendJson(res, 400, badRequest('That action made no sense.'));

  const outcome = await room.dispatch(command, { actorId: playerId, cmdId: cmdId ? String(cmdId) : null });
  if (!outcome.ok) return sendJson(res, 409, { error: outcome.error });
  return sendJson(res, 200, { ok: true, state: room.viewFor(playerId) });
}

/**
 * The other half of the heartbeat.
 *
 * SSE only pushes, so the server cannot tell a phone in a tunnel from a quiet
 * one: its writes keep succeeding into a socket nobody is reading. The client
 * answers each heartbeat with one of these, and a player who stops answering is
 * treated as gone.
 */
async function pingHandler(req, res, { rooms, limiter }) {
  // Generous: a table of eight phones behind one router pings often, and this
  // is the one request that must never be turned away.
  if (!limiter.allow(clientKey(req), 1200)) return tooMany(res);
  const body = await readJson(req, res);
  if (body === undefined) return undefined;

  const room = rooms.get(String(body.gameId || ''));
  if (!room) return sendJson(res, 404, badRequest('That game is no longer available.'));
  if (!room.authenticate(String(body.playerId || ''), String(body.token || ''))) {
    return sendJson(res, 401, { error: { code: 'auth', message: "We couldn't verify it was you." } });
  }
  room.touch(String(body.playerId));
  return sendJson(res, 200, { ok: true });
}

/** The most of any one field we will write into the log. */
const OOPS_FIELD = 300;
/** And of a stack, which is the part actually worth having. */
const OOPS_STACK = 1200;

/**
 * Something went wrong on somebody's phone, and now we know.
 *
 * **Why this exists.** Every bug in this app until now has been found either by
 * Seb playing it or by a machine playing it. Neither covers the case that
 * matters most once other people arrive: a nephew's phone throws on some screen,
 * he shrugs, closes the tab, and quietly never plays again. Nobody is told, so
 * it is never fixed. This turns that silence into a line in the server log.
 *
 * **It is not analytics and must never become analytics.** It fires only when
 * something actually threw. There is no session id, no page-view, no timing, no
 * identifier of any kind, and nothing is stored — it goes to the log and the log
 * scrolls away. The privacy page says exactly this, and if that ever stops being
 * true the privacy page is the first thing that has to change.
 *
 * Deliberately unauthenticated: an error can happen before you have joined
 * anything, which is precisely when you most want to hear about it. That makes
 * it the one open write endpoint, so it is rate limited hard, capped in size,
 * and never echoes anything back that could be used to probe the server.
 */
async function oopsHandler(req, res, { limiter, alerter }) {
  // Always 204, whatever happens. A reporter that can fail is a second thing to
  // go wrong on a page that is already broken, and there is nothing the phone
  // could usefully do with an error about its error.
  const done = () => (res.headersSent ? undefined : send(res, 204, {}, ''));

  // Tight, and tighter than anything else here. A page stuck in a render loop
  // can throw hundreds of times a second, and a whole family shares one address,
  // so this is "enough to tell us what broke" rather than "every occurrence".
  // Hitting the limit is not an error worth reporting either - hence 204.
  if (!limiter.allow(`oops:${clientKey(req)}`, 30)) return done();

  const body = await readJson(req, res);
  if (body === undefined) return undefined;

  const clip = (value, max) => String(value == null ? '' : value).replace(/\s+/g, ' ').slice(0, max);
  const where = clip(body.where, OOPS_FIELD);
  const message = clip(body.message, OOPS_FIELD);
  if (!message) return done();

  const report = {
    message,
    where,
    game: clip(body.game, 40),
    screen: clip(body.screen, 60),
    build: clip(body.build, 40),
    agent: clip(req.headers['user-agent'], 160),
    stack: clip(body.stack, OOPS_STACK),
  };

  console.error('[blob] a phone reported an error', JSON.stringify(report));

  // And, if it is configured, an email - batched and then quiet for a while,
  // because the fault most worth hearing about is also the one that throws
  // hundreds of times. See `server/alerts.js`. Never awaited: the phone is not
  // waiting on Seb's inbox.
  if (alerter) {
    try {
      alerter.record(report);
    } catch {
      // An alerter that goes wrong must not take the report with it.
    }
  }

  return done();
}

/**
 * The Master starts a rematch: a fresh lobby, same starting hand size,
 * carrying in everyone still reachable. This response hands the CALLER their
 * own new session directly, since they are the one asking; everyone else's is
 * fetched separately once their own client notices the finished game now
 * points at one (`rematchSessionHandler`, below).
 */
async function rematchHandler(req, res, gameId, { rooms, limiter }) {
  if (!limiter.allow(clientKey(req))) return tooMany(res);
  const body = await readJson(req, res);
  if (body === undefined) return undefined;

  const room = rooms.get(gameId);
  if (!room) return sendJson(res, 404, badRequest('That game has finished or is no longer available.'));
  const playerId = String(body.playerId || '');
  if (!room.authenticate(playerId, String(body.token || ''))) {
    return sendJson(res, 401, { error: { code: 'auth', message: "We couldn't verify it was you. Try rejoining." } });
  }

  const outcome = await rooms.rematch(room, playerId);
  if (outcome.error) return sendJson(res, 409, { error: outcome.error });

  // Tell everyone else still on the finished game where the new one is. This
  // is a real command — broadcast and persisted like any other change — and
  // it only ever carries a game id and a join code, never a token.
  await room.dispatch(
    { type: 'game/rematchStarted', gameId: outcome.room.state.id, code: outcome.room.state.code },
    { actorId: playerId }
  );

  return sendJson(res, 201, {
    gameId: outcome.room.state.id,
    code: outcome.room.state.code,
    playerId: outcome.player.id,
    token: outcome.token,
    state: outcome.room.viewFor(outcome.player.id),
  });
}

/**
 * How everyone but the Master finds their seat in a rematch: they notice
 * `state.rematchGameId` appear on the finished game and ask "what's mine in
 * that one?", proving who they are with their OLD session — the same pattern
 * every authenticated action here uses. A player who was not reachable when
 * the rematch was created (disconnected, and never a no-phone player) was not
 * carried in automatically, and gets a 404 — their own screen shows the
 * public `rematchCode` as the way back in instead.
 */
async function rematchSessionHandler(req, res, gameId, { rooms, limiter }) {
  if (!limiter.allow(clientKey(req), 200)) return tooMany(res);
  const body = await readJson(req, res);
  if (body === undefined) return undefined;

  const room = rooms.get(gameId);
  if (!room) return sendJson(res, 404, badRequest('That game has finished or is no longer available.'));
  const playerId = String(body.playerId || '');
  if (!room.authenticate(playerId, String(body.token || ''))) {
    return sendJson(res, 401, { error: { code: 'auth', message: "We couldn't verify it was you. Try rejoining." } });
  }

  const mine = room.rematchSessions && room.rematchSessions.get(playerId);
  if (!mine) return sendJson(res, 404, badRequest("You'll need to join the new game with its code."));
  const newRoom = rooms.get(mine.gameId);
  if (!newRoom) return sendJson(res, 404, badRequest('That rematch is no longer available.'));

  return sendJson(res, 200, {
    gameId: mine.gameId,
    code: mine.code,
    playerId: mine.playerId,
    token: mine.token,
    state: newRoom.viewFor(mine.playerId),
  });
}

/**
 * The live stream. Opening it IS reconnecting: the player is marked connected,
 * their grace timer is cancelled, and they immediately receive the current
 * state - whatever screen the game is on.
 */
function streamHandler(req, res, url, { rooms }) {
  const gameId = url.searchParams.get('gameId') || '';
  const playerId = url.searchParams.get('playerId') || '';
  const token = url.searchParams.get('token') || '';

  const room = rooms.get(gameId);
  if (!room) return sendJson(res, 404, badRequest('That game has finished or is no longer available.'));
  if (!room.authenticate(playerId, token)) {
    return sendJson(res, 401, { error: { code: 'auth', message: "We couldn't verify it was you. Try rejoining." } });
  }

  res.writeHead(200, {
    ...SECURITY_HEADERS,
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    // Some proxies buffer streamed responses and would hold every update back.
    'X-Accel-Buffering': 'no',
  });
  res.write('retry: 2000\n\n');

  const pushEvent = (event, data) => {
    res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  };

  const connId = room.attach(playerId, pushEvent);

  // A real event rather than an SSE comment: a comment keeps proxies awake but
  // is invisible to the browser, so the client could not tell a quiet game from
  // a connection that had silently died. This is what the client's watchdog
  // listens for.
  const heartbeat = setInterval(() => {
    try {
      pushEvent('ping', HEARTBEAT_MS);
    } catch {
      clearInterval(heartbeat);
    }
  }, HEARTBEAT_MS);
  if (heartbeat.unref) heartbeat.unref();

  let closed = false;
  const close = () => {
    if (closed) return;
    closed = true;
    clearInterval(heartbeat);
    room.detach(connId);
  };
  req.on('close', close);
  req.on('error', close);
  res.on('error', close);
  return undefined;
}

async function historyListHandler(res, { store }) {
  return sendJson(res, 200, { games: await store.listHistory() });
}

async function historyOneHandler(res, id, { store }) {
  const record = await store.readHistory(id);
  if (!record) return sendJson(res, 404, badRequest("We couldn't find that game."));
  return sendJson(res, 200, record);
}

// -- Static files ------------------------------------------------------------

/**
 * Serve a file, and decide what a miss MEANS.
 *
 * Two kinds of miss, and telling them apart is the whole of this function.
 *
 * A path with no file extension - `/join/4827`, `/history` - is a ROUTE. The
 * app is a single page that reads its own URL, so those have to open the app
 * shell; answering 404 would be wrong and would break every deep link and every
 * shared game link.
 *
 * A path WITH an extension - `/styles.cs`, `/icons/blob.pn` - was asking for a
 * file, and that file is not there. Quietly handing back the app shell with a
 * 200 was the old behaviour and it is worse than useless: a mistyped stylesheet
 * would arrive as a page of HTML, reported as success, and fail somewhere much
 * further away from the cause. That gets the 404 page and a 404 status.
 */
async function staticHandler(res, pathname, publicDir) {
  const rel = pathname === '/' ? '/index.html' : pathname;
  const root = path.resolve(publicDir);
  const resolved = path.resolve(root, `.${path.posix.normalize(rel)}`);
  if (!resolved.startsWith(root)) return send(res, 403, {}, 'Nope.');

  let file = resolved;
  let missing = false;
  try {
    const stat = await fsp.stat(file);
    if (stat.isDirectory()) file = path.join(file, 'index.html');
  } catch {
    // An extension means a file was meant; anything else is one of the app's
    // own routes and belongs to the shell.
    missing = Boolean(path.extname(resolved));
    file = path.join(root, missing ? '404.html' : 'index.html');
  }

  const ext = path.extname(file);
  const type = MIME[ext] || 'application/octet-stream';
  const immutable = ext === '.png' || ext === '.svg' || ext === '.woff2';

  try {
    const data = await fsp.readFile(file);
    return send(
      res,
      missing ? 404 : 200,
      { 'Content-Type': type, 'Cache-Control': immutable ? 'public, max-age=604800' : 'no-cache' },
      data
    );
  } catch {
    return send(res, 404, { 'Content-Type': 'text/plain; charset=utf-8' }, 'Not found');
  }
}

// -- Plumbing ----------------------------------------------------------------

/** A very small fixed-window limiter - enough to blunt a script, not a firewall. */
class RateLimiter {
  constructor(windowMs = 60000) {
    this.windowMs = windowMs;
    /** @type {Map<string,{count:number, resetAt:number}>} */
    this.hits = new Map();
  }

  allow(key, limit = 60) {
    const now = Date.now();
    let entry = this.hits.get(key);
    if (!entry || entry.resetAt < now) {
      entry = { count: 0, resetAt: now + this.windowMs };
      this.hits.set(key, entry);
    }
    entry.count += 1;
    if (this.hits.size > 5000) {
      for (const [k, v] of this.hits) if (v.resetAt < now) this.hits.delete(k);
    }
    return entry.count <= limit;
  }
}

function clientKey(req) {
  const forwarded = req.headers['x-forwarded-for'];
  if (typeof forwarded === 'string' && forwarded.length) return forwarded.split(',')[0].trim();
  return req.socket.remoteAddress || 'unknown';
}

function tooMany(res) {
  return sendJson(res, 429, { error: { code: 'busy', message: 'Slow down a moment, then try again.' } });
}

function badRequest(message) {
  return { error: { code: 'bad-request', message } };
}

/** @returns {Promise<any|undefined>} undefined means a response has already been sent */
function readJson(req, res) {
  return new Promise((resolve) => {
    let size = 0;
    const chunks = [];
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        // `Connection: close` before the destroy, and it is not decoration.
        // Destroying the request kills the socket, and a client that had been
        // told nothing would put that socket back in its keep-alive pool and get
        // ECONNRESET on its NEXT request - a perfectly good one, failing because
        // of an oversized one that came before it. Saying "close" makes the
        // client open a fresh connection instead. Found by a test that sent a
        // huge report and then a normal one.
        if (!res.headersSent) res.setHeader('Connection', 'close');
        sendJson(res, 413, badRequest('That was too much data.'));
        req.destroy();
        resolve(undefined);
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      if (res.headersSent) return resolve(undefined);
      try {
        resolve(chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {});
      } catch {
        sendJson(res, 400, badRequest('That action made no sense.'));
        resolve(undefined);
      }
    });
    req.on('error', () => resolve(undefined));
  });
}

function sendJson(res, status, payload) {
  return send(res, status, { 'Content-Type': 'application/json; charset=utf-8' }, JSON.stringify(payload));
}

function send(res, status, headers, body) {
  if (res.headersSent) return undefined;
  res.writeHead(status, { ...SECURITY_HEADERS, ...headers });
  res.end(body);
  return undefined;
}

/**
 * Names are shown to everyone at the table, so keep them short and printable.
 * Control characters are dropped outright rather than escaped downstream.
 */
function cleanName(value) {
  if (typeof value !== 'string') return '';
  let out = '';
  for (const ch of value) {
    const code = ch.codePointAt(0);
    if (code < 32 || code === 127) continue;
    out += ch;
  }
  return out.trim().slice(0, 16);
}

module.exports = { createServer, cleanName, RateLimiter, MIME, HEARTBEAT_MS };
