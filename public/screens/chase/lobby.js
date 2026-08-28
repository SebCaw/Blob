import { h, plural } from '../../ui.js';
import { topbar, codeCard, playerRow, action } from '../common.js';
import { sizeControl } from '../../size.js';

/**
 * The Chase the Ace lobby.
 *
 * The same furniture as the other three, on purpose. The one setting is one deck
 * or two, and it lives here rather than on the form before it because it depends
 * on who actually turned up.
 */

export function chaseLobby(ctx) {
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
      h('span.mode-strip__label', { text: 'Chase the Ace' }),
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
    isMaster ? deckControl(ctx) : null,
    h('div.spacer'),
    isMaster
      ? h(
          'div.stack.stack--tight',
          !ready
            ? h('p.muted.center', {
                style: { 'font-size': '15px' },
                text: `Chase the Ace needs ${short} more ${short === 1 ? 'player' : 'players'} first.`,
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
 * What the deal is about to look like.
 *
 * Said out loud because the numbers are odd on purpose — 49 and 97 rather than
 * 52 and 104 — and a short deck with uneven hands looks like a bug to anybody
 * who has not been told that the odd card IS the game.
 */
function dealLine(state, players) {
  const cards = state.decks === 2 ? 97 : 49;
  const decks = state.decks === 2 ? 'Two decks' : 'One deck';
  if (players < 1) return `${decks}, ${cards} cards, one lonely ace.`;
  const each = Math.floor(cards / players);
  return `${decks}, ${cards} cards — about ${each} each, then the pairs go.`;
}

const BOT_ORDER = ['easy', 'medium', 'hard', 'impossible'];
const BOT_LEVELS = {
  easy: { name: 'Easy', blurb: 'Takes whichever card it fancies.' },
  medium: { name: 'Medium', blurb: 'Notices when you fidget.' },
  hard: { name: 'Hard', blurb: 'Watches your hands, and hides its own.' },
  impossible: { name: 'Impossible', blurb: 'Remembers everything you did.' },
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
      text: 'It sees what you see: how many cards you hold, and what the table watched you do with them.',
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


/**
 * One deck or two.
 *
 * One deck is refused once there are nine of you rather than quietly dealing
 * four cards each, so the button says why it cannot be picked instead of failing
 * when the Master taps Deal.
 */
function deckControl(ctx) {
  const state = ctx.state;
  const here = state.players.filter((p) => !p.left).length;
  const tooMany = here > 8;
  const two = state.decks === 2;
  return h(
    'div.field',
    h('span.eyebrow', { text: 'Deck' }),
    h(
      'div.seg',
      h('button', {
        className: `seg__btn${two ? '' : ' seg__btn--on'}`,
        type: 'button',
        text: 'One',
        disabled: tooMany,
        onClick: () => ctx.send({ type: 'game/setDecks', decks: 1 }),
      }),
      h('button', {
        className: `seg__btn${two ? ' seg__btn--on' : ''}`,
        type: 'button',
        text: 'Two',
        onClick: () => ctx.send({ type: 'game/setDecks', decks: 2 }),
      })
    ),
    h('p.muted', {
      style: { 'font-size': '13px', 'margin-top': '8px' },
      text: tooMany ? 'One deck only seats eight, and there are more of you than that.' : dealLine(state, here),
    })
  );
}
