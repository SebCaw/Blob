import { h } from '../ui.js';
import { sizeControl } from '../size.js';
import { helpButton } from './help.js';
import { soundOn, setSound } from '../sound.js';
import { askBeforeStart, setAskBeforeStart } from '../prefs.js';
import { installState, offerInstall } from '../install.js';

/**
 * Settings, as a sheet over whatever you were doing.
 *
 * It lives over the top rather than as a screen of its own because the moment
 * you want it is mid-hand — the cards are too small to read and the game is
 * waiting on you. Nothing here touches the game: it is all about this device.
 */
/**
 * Which game this sheet is open over, if any.
 *
 * A state that names no game is Blob: that is what every game saved before the
 * shelf existed looks like, and the default has to keep being right.
 */
function gameOf(ctx) {
  return (ctx.state && ctx.state.game) || (ctx.ui && ctx.ui.game) || null;
}

/**
 * What the sound actually is, here.
 *
 * This sheet is shared by every game on the shelf, and this line was written
 * when Blob was the only one on it — so it promised tricks and bids to somebody
 * playing a game that has neither. Anything in here that names a part of a game
 * has to move with the game, or it is telling the player something untrue.
 */
function soundHint(game) {
  if (game === 'sillyhead') return 'Cards going down, and when the table is waiting on you.';
  if (game === 'sevens') return 'Cards going down, and when it comes round to you.';
  if (game === 'chase') return 'Cards changing hands, and when it comes round to you.';
  if (game === 'gofish') return 'Cards changing hands, and when somebody asks you a question.';
  if (game === 'kingscorner') return 'Cards going down, and when it comes round to you.';
  if (game === 'blob') return 'Cards, tricks and your turn. Never during a bid.';
  return 'Cards, and when a game is waiting on you.';
}

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
    h('p.sheet__hint', { text: soundHint(gameOf(ctx)) })
  );
}

/**
 * A switch, with a line underneath saying what it is for.
 *
 * Pulled out of the sound row because it is now used twice, and a settings
 * sheet where two switches are built two different ways is a settings sheet
 * that will grow a third.
 */
function toggleRow(ctx, { label, hint, on, onChange }) {
  return h(
    'div.sheet__row',
    h(
      'div.toggle-row',
      h('span.sheet__label', { text: label }),
      h(
        'button',
        {
          className: `toggle${on ? ' toggle--on' : ''}`,
          type: 'button',
          role: 'switch',
          'aria-checked': on ? 'true' : 'false',
          'aria-label': label,
          onClick: () => {
            onChange(!on);
            ctx.render();
          },
        },
        h('span.toggle__knob')
      )
    ),
    h('p.sheet__hint', { text: hint })
  );
}

/**
 * The settings that only make sense in the game you are actually in.
 *
 * Blob has none of its own yet. Silly Head has one, and it is the sort of thing
 * that belongs here rather than in the game: whether to be asked about your
 * three face-up cards. It matters enormously the first few times and not at all
 * after that, which is exactly what a setting is for.
 */
function gameRows(ctx) {
  if (gameOf(ctx) !== 'sillyhead') return null;
  return toggleRow(ctx, {
    label: 'Check my three cards',
    hint: 'Before you are dealt in, Silly Head asks whether your best cards are face up. They are played last.',
    on: askBeforeStart(),
    onChange: setAskBeforeStart,
  });
}

/**
 * The small print, and it is meant to be small.
 *
 * Dead last in the sheet, under the Done button, at eleven pixels and dimmed:
 * this is a footer, not a feature. It has to EXIST - a privacy policy nobody can
 * find is not one - and it has to be possible to ignore completely, which for
 * something almost nobody will ever tap is the more important half.
 *
 * Plain links out to two static pages rather than screens in the app, because a
 * policy has to be readable without joining a game and linkable from outside it.
 * They open in a new tab so nobody loses the game they are in by tapping one -
 * this sheet is reachable mid-hand, like everything else in it.
 */
function legalRow() {
  return h(
    'p.sheet__legal',
    h('a', { href: '/privacy.html', target: '_blank', rel: 'noopener', text: 'Privacy' }),
    ' · ',
    h('a', { href: '/terms.html', target: '_blank', rel: 'noopener', text: 'Terms of use' })
  );
}

/**
 * Put it on the home screen, for anybody who wants it.
 *
 * The offer itself is made once, at the end of a game, and never again if it is
 * turned down. This is the other half of that bargain: somewhere permanent and
 * quiet where it can always be found, so saying no costs nothing and changing
 * your mind later is possible. Absent entirely on a device that cannot install
 * - already installed, or a browser that has no way to.
 */
function installRow(ctx) {
  if (installState() === 'none') return null;
  return h('button.btn.btn--ghost', {
    text: 'Add to home screen',
    type: 'button',
    onClick: () => {
      ctx.ui.settingsOpen = false;
      ctx.render();
      offerInstall({ force: true });
    },
  });
}

/**
 * The way back to the other games, from anywhere.
 *
 * The shelf used to be reachable only from a game's own front page, which you
 * never see once you are in a game — so somebody halfway through a hand of Blob
 * had no way to discover Silly Head existed short of leaving and knowing where
 * to look. Settings is on every screen, so it goes here.
 *
 * It asks first when there is a game to lose, because leaving one is one-way:
 * the session goes, and a game that has started will not let you back in. The
 * question is asked in place rather than as a screen of its own — one tap arms
 * it, the next does it, and closing the sheet forgets it.
 */
function shelfRow(ctx, close) {
  if (!ctx.state) {
    return h('button.btn.btn--ghost', {
      text: 'All games',
      type: 'button',
      onClick: () => {
        close();
        ctx.backToShelf();
      },
    });
  }

  if (!ctx.ui.confirmShelf) {
    return h('button.btn.btn--ghost', {
      text: 'Leave and pick another game',
      type: 'button',
      onClick: () => {
        ctx.ui.confirmShelf = true;
        ctx.render();
      },
    });
  }

  return h(
    'div.sheet__row',
    h('p.sheet__hint', {
      text: 'Leaving is one-way — you cannot rejoin a game once it has started.',
    }),
    h('button.btn.btn--primary', {
      text: 'Leave this game',
      type: 'button',
      onClick: () => {
        ctx.ui.confirmShelf = false;
        close();
        ctx.backToShelf();
      },
    }),
    h('button.btn.btn--link', {
      text: 'Stay',
      type: 'button',
      onClick: () => {
        ctx.ui.confirmShelf = false;
        ctx.render();
      },
    })
  );
}

export function settingsSheet(ctx) {
  if (!ctx.ui.settingsOpen) return null;

  const close = () => {
    ctx.ui.settingsOpen = false;
    // A half-armed question does not survive the sheet being shut.
    ctx.ui.confirmShelf = false;
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
      gameRows(ctx),
      installRow(ctx),
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
      // The way back to the other games, from anywhere.
      //
      // The shelf used to be reachable only from a game's own front page, which
      // you never see once you are in a game — so somebody halfway through a
      // hand of Blob had no way to discover Silly Head existed short of leaving
      // and knowing where to look. Settings is on every screen, so it goes here.
      shelfRow(ctx, close),
      h('button.btn.btn--ghost', { text: 'Done', type: 'button', onClick: close }),
      legalRow()
    )
  );
}
