import { h, initials } from '../../ui.js';
import { topbar, action, woodenSpoon, ownName, confetti } from '../common.js';

/**
 * The end of a Sevens game.
 *
 * No score, so no leaderboard — only the order people got out in, and the one
 * left holding cards. Deliberately the same shape as Silly Head's end screen:
 * the games end the same way, and two different-looking answers to the same
 * question would be a cost with nothing bought by it.
 *
 * The last row is the last ROW, not a warning notice. It carries the place after
 * everybody who got out and the same initials badge as the rows above, because
 * it is the next row. That was got wrong once already in this app and read as an
 * error message parked under a leaderboard.
 */

export function overScreen(ctx) {
  const state = ctx.state;
  const you = state.you || {};
  const isMaster = you.isMaster;
  const finished = state.finished || [];
  const loser = state.players.find((p) => p.id === state.loserId);
  const youWon = Boolean(finished.length && finished[0].id === you.id);
  const youLost = Boolean(loser && loser.id === you.id);

  const screen = h(
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
          {
            className: index === 0 ? 'sh-order__row--first' : '',
            // Each row arrives a beat after the one above it, so the order reads
            // as an order rather than as a block of text that was already there.
            style: { '--i': String(index) },
          },
          h('span.sh-order__place', { text: String(index + 1) }),
          h('div.player__badge', { text: initials(entry.name) }),
          h('span.sh-order__name', { text: ownName(entry.name, player && player.id === you.id) }),
          index === 0 ? h('span.player__state.state--in', { text: 'Won' }) : null,
          passNote(state, entry.id)
        );
      })
    ),
    loser
      ? h(
          'div.sh-loser',
          { style: { '--i': String(finished.length) } },
          h('span.sh-order__place', { text: String(finished.length + 1) }),
          h('div.player__badge', { text: initials(loser.name) }),
          h(
            'div.sh-loser__who',
            h('div.sh-loser__name', { text: ownName(loser.name, loser.id === you.id) }),
            h('div.sh-loser__label', { text: 'Left holding them' })
          ),
          woodenSpoon()
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

  if (youWon) confetti();
  return screen;
}

/**
 * How many turns somebody sat there with nothing.
 *
 * Only shown when it is worth a laugh. Passing once is ordinary; passing five
 * times is the story of that person's game and the table already knows it.
 */
function passNote(state, playerId) {
  const player = state.players.find((p) => p.id === playerId);
  if (!player || player.passes < 3) return null;
  return h('span.sh-order__note', { text: `passed ${player.passes}×` });
}

function headline(state, youWon, youLost) {
  if (youWon) return 'You got rid of the lot.';
  if (youLost) return 'You were left holding them.';
  const loser = state.players.find((p) => p.id === state.loserId);
  return loser ? `${loser.name} was left holding them.` : 'That is that.';
}
