import { h, plural } from '../../ui.js';
import { topbar, codeCard, playerRow, action } from '../common.js';
import { sizeControl } from '../../size.js';

/**
 * The Kings Corner lobby.
 *
 * The same furniture as the other six and nothing on top of it, because there is
 * nothing to settle before the deal: one deck, seven cards each, whoever is
 * here. What the strip does say is how deep the stock will be, because that is
 * the one thing that changes with the number of people and it changes a lot —
 * twenty cards at four players and six at six.
 */

export function kingscornerLobby(ctx) {
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
      h('span.mode-strip__label', { text: 'Kings Corner' }),
      h('span.mode-strip__note', { text: dealLine(state, here) })
    ),
    codeCard(state),
    isMaster ? hintsRow(ctx) : hintsNote(state),
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
                text: `Kings Corner needs ${short} more ${short === 1 ? 'player' : 'players'} first.`,
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
 * Does the app point out what you can play?
 *
 * The Master's call, before the deal, and everybody plays under the same one -
 * a table where one person is being shown the answers and the others are not is
 * two different games.
 *
 * A row rather than a screen, and it sits in the lobby rather than in Settings
 * because Settings is per-device and this is per-game. It patches nothing in
 * place: the lobby re-renders on the state coming back, which is the honest
 * way round - a refusal puts it straight back.
 */
function hintsRow(ctx) {
  const on = ctx.state.hints !== false;
  return h(
    'button.kc-hints',
    {
      type: 'button',
      'aria-pressed': on ? 'true' : 'false',
      onClick: () => ctx.send({ type: 'game/setHints', hints: !on }),
    },
    h(
      'span.kc-hints__text',
      h('span.kc-hints__label', { text: 'Show what you can play' }),
      h('span.kc-hints__note', {
        text: on
          ? 'Your playable cards are ringed and the slots they fit light up.'
          : 'Nothing is pointed out. Work it out yourselves.',
      })
    ),
    h('span.kc-hints__switch', { className: on ? 'kc-hints__switch--on' : '', 'aria-hidden': 'true' })
  );
}

/** What the Master has chosen, for everybody else. */
function hintsNote(state) {
  if (state.hints !== false) return null;
  return h('p.muted.center', {
    style: { 'font-size': '14px' },
    text: 'The Master has turned the hints off. Nothing will be pointed out.',
  });
}

/**
 * What the deal will be.
 *
 * Below the minimum there is no deal to describe, and describing one anyway is
 * worse than saying nothing — with one person in the lobby the arithmetic is
 * perfectly correct and completely misleading. Go Fish's lobby learned that.
 *
 * The stock is worth naming because at six players it is six cards deep and
 * gone inside a round, which changes how the game feels rather than being a
 * detail.
 */
function dealLine(state, players) {
  if (players < state.minPlayers) return 'Seven cards each, four turned face up in the middle.';
  const stock = 52 - players * 7 - 4;
  if (stock <= 8) return `Seven each, ${stock} in the stock — that will not last long.`;
  return `Seven each, ${stock} in the stock.`;
}

const BOT_ORDER = ['easy', 'medium', 'hard', 'impossible'];

/**
 * What the levels say, and it is deliberately modest.
 *
 * The ladder here was measured and only `easy` came out properly separated —
 * see KINGS-CORNER.md. So these describe what each one demonstrably DOES rather
 * than promising a difficulty nobody has established. Claiming a bot is
 * unbeatable when it is level with the one below it is a small lie the player
 * finds out about.
 */
const BOT_LEVELS = {
  easy: { name: 'Easy', blurb: 'Puts one card down and stops.' },
  medium: { name: 'Medium', blurb: 'Plays out its whole turn.' },
  hard: { name: 'Hard', blurb: 'Rarely wastes a slot.' },
  impossible: { name: 'Impossible', blurb: 'Never wastes a slot.' },
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
        'It sees exactly what you see: the whole board and how many cards everybody ' +
        'is holding. Never a hand, and never the stock.',
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
