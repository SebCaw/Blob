'use strict';

const { CYCLE, OF_EACH, rankOf } = require('./deck');

/**
 * What may be claimed, and whether a claim was true.
 *
 * Two rules, and neither of them needs a table, a turn or a player to be
 * decided — so they live here where they can be reasoned about on their own.
 *
 * Pure, like the rest of `lib/`.
 */

/**
 * The ranks that may follow this one.
 *
 * Same, one up, or one down, and the ring joins the king back to the ace. The
 * FIRST claim of a round has no previous rank and may be anything, which is
 * what `null` means here — it happens at the start of the game and again every
 * time a challenge is settled, because the winner of a challenge starts fresh.
 *
 * Note that "same" is always available, so nobody is ever forced to lie by the
 * rule itself. They are forced to lie by their cards, which is the difference
 * between this house's version and the strictly-ascending one: here the
 * pressure comes from what you hold rather than from the rank marching away
 * from you.
 *
 * @param {string|null} lastRank
 * @returns {string[]}
 */
function legalRanks(lastRank) {
  if (!lastRank) return CYCLE.slice();
  const at = CYCLE.indexOf(lastRank);
  if (at === -1) return CYCLE.slice();
  const below = CYCLE[(at - 1 + CYCLE.length) % CYCLE.length];
  const above = CYCLE[(at + 1) % CYCLE.length];
  // Ordered low, same, high so a screen can lay them out the way they read.
  return [below, lastRank, above];
}

/** May this rank be claimed on top of that one? */
function isLegalClaim(lastRank, rank) {
  return legalRanks(lastRank).includes(rank);
}

/**
 * Was the claim true?
 *
 * Every card has to be the rank that was named. One wrong card in six makes the
 * whole play a lie — there is no partial credit, and that is what makes hiding
 * one card inside a big honest-looking claim a real gamble rather than a free
 * move.
 *
 * @param {string[]} cards
 * @param {string} rank
 */
function claimIsHonest(cards, rank) {
  return cards.length > 0 && cards.every((card) => rankOf(card) === rank);
}

/** How many cards of each rank a hand holds. */
function countByRank(hand) {
  /** @type {Record<string, number>} */
  const counts = {};
  for (const card of hand) counts[rankOf(card)] = (counts[rankOf(card)] || 0) + 1;
  return counts;
}

/** The cards in a hand of one rank, in the order they are held. */
function cardsOfRank(hand, rank) {
  return hand.filter((card) => rankOf(card) === rank);
}

/**
 * Is this claim arithmetically impossible?
 *
 * The one call that is never a gamble. If somebody claims four kings and you are
 * holding two of them, there are not enough kings in the deck for them to be
 * telling the truth — no reading of a face required, and no level of bot should
 * ever miss it.
 *
 * `known` is what the caller can legitimately account for: their own hand, plus
 * any card the whole room watched go into somebody's hand at a reveal. Both are
 * memory rather than X-ray vision, which is why a bot is allowed to use them.
 *
 * @param {{rank:string, count:number, decks:number, known:string[]}} args
 */
function impossible({ rank, count, decks, known }) {
  const inDeck = OF_EACH * decks;
  const accountedFor = known.filter((card) => rankOf(card) === rank).length;
  return count + accountedFor > inDeck;
}

module.exports = { legalRanks, isLegalClaim, claimIsHonest, countByRank, cardsOfRank, impossible };
