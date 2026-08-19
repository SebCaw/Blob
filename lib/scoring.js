'use strict';

/**
 * Blob scoring — the whole rule, in one place.
 *
 * A player scores ONLY when the tricks they won exactly equal their bid.
 * There is no partial credit and no penalty for how far off they were.
 */

/** Points awarded for hitting your bid, before adding the tricks won. */
const MADE_BID_BASE = 10;

/**
 * Score a single round for a single player.
 *
 *   bid 0, won 0 -> 10      bid 1, won 1 -> 11
 *   bid 0, won 1 ->  0      bid 3, won 4 ->  0
 *
 * @param {number} bid tricks the player said they would win
 * @param {number} tricksWon tricks the player actually won
 * @returns {number} points for the round
 */
function scoreRound(bid, tricksWon) {
  if (!Number.isInteger(bid) || bid < 0) throw new Error('Bid must be a whole number of 0 or more');
  if (!Number.isInteger(tricksWon) || tricksWon < 0) {
    throw new Error('Tricks won must be a whole number of 0 or more');
  }
  return bid === tricksWon ? MADE_BID_BASE + tricksWon : 0;
}

/**
 * Did the player hit their bid exactly?
 * @param {number} bid
 * @param {number} tricksWon
 * @returns {boolean}
 */
function madeBid(bid, tricksWon) {
  return bid === tricksWon;
}

/**
 * Rank players by total score, highest first. Equal totals share a rank, and
 * the next rank skips accordingly (1, 2, 2, 4) — the way a real scoreboard reads.
 *
 * Ordering within a tie is by the supplied player order, which the caller keeps
 * stable (join order), so the leaderboard never jitters between renders.
 *
 * @param {Array<{id:string, total:number}>} players
 * @returns {Array<{id:string, total:number, rank:number, tied:boolean}>}
 */
function rankPlayers(players) {
  const sorted = players
    .map((p, index) => ({ ...p, _index: index }))
    .sort((a, b) => b.total - a.total || a._index - b._index);

  const ranked = [];
  let rank = 0;
  let previousTotal = null;
  sorted.forEach((p, i) => {
    if (previousTotal === null || p.total !== previousTotal) rank = i + 1;
    previousTotal = p.total;
    ranked.push({ id: p.id, name: p.name, total: p.total, isOffline: p.isOffline, rank });
  });

  const counts = new Map();
  ranked.forEach((p) => counts.set(p.rank, (counts.get(p.rank) || 0) + 1));
  return ranked.map((p) => ({ ...p, tied: counts.get(p.rank) > 1 }));
}

/**
 * The winner(s) of a finished game — everyone sharing the top total.
 * @param {Array<{id:string, total:number}>} players
 * @returns {string[]} winning player ids
 */
function winners(players) {
  if (!players.length) return [];
  const top = Math.max(...players.map((p) => p.total));
  return players.filter((p) => p.total === top).map((p) => p.id);
}

module.exports = { MADE_BID_BASE, scoreRound, madeBid, rankPlayers, winners };
