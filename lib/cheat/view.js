'use strict';

const { legalRanks } = require('./rules');
const { MAX_PLAYERS, dealShape, deckOptions } = require('./deck');
const { MIN_PLAYERS, findPlayer, isOut, couldCall, onlyBotsLeft, windowMs } = require('./game');

/**
 * Turn authoritative Cheat state into the view ONE player may see.
 *
 * This is the privacy boundary, and it is the hardest one in the app — not
 * because the rule is subtle but because there is so much to withhold and the
 * game is built out of talking about it.
 *
 * **A claim is public. Its cards are not.** Everybody is told, immediately and
 * exactly, that Dex has put three cards down and called them nines. Nobody is
 * told what they are. Not the table, not a spectator, and not Dex — his own
 * screen is sent the count and the rank like everybody else's, because a claim
 * that is redacted for some viewers and not others is a claim that leaks the
 * moment somebody opens two tabs.
 *
 * **The pile is absent, always.** It is the only object in this repo hidden from
 * every single viewer at once. `pileCount` goes out because you can see the
 * height of a pile across a table; not one card id ever does.
 *
 * **A reveal is retrospective and permanent.** When a claim is called, those
 * cards are turned face up in front of everybody and then go into somebody's
 * hand — where they stay public, as `publicCards`. That is not a leak, it is the
 * same memory Silly Head calls `publicHand`: the room watched them, so the room
 * may remember them. They stop being public the moment they are played again,
 * because nobody can see which cards went face down.
 *
 * @param {object} state
 * @param {string|null} viewerId
 */
function viewFor(state, viewerId) {
  const viewer = findPlayer(state, viewerId);
  const playing = state.phase === 'playing';
  const dealt = Boolean(state.hands);

  // Once it is over, hands stop being secret — the same deliberate widening
  // Sevens and Chase the Ace make, and for the same reason: at a real table you
  // put your cards down at the end. Written as a spread so the key does not
  // exist beforehand and cannot be quietly filled in by a later change.
  const over = state.phase === 'complete';
  const callers = playing ? couldCall(state).map((p) => p.id) : [];

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
      // table, and here it is most of what tells you who is winning.
      cardsHeld: hand.length,
      isTurn: playing && state.turnId === p.id,
      out: isOut(state, p.id),
      place: isOut(state, p.id) ? state.finished.indexOf(p.id) + 1 : null,
      skipped: Boolean(state.autoPlay && state.autoPlay[p.id]),
      isLoser: state.loserId === p.id,
      tied: Boolean(state.tiedIds && state.tiedIds.includes(p.id)),
      /**
       * The cards everybody watched them pick up.
       *
       * Public knowledge, sent to every viewer including a spectator, and the
       * one part of anybody's hand that is not a secret. See the note above.
       */
      publicCards: ((state.seen || {})[p.id] || []).slice(),
      ...(over && dealt ? { cardsLeft: hand.slice() } : {}),
    };
  });

  const you = viewer
    ? {
        id: viewer.id,
        name: viewer.name,
        isMaster: state.masterId === viewer.id,
        /** Your hand. Nobody else's appears anywhere in this payload. */
        hand: dealt ? (state.hands[viewer.id] || []).slice() : [],
        isTurn: playing && state.turnId === viewer.id,
        out: isOut(state, viewer.id),
        /**
         * Whether the claim on the table is yours to call.
         *
         * Worked out here rather than on the phone because who may call is a
         * rule, and rules live on the server.
         */
        canCall: playing && callers.includes(viewer.id) && Boolean(state.claim),
        /** What you may say next, if it is your turn. */
        canClaim: playing && state.turnId === viewer.id && !state.claim,
      }
    : null;

  return {
    game: 'cheat',
    id: state.id,
    code: state.code,
    phase: state.phase,
    decks: state.decks,
    deckOptions: deckOptions(state.players.filter((p) => !p.left).length),
    /** What the deal will look like, so the lobby can say so before anybody commits. */
    dealShape: dealShape(state.players.filter((p) => !p.left).length, state.decks),
    speed: state.speed || 1,
    /** Whether the speed control is worth offering at all. */
    canSpeedUp: playing && onlyBotsLeft(state),
    version: state.version,
    updatedAt: state.updatedAt,
    masterId: state.masterId,
    minPlayers: MIN_PLAYERS,
    maxPlayers: MAX_PLAYERS[state.decks],
    players,
    you,
    turnId: state.turnId,
    lastRank: state.lastRank,
    /** The three ranks that may be claimed next. Public: it is the rule, not a secret. */
    legalRanks: legalRanks(state.lastRank),
    /**
     * The claim on the table.
     *
     * Who, what rank, how many, and when the window shuts. The CARDS are not
     * here and there is no viewer for whom they are — this is the object the
     * whole boundary exists to keep thin.
     */
    claim: state.claim
      ? {
          playerId: state.claim.playerId,
          name: (findPlayer(state, state.claim.playerId) || {}).name || 'Someone',
          rank: state.claim.rank,
          count: state.claim.count,
          /**
           * When it was made.
           *
           * Public — everybody watched it happen — and the screen needs it as an
           * IDENTITY rather than as a time: it is how a phone tells this claim
           * from the next one, and therefore when to start its countdown again.
           * Leaving it out was a real bug: the first window animated and every
           * one after it drew as already finished, because the key the client
           * compares never changed.
           */
          openedAt: state.claim.openedAt,
          /**
           * The window has shut, and it is still callable.
           *
           * The clock paces the game; the next claim is what makes this one
           * safe. So a closed claim has stood, the rank has moved on and the
           * turn has passed, and the Cheat button beside it is still live. See
           * the note at the top of `lib/cheat/game.js`.
           */
          closed: Boolean(state.claim.closed),
          /**
           * How LONG the window is, and when the server will shut it.
           *
           * The screen draws its countdown from `windowMs` and its own clock,
           * started when it first saw this `openedAt` — never from `closesAt`.
           * That is deliberate: a phone four minutes out of step would otherwise
           * show a window already over, or one that never ends. `closesAt` is
           * here for anything that wants to reason about the server's timing,
           * and nothing on the glass does.
           */
          windowMs: windowMs(state),
          closesAt: state.claim.closesAt,
          declined: Object.keys(state.claim.declined || {}),
          /** Their last cards are on the table. Everybody can see the hand is empty. */
          wentOut: (state.hands[state.claim.playerId] || []).length === 0,
        }
      : null,
    /**
     * How high the pile is, and not one card of what is in it.
     *
     * The height is public — it is sitting in the middle of the table.
     */
    // A claim that has stood is face down in the middle as far as anybody
    // looking at the table is concerned, even though the server is still
    // holding it apart so it can be turned over. The height has to say so.
    pileCount: (state.pile || []).length + (state.claim && state.claim.closed ? state.claim.count : 0),
    // What the room has watched: claims, calls and outcomes, never a card id.
    log: (state.log || []).slice(),
    /**
     * What just happened.
     *
     * The one place card faces legitimately appear beyond a hand: a call turns
     * cards over in front of everybody, and this is how the screen knows which
     * to draw. Those same cards are in the loser's `publicCards` by the time
     * this is sent, so nothing here is a secret anybody still holds.
     */
    lastEvent: state.lastEvent || null,
    finished: (state.finished || []).map((id) => ({
      id,
      name: (findPlayer(state, id) || {}).name || 'Someone',
    })),
    loserId: state.loserId,
    loserName: state.loserId ? (findPlayer(state, state.loserId) || {}).name || null : null,
    tied: state.tiedIds
      ? state.tiedIds.map((id) => ({ id, name: (findPlayer(state, id) || {}).name || 'Someone' }))
      : null,
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
    game: 'cheat',
    playedAt: state.createdAt,
    completedAt: state.completedAt,
    seed: state.seed,
    decks: state.decks,
    players: state.players.map((p) => ({
      id: p.id,
      name: p.name,
      place: state.finished.indexOf(p.id) === -1 ? null : state.finished.indexOf(p.id) + 1,
      isLoser: state.loserId === p.id,
      // How many they were still sat on when it stopped. The whole reason the
      // last two are ranked at all, so it belongs in the record.
      cardsLeft: state.hands ? (state.hands[p.id] || []).length : null,
    })),
    order: state.finished.map((id) => (findPlayer(state, id) || {}).name || 'Someone'),
    loser: state.loserId ? (findPlayer(state, state.loserId) || {}).name || null : null,
    tied: state.tiedIds ? state.tiedIds.map((id) => (findPlayer(state, id) || {}).name || 'Someone') : null,
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
    game: 'cheat',
    players,
    winners: winner ? [winner.name] : [],
    detail: record.order && record.order.length ? record.order.join(', ') : null,
    loser: record.loser || (record.tied ? record.tied.join(' and ') : null),
  };
}

module.exports = { viewFor, electionView, historyRecord, historySummary };
