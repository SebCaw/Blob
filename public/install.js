import { h, fill, fragment } from './ui.js';
import { mascot } from './mascot.js';

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
 * **It waits until a game has finished, and that is the whole design.** The
 * commonest way anybody new arrives here is scanning a code to JOIN A GAME that
 * is already happening, with people waiting on them — which makes arrival the
 * single worst moment to ask somebody to install anything. The end of a game is
 * the opposite: they have just played, nothing is urgent, and every game already
 * has a screen sitting there for exactly that beat.
 *
 * On iPhone it also dodges a real trap. An installed iOS web app gets its OWN
 * storage, separate from Safari's — so installing mid-game would lose the
 * session that says which game you are in, and you would have to rejoin by code.
 * After the game there is nothing left to lose.
 *
 * **One ask, and no means no.** The answer lives in `localStorage`, which is a
 * note the browser keeps on that DEVICE, for good. Seb asked whether this could
 * be done per IP address; it should not be, and it would not work — everybody on
 * one wifi shares a public IP, so a family round a table looks like one person
 * and five of them would never be asked at all. IPs also rotate, and they are
 * personal data under GDPR, which nothing in this repo has ever stored.
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

/**
 * Where the answer is kept.
 *
 * `localStorage`, not `sessionStorage`: this was the short-lived kind, which
 * meant a dismissal was forgotten the moment the tab closed and the banner came
 * back the next evening. Asking somebody who has already said no is nagging.
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
    return localStorage.getItem(DISMISSED_KEY) === '1';
  } catch {
    // A browser refusing storage is one in private mode. Asking once per visit
    // is the right failure there - better than never offering it at all.
    return false;
  }
}

function dismiss() {
  try {
    localStorage.setItem(DISMISSED_KEY, '1');
  } catch {
    /* see above: a device that cannot remember gets asked again next time */
  }
}

let deferredPrompt = null;
let bannerEl = null;
/** Asked already since this page loaded. One offer per sitting, not per game. */
let offeredThisLoad = false;

/**
 * Make the app installable-on-request. Call once at boot.
 *
 * Deliberately shows NOTHING by itself. All this does is catch Chrome's prompt
 * so it can be fired later, on our terms — `offerInstall` is what actually puts
 * anything on the screen, and it is called at the end of a game and from
 * Settings.
 */
export function setupInstallBanner({ canOfferNow = () => false } = {}) {
  bannerEl = h('div.install-banner', { role: 'status', 'aria-live': 'polite' });
  document.body.appendChild(bannerEl);

  window.addEventListener('beforeinstallprompt', (event) => {
    // Chrome would otherwise show its own generic mini-bar at a moment of its
    // choosing. Taking that away is the whole reason to listen: it lets the
    // offer arrive in this app's own voice, when the table is quiet.
    event.preventDefault();
    deferredPrompt = event;
    // And it has to be able to offer RIGHT HERE, not only on the next repaint.
    // Chrome fires this whenever it decides the site is worth installing, which
    // is very often while somebody is sitting on a finished game with nothing
    // left to trigger a render. Without this the offer simply never arrived.
    if (canOfferNow()) offerInstall();
  });

  window.addEventListener('appinstalled', () => {
    deferredPrompt = null;
    hide();
  });
}

/**
 * Can this device be offered an install at all?
 *
 * `'prompt'` — Android, with a real button behind it.
 * `'manual'` — iOS Safari, where the only route is the Share sheet.
 * `'none'`   — already installed, or a browser that cannot do it. Notably every
 *              non-Safari browser on iOS: they wear Safari's user-agent but can
 *              install nothing, and offering would be a false promise.
 */
export function installState() {
  if (isStandalone()) return 'none';
  if (deferredPrompt) return 'prompt';
  if (isIosSafari()) return 'manual';
  return 'none';
}

/**
 * Offer it. `force` is Settings asking on the player's behalf.
 *
 * Unforced, this respects a previous no and only ever speaks once per load —
 * the end of every game calls it, and being asked after each of five hands
 * would be worse than never asking.
 */
export function offerInstall({ force = false } = {}) {
  const state = installState();
  if (state === 'none') return false;
  if (!force && (dismissed() || offeredThisLoad)) return false;
  offeredThisLoad = true;
  show(state === 'prompt' ? androidBanner() : iosBanner());
  return true;
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

/**
 * The card the offer is made on.
 *
 * It was a strip: one line of thirteen-pixel grey text and a small button, sat
 * along the bottom of the screen. Seb's words were that it "looks like
 * cookies", and that is exactly right — it had the shape of the thing everybody
 * on the internet has trained themselves to dismiss without reading, so the one
 * genuinely useful offer this app makes was wearing the costume of the least
 * useful thing on the web.
 *
 * So it is a card with a picture, a heading and a sentence, and the action is a
 * full-width button rather than a chip wedged between the text and a cross. It
 * is still not modal and still does not block anything — it appears when a game
 * has just finished and nobody is waiting on anybody, and being ignorable is
 * part of the deal. But it should be ignored because somebody read it and did
 * not want it, not because it looked like boilerplate.
 *
 * "Not now" in words rather than a ✕ for the same reason: a cross in the corner
 * is what you close a cookie bar with.
 */
function card(...inside) {
  return h(
    'div.install-card',
    h('div.install-card__mascot', mascot('cheer', { size: 'md' })),
    // Worded as an invitation after a game rather than an instruction on
    // arrival, because that is exactly when it appears. "Enjoyed that?" is
    // doing real work: it says why it is asking NOW, which is the difference
    // between an offer and an interruption.
    h('h2.install-card__title', { text: 'Enjoyed that?' }),
    ...inside,
    h('button.btn.btn--link.install-card__no', { type: 'button', text: 'Not now', onClick: close })
  );
}

function androidBanner() {
  return card(
    h('p.install-card__text', {
      text:
        'Put Blob on your home screen. It opens full screen like a proper app, and it is there next ' +
        'time without anybody having to find the link again.',
    }),
    h('button.btn.btn--primary.install-card__go', {
      text: 'Add to home screen',
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
    })
  );
}

/**
 * Safari's Share button, drawn rather than set in type.
 *
 * It was the U+2B06 character with a variation selector, and it came out as a
 * fat white arrow sitting on the text baseline at whatever size and weight the
 * system font felt like — Seb sent a photo of it. The same trap the crown and
 * the settings cog in `common.js` are already written up for: a glyph you do
 * not control is a glyph that will be wrong somewhere.
 *
 * Drawn as the actual icon rather than a generic arrow, because this sentence is
 * telling somebody to find one specific button on their screen, and the fastest
 * way to say which is to show it.
 */
function shareGlyph() {
  const wrap = h('span.install-banner__glyph', { 'aria-hidden': 'true' });
  wrap.appendChild(
    fragment(
      '<svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg" fill="none" ' +
        'stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' +
        '<path d="M12 3 L12 15"/>' +
        '<path d="M8 7 L12 3 L16 7"/>' +
        '<path d="M6 11 L4 11 L4 21 L20 21 L20 11 L18 11"/>' +
        '</svg>'
    )
  );
  return wrap;
}

function iosBanner() {
  return card(
    h('p.install-card__text', {
      text:
        'Put Blob on your home screen. It opens full screen like a proper app, and it is there next ' +
        'time without anybody having to find the link again.',
    }),
    // Two steps, numbered, because this is the platform with no button to press
    // — it is a set of instructions and it should look like one rather than
    // like a sentence with an icon buried in it.
    h(
      'ol.install-card__steps',
      h('li', 'Tap ', shareGlyph(), ' at the bottom of Safari'),
      h('li', { text: 'Choose "Add to Home Screen"' })
    )
  );
}
