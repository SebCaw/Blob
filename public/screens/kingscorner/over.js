import { h, initials } from '../../ui.js';
import { topbar, action, ownName, confetti } from '../common.js';
import { cardFace } from '../../cards.js';

/**
 * The end of a game of Kings Corner.
 *
 * Somebody emptied their hand, and everybody else is holding what they were
 * left with — so the screen is that, fewest first. The cards go face up, which
 * is the one moment the privacy boundary widens and is exactly what happens at a
 * real table when the hands go down.
 *
 * No wooden spoon. There is no scoring in this game and being left with six
 * cards is mostly the deal; a spoon for it would be a joke at the wrong
 * person's expense.
 */

export function overScreen(ctx) {
  const state = ctx.state;
  const you = state.you || {};
  const isMaster = you.isMaster;
  const winners = state.winnerIds || [];
  const youWon = winners.includes(you.id);

  const order = state.players
    .filter((p) => !p.left)
    .slice()
    .sort((a, b) => (a.cardsLeft || []).length - (b.cardsLeft || []).length || a.name.localeCompare(b.name));

  const screen = h(
    'div.screen.screen--scroll',
    topbar(state, { title: 'Game over', ctx }),
    h(
      'div.stack.center',
      h('h1.sh-over__title', { text: headline(state, youWon) }),
      h('p.muted.center', { text: subtitle(state) })
    ),
    h(
      'ol.sh-order',
      order.map((player, index) => {
        const left = player.cardsLeft || [];
        const won = winners.includes(player.id);
        return h(
          'li.sh-order__row',
          { className: won ? 'sh-order__row--first' : '', style: { '--i': String(index) } },
          h('span.sh-order__place', { text: String(left.length) }),
          h('div.player__badge', { text: initials(player.name) }),
          h(
            'div.kc-over__who',
            h('span.sh-order__name', { text: ownName(player.name, player.id === you.id) }),
            left.length
              ? h(
                  'div.kc-over__cards',
                  left.map((card) => cardFace(card, { size: 'xs', corner: true }))
                )
              : h('span.kc-over__out', { text: 'went out' })
          ),
          won ? h('span.player__state.state--in', { text: winners.length > 1 ? 'Level' : 'Won' }) : null
        );
      })
    ),
    h('div.spacer'),
    isMaster
      ? action('Play again', () => ctx.rematch())
      : state.rematchCode
        ? action(`Join the new game (${state.rematchCode})`, () => ctx.joinDifferentGame(state.rematchCode))
        : h('p.muted.center', { text: 'Waiting to see if the Master starts another.' }),
    h('button.btn.btn--link', { text: 'Leave game', type: 'button', onClick: () => ctx.leaveGame() })
  );

  if (youWon) confetti();
  return screen;
}

function headline(state, youWon) {
  const names = state.winnerNames || [];
  if (youWon && names.length > 1) return 'Level at the top.';
  if (youWon) return 'Out first. Yours.';
  if (!names.length) return 'Nobody got out.';
  if (names.length > 1) return `${names.join(' and ')} finished level.`;
  return `${names[0]} takes it.`;
}

/**
 * Why it stopped.
 *
 * A dead board and somebody going out are different results, and a screen that
 * showed them the same would be lying quietly — anybody who was watching knows
 * nobody emptied their hand, and being told "X wins" with four cards still in
 * their hand needs explaining.
 */
function subtitle(state) {
  if (state.endedEarly) return 'The Master ended this one early.';
  if (state.endReason === 'dead-board') {
    return 'Nothing legal left anywhere and no cards to draw, so it stopped there. Fewest cards wins.';
  }
  if (state.endReason === 'last-standing') return 'Everybody else had gone.';
  return 'First hand empty takes it.';
}
