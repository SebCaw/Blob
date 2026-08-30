import { h } from './ui.js';
import { decodeQr } from './qr-read.js';

/**
 * Scanning somebody else's screen, from inside the app.
 *
 * The app has shown a QR code in every lobby for a long time and had no way of
 * reading one, which sounds like a gap and was actually a real problem. Point a
 * phone's own camera at the code and the link opens in the browser — a fresh
 * tab, a fresh page load, and, if the app is installed, NOT the installed app.
 * You end up in a second copy of Blob looking at the game you are already in
 * from the outside. There is no web API that lets a link jump into an installed
 * app; the only way to stay inside is to do the scanning inside.
 *
 * So: a viewfinder that never leaves the app, and a code that goes straight into
 * the join screen with the game's colours already on.
 *
 * `BarcodeDetector` first, because when it is there it is the phone's own
 * decoder and will always beat ours. It is not there on iOS, which is where
 * most of this app is played, so `qr-read.js` is the one that will actually run
 * for the person who asked for this.
 */

/** How often a frame is actually read. Ten a second is far more than enough. */
const EVERY_MS = 90;

/** The widest a frame is scaled to before reading. */
const FRAME_WIDTH = 640;

/**
 * Can this device offer to scan at all?
 *
 * Three things have to be true and only one of them is about the hardware: a
 * camera has to exist, the browser has to expose it, and the page has to be
 * on HTTPS — `mediaDevices` is simply absent otherwise, which is why the check
 * is one line rather than three.
 */
export function canScan() {
  return Boolean(navigator.mediaDevices && navigator.mediaDevices.getUserMedia);
}

/**
 * A game code out of whatever the code said.
 *
 * The app's own links are `https://…/?c=4827&g=gofish`, but a code written on a
 * whiteboard and photographed is four digits and nothing else, and either is a
 * perfectly reasonable thing to point a camera at. Anything else is somebody
 * scanning a parcel label, and it says so rather than trying.
 *
 * @param {string} text
 * @returns {{code:string, game:string|null}|null}
 */
export function joinFromText(text) {
  const raw = String(text || '').trim();
  if (!raw) return null;

  if (/^\d{4,6}$/.test(raw)) return { code: raw, game: null };

  try {
    // A base is supplied so a link with no scheme still parses, and it is this
    // origin because a code is only ever redeemed against this server anyway.
    const url = new URL(raw, location.origin);
    const code = (url.searchParams.get('c') || '').replace(/\D/g, '');
    if (code.length >= 4 && code.length <= 6) {
      return { code, game: url.searchParams.get('g') || null };
    }
  } catch {
    /* not a link */
  }
  return null;
}

/**
 * Open the viewfinder.
 *
 * @returns {Promise<string|null>} what the code said, or null if it was closed
 * @throws {Error} with something worth showing a person, if the camera will not open
 */
export async function scan() {
  if (!canScan()) throw new Error('This browser will not let the app use the camera.');

  let stream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      // `ideal` rather than `exact`: a laptop has only a front camera and
      // should get on with it rather than refusing.
      video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 }, height: { ideal: 720 } },
      audio: false,
    });
  } catch (error) {
    if (error && (error.name === 'NotAllowedError' || error.name === 'SecurityError')) {
      throw new Error('The camera is blocked. You can still type the code in.');
    }
    throw new Error('No camera to scan with. You can still type the code in.');
  }

  const video = h('video.scan__video', { playsinline: true, muted: true, autoplay: true });
  video.muted = true; // as a property as well: the attribute alone is ignored on iOS
  video.srcObject = stream;

  const hint = h('p.scan__hint', { text: 'Point at the code on the other phone.' });
  const overlay = h(
    'div.scan',
    { role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Scan a game code' },
    video,
    h('div.scan__frame', { 'aria-hidden': 'true' }, h('i'), h('i'), h('i'), h('i')),
    h('div.scan__bar', hint, h('button.btn.btn--ghost.scan__close', { type: 'button', text: 'Cancel' }))
  );

  const canvas = document.createElement('canvas');
  const paper = canvas.getContext('2d', { willReadFrequently: true });

  let detector = null;
  try {
    if ('BarcodeDetector' in window) detector = new window.BarcodeDetector({ formats: ['qr_code'] });
  } catch {
    /* the one we wrote will do */
  }

  return new Promise((resolve) => {
    let running = true;
    let frame = 0;
    let lastRead = 0;
    let struggling = null;

    const finish = (result) => {
      if (!running) return;
      running = false;
      cancelAnimationFrame(frame);
      clearTimeout(struggling);
      for (const track of stream.getTracks()) track.stop();
      document.removeEventListener('keydown', onKey);
      overlay.remove();
      resolve(result);
    };

    const onKey = (event) => {
      if (event.key === 'Escape') finish(null);
    };

    overlay.querySelector('.scan__close').addEventListener('click', () => finish(null));
    document.addEventListener('keydown', onKey);
    document.body.appendChild(overlay);
    // Autoplay is set, but a promise rejection here is unhandled otherwise and
    // some browsers want the play() as well as the attribute.
    video.play().catch(() => {});

    // Nothing is worse than a viewfinder that says nothing while you hold a
    // phone at it. After a few seconds of not reading anything it offers the
    // one piece of advice that actually helps.
    struggling = setTimeout(() => {
      hint.textContent = 'Hold it steady, and fill about half the box.';
    }, 6000);

    const look = (now) => {
      if (!running) return;
      frame = requestAnimationFrame(look);
      if (now - lastRead < EVERY_MS) return;
      lastRead = now;
      if (!video.videoWidth || !video.videoHeight) return;

      const scale = Math.min(1, FRAME_WIDTH / video.videoWidth);
      canvas.width = Math.round(video.videoWidth * scale);
      canvas.height = Math.round(video.videoHeight * scale);
      paper.drawImage(video, 0, 0, canvas.width, canvas.height);

      if (detector) {
        // Native, and asynchronous — so the answer may land after the overlay
        // has gone, and `finish` ignoring a second call is what covers that.
        detector
          .detect(canvas)
          .then((codes) => {
            const value = codes && codes.length ? codes[0].rawValue : null;
            if (value) finish(value);
          })
          .catch(() => {
            // A detector that throws is a detector we stop asking.
            detector = null;
          });
        return;
      }

      const found = decodeQr(paper.getImageData(0, 0, canvas.width, canvas.height));
      if (found) finish(found);
    };
    frame = requestAnimationFrame(look);
  });
}
