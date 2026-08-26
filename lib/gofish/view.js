'use strict';

const { BOOKS_IN_DECK, MAX_PLAYERS, dealShape } = require('./deck');
const { askableRanks, completeBooks } = require('./rules');
const { MIN_PLAYERS, findPlayer, isOut, askable, booksMade, onlyBotsLeft } = require('./game');

/**
 * Turn authoritative Go Fish state into the view ONE player may see.
 *
 * This is the privacy boundary, and it is the SHORTEST one in the app. That is
 * worth stating plainly rather than treating as an oversight:
 *
 *   **Secret:** the cards in each hand, and the pool. That is the whole list.
 *
 *   **Public:** how many cards everybody holds, every book and whose it is, how
 *   deep the pool is, and every question and answer since the deal.
 *
 * Cheat is the opposite game and makes the contrast useful. There a claim is
 * public and its cards are secret from everybody including their owner. Here
 * nothing is claimed and nothing is hidden except what is physically face down,
 * and the difficulty is entirely in remembering what was said.
 *
 * **No card id ever leaves its owner's hand**, with exactly one exception, and
 * it is not really one. When cards cross the table on a handover they are turned
 * over in front of everybody — you watch two sevens change hands — so those ids
 * ride along in `lastEvent` for a single beat, which is what lets the screen
 * animate them honestly. They do not persist anywhere. Nothing is given away
 * that the rank and the count had not already given away, because suits are
 * irrelevant to this game: you ask by rank and you book by rank.
 *
 * **A book is a rank, not four cards.** All four cards of a book are determined
 * by the rank, so sending them would be four card ids doing the work of one
 * letter. The client draws them from the rank.
 *
 * @param {object} state
 * @param {string|null} viewerId
 */
function viewFor(state, viewerId) {
  const viewer = findPlayer(state, viewerId);
  const playing = state.phase === 'playing';
  const dealt = Boolean(state.hands);
  const here = state.players.filter((p) => !p.left).length;

  // Once it is over, hands stop being secret — the same deliberate widening
  // Sevens, Chase the Ace and Cheat all make, and for the same reason: at a real
  // table you put your cards down at the end. Written as a spread so the key
  // does not exist beforehand and cannot be quietly filled in by a later change.
  const over = state.phase === 'complete';

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
      // table, and here it is half of deciding who to ask.
      cardsHeld: hand.length,
      /** The ranks they have laid down, face up in front of them. */
      books: ((state.books || {})[p.id] || []).slice(),
      isTurn: playing && state.turnId === p.id,
      /** Being asked right now, and therefore the person everybody is watching. */
      isAsked: Boolean(playing && state.ask && state.ask.targetId === p.id),
      out: isOut(state, p.id),
      place: isOut(state, p.id) ? state.finished.indexOf(p.id) + 1 : null,
      skipped: Boolean(state.autoPlay && state.autoPlay[p.id]),
      isWinner: Boolean(state.winnerIds && state.winnerIds.includes(p.id)),
      ...(over && dealt ? { cardsLeft: hand.slice() } : {}),
    };
  });

  const yourHand = viewer && dealt ? (state.hands[viewer.id] || []).slice() : [];
  const asked = Boolean(playing && state.ask && viewer && state.ask.targetId === viewer.id);

  const you = viewer
    ? {
        id: viewer.id,
        name: viewer.name,
        isMaster: state.masterId === viewer.id,
        /** Your hand. Nobody else's appears anywhere in this payload. */
        hand: yourHand,
        isTurn: playing && state.turnId === viewer.id,
        out: isOut(state, viewer.id),
        books: ((state.books || {})[viewer.id] || []).slice(),
        /**
         * The ranks you may ask for, and the rule behind them.
         *
         * Worked out here rather than on the phone because "you must hold it" is
         * a rule, and rules live on the server. The client draws buttons from
         * this and never decides for itself what is legal.
         */
        askable: playing && !state.ask && state.turnId === viewer.id ? askableRanks(yourHand) : [],
        /** Who you may ask. Everybody still holding cards but you. */
        canAsk: playing && !state.ask && state.turnId === viewer.id ? askable(state, viewer.id).map((p) => p.id) : [],
        /**
         * The question is yours to answer, and WHAT the answer is.
         *
         * The one field in this app that tells exactly one viewer something
         * nobody else may know — and it is only ever sent to the person who is
         * looking at the cards anyway. It is here so the button can read HAND
         * THEM OVER or GO FISH before it is pressed, which is the difference
         * between answering a question and being told what you said.
         */
        answering: asked
          ? {
              askerId: state.ask.askerId,
              rank: state.ask.rank,
              /** How many you are about to hand over. Zero means go fish. */
              handing: yourHand.filter((card) => card.slice(0, -1) === state.ask.rank).length,
            }
          : null,
        /** Books sitting in your hand, waiting for you to put them down. */
        ready: playing ? completeBooks(yourHand) : [],
      }
    : null;

  return {
    game: 'gofish',
    id: state.id,
    code: state.code,
    phase: state.phase,
    version: state.version,
    updatedAt: state.updatedAt,
    masterId: state.masterId,
    minPlayers: MIN_PLAYERS,
    maxPlayers: MAX_PLAYERS,
    /** What the deal will look like, so the lobby can say so before anybody commits. */
    dealShape: dealShape(here),
    speed: state.speed || 1,
    /** Whether the speed control is worth offering at all. */
    canSpeedUp: playing && onlyBotsLeft(state),
    players,
    you,
    turnId: state.turnId,
    /**
     * The question on the table.
     *
     * Who asked whom for what, and not a word about the answer. Everybody gets
     * exactly this — the target's own view adds `you.answering`, and that is the
     * only asymmetry in the whole payload.
     */
    ask: state.ask
      ? {
          askerId: state.ask.askerId,
          askerName: (findPlayer(state, state.ask.askerId) || {}).name || 'Someone',
          targetId: state.ask.targetId,
          targetName: (findPlayer(state, state.ask.targetId) || {}).name || 'Someone',
          rank: state.ask.rank,
          /**
           * When it was asked.
           *
           * Public, and the screen needs it as an IDENTITY rather than as a
           * time: it is how a phone tells this question from the next one, and
           * therefore when to play its animation again. Cheat shipped without
           * the equivalent and every countdown after the first drew as already
           * spent.
           */
          askedAt: state.ask.askedAt,
        }
      : null,
    /** How deep the pool is, and not one card of what is in it. */
    poolCount: (state.pool || []).length,
    /** How many books are down all told, out of thirteen. The progress bar. */
    booksMade: booksMade(state),
    booksInDeck: BOOKS_IN_DECK,
    /**
     * Every question and answer since the deal.
     *
     * The memory the whole game is played out of, and the same for everybody.
     * Ranks and counts only — there is never a card id in here.
     */
    log: (state.log || []).slice(),
    /**
     * What just happened.
     *
     * The one place a card id legitimately appears outside its owner's hand: a
     * handover is watched by the room, and this is how the screen knows what to
     * fly across. One beat, and gone.
     */
    lastEvent: state.lastEvent || null,
    finished: (state.finished || []).map((id) => ({
      id,
      name: (findPlayer(state, id) || {}).name || 'Someone',
    })),
    winners: state.winnerIds
      ? state.winnerIds.map((id) => ({
          id,
          name: (findPlayer(state, id) || {}).name || 'Someone',
          books: ((state.books || {})[id] || []).length,
        }))
      : null,
    /** The game stopped because nothing was happening. See BARREN_TURNS. */
    stoppedBarren: Boolean(state.stoppedBarren),
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
    game: 'gofish',
    playedAt: state.createdAt,
    completedAt: state.completedAt,
    seed: state.seed,
    players: state.players.map((p) => ({
      id: p.id,
      name: p.name,
      books: ((state.books || {})[p.id] || []).length,
      // Which books, because "she got the aces and the kings" is the thing
      // anybody actually recounts afterwards.
      ranks: ((state.books || {})[p.id] || []).slice(),
      isWinner: Boolean(state.winnerIds && state.winnerIds.includes(p.id)),
      place: state.finished.indexOf(p.id) === -1 ? null : state.finished.indexOf(p.id) + 1,
    })),
    booksMade: Object.values(state.books || {}).reduce((sum, ranks) => sum + ranks.length, 0),
    winners: state.winnerIds
      ? state.winnerIds.map((id) => (findPlayer(state, id) || {}).name || 'Someone')
      : [],
    stoppedBarren: Boolean(state.stoppedBarren),
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
  const winners = (record.winners || []).slice();
  const top = (record.players || []).slice().sort((a, b) => (b.books || 0) - (a.books || 0))[0];
  return {
    game: 'gofish',
    players,
    winners,
    detail: top ? `${top.books} ${top.books === 1 ? 'book' : 'books'} to ${top.name}` : null,
    loser: null,
  };
}

module.exports = { viewFor, electionView, historyRecord, historySummary };
