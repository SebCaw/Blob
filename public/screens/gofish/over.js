import { h, initials } from '../../ui.js';
import { topbar, action, ownName, confetti } from '../common.js';

/**
 * The end of a game of Go Fish.
 *
 * The one game on the shelf with a SCORE at the end rather than an order, and
 * the screen has to be about that: how many books each, biggest pile first.
 * Every other game here finishes with somebody left holding the cards, and the
 * temptation was to reuse that shape — but "who got out first" is not the
 * question here and putting it on the screen would be answering the wrong one.
 *
 * There is also no wooden spoon. Nobody loses Go Fish; somebody wins it, and the
 * rest collected fewer books. Handing out a spoon for coming last in a game that
 * is mostly luck at three books apiece would be a joke at the wrong person's
 * expense.
 */

export function overScreen(ctx) {
  const state = ctx.state;
  const you = state.you || {};
  const isMaster = you.isMaster;
  const winners = state.winners || [];
  const youWon = winners.some((w) => w.id === you.id);

  // Everybody, by books. Not by who got out first — going out early in this game
  // means you ran out of cards, which is neither good nor bad on its own.
  const order = state.players
    .filter((p) => !p.left)
    .slice()
    .sort((a, b) => (b.books || []).length - (a.books || []).length || a.name.localeCompare(b.name));

  const screen = h(
    'div.screen.screen--scroll',
    topbar(state, { title: 'Game over', ctx }),
    h(
      'div.stack.center',
      h('h1.sh-over__title', { text: headline(winners, youWon) }),
      h('p.muted.center', { text: subtitle(state) })
    ),
    h(
      'ol.sh-order',
      order.map((player, index) => {
        const books = player.books || [];
        const won = winners.some((w) => w.id === player.id);
        return h(
          'li.sh-order__row',
          { className: won ? 'sh-order__row--first' : '', style: { '--i': String(index) } },
          h('span.sh-order__place', { text: String(books.length) }),
          h('div.player__badge', { text: initials(player.name) }),
          h(
            'div.gf-over__who',
            h('span.sh-order__name', { text: ownName(player.name, player.id === you.id) }),
            books.length
              ? h('span.gf-over__books', { text: books.join(' · ') })
              : h('span.gf-over__books.gf-over__books--none', { text: 'no books' })
          ),
          won ? h('span.player__state.state--in', { text: winners.length > 1 ? 'Level' : 'Most books' }) : null
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

function headline(winners, youWon) {
  if (youWon && winners.length > 1) return 'Level at the top.';
  if (youWon) return 'Most books. Yours.';
  if (!winners.length) return 'Nobody got a book.';
  if (winners.length > 1) return `${winners.map((w) => w.name).join(' and ')} finished level.`;
  return `${winners[0].name} takes it.`;
}

/**
 * Why it stopped, and it is worth saying.
 *
 * Go Fish usually ends with a book or two still unmade, because out is out in
 * this house and cards get stranded in the pool. Somebody counting to thirteen
 * and coming up short deserves to be told why rather than left to wonder whether
 * the app dropped something.
 */
function subtitle(state) {
  if (state.endedEarly) return 'The Master ended this one early.';
  const short = (state.booksInDeck || 13) - (state.booksMade || 0);
  if (state.stoppedBarren) {
    return 'Nothing was moving, so it stopped there.';
  }
  if (!short) return 'All thirteen books made.';
  return `${state.booksMade} of ${state.booksInDeck} books. It stops when there is nobody left to ask.`;
}
