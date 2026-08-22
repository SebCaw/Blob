'use strict';

const path = require('path');

const { Store } = require('./server/store');
const { Rooms } = require('./server/rooms');
const { createServer, HEARTBEAT_MS } = require('./server/http');

/**
 * Blob - a companion app for the physical card game.
 *
 * Run it with `node server.js`. No build step and no dependencies: the
 * whole thing is Node's standard library plus static files.
 */

const PORT = Number(process.env.BLOB_PORT || process.env.PORT || 4100);
const HOST = process.env.BLOB_HOST || '0.0.0.0';
const DATA_DIR = process.env.BLOB_DATA_DIR || path.join(__dirname, 'data');
/** How long a dropped phone has to come back before the game works around it. */
const GRACE_MS = Number(process.env.BLOB_GRACE_MS) || undefined;
/** How long a Master election waits for stragglers before tallying. */
const ELECTION_MS = Number(process.env.BLOB_ELECTION_MS) || undefined;
/**
 * How long a phone may go without answering a heartbeat before it counts as
 * gone. It has to be comfortably longer than the heartbeat interval itself, or
 * every phone is dropped in the gap between two beats — so anything shorter is
 * raised rather than obeyed.
 */
const PRESENCE_FLOOR_MS = Math.round(HEARTBEAT_MS * 2.5);
const PRESENCE_MS = presenceSetting(process.env.BLOB_PRESENCE_MS);

function presenceSetting(raw) {
  const wanted = Number(raw);
  if (!wanted) return undefined;
  if (wanted >= PRESENCE_FLOOR_MS) return wanted;
  console.warn(
    `[blob] BLOB_PRESENCE_MS=${wanted} is below the ${PRESENCE_FLOOR_MS}ms floor ` +
      `(heartbeat is ${HEARTBEAT_MS}ms) — using the floor instead, or every phone would be dropped between beats.`
  );
  return PRESENCE_FLOOR_MS;
}
const PUBLIC_DIR = path.join(__dirname, 'public');
const SWEEP_MS = 30 * 60 * 1000;
/** How often to look for phones that have stopped answering the heartbeat. */
const PRESENCE_SWEEP_MS = 5000;

/**
 * Wire everything together. Exported so the tests can start a server on an
 * ephemeral port with its own temporary data directory.
 *
 * @param {{dataDir?:string, graceMs?:number, electionMs?:number}} [options]
 */
async function build(options = {}) {
  const store = new Store(options.dataDir || DATA_DIR);
  store.init();

  const rooms = new Rooms({
    store,
    graceMs: options.graceMs ?? GRACE_MS,
    electionMs: options.electionMs ?? ELECTION_MS,
    presenceMs: options.presenceMs ?? PRESENCE_MS,
    stallMs: options.stallMs,
  });
  const restored = await rooms.restore();

  const server = createServer({ rooms, store, publicDir: PUBLIC_DIR });

  const sweeper = setInterval(() => rooms.sweep(), SWEEP_MS);
  if (sweeper.unref) sweeper.unref();

  const presence = setInterval(() => rooms.sweepPresence(), options.presenceSweepMs || PRESENCE_SWEEP_MS);
  if (presence.unref) presence.unref();

  const close = () =>
    new Promise((resolve) => {
      clearInterval(sweeper);
      clearInterval(presence);
      rooms.disposeAll();
      server.close(() => resolve());
      // Long-lived SSE responses hold sockets open, so nudge them shut.
      server.closeAllConnections?.();
    });

  return { server, rooms, store, restored, close };
}

async function main() {
  const { server, restored } = await build();
  server.listen(PORT, HOST, () => {
    console.log(`[blob] listening on http://${HOST}:${PORT}`);
    if (restored) console.log(`[blob] picked up ${restored} game(s) that were still in progress`);
  });

  const shutdown = () => {
    console.log('[blob] shutting down');
    server.close(() => process.exit(0));
    server.closeAllConnections?.();
    setTimeout(() => process.exit(0), 2000).unref();
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

if (require.main === module) {
  main().catch((err) => {
    console.error('[blob] failed to start', err);
    process.exit(1);
  });
}

module.exports = { build, PORT };
