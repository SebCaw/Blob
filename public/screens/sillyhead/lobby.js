import { h, plural } from '../../ui.js';
import { qrSvg } from '../../qr.js';
import { topbar, playerRow, action } from '../common.js';
import { sizeControl } from '../../size.js';

/**
 * The Silly Head lobby.
 *
 * Deliberately the same furniture as Blob's — a code big enough to read across
 * a table, a QR for the people who would rather point a camera, everyone
 * appearing as they arrive. It is the same job, and a second group of people
 * learning a second lobby would be a cost with nothing bought by it.
 *
 * The one setting is standard or quick, and it lives here rather than on the
 * form before it because it depends on who actually turned up.
 */

export function sillyheadLobby(ctx) {
  const state = ctx.state;
  const you = state.you;
  const isMaster = you && you.isMaster;
  const ready = state.players.filter((p) => !p.left).length >= state.minPlayers;

  return h(
    'div.screen.screen--scroll',
    topbar(state, { title: 'Lobby', ctx }),
    h(
      'div.mode-strip.mode-strip--online',
      h('span.mode-strip__label', { text: 'Silly Head' }),
      h('span.mode-strip__note', { text: deckLine(state) })
    ),
    codeCard(state),
    h(
      'div.stack.stack--tight',
      h(
        'div',
        { style: { display: 'flex', 'align-items': 'baseline', 'justify-content': 'space-between' } },
        h('span.eyebrow', { text: plural(state.players.length, 'player', 'players') }),
        h('span.eyebrow', { text: `${state.maxPlayers} max` })
      ),
      h(
        'ul.players',
        state.players.map((player) =>
          playerRow(player, state, {
            status: lobbyStatus(player),
            trailing: isMaster && player.isBot ? dropBot(ctx, player) : null,
          })
        )
      )
    ),
    isMaster ? botAdder(ctx) : null,
    isMaster ? lengthControl(ctx) : null,
    h('div.spacer'),
    isMaster
      ? h(
          'div.stack.stack--tight',
          !ready
            ? h('p.muted.center', {
                style: { 'font-size': '15px' },
                text: 'Silly Head needs one more player before you can start.',
              })
            : null,
          action('Deal', () => ctx.send({ type: 'game/start' }), { disabled: !ready })
        )
      : h('p.muted.center', { text: 'Waiting for the Master to deal.' }),
    sizeControl(ctx),
    h('button.btn.btn--link', { text: 'Leave game', type: 'button', onClick: () => ctx.leaveGame() })
  );
}

/** "Two decks, nine cards each" — what the table is about to look like. */
function deckLine(state) {
  const decks = state.decks || 2;
  return `${decks === 1 ? 'One deck' : `${decks} decks`}, nine cards each.`;
}

/** The four settings, easiest first, and what the lobby says about each. */
const BOT_ORDER = ['easy', 'medium', 'hard', 'impossible'];
const BOT_LEVELS = {
  easy: { name: 'Easy', blurb: 'Still learning. Kind to a beginner.' },
  medium: { name: 'Medium', blurb: 'Plays a sensible hand.' },
  hard: { name: 'Hard', blurb: 'Saves the good stuff for later.' },
  impossible: { name: 'Impossible', blurb: 'You have been warned.' },
};

function lobbyStatus(player) {
  if (player.isBot) {
    return { text: BOT_LEVELS[player.botLevel] ? BOT_LEVELS[player.botLevel].name : 'Bot', kind: 'bot' };
  }
  if (player.left) return { text: 'Left', kind: 'gone' };
  if (!player.connected) return { text: 'Away', kind: 'gone' };
  return { text: 'Here', kind: 'in' };
}

/**
 * Sitting a bot down.
 *
 * The same shape as Blob's, deliberately — it is the same question with the
 * same four answers, and a second group of people learning a second control
 * would be a cost with nothing bought by it. The blurbs say nothing about
 * METHOD: a bot advertising what it saves has told you how to beat it.
 */
function botAdder(ctx) {
  const state = ctx.state;
  const full = state.players.length >= state.maxPlayers;

  if (!ctx.ui.addingBot) {
    return h('button.btn.btn--ghost', {
      text: '+ Add a bot',
      type: 'button',
      disabled: full,
      onClick: () => {
        ctx.ui.addingBot = true;
        ctx.render();
      },
    });
  }

  return h(
    'div.card',
    h('div.eyebrow', { text: 'Add a bot' }),
    h('p.muted', {
      style: { 'font-size': '14px', margin: '6px 0 10px' },
      text: 'It gets nine cards like everybody else, sorts its own table, and only sees what you see.',
    }),
    h(
      'div.levels',
      BOT_ORDER.map((level) =>
        h(
          'button.level',
          { type: 'button', disabled: full, onClick: () => ctx.send({ type: 'player/addBot', level }) },
          h('span.level__name', { text: BOT_LEVELS[level].name }),
          h('span.level__blurb', { text: BOT_LEVELS[level].blurb })
        )
      )
    ),
    full ? h('p.muted', { style: { 'font-size': '13px', 'margin-top': '10px' }, text: 'This table is full.' }) : null,
    h(
      'div.btn-row',
      { style: { 'margin-top': '12px' } },
      h('button.btn.btn--ghost.btn--small', {
        text: 'Done',
        type: 'button',
        onClick: () => {
          ctx.ui.addingBot = false;
          ctx.render();
        },
      })
    )
  );
}

function dropBot(ctx, player) {
  return h('button.btn--tiny', {
    text: 'Remove',
    type: 'button',
    'aria-label': `Remove ${player.name}`,
    onClick: () => ctx.send({ type: 'player/remove', playerId: player.id }),
  });
}

function codeCard(state) {
  const joinUrl = `${location.origin}/?c=${state.code}`;
  return h(
    'div.code-card',
    h('div.eyebrow', { text: 'Game code' }),
    h('div.code.tabular', { text: state.code, 'aria-label': `Game code ${state.code.split('').join(' ')}` }),
    qrSvg(joinUrl, { className: 'qr', label: `QR code to join game ${state.code}` }),
    h('p.muted', { style: { 'font-size': '13px', 'margin-top': '8px' }, text: 'Scan, or type the code in.' })
  );
}

/**
 * Standard or quick.
 *
 * Quick is refused outright once there are five of you rather than quietly
 * dropping people, so the button says why it cannot be picked instead of
 * failing when the Master taps Deal.
 */
function lengthControl(ctx) {
  const state = ctx.state;
  const tooMany = state.players.filter((p) => !p.left).length > 4;
  const quick = Boolean(state.quick);
  return h(
    'div.field',
    h('span.eyebrow', { text: 'Length' }),
    h(
      'div.seg',
      h('button', {
        className: `seg__btn${quick ? '' : ' seg__btn--on'}`,
        type: 'button',
        text: 'Standard',
        onClick: () => ctx.send({ type: 'game/setQuick', quick: false }),
      }),
      h('button', {
        className: `seg__btn${quick ? ' seg__btn--on' : ''}`,
        type: 'button',
        text: 'Quick',
        disabled: tooMany,
        onClick: () => ctx.send({ type: 'game/setQuick', quick: true }),
      })
    ),
    h('p.muted', {
      style: { 'font-size': '13px', 'margin-top': '8px' },
      text: tooMany ? 'A quick game is one deck, so it only seats four.' : deckLine(state),
    })
  );
}
