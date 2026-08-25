'use strict';

const { rankOf } = require('./deck');

/**
 * Pairing, and nothing else.
 *
 * The whole rulebook of this game is "two of the same rank go in the middle",
 * and it is worth keeping that on its own so it can be tested without a table,
 * a turn order or a player around it.
 *
 * Pure, like the rest of `lib/`.
 */

/**
 * Pull every pair out of a hand.
 *
 * Two cards of the same RANK are a pair — suit and deck copy do not come into
 * it. Hold three of a rank and one pair leaves and the odd one stays; hold four
 * and both pairs leave. That is why this counts rather than matching: a naive
 * "remove all cards that appear more than once" bins three sevens and quietly
 * changes the deck maths, which is the sort of bug that only shows up as a game
 * that will not end.
 *
 * **Order is preserved for what is kept.** In this game the order of a hand is
 * the game — it is what everybody is trying to read — so discarding must not
 * quietly reshuffle what is left. The earliest cards of a rank are the ones that
 * go, which keeps it deterministic.
 *
 * @param {string[]} hand in the order it is held
 * @returns {{kept:string[], pairs:string[][]}} pairs are [a, b] each
 */
function extractPairs(hand) {
  /** @type {Record<string, number[]>} rank -> the positions holding it */
  const byRank = {};
  hand.forEach((card, i) => {
    const rank = rankOf(card);
    if (!byRank[rank]) byRank[rank] = [];
    byRank[rank].push(i);
  });

  const dropped = new Set();
  const pairs = [];
  // Ranks in the order their first card sits in the hand, so the pairs come out
  // in a stable order rather than whatever the object happens to iterate in.
  const ranks = Object.keys(byRank).sort((a, b) => byRank[a][0] - byRank[b][0]);
  for (const rank of ranks) {
    const positions = byRank[rank];
    for (let k = 0; k + 1 < positions.length; k += 2) {
      dropped.add(positions[k]);
      dropped.add(positions[k + 1]);
      pairs.push([hand[positions[k]], hand[positions[k + 1]]]);
    }
  }

  return { kept: hand.filter((_, i) => !dropped.has(i)), pairs };
}

/** Does this hand still hold a pair somebody has not binned yet? */
function hasPair(hand) {
  return pairIndexes(hand).length > 0;
}

/**
 * Every pair in a hand, as the POSITIONS holding it.
 *
 * Positions rather than cards, because the screen works in slots and the
 * reducer is handed two indices. One entry per pair: three of a rank is one
 * pair and a spare, four is two pairs.
 *
 * @param {string[]} hand
 * @returns {number[][]} `[[i, j], ...]`
 */
function pairIndexes(hand) {
  const byRank = {};
  hand.forEach((card, i) => {
    const rank = rankOf(card);
    if (!byRank[rank]) byRank[rank] = [];
    byRank[rank].push(i);
  });
  const out = [];
  const ranks = Object.keys(byRank).sort((a, b) => byRank[a][0] - byRank[b][0]);
  for (const rank of ranks) {
    const at = byRank[rank];
    for (let k = 0; k + 1 < at.length; k += 2) out.push([at[k], at[k + 1]]);
  }
  return out;
}

/**
 * Move one card within a hand, from one position to another.
 *
 * The card at `from` is lifted out and dropped back in at `to`, everything else
 * closing up around it — the way you would move a card in a real fan. Returns
 * null for anything out of range, so the reducer can refuse rather than silently
 * producing a hand of the wrong length.
 *
 * @param {string[]} hand
 * @param {number} from
 * @param {number} to
 * @returns {string[]|null}
 */
function moveCard(hand, from, to) {
  if (!Number.isInteger(from) || !Number.isInteger(to)) return null;
  if (from < 0 || from >= hand.length) return null;
  if (to < 0 || to >= hand.length) return null;
  if (from === to) return hand.slice();
  const next = hand.slice();
  const [card] = next.splice(from, 1);
  next.splice(to, 0, card);
  return next;
}

/**
 * Put a drawn card somewhere in the hand, at random.
 *
 * NOT on the end. A card that always lands in the same place is a card everybody
 * can see the position of, which would mean every turn ended with a mandatory
 * tidy-up before the arrangement meant anything again. Slotting it in is also
 * what a person does at a table.
 *
 * The randomness comes in as a number between 0 and 1 rather than being taken
 * here, because `lib/` is pure.
 *
 * @param {string[]} hand
 * @param {string} card
 * @param {number} roll 0..1
 */
function insertAt(hand, card, roll) {
  const at = Math.min(hand.length, Math.max(0, Math.floor(roll * (hand.length + 1))));
  const next = hand.slice();
  next.splice(at, 0, card);
  return next;
}

/**
 * A hand in a new random order.
 *
 * The shuffle button. Same reasoning as `insertAt` about where the randomness
 * comes from — this takes a function returning 0..1 and does a Fisher-Yates with
 * it, so the reducer stays pure and the deal stays replayable.
 *
 * @param {string[]} hand
 * @param {() => number} random
 */
function shuffleHand(hand, random) {
  const out = hand.slice();
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    const swap = out[i];
    out[i] = out[j];
    out[j] = swap;
  }
  return out;
}

module.exports = { extractPairs, hasPair, pairIndexes, moveCard, insertAt, shuffleHand };
