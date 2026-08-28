import { h, fill } from './ui.js';

/**
 * The install banner: a one-tap way onto the home screen.
 *
 * `manifest.webmanifest` and `sw.js` already make the app installable — a
 * phone can always get here through its own browser menu. This is the
 * proactive half: a small strip that offers to do it, so nobody has to know
 * "Add to Home Screen" is a thing to look for.
 *
 * It is a GLOBAL OVERLAY, appended to `document.body` the same way `connection`
 * and `toastEl` already are in `app.js`, and deliberately not a row on the
 * shelf. `CLAUDE.md` is explicit that the front page does not change except by
 * the user asking for a new section in those words — this was asked for as "add
 * to home screen", not as a shelf redesign, so it lives above every screen
 * rather than inside one. It also means it can never replay the shelf's own
 * entry animation or shift anything shelf.js draws.
 *
 * Two platforms, two different problems:
 *
 *   Android/Chrome fires `beforeinstallprompt` when it thinks the page is
 *   worth installing, and hands over a real native prompt to trigger. Nothing
 *   is drawn until that fires — there is no point offering a button that does
 *   nothing.
 *
 *   iOS Safari never fires it and never will; Apple has no equivalent event.
 *   The only way onto an iPhone's home screen is the manual Share sheet, so
 *   for iOS this shows instructions instead of a button, gated on being
 *   Safari specifically — Chrome-on-iOS and other iOS browsers cannot install
 *   at all, and telling them to try would be a false promise.
 */

const DISMISSED_KEY = 'blob.installDismissed';

/** Already running as an installed app, on either platform's own signal. */
function isStandalone() {
  const media = window.matchMedia && window.matchMedia('(display-mode: standalone)').matches;
  // iOS has no `display-mode` media query; Safari sets this instead.
  return Boolean(media || window.navigator.standalone);
}

/** iOS Safari, and only Safari — see the note above about why that matters. */
function isIosSafari() {
  const ua = window.navigator.userAgent || '';
  const isIos = /iphone|ipad|ipod/i.test(ua);
  // Every iOS browser embeds Safari's engine and its UA string, including
  // Chrome and Firefox, so "Safari" in a plain check would catch all of them.
  // Their own UA carries a second token that Safari itself never adds.
  const isOtherBrowser = /crios|fxios|edgios|opios/i.test(ua);
  return isIos && !isOtherBrowser;
}

function dismissed() {
  try {
    return sessionStorage.getItem(DISMISSED_KEY) === '1';
  } catch {
    return false;
  }
}

function dismiss() {
  try {
    sessionStorage.setItem(DISMISSED_KEY, '1');
  } catch {
    /* a session that cannot remember this just gets asked again next time */
  }
}

let deferredPrompt = null;
let bannerEl = null;

/**
 * Wire up the banner. Call once, at boot, alongside the other global overlays.
 *
 * @param {{isInGame: () => boolean}} deps
 *   Whether a game is actually in progress right now, checked at the moment
 *   the prompt would fire rather than once at boot. `beforeinstallprompt` can
 *   arrive at any point in the session, including mid-hand, and a banner
 *   sliding in over the table while somebody is mid-turn is exactly the kind
 *   of interruption this app has otherwise gone out of its way to avoid.
 */
export function setupInstallBanner(deps) {
  bannerEl = h('div.install-banner', { role: 'status', 'aria-live': 'polite' });
  document.body.appendChild(bannerEl);

  if (isStandalone() || dismissed()) return;

  window.addEventListener('beforeinstallprompt', (event) => {
    // Chrome would otherwise show its own generic mini-bar; taking that away
    // is the whole reason to listen at all, since it lets this app offer the
    // same install in its own voice and only when the moment is quiet.
    event.preventDefault();
    deferredPrompt = event;
    if (!deps.isInGame()) show(androidBanner());
  });

  window.addEventListener('appinstalled', () => {
    deferredPrompt = null;
    hide();
  });

  // iOS gets no event to wait for — Safari never fires one — so the offer is
  // just made once the app has settled, and only away from a live game.
  if (isIosSafari() && !deps.isInGame()) {
    show(iosBanner());
  }
}

function show(content) {
  if (!bannerEl) return;
  fill(bannerEl, content);
  // A timer rather than `requestAnimationFrame`, and the difference is not
  // cosmetic: rAF does not fire at all in a backgrounded tab. `beforeinstallprompt`
  // very often arrives exactly there — the browser decides the page is worth
  // installing while somebody has flipped to another app — and the banner would
  // then be built, never shown, and never offered again. The delay is only here
  // to let the display change land before the transform does, so the slide
  // actually animates instead of snapping.
  setTimeout(() => bannerEl.classList.add('install-banner--show'), 30);
}

function hide() {
  if (!bannerEl) return;
  bannerEl.classList.remove('install-banner--show');
}

function close() {
  dismiss();
  hide();
}

function androidBanner() {
  return h(
    'div.install-banner__row',
    h('span.install-banner__text', { text: 'Add Blob to your home screen — opens full screen, no address bar.' }),
    h('button.btn.btn--primary.btn--small', {
      text: 'Install',
      type: 'button',
      onClick: async () => {
        hide();
        if (!deferredPrompt) return;
        const prompt = deferredPrompt;
        deferredPrompt = null;
        prompt.prompt();
        // The native dialog answers this; nothing here needs the outcome, but
        // it has to be awaited or the browser can log an unhandled rejection.
        await prompt.userChoice.catch(() => {});
      },
    }),
    h('button.icon-btn.install-banner__close', {
      type: 'button',
      'aria-label': 'Dismiss',
      onClick: close,
    }, h('span', { text: '✕', 'aria-hidden': 'true' }))
  );
}

function iosBanner() {
  return h(
    'div.install-banner__row',
    h(
      'span.install-banner__text',
      { text: 'Add Blob to your home screen: tap ' },
      h('span.install-banner__glyph', { text: '⬆︎', 'aria-hidden': 'true' }),
      ' then "Add to Home Screen".'
    ),
    h('button.icon-btn.install-banner__close', {
      type: 'button',
      'aria-label': 'Dismiss',
      onClick: close,
    }, h('span', { text: '✕', 'aria-hidden': 'true' }))
  );
}
