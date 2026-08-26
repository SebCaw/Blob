import { h, initials } from '../../ui.js';
import { topbar, action, woodenSpoon, ownName, confetti } from '../common.js';

/**
 * The end of a game of Cheat.
 *
 * The same shape as the other three: the order people got out in, and the one
 * left holding the most. Games that end the same way should look like they end
 * the same way.
 *
 * The difference is the bottom of the list. This game stops with TWO players
 * still holding cards rather than one, because heads-up Cheat has no end — so
 * the last two are ranked by how much they were sitting on, and the screen says
 * the count out loud. Level, and there is no spoon at all: an honest draw beats
 * a coin toss for it.
 */

export function overScreen(ctx) {
  const state = ctx.state;
  const you = state.you || {};
  const isMaster = you.isMaster;
  const finished = state.finished || [];
  const loser = state.players.find((p) => p.id === state.loserId);
  const tied = state.tied || null;
  const youWon = Boolean(finished.length && finished[0].id === you.id);
  const youLost = Boolean(loser && loser.id === you.id);

  // Everybody who never emptied their hand, biggest pile of cards first. With
  // the game stopping at two, this is usually exactly two people.
  const stranded = state.players
    .filter((p) => !p.left && !finished.some((f) => f.id === p.id))
    .sort((a, b) => (b.cardsLeft || []).length - (a.cardsLeft || []).length);

  const screen = h(
    'div.screen.screen--scroll',
    topbar(state, { title: 'Game over', ctx }),
    h(
      'div.stack.center',
      h('h1.sh-over__title', { text: headline(state, loser, tied, youWon, youLost) }),
      h('p.muted.center', { text: subtitle(state, tied) })
    ),
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
    stranded.map((player, i) => strandedRow(player, you, state, finished.length + i)),
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
 * One of the two left holding cards.
 *
 * The count is the point — it is what decided which of them lost, so leaving it
 * off would make the ordering look arbitrary. The server only sends these hands
 * once the game is complete; the phase gate is in `lib/cheat/view.js`.
 */
function strandedRow(player, you, state, index) {
  const held = (player.cardsLeft || []).length;
  const isLoser = state.loserId === player.id;
  return h(
    'div',
    { className: `sh-loser${isLoser ? '' : ' sh-loser--quiet'}`, style: { '--i': String(index) } },
    h('span.sh-order__place', { text: String(index + 1) }),
    h('div.player__badge', { text: initials(player.name) }),
    h(
      'div.sh-loser__who',
      h('div.sh-loser__name', { text: ownName(player.name, player.id === you.id) }),
      h('div.sh-loser__label', { text: `${held} ${held === 1 ? 'card' : 'cards'} left` })
    ),
    isLoser ? woodenSpoon() : null
  );
}

function headline(state, loser, tied, youWon, youLost) {
  if (youLost) return 'Left holding the lot.';
  if (youWon) return 'First one out.';
  if (tied) return 'Dead level.';
  if (!loser) return 'That is that.';
  return `${loser.name} was left holding it.`;
}

function subtitle(state, tied) {
  if (state.endedEarly) return 'The Master ended this one early.';
  if (tied) return `${tied.map((t) => t.name).join(' and ')} finished with the same number, so nobody gets the spoon.`;
  return 'It stops at two — heads-up, this game never ends.';
}
