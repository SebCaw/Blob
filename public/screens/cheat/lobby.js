import { h, plural } from '../../ui.js';
import { topbar, codeCard, playerRow, action } from '../common.js';
import { sizeControl } from '../../size.js';

/**
 * The Cheat lobby.
 *
 * The same furniture as the other four, plus the one thing this game has to
 * settle before it deals: how many decks. That is here rather than on the form
 * before it because the answer depends on who turned up — one deck cannot give
 * eight people seven cards each, so above seven it stops being offered at all
 * and three appears instead.
 *
 * Every option says what the hand will actually be. "Two decks" means nothing to
 * anybody; "eight each, four of you get nine" is the thing people want to know.
 */

export function cheatLobby(ctx) {
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
      h('span.mode-strip__label', { text: 'Cheat' }),
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
                text: `Cheat needs ${short} more ${short === 1 ? 'player' : 'players'} first.`,
              })
            : null,
          action('Deal', () => ctx.send({ type: 'game/start' }), { disabled: !ready })
        )
      : h('p.muted.center', { text: 'Waiting for the Master to deal.' }),
    sizeControl(ctx),
    h('button.btn.btn--link', { text: 'Leave game', type: 'button', onClick: () => ctx.leaveGame() })
  );
}

/** The whole deck goes out, so the hands are uneven and the lobby says so. */
function handLine(shape) {
  if (!shape || !shape.each) return '';
  if (!shape.extra) return `${shape.each} cards each`;
  return `${shape.each} each, ${shape.extra} of you get ${shape.each + 1}`;
}

function dealLine(state, players) {
  const decks = { 1: 'One deck', 2: 'Two decks', 3: 'Three decks' }[state.decks] || 'One deck';
  const shape = state.dealShape || {};
  if (players < 1) return `${decks}, ${shape.cards || 52} cards.`;
  return `${decks}, ${shape.cards} cards — ${handLine(shape)}.`;
}

const BOT_ORDER = ['easy', 'medium', 'hard', 'impossible'];
const BOT_LEVELS = {
  easy: { name: 'Easy', blurb: 'Believes almost anything.' },
  medium: { name: 'Medium', blurb: 'Doubts a claim that is too good.' },
  hard: { name: 'Hard', blurb: 'Counts what it has seen.' },
  impossible: { name: 'Impossible', blurb: 'Remembers every card that was turned over.' },
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
        'It sees what you see: how many cards everybody holds, what was said, and any card the ' +
        'whole table watched get turned over. Never what is face down.',
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


const DECK_NAME = { 1: 'One', 2: 'Two', 3: 'Three' };

/**
 * How many decks, and what that actually deals.
 *
 * The options come from the server rather than being worked out here, because
 * which ones are legal is a rule. Above seven players one deck simply is not on
 * the list — there is no disabled button to explain, because there is nothing to
 * explain: it cannot be done.
 */
function deckControl(ctx) {
  const state = ctx.state;
  const here = state.players.filter((p) => !p.left).length;
  const options = state.deckOptions || [1, 2];
  const cards = (n) => 52 * n;
  const shapeFor = (n) => {
    if (!here) return '';
    const each = Math.floor(cards(n) / here);
    const extra = cards(n) % here;
    return extra ? `${each}/${each + 1} each` : `${each} each`;
  };

  return h(
    'div.field',
    h('span.eyebrow', { text: 'Decks' }),
    h(
      'div.seg',
      options.map((n) =>
        h('button', {
          className: `seg__btn${state.decks === n ? ' seg__btn--on' : ''}`,
          type: 'button',
          text: `${DECK_NAME[n]} · ${shapeFor(n)}`,
          onClick: () => ctx.send({ type: 'game/setDecks', decks: n }),
        })
      )
    ),
    h('p.muted', {
      style: { 'font-size': '13px', 'margin-top': '8px' },
      text: options.includes(1)
        ? 'Everybody needs seven cards to have anything to bluff with. One deck manages that up to seven of you.'
        : 'One deck cannot give this many people seven cards each, so it is two or three. Three makes for a longer, gentler game.',
    })
  );
}
