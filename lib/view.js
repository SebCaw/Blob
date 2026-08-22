'use strict';

const { rankPlayers, madeBid, winners } = require('./scoring');
const { currentRound, findPlayer, gameDeckCheck, MIN_PLAYERS, handSizeCeiling, MAX_ONLINE_PLAYERS } = require('./game');
const { legalPlays, trickWinner } = require('./deck');

/**
 * Turn authoritative state into the view ONE player is allowed to see.
 *
 * This is the privacy boundary. While bidding is open, other players' bid
 * values are not merely hidden in the UI — they never leave the server. Same
 * for election votes, and — online — for the cards in everyone else's hand. If
 * a value is secret, it is absent from this payload.
 *
 * A leaked hand would be worse than a leaked bid: a bid ruins one round and is
 * obvious, a hand quietly ruins the whole game. Hands are read through
 * `handFor` below and nowhere else.
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
  const online = state.mode === 'online';
  // The forehead round: one card each, and the one hand you cannot see is your
  // own. Everyone else's is public, which is the rule the whole table plays by.
  const foreheadRound = Boolean(online && round && round.hands && round.handSize === 1);

  const players = state.players.map((p) => {
    const bidEntry = round ? round.bids[p.id] : null;
    const canSeeValue = Boolean(bidEntry) && (revealed || p.id === viewerId);
    const hand = online && round && round.hands ? round.hands[p.id] || [] : null;
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
      // How many cards someone is holding is public — you can see that across a
      // table. Which cards they are is not, unless it is the forehead round.
      cardsHeld: hand ? hand.length : null,
      card: foreheadRound && p.id !== viewerId ? hand[0] || null : null,
      tricksWon: round && round.tricksWon ? round.tricksWon[p.id] : null,
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
    mode: state.mode || 'table',
    startHandSize: state.startHandSize,
    // What the lobby stepper may go up to. Infinity round a table, where a group
    // can shuffle in a second deck, so it is sent as null rather than a number.
    maxHandSize: online ? handSizeCeiling(state) : null,
    maxPlayers: online ? MAX_ONLINE_PLAYERS : null,
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
          // Online only. The turned card and the trick on the table are things
          // everyone can see, so they are public by the same reasoning that
          // keeps hands private.
          forehead: foreheadRound,
          trumpCard: online ? round.trumpCard || null : null,
          trumpSuit: online ? round.trumpSuit || null : null,
          noTrumps: online && Boolean(round.hands) && !round.trumpSuit,
          trick: online && round.trick ? trickView(state, round) : null,
          lastTrick: online && round.tricksPlayed && round.tricksPlayed.length
            ? round.tricksPlayed[round.tricksPlayed.length - 1]
            : null,
          tricksPlayed: online && round.tricksPlayed ? round.tricksPlayed.length : null,
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
          ...handFor(state, round, viewer, foreheadRound),
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

/**
 * The viewer's own hand, and nothing about anyone else's.
 *
 * The only place `round.hands` is read for the player it belongs to. Keys are
 * left OUT rather than set to null when the viewer may not see them, so a hand
 * that should be secret cannot arrive as an empty-looking field that some later
 * change quietly fills in.
 */
function handFor(state, round, viewer, foreheadRound) {
  if (state.mode !== 'online' || !round || !round.hands) return {};
  const hand = round.hands[viewer.id] || [];
  const trick = round.trick;
  const yourTurn = Boolean(trick && trick.turnId === viewer.id);
  const out = { cardsHeld: hand.length, yourTurn, tricksWon: round.tricksWon ? round.tricksWon[viewer.id] : null };

  // The forehead round inverts everything: your own card is the one card in the
  // game you are not allowed to see, so it does not travel to you at all. There
  // is nothing to choose between either — you hold one card and it gets played.
  if (foreheadRound) return out;

  out.hand = hand.slice();
  out.playable = yourTurn ? legalPlays(hand, trick.ledSuit) : [];
  return out;
}

/** The trick on the table. All of it is public — it is face up in the middle. */
function trickView(state, round) {
  const trick = round.trick;
  const turn = findPlayer(state, trick.turnId);
  return {
    number: trick.number,
    leaderId: trick.leaderId,
    turnId: trick.turnId,
    turnName: turn ? turn.name : null,
    ledSuit: trick.ledSuit,
    plays: trick.plays.map((p) => ({ playerId: p.playerId, cardId: p.cardId })),
    // Who would take it if it stopped here — the gold ring on the playing screen.
    winningPlayerId: trick.plays.length ? trickWinner(trick.plays, trick.ledSuit, round.trumpSuit) : null,
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
    mode: state.mode || 'table',
    startHandSize: state.startHandSize,
    sequence: state.sequence,
    players: state.players.map((p) => ({ id: p.id, name: p.name, isOffline: p.isOffline, total: p.total })),
    rounds: state.rounds
      .filter((r) => r.completedAt)
      .map((r) => ({
        number: r.index + 1,
        handSize: r.handSize,
        // The game is over, so nothing here is secret any more. The seed is what
        // lets a finished deal be dealt again and checked.
        seed: r.seed || null,
        trumpCard: r.trumpCard || null,
        tricksPlayed: r.tricksPlayed || null,
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
