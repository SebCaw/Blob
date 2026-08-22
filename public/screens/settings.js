import { h } from '../ui.js';
import { sizeControl } from '../size.js';
import { helpButton } from './help.js';
import { soundOn, setSound } from '../sound.js';

/**
 * Settings, as a sheet over whatever you were doing.
 *
 * It lives over the top rather than as a screen of its own because the moment
 * you want it is mid-hand — the cards are too small to read and the game is
 * waiting on you. Nothing here touches the game: it is all about this device.
 */
/**
 * Sound on or off, remembered on this device.
 *
 * A toggle rather than a slider: there is one volume, chosen to sit under a
 * conversation, and a person who wants it quieter wants it off.
 */
function soundRow(ctx) {
  const on = soundOn();
  return h(
    'div.sheet__row',
    h(
      'div.toggle-row',
      h('span.sheet__label', { text: 'Sound' }),
      h(
        'button',
        {
          className: `toggle${on ? ' toggle--on' : ''}`,
          type: 'button',
          role: 'switch',
          'aria-checked': on ? 'true' : 'false',
          'aria-label': 'Sound',
          onClick: () => {
            // Turning it ON makes a noise, which is the only honest way to show
            // a sound switch has worked.
            setSound(!on);
            ctx.render();
          },
        },
        h('span.toggle__knob')
      )
    ),
    h('p.sheet__hint', { text: 'Cards, tricks and your turn. Never during a bid.' })
  );
}

export function settingsSheet(ctx) {
  if (!ctx.ui.settingsOpen) return null;

  const close = () => {
    ctx.ui.settingsOpen = false;
    ctx.render();
  };

  return h(
    'div.sheet',
    {
      role: 'dialog',
      'aria-modal': 'true',
      'aria-label': 'Settings',
      // A tap on the dark surround closes it, the way every sheet does.
      onClick: (event) => {
        if (event.target.classList.contains('sheet')) close();
      },
    },
    h(
      'div.sheet__panel',
      h(
        'div.sheet__head',
        h('span.sheet__title', { text: 'Settings' }),
        h('button.icon-btn', { type: 'button', 'aria-label': 'Close settings', onClick: close }, h('span.icon-btn__glyph', { text: '✕' }))
      ),
      h(
        'div.sheet__row',
        h('span.sheet__label', { text: 'Card and text size' }),
        sizeControl(ctx, { bare: true }),
        h('p.sheet__hint', {
          text: 'Takes effect straight away, and is remembered on this device.',
        })
      ),
      soundRow(ctx),
      // The rules, reachable mid-hand — which is when somebody usually needs
      // them. Opening it closes this, so they are not stacked two deep.
      helpButton(
        {
          ...ctx,
          render: () => {
            ctx.ui.settingsOpen = false;
            ctx.render();
          },
        },
        { kind: 'ghost' }
      ),
      h('button.btn.btn--ghost', { text: 'Done', type: 'button', onClick: close })
    )
  );
}
