import { h, plural } from '../../ui.js';
import { qrSvg } from '../../qr.js';
import { topbar, playerRow, action } from '../common.js';
import { sizeControl } from '../../size.js';

/**
 * The Go Fish lobby.
 *
 * The same furniture as the other five and nothing on top of it, because there
 * is nothing to settle before the deal. One deck, and the hand size follows from
 * how many people are here — so the strip says what the deal will actually be
 * rather than offering a choice nobody has to make.
 */

export function gofishLobby(ctx) {
  const state = ctx.state;
  const you = state.you;
  const isMaster = you && you.isMaster;
  const here = state.players.filter((p) => !p.left).length;
  const short = state.minPlayers - here;
  const ready = short <= 0;

  return h(
    'div.screen.screen--scroll',
    topbar(state, { title: 'Lobby', ctx }),
    h(
      'div.mode-strip.mode-strip--online',
      h('span.mode-strip__label', { text: 'Go Fish' }),
      h('span.mode-strip__note', { text: dealLine(state, here) })
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
    h('div.spacer'),
    isMaster
      ? h(
          'div.stack.stack--tight',
          !ready
            ? h('p.muted.center', {
                style: { 'font-size': '15px' },
                text: `Go Fish needs ${short} more ${short === 1 ? 'player' : 'players'} first.`,
              })
            : null,
          action('Deal', () => ctx.send({ type: 'game/start' }), { disabled: !ready })
        )
      : h('p.muted.center', { text: 'Waiting for the Master to deal.' }),
    sizeControl(ctx),
    h('button.btn.btn--link', { text: 'Leave game', type: 'button', onClick: () => ctx.leaveGame() })
  );
}

/**
 * What the deal will be, worked out on the server and simply repeated here.
 *
 * The hand size changes at four players, which is the sort of thing that is
 * mildly surprising if it happens without warning while somebody is walking
 * into the room.
 */
function dealLine(state, players) {
  const shape = state.dealShape || {};
  // Below the minimum there is no deal to describe, and describing one anyway
  // is worse than saying nothing: with one person in the lobby the arithmetic
  // is perfectly correct and completely misleading.
  if (players < state.minPlayers) return 'Seven cards each at three of you, five at four or more.';
  return `${shape.each} cards each, ${shape.pool} in the pool.`;
}

const BOT_ORDER = ['easy', 'medium', 'hard', 'impossible'];
const BOT_LEVELS = {
  easy: { name: 'Easy', blurb: 'Forgets what was asked.' },
  medium: { name: 'Medium', blurb: 'Remembers the last go round.' },
  hard: { name: 'Hard', blurb: 'Remembers every question.' },
  impossible: { name: 'Impossible', blurb: 'Remembers how many, not just who.' },
};

function lobbyStatus(player) {
  if (player.isBot) {
    return { text: BOT_LEVELS[player.botLevel] ? BOT_LEVELS[player.botLevel].name : 'Bot', kind: 'bot' };
  }
  if (player.left) return { text: 'Left', kind: 'gone' };
  if (!player.connected) return { text: 'Away', kind: 'gone' };
  return { text: 'Here', kind: 'in' };
}

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
      text:
        'It hears exactly what you hear: every question, every answer, and how many cards ' +
        'everybody is holding. Never what is in a hand or in the pool.',
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
