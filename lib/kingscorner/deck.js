'use strict';

const { SUITS, RED_SUITS, newDeck, shuffle, parseCard } = require('../deck');

/**
 * The deck as Kings Corner reads it.
 *
 * **The ace is low**, the same departure Sevens makes and for the same reason:
 * `lib/deck.js` puts the ace above the king because a trick needs it there, and
 * here a pile built down ends three, two, ace and stops. Borrowing the shared
 * value would put an ace under a king and make every pile in the game one card
 * longer than it can actually be, with nothing complaining.
 *
 * **Colour is a rule here, not decoration.** Every card that goes down has to be
 * the opposite colour to the one it lands on, so `isRed` is load-bearing rather
 * than a hint for the screen. Everything else — the card ids, the shuffle, the
 * suits — is the shared deck untouched.
 */

/** Low to high, as Kings Corner counts. Ace first. */
const RANKS = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'];

/** The lowest and highest a pile can run. */
const LOW_VALUE = 1;
const HIGH_VALUE = RANKS.length;

/** The one rank that opens a corner. */
const KING = 'K';

/** Rank -> value, ace 1 through king 13. Built from the order so the two cannot drift. */
const VALUE = Object.fromEntries(RANKS.map((rank, i) => [rank, i + 1]));

/** How many cards everybody starts with. */
const HAND_SIZE = 7;

/** @param {string} cardId */
function rankOf(cardId) {
  return parseCard(cardId).rank;
}

/** @param {string} cardId */
function suitOf(cardId) {
  return parseCard(cardId).suit;
}

/**
 * The Kings Corner value of a card id: ace 1, king 13.
 *
 * Deliberately NOT `valueOf` from `lib/deck.js`, which is ace 14. Anything in
 * this game that compares two ranks comes through here.
 *
 * @param {string} cardId
 * @returns {number}
 */
function valueOf(cardId) {
  return VALUE[rankOf(cardId)];
}

/** @param {string} cardId */
function isRed(cardId) {
  return RED_SUITS.includes(suitOf(cardId));
}

/** @param {string} cardId */
function isKing(cardId) {
  return rankOf(cardId) === KING;
}

/**
 * Do these two cards sit on top of each other?
 *
 * The building rule in one place: `under` goes onto `over` when it is one rank
 * lower and the other colour. Every legality question in this game is this
 * function asked about a different pair of cards.
 *
 * @param {string} over the card already down — the lower end of a pile
 * @param {string} under the card going onto it
 */
function fits(over, under) {
  return valueOf(under) === valueOf(over) - 1 && isRed(under) !== isRed(over);
}

/**
 * Two questions that sound like one, and getting them the same way round cost a
 * red test the first time this file was written.
 *
 * `wants` looks UP: the card a hand card needs to find before it can be put
 * down — one rank higher, the other colour. A king wants nothing, because there
 * is nothing above it.
 *
 * `takes` looks DOWN: the card a pile will accept next, read off its lowest
 * card — one rank lower, the other colour. A pile built to an ace takes
 * nothing, which is what makes it dead.
 *
 * Both are derived from one card and nothing else, and both come from the
 * server anyway: the rank order is a rule of this game — the ace being low is
 * the whole of this file — and a client that worked it out would be a second
 * copy of that rule, cached for a month, free to disagree.
 *
 * @param {string} cardId
 * @returns {{rank:string, red:boolean}|null}
 */
function wants(cardId) {
  const value = valueOf(cardId);
  if (value >= HIGH_VALUE) return null;
  return { rank: RANKS[value], red: !isRed(cardId) };
}

/**
 * What would go onto this card next. See `wants` above for the pair.
 *
 * @param {string} cardId
 * @returns {{rank:string, red:boolean}|null}
 */
function takes(cardId) {
  const value = valueOf(cardId);
  if (value <= LOW_VALUE) return null;
  return { rank: RANKS[value - 2], red: !isRed(cardId) };
}

/**
 * The deal: seven each, four turned into the cross, the rest face down.
 *
 * Six hands of seven plus the four turned is forty-six of fifty-two, so one deck
 * always covers the table and no card ever needs a copy tag the way Silly Head's
 * do. At six players that leaves a stock of six, which is thin on purpose — see
 * KINGS-CORNER.md.
 *
 * @param {string} seed
 * @param {string[]} playerIds
 * @returns {{hands:Record<string,string[]>, cross:string[], stock:string[]}}
 */
function deal(seed, playerIds) {
  const cards = shuffle(newDeck(), seed);
  /** @type {Record<string, string[]>} */
  const hands = {};
  let at = 0;
  for (const id of playerIds) {
    hands[id] = sortHand(cards.slice(at, at + HAND_SIZE));
    at += HAND_SIZE;
  }
  const cross = cards.slice(at, at + 4);
  return { hands, cross, stock: cards.slice(at + 4) };
}

/**
 * The order a hand is held in: by suit, low to high inside a suit.
 *
 * Sorted on the server because the order is the same for everybody and there is
 * no reason for six phones to each work it out. It also means the fan never
 * reshuffles itself under the thumb when a card leaves — which matters more here
 * than anywhere else, because a turn is a chain of moves and the hand changes
 * three or four times inside one go.
 *
 * @param {string[]} hand
 * @returns {string[]}
 */
function sortHand(hand) {
  return hand.slice().sort((a, b) => {
    const suits = SUIT_ORDER.indexOf(suitOf(a)) - SUIT_ORDER.indexOf(suitOf(b));
    return suits || valueOf(a) - valueOf(b);
  });
}

/** Red, black, red, black — so two suits of one colour never sit side by side. */
const SUIT_ORDER = ['H', 'S', 'D', 'C'];

module.exports = {
  RANKS,
  SUITS,
  SUIT_ORDER,
  LOW_VALUE,
  HIGH_VALUE,
  KING,
  VALUE,
  HAND_SIZE,
  rankOf,
  suitOf,
  valueOf,
  isRed,
  isKing,
  fits,
  wants,
  takes,
  deal,
  sortHand,
};
