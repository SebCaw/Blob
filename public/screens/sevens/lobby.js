import { h, plural } from '../../ui.js';
import { qrSvg } from '../../qr.js';
import { topbar, playerRow, action } from '../common.js';
import { sizeControl } from '../../size.js';

/**
 * The Sevens lobby.
 *
 * The same furniture as the other two, on purpose — a code big enough to read
 * across a table, a QR for the people who would rather point a camera, everyone
 * appearing as they arrive. It is the same job, and a third group of people
 * learning a third lobby would be a cost with nothing bought by it.
 *
 * There are no settings. Sevens deals the whole deck to whoever turned up, and
 * the only thing that changes with the number of players is how many cards each
 * of you gets — which is not a choice anybody makes.
 */

export function sevensLobby(ctx) {
  const state = ctx.state;
  const you = state.you;
  const isMaster = you && you.isMaster;
  const here = state.players.filter((p) => !p.left).length;
  const ready = here >= state.minPlayers;

  return h(
    'div.screen.screen--scroll',
    topbar(state, { title: 'Lobby', ctx }),
    h(
      'div.mode-strip.mode-strip--online',
      h('span.mode-strip__label', { text: 'Sevens' }),
      h('span.mode-strip__note', { text: dealLine(here) })
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
                text: `Sevens needs ${state.minPlayers - here} more ${
                  state.minPlayers - here === 1 ? 'player' : 'players'
                } before you can start.`,
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
 * "Seven each, and four of you get eight" — what the deal is about to look like.
 *
 * Said out loud because 52 does not divide by three, five, six or seven, and an
 * uneven hand looks like a bug to anybody who has not been told it is the game.
 */
function dealLine(players) {
  if (players < 1) return 'The whole deck, dealt out to the last card.';
  const each = Math.floor(52 / players);
  const extra = 52 % players;
  if (!extra) return `${each} cards each.`;
  return `${each} cards each, and ${extra} of you get ${each + 1}.`;
}

/** The four settings, easiest first, and what the lobby says about each. */
const BOT_ORDER = ['easy', 'medium', 'hard', 'impossible'];
const BOT_LEVELS = {
  easy: { name: 'Easy', blurb: 'Plays the first thing that fits.' },
  medium: { name: 'Medium', blurb: 'Knows what it is doing.' },
  hard: { name: 'Hard', blurb: 'Watches what it gives away.' },
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
      text: 'It is dealt from the same deck as everybody else, and only sees what you see.',
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
