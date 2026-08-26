'use strict';

const { OF_EACH, RANKS, rankOf } = require('./deck');

/**
 * What a hand is allowed to do, decided without reference to a table.
 *
 * There is exactly one rule in Go Fish and it lives here: **you may only ask
 * for a rank you are already holding.** Everything else in the game is
 * bookkeeping about who has what. Keeping the rule apart from the reducer means
 * it can be reasoned about on its own, and it means the bots and the reducer
 * agree on it by construction rather than by both having been written
 * carefully.
 *
 * Pure, like the rest of `lib/`.
 */

/** How many of each rank a hand holds. */
function countByRank(hand) {
  /** @type {Record<string, number>} */
  const counts = {};
  for (const card of hand) counts[rankOf(card)] = (counts[rankOf(card)] || 0) + 1;
  return counts;
}

/** The cards of one rank, in the order they are held. */
function cardsOfRank(hand, rank) {
  return hand.filter((card) => rankOf(card) === rank);
}

/**
 * The ranks this hand may ask for, in deck order.
 *
 * The whole rule, and it is why asking is a public act: every one of these is
 * something the table learns about your hand the moment you say it.
 */
function askableRanks(hand) {
  const counts = countByRank(hand);
  return RANKS.filter((rank) => counts[rank]);
}

/** May this hand ask for that rank? */
function canAsk(hand, rank) {
  return cardsOfRank(hand, rank).length > 0;
}

/**
 * The ranks this hand is holding a complete book of.
 *
 * Not laid down — held. Books go down by hand in this house, so a hand can be
 * sat on four sevens and still be asked for them, which is the point of making
 * it a tap rather than doing it for you.
 */
function completeBooks(hand) {
  const counts = countByRank(hand);
  return RANKS.filter((rank) => counts[rank] >= OF_EACH);
}

module.exports = { countByRank, cardsOfRank, askableRanks, canAsk, completeBooks };
