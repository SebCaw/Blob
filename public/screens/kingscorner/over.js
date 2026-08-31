import { h, initials } from '../../ui.js';
import { topbar, action, ownName, confetti } from '../common.js';
import { cardFace } from '../../cards.js';

/**
 * The end of a game of Kings Corner.
 *
 * The result is an ORDER, not a winner and a crowd. Going out does not stop the
 * game — everybody plays on and the last person still holding cards is the one
 * the evening remembers — so this screen is the order people went out in, with
 * whoever was left at the bottom holding what they were left with.
 *
 * The cards go face up, which is the one moment the privacy boundary widens and
 * is exactly what happens at a real table when the hands go down.
 *
 * No wooden spoon. There is no scoring here and being last is mostly the deal.
 */

export function overScreen(ctx) {
  const state = ctx.state;
  const you = state.you || {};
  const isMaster = you.isMaster;
  const order = state.finished || [];
  const youWon = order.length > 0 && order[0].id === you.id;

  // Everybody in the order they went out, then whoever never did.
  const places = order
    .map((entry, i) => ({ player: state.players.find((p) => p.id === entry.id), place: i + 1 }))
    .filter((row) => row.player);
  const placed = new Set(places.map((row) => row.player.id));
  const leftOver = state.players.filter((p) => !p.left && !placed.has(p.id)).map((player) => ({ player, place: null }));
  const rows = [...places, ...leftOver];

  const screen = h(
    'div.screen.screen--scroll',
    topbar(state, { title: 'Game over', ctx }),
    h(
      'div.stack.center',
      h('h1.sh-over__title', { text: headline(state, you, youWon) }),
      h('p.muted.center', { text: subtitle(state) })
    ),
    h(
      'ol.sh-order',
      rows.map(({ player, place }, index) => {
        const left = player.cardsLeft || [];
        const isLoser = state.loserId === player.id;
        return h(
          'li.sh-order__row',
          {
            className: place === 1 ? 'sh-order__row--first' : isLoser ? 'sh-order__row--last' : '',
            style: { '--i': String(index) },
          },
          h('span.sh-order__place', { text: place ? String(place) : '—' }),
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
          place === 1
            ? h('span.player__state.state--in', { text: 'Won' })
            : isLoser
              ? h('span.player__state.state--gone', { text: 'Left holding' })
              : null
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

function headline(state, you, youWon) {
  const first = (state.finished || [])[0];
  if (youWon) return 'Out first. Yours.';
  if (state.loserId === you.id) return 'Left holding the cards.';
  if (!first) return 'Nobody got out.';
  return `${first.name} was out first.`;
}

/**
 * Why it stopped, and who was left.
 *
 * A dead board and everybody going out are different results, and a screen that
 * showed them the same would be lying quietly — anybody watching knows whether
 * the last hand was played out or the board simply seized up.
 */
function subtitle(state) {
  if (state.endedEarly) return 'The Master ended this one early.';
  if (state.endReason === 'dead-board') {
    return 'Nothing legal left anywhere and no cards to draw, so it stopped there. Fewest cards left came out best.';
  }
  if (state.loserName) return `${state.loserName} was last one holding cards.`;
  return 'Everybody got out.';
}
