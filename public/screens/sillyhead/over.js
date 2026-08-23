import { h, initials } from '../../ui.js';
import { topbar, action, woodenSpoon, ownName } from '../common.js';

/**
 * The end of a Silly Head game.
 *
 * There is no score, so there is no leaderboard — only the order people got
 * out in, and the one person still holding cards. The winner is at the top
 * because they earned it; the Silly Head is at the bottom in their own colours,
 * because that is the whole joke and burying it would be the wrong kind of
 * kind.
 */

export function overScreen(ctx) {
  const state = ctx.state;
  const you = state.you;
  const isMaster = you && you.isMaster;
  const finished = state.finished || [];
  const loser = state.players.find((p) => p.id === state.loserId);
  const youWon = finished.length && finished[0].id === you.id;
  const youLost = loser && loser.id === you.id;

  return h(
    'div.screen.screen--scroll',
    topbar(state, { title: 'Game over', ctx }),
    h(
      'div.stack.center',
      h('h1.sh-over__title', { text: headline(state, youWon, youLost) }),
      state.endedEarly ? h('p.muted.center', { text: 'The Master ended this one early.' }) : null
    ),
    h('div.spacer'),
    h(
      'ol.sh-order',
      finished.map((entry, index) => {
        const player = state.players.find((p) => p.id === entry.id);
        return h(
          'li.sh-order__row',
          { className: index === 0 ? 'sh-order__row--first' : '' },
          h('span.sh-order__place', { text: String(index + 1) }),
          h('div.player__badge', { text: initials(entry.name) }),
          h('span.sh-order__name', { text: ownName(entry.name, player && player.id === you.id) }),
          index === 0 ? h('span.player__state.state--in', { text: 'Won' }) : null
        );
      })
    ),
    loser
      ? h(
          'div.sh-loser',
          woodenSpoon(),
          h(
            'div',
            h('div.sh-loser__name', { text: ownName(loser.name, loser.id === you.id) }),
            h('div.sh-loser__label', { text: 'Silly Head' })
          )
        )
      : null,
    h('div.spacer'),
    isMaster
      ? action('Play again', () => ctx.rematch())
      : state.rematchCode
      ? action(`Join the new game (${state.rematchCode})`, () => ctx.joinDifferentGame(state.rematchCode))
      : h('p.muted.center', { text: 'Waiting to see if the Master starts another.' }),
    h('button.btn.btn--link', { text: 'Leave game', type: 'button', onClick: () => ctx.leaveGame() })
  );
}

function headline(state, youWon, youLost) {
  if (youWon) return 'You got rid of the lot.';
  if (youLost) return 'You are the Silly Head.';
  const loser = state.players.find((p) => p.id === state.loserId);
  return loser ? `${loser.name} is the Silly Head.` : 'That is that.';
}
