'use strict';

const { rankPlayers, madeBid, winners } = require('./scoring');
const { currentRound, findPlayer, gameDeckCheck, MIN_PLAYERS } = require('./game');

/**
 * Turn authoritative state into the view ONE player is allowed to see.
 *
 * This is the privacy boundary. While bidding is open, other players' bid
 * values are not merely hidden in the UI — they never leave the server. Same
 * for election votes. If a value is secret, it is absent from this payload.
 *
 * @param {object} state
 * @param {string|null} viewerId
 * @returns {object}
 */
function viewFor(state, viewerId) {
  const round = currentRound(state);
  const revealed = Boolean(round && round.locked);
  const viewer = findPlayer(state, viewerId);
  const viewerIsMaster = Boolean(viewer) && state.masterId === viewer.id;
  const deck = gameDeckCheck(state);

  const players = state.players.map((p) => {
    const bidEntry = round ? round.bids[p.id] : null;
    const canSeeValue = Boolean(bidEntry) && (revealed || p.id === viewerId);
    return {
      id: p.id,
      name: p.name,
      isOffline: p.isOffline,
      connected: p.connected,
      awaitingTakeover: p.awaitingTakeover,
      isMaster: state.masterId === p.id,
      total: p.total,
      hasBid: Boolean(bidEntry),
      bid: canSeeValue ? bidEntry.value : null,
      bidEnteredBy: bidEntry ? bidEntry.enteredBy : null,
      tricks: round && round.tricks ? round.tricks[p.id] : null,
      roundScore: round && round.scores ? round.scores[p.id] : null,
      madeBid: round && round.tricks && bidEntry ? madeBid(bidEntry.value, round.tricks[p.id]) : null,
    };
  });

  const leaderboard = rankPlayers(
    state.players.map((p) => ({ id: p.id, name: p.name, total: p.total, isOffline: p.isOffline }))
  ).map((p) => ({
    ...p,
    roundScore: round && round.scores ? round.scores[p.id] : null,
    previousTotal: round && round.scores ? p.total - (round.scores[p.id] || 0) : p.total,
  }));

  return {
    id: state.id,
    code: state.code,
    version: state.version,
    phase: state.phase,
    startHandSize: state.startHandSize,
    sequence: state.sequence,
    roundIndex: state.roundIndex,
    masterId: state.masterId,
    masterName: (findPlayer(state, state.masterId) || {}).name || null,
    minPlayers: MIN_PLAYERS,
    canStart: state.players.length >= MIN_PLAYERS,
    completedAt: state.completedAt,
    endedEarly: Boolean(state.endedEarly),
    amendedAt: state.amendedAt || null,
    // Non-sensitive — a game id and a join code, never a session token — so
    // everyone still on this finished game's screen can see a rematch has
    // started, whether or not they were carried into it automatically.
    rematchGameId: state.rematchGameId,
    rematchCode: state.rematchCode,
    deck: { ...deck, acknowledged: state.deckWarningAcknowledged },
    players,
    round: round
      ? {
          index: round.index,
          number: round.index + 1,
          totalRounds: state.sequence.length,
          handSize: round.handSize,
          locked: round.locked,
          revealed,
          bidsIn: state.players.filter((p) => round.bids[p.id]).length,
          bidsNeeded: state.players.length,
          scored: Boolean(round.completedAt),
          trickTotalOverridden: round.trickTotalOverridden,
        }
      : null,
    you: viewer
      ? {
          id: viewer.id,
          name: viewer.name,
          isMaster: viewerIsMaster,
          connected: viewer.connected,
          total: viewer.total,
          bid: round && round.bids[viewer.id] ? round.bids[viewer.id].value : null,
          hasSubmitted: Boolean(round && round.bids[viewer.id]),
          tricks: round && round.tricks ? round.tricks[viewer.id] : null,
          roundScore: round && round.scores ? round.scores[viewer.id] : null,
          madeBid:
            round && round.tricks && round.bids[viewer.id]
              ? madeBid(round.bids[viewer.id].value, round.tricks[viewer.id])
              : null,
          canBidFor: viewerIsMaster && round && !round.locked ? bidTargetsFor(state, round) : [],
        }
      : null,
    leaderboard,
    winners: state.phase === 'complete' ? winners(state.players) : [],
    election: electionView(state, viewerId),
    history: state.rounds
      .filter((r) => r.completedAt)
      .map((r) => ({
        index: r.index,
        handSize: r.handSize,
        bids: mapValues(r.bids, (b) => b.value),
        enteredBy: mapValues(r.bids, (b) => b.enteredBy),
        tricks: r.tricks,
        scores: r.scores,
        totalsAfter: r.totalsAfter,
        amended: Boolean(r.amendedAt),
      })),
  };
}

/** Who still needs a bid putting in on the Master's phone. */
function bidTargetsFor(state, round) {
  return state.players
    .filter((p) => !round.bids[p.id] && (p.isOffline || (!p.connected && p.awaitingTakeover)))
    .map((p) => ({ id: p.id, name: p.name, reason: p.isOffline ? 'offline' : 'disconnected' }));
}

/**
 * The election, with votes redacted. A voter sees only their own choice; the
 * counts appear once the ballot is settled.
 */
function electionView(state, viewerId) {
  const e = state.election;
  if (!e) return null;
  const name = (id) => (findPlayer(state, id) || {}).name || 'Someone';
  return {
    id: e.id,
    ballot: e.ballot,
    forPlayerName: e.forPlayerId ? name(e.forPlayerId) : null,
    candidates: e.candidates.map((id) => ({ id, name: name(id) })),
    eligible: e.eligible,
    votesIn: Object.keys(e.votes).length,
    votesNeeded: e.eligible.length,
    voted: e.eligible.filter((id) => e.votes[id]),
    youCanVote: e.eligible.includes(viewerId) && !e.resolvedAt,
    yourVote: e.votes[viewerId] || null,
    resolved: Boolean(e.resolvedAt),
    winnerId: e.winnerId,
    winnerName: e.winnerId ? name(e.winnerId) : null,
    reason: e.reason,
    counts: e.resolvedAt
      ? Object.entries(e.counts || {}).map(([id, votes]) => ({ id, name: name(id), votes }))
      : null,
    lastBallot: e.lastBallot
      ? {
          ballot: e.lastBallot.ballot,
          counts: Object.entries(e.lastBallot.counts).map(([id, votes]) => ({ id, name: name(id), votes })),
        }
      : null,
  };
}

function mapValues(obj, fn) {
  const out = {};
  Object.entries(obj || {}).forEach(([k, v]) => {
    out[k] = fn(v);
  });
  return out;
}

/**
 * The permanent record of a finished game (spec section 24). Bids are all
 * revealed by this point, so nothing is redacted.
 */
function historyRecord(state) {
  const ranked = rankPlayers(state.players.map((p) => ({ id: p.id, name: p.name, total: p.total })));
  return {
    id: state.id,
    code: state.code,
    playedAt: state.createdAt,
    completedAt: state.completedAt,
    startHandSize: state.startHandSize,
    sequence: state.sequence,
    players: state.players.map((p) => ({ id: p.id, name: p.name, isOffline: p.isOffline, total: p.total })),
    rounds: state.rounds
      .filter((r) => r.completedAt)
      .map((r) => ({
        number: r.index + 1,
        handSize: r.handSize,
        players: state.players.map((p) => ({
          id: p.id,
          name: p.name,
          bid: r.bids[p.id] ? r.bids[p.id].value : null,
          enteredBy: r.bids[p.id] ? r.bids[p.id].enteredBy : null,
          tricks: r.tricks ? r.tricks[p.id] : null,
          score: r.scores ? r.scores[p.id] : null,
          runningTotal: r.totalsAfter ? r.totalsAfter[p.id] : null,
        })),
      })),
    finalRanking: ranked,
    winners: winners(state.players).map((id) => (findPlayer(state, id) || {}).name),
  };
}

module.exports = { viewFor, historyRecord, electionView };
