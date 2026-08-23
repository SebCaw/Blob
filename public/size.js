import { h } from './ui.js';

/**
 * How big Blob draws itself, and the control for changing it.
 *
 * There is one knob — `--ui-zoom` in the stylesheet — and it is the product of
 * what the screen suggests and what the player asked for. Scaling the whole app
 * from one place is the only way a design like this stays honest: pick out a few
 * font sizes to enlarge and you end up with big text in boxes built for small
 * text, which is worse than either.
 */

const KEY = 'blob.size';

/** The steps on offer. Three is enough: any more and nobody knows which they are on. */
export const SIZES = [
  { id: 'normal', label: 'Normal', letter: 'A' },
  { id: 'large', label: 'Large', letter: 'A' },
  { id: 'huge', label: 'Largest', letter: 'A' },
];

/** What this device is set to. */
export function currentSize() {
  try {
    const saved = localStorage.getItem(KEY);
    return SIZES.some((s) => s.id === saved) ? saved : 'normal';
  } catch {
    return 'normal';
  }
}

/**
 * Draw everything at this size from now on, and remember it on this device.
 * Normal clears the attribute rather than setting one, so the default really is
 * the default.
 */
export function applySize(id) {
  const size = SIZES.some((s) => s.id === id) ? id : 'normal';
  if (size === 'normal') delete document.documentElement.dataset.size;
  else document.documentElement.dataset.size = size;
  // The zoom has just changed, so how tall the app may be has changed with it.
  pinViewport();
  try {
    localStorage.setItem(KEY, size);
  } catch {
    /* a phone with storage switched off still gets the size, just not the memory */
  }
  return size;
}

/**
 * The zoom actually in force, for anything measuring the page.
 *
 * `getBoundingClientRect` reports what you can see, but a transform inside a
 * zoomed subtree is in that subtree's own pixels — so anything that measures one
 * and then moves by the other has to divide the difference back out.
 */
export function uiZoom() {
  // Measured rather than read: the variable resolves to a `calc()` expression
  // rather than a number, and a browser that ignores `zoom` altogether would
  // still report one.
  //
  // Measured with a box of a KNOWN size, not with the app's own width against
  // itself. The app's width depends on what is in it, on the stylesheet and on
  // whether the window has finished settling, and read at the wrong moment it
  // gave 2.1 where the zoom was 1.4 — which quietly threw out every sum that
  // divides by this. A 100px box is 100px whatever else is going on, so
  // whatever it comes back as IS the scale.
  const app = document.getElementById('app');
  if (!app) return 1;
  const probe = document.createElement('div');
  probe.style.cssText =
    'position:absolute;top:0;left:0;width:100px;height:100px;visibility:hidden;pointer-events:none;';
  app.appendChild(probe);
  const scale = probe.getBoundingClientRect().height / 100;
  probe.remove();
  return Number.isFinite(scale) && scale > 0.2 && scale < 4 ? scale : 1;
}

/**
 * How tall the app is allowed to be, in its own pixels, measured rather than
 * declared.
 *
 * `100dvh` is meant to be the window and the stylesheet divides it back out by
 * the zoom the way everything else does. Inside a `zoom`ed subtree that is not
 * reliable: measured on a phone at the largest text setting, a screen that
 * should have been 852 tall came out 1075 — a quarter taller than the window,
 * with everything past the fold behind the browser's own furniture, which is
 * where the hand lives.
 *
 * So the height is written down as a variable from the one number that is never
 * in doubt: `window.innerHeight`, divided by the zoom actually in force. The
 * stylesheet keeps the `dvh` expression as its fallback, for the first paint
 * before there is anything to measure.
 */
export function pinViewport() {
  const height = Math.max(320, window.innerHeight / (uiZoom() || 1));
  document.documentElement.style.setProperty('--app-h', `${Math.floor(height)}px`);
  return height;
}

/**
 * The control itself: three A's, growing.
 *
 * No numbers and no words to read — which matters, because the person reaching
 * for this is the person who cannot comfortably read the screen yet.
 */
export function sizeControl(ctx, options = {}) {
  const current = currentSize();
  return h(
    'div.size',
    { role: 'group', 'aria-label': 'Text size' },
    // The settings sheet has already said what this is; saying it twice in a row
    // is the sort of thing that makes a panel feel cluttered.
    options.bare ? null : h('span.size__label', { text: 'Size' }),
    h(
      'div.size__options',
      SIZES.map((size) =>
        h('button', {
          className: `size__btn size__btn--${size.id}${current === size.id ? ' size__btn--on' : ''}`,
          type: 'button',
          text: size.letter,
          'aria-label': `${size.label} text`,
          'aria-pressed': current === size.id ? 'true' : 'false',
          onClick: () => {
            applySize(size.id);
            ctx.render();
          },
        })
      )
    )
  );
}
