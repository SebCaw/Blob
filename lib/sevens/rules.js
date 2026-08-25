'use strict';

const { SUITS, SEVEN, SEVEN_VALUE, LOW_VALUE, HIGH_VALUE, suitOf, valueOf } = require('./deck');

/**
 * What the table will accept, and what happens when a card lands on it.
 *
 * Everything in here is about the four columns and nothing else — it does not
 * know who is playing, whose turn it is, or where a card came from. That belongs
 * to the reducer. Keeping the two apart is what makes the rules testable one at
 * a time.
 *
 * Pure, like the rest of `lib/`.
 */

/**
 * The table: one entry per suit.
 *
 * A suit is either `null`, meaning its seven has not been played and the suit
 * cannot be touched at all, or `{low, high}` — the values at each end of the run
 * so far. A suit that has just opened is `{low: 7, high: 7}`, because a seven is
 * both ends of its own run until something is put either side of it.
 *
 * Only the two ends are stored. Everything between them is implied: a run is
 * unbroken by definition, since the only way to extend it is one card at a time
 * from an end.
 *
 * @returns {Record<string, {low:number, high:number}|null>}
 */
function emptyTable() {
  return Object.fromEntries(SUITS.map((suit) => [suit, null]));
}

/**
 * Would this card be legal on the table as it stands?
 *
 * Three cases and no others: a seven opens its suit, a card one below the low
 * end extends downward, a card one above the high end extends upward.
 *
 * @param {string} cardId
 * @param {Record<string, {low:number, high:number}|null>} table
 * @returns {boolean}
 */
function isPlayable(cardId, table) {
  const run = table[suitOf(cardId)];
  const value = valueOf(cardId);
  if (!run) return value === SEVEN_VALUE;
  return value === run.low - 1 || value === run.high + 1;
}

/**
 * The card put down, and the run it joined.
 *
 * Returns the new table rather than changing the one it was given — the reducer
 * clones state at the top of every command and nothing under it mutates.
 *
 * @param {string} cardId
 * @param {Record<string, {low:number, high:number}|null>} table
 * @returns {{table:object, suit:string, end:'open'|'low'|'high'}}
 */
function place(cardId, table) {
  const suit = suitOf(cardId);
  const value = valueOf(cardId);
  const run = table[suit];
  const next = { ...table };

  if (!run) {
    next[suit] = { low: SEVEN_VALUE, high: SEVEN_VALUE };
    return { table: next, suit, end: 'open' };
  }
  if (value === run.low - 1) {
    next[suit] = { low: value, high: run.high };
    return { table: next, suit, end: 'low' };
  }
  next[suit] = { low: run.low, high: value };
  return { table: next, suit, end: 'high' };
}

/**
 * Which values a suit would take next, for the screen to show as its open ends.
 *
 * Empty for a suit that is finished, and the seven alone for one not yet opened.
 *
 * @param {{low:number, high:number}|null} run
 * @returns {number[]}
 */
function openEnds(run) {
  if (!run) return [SEVEN_VALUE];
  const ends = [];
  if (run.low > LOW_VALUE) ends.push(run.low - 1);
  if (run.high < HIGH_VALUE) ends.push(run.high + 1);
  return ends;
}

/** Has this suit gone all the way out, ace to king? */
function isComplete(run) {
  return Boolean(run) && run.low === LOW_VALUE && run.high === HIGH_VALUE;
}

/** How many cards of a suit are down. Zero for a suit that has not opened. */
function cardsDown(run) {
  return run ? run.high - run.low + 1 : 0;
}

/** How many cards are on the table altogether. */
function totalDown(table) {
  return SUITS.reduce((sum, suit) => sum + cardsDown(table[suit]), 0);
}

/** How many suits have had their seven played. */
function suitsOpen(table) {
  return SUITS.filter((suit) => table[suit]).length;
}

module.exports = {
  SEVEN,
  SEVEN_VALUE,
  emptyTable,
  isPlayable,
  place,
  openEnds,
  isComplete,
  cardsDown,
  totalDown,
  suitsOpen,
};
