'use strict';

const { pairIndexes } = require('./rules');
const {
  MIN_PLAYERS,
  MAX_PLAYERS,
  findPlayer,
  isOut,
  sourceFor,
  lockedHandId,
  holdsTheAce,
} = require('./game');

/**
 * Turn authoritative Chase the Ace state into the view ONE player may see.
 *
 * This is the privacy boundary, and it is the strictest in the app.
 *
 * **Positions are public. Faces are not.** Everybody can see how many cards you
 * hold, and therefore how many slots there are to choose between. Nobody but you
 * learns what is in any of them, and the person about to draw from you learns it
 * least of all — they get a NUMBER, not a hand.
 *
 * That is the whole game. In Sevens a leak would spoil a turn; here it ends the
 * game outright, because an opponent whose payload names the ace simply never
 * picks it. There is no screen-side care that makes that safe, which is why the
 * source's cards are absent from every payload rather than merely undrawn.
 *
 * What IS public, because the room watched it happen: how many cards everybody
 * holds, that a card was taken and from which slot, both cards of any pair that
 * went in the middle, that somebody rearranged and which slot moved where, and
 * that somebody shuffled. Never: a card in anybody else's hand, or which
 * permutation a shuffle produced.
 *
 * @param {object} state
 * @param {string|null} viewerId
 */
function viewFor(state, viewerId) {
  const viewer = findPlayer(state, viewerId);
  const playing = state.phase === 'playing';
  const dealt = Boolean(state.hands);

  // Once it is over, hands stop being secret — the same deliberate widening
  // Sevens makes, and for the same reason: at a real table you put your cards
  // down at the end, and seeing what the loser was sat on is the end screen's
  // whole job. Phase-gated, and written as a spread so the key does not exist
  // beforehand and cannot be quietly filled in by a later change.
  const over = state.phase === 'complete';

  const locked = playing ? lockedHandId(state) : null;
  const drawFromId = playing && state.turnId ? sourceFor(state, state.turnId) : null;

  const players = state.players.map((p) => {
    const hand = dealt ? state.hands[p.id] || [] : [];
    return {
      id: p.id,
      name: p.name,
      connected: p.connected,
      awaitingTakeover: p.awaitingTakeover,
      isMaster: state.masterId === p.id,
      isBot: Boolean(p.isBot),
      botLevel: p.isBot ? p.botLevel || 'medium' : null,
      left: Boolean(p.left),
      // How many cards somebody holds is public — you can count them across a
      // table, and here you have to, because it is how many slots you may pick
      // from. WHICH cards is not, and never appears here.
      cardsHeld: hand.length,
      isTurn: playing && state.turnId === p.id,
      // Somebody is choosing from their hand right now, so it is frozen.
      locked: locked === p.id,
      out: isOut(state, p.id),
      place: isOut(state, p.id) ? state.finished.indexOf(p.id) + 1 : null,
      skipped: Boolean(state.autoPlay && state.autoPlay[p.id]),
      isLoser: state.loserId === p.id,
      ...(over && dealt ? { cardsLeft: hand.slice() } : {}),
    };
  });

  const you = viewer
    ? {
        id: viewer.id,
        name: viewer.name,
        isMaster: state.masterId === viewer.id,
        // Your hand, in the order YOU have it in. Nobody else's appears
        // anywhere in this payload.
        hand: dealt ? (state.hands[viewer.id] || []).slice() : [],
        isTurn: playing && state.turnId === viewer.id,
        out: isOut(state, viewer.id),
        // You can see this by looking at your own cards, so saying it plainly
        // costs nothing and saves every screen working it out again.
        hasTheAce: dealt ? holdsTheAce(state, viewer.id) : false,
        /**
         * The pairs you are sitting on, as the positions holding them.
         *
         * Worked out here rather than on the phone because deciding what counts
         * as a pair is a rule, and rules live on the server. The screen only
         * draws what this says — including the nudge, when somebody has not
         * spotted one.
         */
        pairs: dealt ? pairIndexes(state.hands[viewer.id] || []) : [],
        locked: locked === viewer.id,
        canArrange:
          playing &&
          !isOut(state, viewer.id) &&
          locked !== viewer.id &&
          (dealt ? (state.hands[viewer.id] || []).length : 0) >= 2,
      }
    : null;

  return {
    game: 'chase',
    id: state.id,
    code: state.code,
    phase: state.phase,
    decks: state.decks,
    version: state.version,
    updatedAt: state.updatedAt,
    masterId: state.masterId,
    minPlayers: MIN_PLAYERS,
    maxPlayers: MAX_PLAYERS[state.decks],
    players,
    you,
    turnId: state.turnId,
    /**
     * The hand the current turn-holder is drawing from.
     *
     * A COUNT and a name. This is the object the whole privacy boundary exists
     * to keep thin — if a card id ever appears in here, the game is over.
     */
    source: drawFromId
      ? {
          id: drawFromId,
          name: (findPlayer(state, drawFromId) || {}).name || 'Someone',
          cardsHeld: (state.hands[drawFromId] || []).length,
        }
      : null,
    lockedId: locked,
    // Every pair that went in the middle, both cards. Public: the room watched
    // each of them go down.
    discarded: (state.discarded || []).slice(),
    // What the room has watched. Positions and who, never a card that is still
    // in somebody's hand. This is what makes paying attention worth something,
    // for a person and for a bot alike.
    log: (state.log || []).slice(),
    lastEvent: state.lastEvent || null,
    finished: (state.finished || []).map((id) => ({
      id,
      name: (findPlayer(state, id) || {}).name || 'Someone',
    })),
    loserId: state.loserId,
    loserName: state.loserId ? (findPlayer(state, state.loserId) || {}).name || null : null,
    endedEarly: Boolean(state.endedEarly),
    completedAt: state.completedAt,
    rematchGameId: state.rematchGameId,
    rematchCode: state.rematchCode,
    election: electionView(state, viewerId),
  };
}

/** A vote in progress. Who voted is public; what they voted is not, until the tally. */
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
  };
}

/** What gets written down once a game is over. */
function historyRecord(state) {
  return {
    id: state.id,
    code: state.code,
    game: 'chase',
    playedAt: state.createdAt,
    completedAt: state.completedAt,
    seed: state.seed,
    decks: state.decks,
    players: state.players.map((p) => ({
      id: p.id,
      name: p.name,
      place: state.finished.indexOf(p.id) === -1 ? null : state.finished.indexOf(p.id) + 1,
      isLoser: state.loserId === p.id,
    })),
    order: state.finished.map((id) => (findPlayer(state, id) || {}).name || 'Someone'),
    loser: state.loserId ? (findPlayer(state, state.loserId) || {}).name || null : null,
    endedEarly: Boolean(state.endedEarly),
  };
}

/**
 * The one line the history list shows.
 *
 * Here rather than in `server/store.js` because only this game knows what its
 * own record holds — the lesson from Silly Head's games silently vanishing off
 * that list for want of a `rounds` field they never had.
 */
function historySummary(record) {
  const players = (record.players || []).map((p) => ({ id: p.id, name: p.name, place: p.place }));
  const winner = players.find((p) => p.place === 1);
  return {
    game: 'chase',
    players,
    winners: winner ? [winner.name] : [],
    detail: record.order && record.order.length ? record.order.join(', ') : null,
    loser: record.loser || null,
  };
}

module.exports = { viewFor, electionView, historyRecord, historySummary };
