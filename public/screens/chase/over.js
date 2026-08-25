import { h, initials } from '../../ui.js';
import { cardFace } from '../../cards.js';
import { topbar, action, woodenSpoon, ownName, confetti } from '../common.js';

/**
 * The end of a Chase the Ace game.
 *
 * The same shape as Silly Head's and Sevens': the order people got out in, and
 * the one left holding it. Three games ending the same way should look like they
 * end the same way.
 *
 * The card is the whole joke here, though, so it gets shown. Everybody knew the
 * ace was in there somewhere from the first deal; seeing it turned over in
 * somebody's hand at the end is the moment the game was played for.
 */

export function overScreen(ctx) {
  const state = ctx.state;
  const you = state.you || {};
  const isMaster = you.isMaster;
  const finished = state.finished || [];
  const loser = state.players.find((p) => p.id === state.loserId);
  const youWon = Boolean(finished.length && finished[0].id === you.id);
  const youLost = Boolean(loser && loser.id === you.id);
  const stranded = (loser && loser.cardsLeft) || [];

  const screen = h(
    'div.screen.screen--scroll',
    topbar(state, { title: 'Game over', ctx }),
    h(
      'div.stack.center',
      h('h1.sh-over__title', { text: headline(state, loser, youWon, youLost) }),
      state.endedEarly
        ? h('p.muted.center', {
            text: loser ? 'The Master ended this one early.' : 'Somebody walked off with the ace, so nobody lost.',
          })
        : null
    ),
    theCard(stranded, youLost),
    h(
      'ol.sh-order',
      finished.map((entry, index) => {
        const player = state.players.find((p) => p.id === entry.id);
        return h(
          'li.sh-order__row',
          { className: index === 0 ? 'sh-order__row--first' : '', style: { '--i': String(index) } },
          h('span.sh-order__place', { text: String(index + 1) }),
          h('div.player__badge', { text: initials(entry.name) }),
          h('span.sh-order__name', { text: ownName(entry.name, player && player.id === you.id) }),
          index === 0 ? h('span.player__state.state--in', { text: 'Out first' }) : null
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
            h('div.sh-loser__label', { text: 'Chased the ace' })
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
 * The ace, turned over.
 *
 * The server only sends it once the game is complete — the phase gate is in
 * `lib/chase/view.js`, and until then the key does not exist, so there is
 * nothing here for a screen to leak.
 */
function theCard(cards, youLost) {
  if (!cards.length) return null;
  return h(
    'div.ca-reveal',
    h('span.eyebrow.center', { text: youLost ? 'You were holding' : 'Left holding' }),
    h('div.ca-reveal__card', cardFace(cards[0], { size: 'lg', corner: true }))
  );
}

function headline(state, loser, youWon, youLost) {
  if (youLost) return 'You chased the ace.';
  if (youWon) return 'First one out.';
  if (!loser) return 'That is that.';
  return `${loser.name} chased the ace.`;
}
