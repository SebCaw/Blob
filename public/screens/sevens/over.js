import { h, initials } from '../../ui.js';
import { cardFace, suitGlyph, suitName, isRed } from '../../cards.js';
import { topbar, action, woodenSpoon, ownName, confetti } from '../common.js';

/**
 * The end of a Sevens game.
 *
 * No score, so no leaderboard — only the order people got out in, and the one
 * left holding cards. The same shape as Silly Head's end screen, because the
 * games end the same way and two different-looking answers to one question would
 * be a cost with nothing bought by it.
 *
 * The first version of this screen was the order list and nothing else, floating
 * in the middle of a tall phone with a gap above and below it. The fix was not
 * decoration: a Sevens game produces two things worth looking at afterwards, and
 * neither of them was on the screen. **What the loser was stuck with** is the
 * joke, and it is the reason the headline is true. **The table you all built**
 * is the artefact — four runs that only came out that way once.
 *
 * The last row is the last ROW, not a warning notice. It carries the place after
 * everybody who got out and the same initials badge as the rows above, because
 * it IS the next row. That was got wrong once already in this app and read as an
 * error message parked under a leaderboard.
 */

/** Low to high, as Sevens counts. Mirrors `lib/sevens/deck.js`. */
const RANKS = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'];
const RANK_WORD = {
  A: 'ace', J: 'jack', Q: 'queen', K: 'king',
};

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
      h('h1.sh-over__title', { text: headline(state, loser, stranded.length, youWon, youLost) }),
      state.endedEarly ? h('p.muted.center', { text: 'The Master ended this one early.' }) : null
    ),
    strandedCards(stranded, loser, youLost),
    h(
      'ol.sh-order',
      finished.map((entry, index) => {
        const player = state.players.find((p) => p.id === entry.id);
        return h(
          'li.sh-order__row',
          {
            className: index === 0 ? 'sh-order__row--first' : '',
            // Each row arrives a beat after the one above it, so the order reads
            // as an order rather than as a block that was already there.
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
            h('div.sh-loser__label', {
              text: stranded.length
                ? `still had ${stranded.length} ${stranded.length === 1 ? 'card' : 'cards'}`
                : 'left holding them',
            })
          ),
          woodenSpoon()
        )
      : null,
    finalTable(state),
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
 * The cards somebody was left holding, face up.
 *
 * The server only sends these once the game is over — see the phase gate in
 * `lib/sevens/view.js`. Until then the key does not exist, so there is nothing
 * here for a screen to leak.
 *
 * It sits directly under the headline because it is what makes the headline
 * true. "Ada was left holding six" is a fact; the six cards are the joke, and
 * usually the reason as well — a hand of nothing but kings and aces explains
 * itself.
 */
function strandedCards(cards, loser, youLost) {
  if (!cards.length) return null;
  return h(
    'div.sv-stranded',
    h('span.eyebrow.center', { text: youLost ? 'You were sat on' : `${loser.name} was sat on` }),
    h(
      'div.sv-stranded__cards',
      cards.map((card, i) =>
        h(
          'div.sv-stranded__card',
          { style: { '--i': String(i) } },
          cardFace(card, { size: 'sm', corner: true })
        )
      )
    )
  );
}

/**
 * The four runs as they finished.
 *
 * Written as words rather than drawn as cards. Fifty-odd miniature cards would
 * be the same information at a size nobody can read, and what is actually worth
 * knowing afterwards is which suits went all the way out and which one stalled —
 * because the one that stalled is where the game was lost.
 */
function finalTable(state) {
  const suits = state.suits || [];
  if (!suits.length) return null;
  return h(
    'div.sv-final',
    h('span.eyebrow.center', { text: 'The table when it stopped' }),
    h(
      'div.sv-final__grid',
      suits.map((entry) =>
        h(
          'div',
          { className: `sv-final__suit${entry.complete ? ' sv-final__suit--done' : ''}` },
          h('span', {
            className: `sv-final__glyph${isRed(entry.suit) ? ' sv-final__glyph--red' : ''}`,
            text: suitGlyph(entry.suit),
            'aria-hidden': 'true',
          }),
          h('span.sv-final__span', { text: spanOf(entry) }),
          h('span.sv-final__n', { text: `${entry.down}` }),
          h('span.sr-only', { text: `${suitName(entry.suit)}: ${spanOf(entry)}` })
        )
      )
    )
  );
}

/** "ace to king", "four to ten", or "never started". */
function spanOf(entry) {
  if (!entry.open) return 'never started';
  if (entry.complete) return 'all of it';
  const low = rankWord(entry.run.low);
  const high = rankWord(entry.run.high);
  return low === high ? `just the ${low}` : `${low} to ${high}`;
}

function rankWord(value) {
  const rank = RANKS[value - 1];
  return RANK_WORD[rank] || rank;
}

/**
 * How many turns somebody sat there with nothing.
 *
 * Only shown when it is worth a laugh. Passing once is ordinary; passing five
 * times is the story of that person's game, and the table already knows it.
 */
function passNote(state, playerId) {
  const player = state.players.find((p) => p.id === playerId);
  if (!player || player.passes < 3) return null;
  return h('span.sh-order__note', { text: `passed ${player.passes}×` });
}

function headline(state, loser, held, youWon, youLost) {
  if (youWon) return 'You got rid of the lot.';
  if (youLost) return held ? `You were left holding ${held}.` : 'You were left holding them.';
  if (!loser) return 'That is that.';
  return held ? `${loser.name} was left holding ${held}.` : `${loser.name} was left holding them.`;
}
