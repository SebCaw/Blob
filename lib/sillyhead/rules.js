'use strict';

const { RANKS } = require('../deck');
const { rankOf } = require('./deck');

/**
 * What may be played on what, and what happens when it lands.
 *
 * Everything in here is about the pile in the middle and nothing else — it does
 * not know who is playing, whose turn it is, or where the cards came from. That
 * belongs to the reducer. Keeping the two apart is what makes the specials
 * testable one at a time, and the specials are where this game lives.
 *
 * Pure, like the rest of `lib/`.
 */

/** Plays on anything and resets the pile. The pile stays underneath. */
const RESET_RANK = '2';

/** Plays on anything and sacks the pile: out of the game for good. */
const SACK_RANK = '10';

/** Plays in order, but the card after it must be this or lower. */
const LOW_RANK = '9';

/** Four of one number in a row sacks the pile, however they got there. */
const RUN_TO_SACK = 4;

/** Rank -> its value, 2 low and 14 for an ace. Built once from Blob's rank order. */
const VALUE = Object.fromEntries(RANKS.map((rank, i) => [rank, i + 2]));

/** The value that must be matched or beaten after a 9. */
const LOW_VALUE = VALUE[LOW_RANK];

/**
 * The card on top of the pile, or null if the pile is empty.
 * @param {string[]} pile oldest first
 * @returns {string|null}
 */
function topCard(pile) {
  return pile.length ? pile[pile.length - 1] : null;
}

/**
 * The rank on top of the pile, or null.
 * @param {string[]} pile
 * @returns {string|null}
 */
function topRank(pile) {
  const card = topCard(pile);
  return card ? rankOf(card) : null;
}

/**
 * How many cards of the same rank are sitting on top of each other.
 *
 * This is the whole of the four-in-a-row rule: it does not matter whether one
 * person laid all four or four people laid one each, only that four of the same
 * number are on top when the fourth lands.
 *
 * @param {string[]} pile
 * @returns {number} 0 for an empty pile
 */
function runLength(pile) {
  const rank = topRank(pile);
  if (!rank) return 0;
  let n = 0;
  for (let i = pile.length - 1; i >= 0 && rankOf(pile[i]) === rank; i--) n++;
  return n;
}

/**
 * Does the pile currently demand a low card? True while a 9 is on top.
 * @param {string[]} pile
 * @returns {boolean}
 */
function forcesLow(pile) {
  return topRank(pile) === LOW_RANK;
}

/**
 * May a card of this rank be played on this pile?
 *
 * Note what is NOT special-cased: the 2's reset. A 2 is the lowest card in the
 * deck, so "equal or higher than a 2" already means "anything", and the reset
 * falls out of the ordering rather than being a rule of its own.
 *
 * @param {string} rank
 * @param {string[]} pile
 * @returns {boolean}
 */
function isPlayableRank(rank, pile) {
  if (!(rank in VALUE)) return false;
  if (!pile.length) return true;
  if (rank === RESET_RANK || rank === SACK_RANK) return true;
  if (forcesLow(pile)) return VALUE[rank] <= LOW_VALUE;
  return VALUE[rank] >= VALUE[topRank(pile)];
}

/**
 * How many cards of one rank may go down at once.
 *
 * A run never goes past four: holding three 4s with two 4s already on top, you
 * may play exactly one — which is the fourth, which sacks the pile. Five of a
 * number is never a legal play, which is also the house rule.
 *
 * @param {string} rank
 * @param {string[]} pile
 * @returns {number} 0 if that rank cannot be played at all
 */
function maxPlayable(rank, pile) {
  if (!isPlayableRank(rank, pile)) return 0;
  const already = topRank(pile) === rank ? runLength(pile) : 0;
  return Math.max(0, RUN_TO_SACK - already);
}

/**
 * Can this exact set of cards be played on this pile?
 *
 * @param {string[]} cardIds one or more cards, all of the same rank
 * @param {string[]} pile
 * @returns {{ok:true}|{ok:false, reason:string}}
 */
function checkPlay(cardIds, pile) {
  if (!Array.isArray(cardIds) || cardIds.length === 0) return { ok: false, reason: 'Pick a card first.' };
  const rank = rankOf(cardIds[0]);
  if (cardIds.some((id) => rankOf(id) !== rank)) {
    return { ok: false, reason: 'Cards played together have to be the same number.' };
  }
  if (!isPlayableRank(rank, pile)) {
    const top = topRank(pile);
    return {
      ok: false,
      reason: forcesLow(pile)
        ? 'A 9 is showing, so the next card has to be a 9 or lower.'
        : `That has to beat the ${top} on the pile.`,
    };
  }
  const most = maxPlayable(rank, pile);
  if (cardIds.length > most) {
    return {
      ok: false,
      reason:
        most === RUN_TO_SACK
          ? `You can play at most ${RUN_TO_SACK} of a number at once.`
          : `Only ${most} more ${rank}${most === 1 ? '' : 's'} will fit — four in a row sacks the pile.`,
    };
  }
  return { ok: true };
}

/**
 * Put cards on the pile and say what became of it.
 *
 * The sacked cards come back by name as well as by number, because they are
 * gone from the game for good and anybody keeping track of what is left needs
 * to know WHICH ones went.
 *
 * @param {string[]} pile oldest first
 * @param {string[]} cardIds all of one rank, already checked
 * @returns {{pile:string[], sacked:number, sackedCards:string[], playAgain:boolean}}
 */
function resolvePlay(pile, cardIds) {
  const next = pile.concat(cardIds);
  const sacks = rankOf(cardIds[0]) === SACK_RANK || runLength(next) >= RUN_TO_SACK;
  if (!sacks) return { pile: next, sacked: 0, sackedCards: [], playAgain: false };
  return { pile: [], sacked: next.length, sackedCards: next, playAgain: true };
}

module.exports = {
  RESET_RANK,
  SACK_RANK,
  LOW_RANK,
  RUN_TO_SACK,
  VALUE,
  topCard,
  topRank,
  runLength,
  forcesLow,
  isPlayableRank,
  maxPlayable,
  checkPlay,
  resolvePlay,
};
