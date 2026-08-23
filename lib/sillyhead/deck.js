'use strict';

const { RANKS, SUITS, RED_SUITS, shuffle } = require('../deck');

/**
 * Cards for Silly Head, which can need more than one deck.
 *
 * Blob deals from exactly 52 distinct cards and leans on that: a card id is
 * unique, so a hand is a set and `10H` means one particular piece of card. Silly
 * Head shuffles a second deck in at five players and a fourth by sixteen, so the
 * same face can turn up more than once and the ids have to say WHICH one.
 *
 * So a Silly Head card id carries its copy: `10H#1`, `10H#2`. Everything else —
 * the rank, the suit, the colour — reads exactly as it does in Blob, and the
 * copy number is never shown to anybody. It exists so that two identical cards
 * can be told apart when one of them is played.
 *
 * Pure, like the rest of `lib/`: the shuffle is seeded by the caller and there
 * is no clock and no `Math.random()` anywhere in here.
 */

/** How many players one deck can seat before another is worth adding. */
const PLAYERS_PER_DECK = 4;

/**
 * One deck is enough for four, and four is where a second one starts to be
 * needed rather than merely traditional.
 *
 * This was two — a standard game shuffled two decks together however few of you
 * there were — and it was changed after playing it: at a table of four that
 * puts eight kings in a 104 card deck, and a game where every card you are
 * holding might be the second of a pair reads as the app dealing badly rather
 * than as the game being played properly. Four players take 36 of 52 cards,
 * which leaves a stock of sixteen: short, and that is the point of it.
 */
const MIN_DECKS = 1;

/** The quick game is one deck, and one deck will not stretch past this many. */
const MAX_QUICK_PLAYERS = 4;

/** Cards each: three face-down, three face-up on them, three in hand. */
const DOWN_COUNT = 3;
const UP_COUNT = 3;
const HAND_COUNT = 3;
const CARDS_EACH = DOWN_COUNT + UP_COUNT + HAND_COUNT;

/**
 * How many decks to shuffle together.
 *
 * Scales with the table rather than being a setting, because "how many decks"
 * is not a question anybody wants to be asked — it is arithmetic, and getting
 * it wrong is only ever noticed as the deck running out too early.
 *
 * @param {number} playerCount
 * @param {boolean} [quick] the one-deck quick game
 * @returns {number}
 */
function decksFor(playerCount, quick = false) {
  if (quick) return 1;
  return Math.max(MIN_DECKS, Math.ceil(playerCount / PLAYERS_PER_DECK));
}

/**
 * Every card in `copies` decks, in a fixed order.
 *
 * @param {number} copies how many decks
 * @returns {string[]} card ids, e.g. `["2S#1", "3S#1", ..., "AC#2"]`
 */
function buildDeck(copies) {
  if (!Number.isInteger(copies) || copies < 1) throw new Error('A deal needs at least one deck');
  const deck = [];
  for (let copy = 1; copy <= copies; copy++) {
    for (const suit of SUITS) {
      for (const rank of RANKS) deck.push(`${rank}${suit}#${copy}`);
    }
  }
  return deck;
}

/**
 * Split a Silly Head card id into its parts.
 *
 * The copy tag is stripped first, so the rest parses the same way Blob's does:
 * the suit is the last character and the rank is everything before it, which
 * means `10H` needs no special case.
 *
 * @param {string} cardId
 * @returns {{id:string, rank:string, suit:string, value:number, red:boolean, copy:number}}
 */
function parseCard(cardId) {
  if (typeof cardId !== 'string') throw new Error(`Not a card: ${cardId}`);
  const hash = cardId.indexOf('#');
  const face = hash === -1 ? cardId : cardId.slice(0, hash);
  const copy = hash === -1 ? 1 : Number(cardId.slice(hash + 1));
  if (face.length < 2 || !Number.isInteger(copy) || copy < 1) throw new Error(`Not a card: ${cardId}`);
  const suit = face.slice(-1);
  const rank = face.slice(0, -1);
  const index = RANKS.indexOf(rank);
  if (!SUITS.includes(suit) || index === -1) throw new Error(`Not a card: ${cardId}`);
  return { id: cardId, rank, suit, value: index + 2, red: RED_SUITS.includes(suit), copy };
}

/** The rank of a card id: `'3'` … `'10'`, `'J'`, `'Q'`, `'K'`, `'A'`. */
function rankOf(cardId) {
  return parseCard(cardId).rank;
}

/** The rank value of a card id: 2 low, 14 for an ace. */
function valueOf(cardId) {
  return parseCard(cardId).value;
}

/**
 * Deal a game: nine cards each — three face-down, three face-up on top of them,
 * three in hand — and whatever is left becomes the stock.
 *
 * Dealt in the order it is dealt at a table: a row of face-downs to everybody,
 * then the face-ups, then the hands. Nobody can tell the difference, but a deal
 * that is replayed from its seed should look like the one that happened.
 *
 * @param {number|string} seed the game's own seed
 * @param {string[]} playerIds seating order
 * @param {number} copies how many decks
 * @returns {{down:Object<string,string[]>, up:Object<string,string[]>, hands:Object<string,string[]>, stock:string[]}}
 */
function deal(seed, playerIds, copies) {
  if (!Array.isArray(playerIds) || playerIds.length < 2) {
    throw new Error('A deal needs at least two players');
  }
  const deck = shuffle(buildDeck(copies), seed);
  const needed = playerIds.length * CARDS_EACH;
  if (needed > deck.length) {
    throw new Error(
      `${playerIds.length} players at ${CARDS_EACH} cards each needs ${needed} cards, and ${copies} deck(s) hold ${deck.length}`
    );
  }

  const down = {};
  const up = {};
  const hands = {};
  let at = 0;
  const rowTo = (target, count) => {
    for (let i = 0; i < count; i++) {
      for (const id of playerIds) {
        (target[id] = target[id] || []).push(deck[at++]);
      }
    }
  };
  rowTo(down, DOWN_COUNT);
  rowTo(up, UP_COUNT);
  rowTo(hands, HAND_COUNT);

  return { down, up, hands, stock: deck.slice(at) };
}

module.exports = {
  PLAYERS_PER_DECK,
  MIN_DECKS,
  MAX_QUICK_PLAYERS,
  DOWN_COUNT,
  UP_COUNT,
  HAND_COUNT,
  CARDS_EACH,
  decksFor,
  buildDeck,
  parseCard,
  rankOf,
  valueOf,
  deal,
};
