'use strict';

/**
 * Master election — the pure tallying rules.
 *
 * When the Master fails to reconnect, the remaining connected players vote for
 * a replacement. Nobody may vote for themselves, and votes stay hidden until
 * the ballot is tallied.
 */

/**
 * Count votes per candidate.
 * @param {Record<string,string>} votes voterId -> candidateId
 * @param {string[]} candidates
 * @returns {Record<string,number>}
 */
function tally(votes, candidates) {
  /** @type {Record<string,number>} */
  const counts = {};
  candidates.forEach((id) => {
    counts[id] = 0;
  });
  Object.values(votes).forEach((candidateId) => {
    if (candidateId in counts) counts[candidateId] += 1;
  });
  return counts;
}

/**
 * Decide what happens to a ballot.
 *
 * A tie normally triggers a runoff between the tied candidates. But a runoff
 * whose candidate set is unchanged can never break the tie — two eligible
 * voters, each barred from voting for themselves, tie 1-1 forever — so that
 * case resolves on a deterministic tiebreak instead of looping.
 *
 * @param {object} args
 * @param {string[]} args.candidates candidates on this ballot
 * @param {Record<string,string>} args.votes voterId -> candidateId
 * @param {string[]} args.eligible voters entitled to vote on this ballot
 * @param {string[]|null} [args.previousCandidates] candidate set of the ballot before
 * @param {string[]} args.tiebreakOrder player ids, most-senior first
 * @param {boolean} [args.force] tally now even if not everyone has voted
 * @returns {{status:'open'}
 *          |{status:'resolved', winnerId:string, counts:Record<string,number>, reason:'majority'|'tiebreak'}
 *          |{status:'runoff', candidates:string[], counts:Record<string,number>}}
 */
function resolveBallot({ candidates, votes, eligible, previousCandidates = null, tiebreakOrder, force = false }) {
  const votesCast = eligible.filter((id) => votes[id]).length;
  if (!force && votesCast < eligible.length) return { status: 'open' };

  const counts = tally(votes, candidates);
  const top = Math.max(...candidates.map((id) => counts[id]));
  const leaders = candidates.filter((id) => counts[id] === top);

  if (leaders.length === 1) {
    return { status: 'resolved', winnerId: leaders[0], counts, reason: 'majority' };
  }

  const sameAsBefore =
    previousCandidates &&
    previousCandidates.length === leaders.length &&
    leaders.every((id) => previousCandidates.includes(id));

  if (sameAsBefore || force) {
    return { status: 'resolved', winnerId: byTiebreak(leaders, tiebreakOrder), counts, reason: 'tiebreak' };
  }

  return { status: 'runoff', candidates: leaders, counts };
}

/**
 * Pick deterministically between tied candidates: the longest-standing player.
 * @param {string[]} tied
 * @param {string[]} tiebreakOrder most-senior first
 * @returns {string}
 */
function byTiebreak(tied, tiebreakOrder) {
  for (const id of tiebreakOrder) if (tied.includes(id)) return id;
  return [...tied].sort()[0];
}

module.exports = { tally, resolveBallot, byTiebreak };
