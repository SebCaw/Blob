'use strict';

const { SUITS, RED_SUITS, newDeck, shuffle, parseCard } = require('../deck');

/**
 * The deck as Sevens reads it.
 *
 * One thing differs from every other game here, and it is the whole reason this
 * file exists: **the ace is low**. `lib/deck.js` orders its ranks with the ace
 * at the top, because that is what Blob and Silly Head need — an ace wins a
 * trick and an ace beats a king on the pile. In Sevens the downward run off a
 * seven ends three, two, ace, so an ace is worth one and nothing else.
 *
 * Reusing the shared value would put the ace above the king and quietly make the
 * upward run thirteen long and the downward run five. Everything else — the card
 * ids, the shuffle, the red suits — is the shared deck untouched.
 */

/** Low to high, as Sevens counts. Ace first, and that is the point. */
const RANKS = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'];

/** The rank every suit is built out from. */
const SEVEN = '7';

/** What a seven is worth, so nothing has to re-derive the middle of the run. */
const SEVEN_VALUE = RANKS.indexOf(SEVEN) + 1;

/** The lowest and highest a suit can go. */
const LOW_VALUE = 1;
const HIGH_VALUE = RANKS.length;

/** The suit the opening seven belongs to. Whoever holds it leads. */
const OPENING_CARD = '7D';

/**
 * Rank -> its Sevens value, ace 1 through king 13.
 * Built once from the order above rather than written out, so the two cannot drift.
 */
const VALUE = Object.fromEntries(RANKS.map((rank, i) => [rank, i + 1]));

/** @param {string} cardId */
function rankOf(cardId) {
  return parseCard(cardId).rank;
}

/** @param {string} cardId */
function suitOf(cardId) {
  return parseCard(cardId).suit;
}

/**
 * The Sevens value of a card id: ace 1, king 13.
 *
 * Deliberately NOT `valueOf` from `lib/deck.js`, which is ace 14. Anything in
 * this game that compares two cards comes through here.
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

/**
 * The suit order the table and the hand both use, left to right.
 *
 * Red, black, red, black — Seb's call, and it is worth more than it looks. The
 * columns and the fan are drawn in the same order, so a card in your hand is
 * roughly above the column it is going to, and two suits of the same colour
 * never sit next to each other where a glance could confuse them.
 */
const SUIT_ORDER = ['H', 'S', 'D', 'C'];

/**
 * Deal the whole deck out, one card at a time round the table.
 *
 * Everything goes out — there is no stock in Sevens and no cards left over. With
 * three, five, six or seven players 52 does not divide, so hands are uneven by
 * one card and that is simply how the game is played.
 *
 * @param {string} seed
 * @param {string[]} playerIds
 * @returns {Record<string, string[]>} playerId -> their hand
 */
function deal(seed, playerIds) {
  const cards = shuffle(newDeck(), seed);
  /** @type {Record<string, string[]>} */
  const hands = {};
  for (const id of playerIds) hands[id] = [];
  cards.forEach((card, i) => {
    hands[playerIds[i % playerIds.length]].push(card);
  });
  for (const id of playerIds) hands[id] = sortHand(hands[id]);
  return hands;
}

/**
 * A hand in the order it is held: by suit in `SUIT_ORDER`, low to high within
 * each suit.
 *
 * Sorted on the server rather than the screen because the order is the same for
 * everybody and there is no reason for four phones to each work it out. It also
 * means the fan a player sees never reshuffles itself under them when a card
 * leaves.
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

module.exports = {
  RANKS,
  SUITS,
  SUIT_ORDER,
  SEVEN,
  SEVEN_VALUE,
  LOW_VALUE,
  HIGH_VALUE,
  OPENING_CARD,
  VALUE,
  rankOf,
  suitOf,
  valueOf,
  isRed,
  deal,
  sortHand,
};
