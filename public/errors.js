/**
 * Tell the server when something threw on somebody's phone.
 *
 * **The problem this solves.** Until now every bug here has been found by Seb
 * playing the game or by `tools/soak.js` playing it a few thousand times.
 * Neither covers what happens once other people arrive: a phone throws on some
 * screen, that person shrugs and closes the tab, and nobody ever hears about it.
 * The bug is not rare, it is just silent. This makes it a line in the server log.
 *
 * **It is not analytics.** It fires only when something actually threw. No page
 * views, no timings, no session id, no identifier of any sort - and no names,
 * codes or cards, which is why the report carries the ROUTE rather than the
 * screen's contents. The privacy page says as much, and if this ever grows into
 * something that watches people rather than watching for faults, that page is
 * the first thing that has to change.
 *
 * Best effort throughout. Every failure path here ends in silence, because a
 * reporter that can itself go wrong is a second fault on a page that already has
 * one.
 */

const ENDPOINT = '/api/oops';

/**
 * A hard cap per page load.
 *
 * A render loop that throws can do it hundreds of times a second, and the
 * hundredth copy of an error says nothing the first did not. The server limits
 * this too; doing it here as well means a broken phone is not also flooding its
 * own network.
 */
const MAX_REPORTS = 8;

/** Identical errors are the same bug however many times they arrive. */
const seen = new Set();
let sent = 0;

/**
 * What was on screen when it happened, in the vaguest terms that are still
 * useful. `ui.route` is a word like "shelf" or "game" - never a name, a code or
 * a card.
 */
let describe = () => ({});

export function setErrorContext(fn) {
  if (typeof fn === 'function') describe = fn;
}

/**
 * Which shell this phone is actually running, taken from the service worker's
 * own cache name.
 *
 * Worth having above almost anything else in a report. A stale shell has been
 * the cause of several confusing evenings on this project - the code on the
 * server was fixed and the phone was still running last week's - and "it is
 * broken" reads very differently once you can see they are three versions
 * behind. Read once, on the way past; if it is unavailable the report simply
 * does without it.
 */
let build = '';
try {
  if (window.caches && caches.keys) {
    caches.keys().then((names) => {
      build = names.find((name) => name.startsWith('blob-shell')) || '';
    }).catch(() => {});
  }
} catch {
  // Private windows and blocked storage both land here. Not worth a word.
}

function report(where, error, extra = {}) {
  try {
    if (sent >= MAX_REPORTS) return;

    const message = String((error && error.message) || error || 'unknown').slice(0, 300);
    const stack = String((error && error.stack) || '').slice(0, 1200);
    const key = `${where}:${message}`;
    if (seen.has(key)) return;
    seen.add(key);
    sent += 1;

    let context = {};
    try {
      context = describe() || {};
    } catch {
      // The app being too broken to say where it is does not stop the report.
    }

    const payload = JSON.stringify({ where, message, stack, build, ...context, ...extra });

    // `keepalive` so a report survives the navigation that an error often
    // precedes - a phone that throws and then closes the tab is exactly the case
    // this exists for. Falls back to fetch without it, then gives up quietly.
    if (navigator.sendBeacon) {
      const ok = navigator.sendBeacon(ENDPOINT, new Blob([payload], { type: 'application/json' }));
      if (ok) return;
    }
    fetch(ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: payload,
      keepalive: true,
    }).catch(() => {});
  } catch {
    // Nothing. See the note at the top.
  }
}

/**
 * Start listening.
 *
 * Both halves matter. `error` catches what throws; `unhandledrejection` catches
 * the async half, which is most of this app - every command, every fetch, every
 * reconnect is a promise, and a rejected one throws no error event at all.
 */
export function watchForErrors() {
  window.addEventListener('error', (event) => {
    // A failed <img> or <script> also fires this, with no error attached. Those
    // are worth knowing about too, but they are not exceptions.
    if (!event.error && event.target && event.target !== window) {
      const src = event.target.src || event.target.href;
      if (src) report('asset', new Error(`failed to load ${String(src).slice(0, 200)}`));
      return;
    }
    report('window', event.error || event.message);
  }, true);

  window.addEventListener('unhandledrejection', (event) => {
    report('promise', event.reason);
  });
}

/** For the places that already catch and would otherwise swallow. */
export function reportError(where, error, extra) {
  report(where, error, extra);
}
