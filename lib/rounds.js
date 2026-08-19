'use strict';

/**
 * Round sequence generation and deck-size checking.
 *
 * A Blob game counts the hand size down from the starting size to 1, then back
 * up to the starting size. Bidding happens before every round in that sequence.
 */

/** The smallest starting hand the Master may choose. */
const MIN_HAND_SIZE = 3;

/** A standard deck. Used for the friendly warning only — never a hard limit. */
const STANDARD_DECK_SIZE = 52;

/**
 * Build the full round sequence for a starting hand size.
 * 7 -> [7,6,5,4,3,2,1,2,3,4,5,6,7]
 *
 * @param {number} startHandSize
 * @returns {number[]} hand size for each round, in order
 */
function roundSequence(startHandSize) {
  if (!Number.isInteger(startHandSize) || startHandSize < MIN_HAND_SIZE) {
    throw new Error(`Starting hand size must be a whole number of at least ${MIN_HAND_SIZE}`);
  }
  const down = [];
  for (let n = startHandSize; n >= 1; n--) down.push(n);
  const up = [];
  for (let n = 2; n <= startHandSize; n++) up.push(n);
  return down.concat(up);
}

/**
 * Total number of rounds for a starting hand size. (2 * start) - 1.
 * @param {number} startHandSize
 * @returns {number}
 */
function roundCount(startHandSize) {
  return roundSequence(startHandSize).length;
}

/**
 * The largest hand size in a game — which is the starting hand size, since the
 * sequence only ever counts down and back up to it.
 * @param {number} startHandSize
 * @returns {number}
 */
function largestHandSize(startHandSize) {
  return startHandSize;
}

/**
 * How many cards the biggest round of this game needs, and whether that exceeds
 * a standard deck. This NEVER blocks a game — groups may use multiple decks.
 *
 * @param {number} playerCount
 * @param {number} startHandSize
 * @param {number} [deckSize]
 * @returns {{cardsNeeded:number, deckSize:number, exceeds:boolean, decksNeeded:number, message:string|null}}
 */
function deckCheck(playerCount, startHandSize, deckSize = STANDARD_DECK_SIZE) {
  const cardsNeeded = playerCount * largestHandSize(startHandSize);
  const exceeds = cardsNeeded > deckSize;
  const decksNeeded = Math.max(1, Math.ceil(cardsNeeded / deckSize));
  return {
    cardsNeeded,
    deckSize,
    exceeds,
    decksNeeded,
    message: exceeds
      ? `This game needs ${cardsNeeded} cards at its biggest round, but a standard deck has ${deckSize}. ` +
        `You'll need ${decksNeeded} decks.`
      : null,
  };
}

module.exports = {
  MIN_HAND_SIZE,
  STANDARD_DECK_SIZE,
  roundSequence,
  roundCount,
  largestHandSize,
  deckCheck,
};
