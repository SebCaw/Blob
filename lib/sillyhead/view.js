'use strict';

const {
  MAX_PLAYERS,
  MIN_PLAYERS,
  PILE_COUNT,
  activePlayers,
  findPlayer,
  isOut,
  playableCards,
  zoneOf,
  decksFor,
} = require('./game');
const { MAX_QUICK_PLAYERS, HAND_COUNT } = require('./deck');
const { RUN_TO_SACK, forcesLow, runLength, topCard } = require('./rules');

/**
 * Turn authoritative Silly Head state into the view ONE player may see.
 *
 * This is the privacy boundary, and it carries one secret Blob never had: your
 * own three face-down cards. A hand is a secret from everybody else; a
 * face-down card is a secret from YOU as well, and it stays one until you turn
 * it over. Both work the same way — the card ids are ABSENT from the payload,
 * not hidden by the screen. If a phone never receives it, no amount of poking
 * at the app can reveal it.
 *
 * What is public is what you could see across a real table: everybody's
 * face-up cards, how many cards they are holding, how many face-down they have
 * left, the top of the pile and how big it is.
 *
 * @param {object} state
 * @param {string|null} viewerId
 * @returns {object}
 */
function viewFor(state, viewerId) {
  const viewer = findPlayer(state, viewerId);
  const playing = state.phase === 'playing';
  const sorting = state.phase === 'sort';
  const dealt = Boolean(state.hands);

  const players = state.players.map((p) => {
    const hand = dealt ? state.hands[p.id] || [] : [];
    const up = dealt ? state.up[p.id] || [] : [];
    const down = dealt ? state.down[p.id] || [] : [];
    return {
      id: p.id,
      name: p.name,
      connected: p.connected,
      awaitingTakeover: p.awaitingTakeover,
      isMaster: state.masterId === p.id,
      // That a seat is a bot is public — playing against one without being told
      // would be a lie, and not one the table could check. Its private seed is
      // never here, which is what stops a level meaning "sees more".
      isBot: Boolean(p.isBot),
      botLevel: p.isBot ? p.botLevel || 'medium' : null,
      left: Boolean(p.left),
      // How many cards somebody is holding is public — you can count them across
      // a table. WHICH cards is not, and never appears here.
      cardsHeld: hand.length,
      // Face-up cards are face up. During the sort a pile can be a stack of
      // matching cards, and that is public too: everyone can see you fishing.
      up: up.map((stack) => stack.slice()),
      // The count only. Never the cards — not even to the person they belong to.
      downLeft: down.filter(Boolean).length,
      // The cards this player is publicly KNOWN to be holding: the ones the
      // room watched them pick up and has not seen them play since. Not the
      // rest of their hand, which is theirs — anything drawn from the deck
      // arrives unseen and never appears here.
      knownCards: dealt ? ((state.publicHand || {})[p.id] || []).slice() : [],
      sortDone: Boolean(state.sortDone && state.sortDone[p.id]),
      isTurn: playing && state.turnId === p.id,
      out: isOut(state, p.id),
      // Where they finished. 1 is the winner; nobody gets a place for losing.
      place: isOut(state, p.id) ? state.finished.indexOf(p.id) + 1 : null,
      skipped: Boolean(state.autoPlay && state.autoPlay[p.id]),
      isSillyHead: state.loserId === p.id,
    };
  });

  const you = viewer
    ? {
        id: viewer.id,
        name: viewer.name,
        isMaster: state.masterId === viewer.id,
        // Your hand, and nobody else's. This is the only place it appears.
        hand: dealt ? (state.hands[viewer.id] || []).slice() : [],
        up: dealt ? (state.up[viewer.id] || []).map((stack) => stack.slice()) : [],
        // Which of your face-down piles still have a card. Not what they are.
        downLeft: dealt ? (state.down[viewer.id] || []).map(Boolean) : [],
        zone: dealt ? zoneOf(state, viewer.id) : 'out',
        // What the rules would actually let you put down right now. The reducer
        // enforces this; the screen only reflects it.
        playable: playableCards(state, viewer.id),
        isTurn: playing && state.turnId === viewer.id,
        out: isOut(state, viewer.id),
        sortDone: Boolean(state.sortDone && state.sortDone[viewer.id]),
      }
    : null;

  const stuck = Boolean(you && you.isTurn && !you.playable.length);

  return {
    game: 'sillyhead',
    id: state.id,
    code: state.code,
    phase: state.phase,
    quick: Boolean(state.quick),
    decks: state.decks || decksFor(activePlayers(state).length || MIN_PLAYERS, state.quick),
    version: state.version,
    updatedAt: state.updatedAt,
    masterId: state.masterId,
    minPlayers: MIN_PLAYERS,
    maxPlayers: state.quick ? MAX_QUICK_PLAYERS : MAX_PLAYERS,
    handSize: HAND_COUNT,
    pileCount: PILE_COUNT,
    players,
    you,
    turnId: state.turnId,
    // The middle of the table.
    //
    // The whole pile is here, not only the top of it. Every one of those cards
    // was played face up in front of the room, so none of it is a secret — and
    // somebody who has been paying attention knows exactly what is in there.
    // The screen still shows only the top card and the count, because that is
    // what is useful to look at; remembering the rest is the player's job, and
    // the bots' too.
    pile: {
      count: state.pile.length,
      cards: state.pile.slice(),
      top: topCard(state.pile),
      run: runLength(state.pile),
      runToSack: RUN_TO_SACK,
      forcesLow: forcesLow(state.pile),
    },
    stock: state.stock ? state.stock.length : 0,
    sacked: state.sacked || 0,
    // Which cards are out of the game for good. Public for the same reason: the
    // room watched every one of them go down before the pile was sacked.
    sackedCards: (state.sackedCards || []).slice(),
    // The last face-down card anybody turned over. It went face up in front of
    // everyone, so there is nothing to hide once it has.
    lastFlip: state.lastFlip,
    stuck,
    finished: state.finished.map((id) => ({ id, name: (findPlayer(state, id) || {}).name || 'Someone' })),
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

/**
 * What gets written down once a game is over.
 *
 * The seed goes in: the game has finished, so nothing is secret any more, and a
 * seed is what turns "that deal was rigged" into something checkable.
 *
 * @param {object} state
 */
function historyRecord(state) {
  return {
    id: state.id,
    code: state.code,
    game: 'sillyhead',
    playedAt: state.createdAt,
    completedAt: state.completedAt,
    quick: Boolean(state.quick),
    decks: state.decks,
    seed: state.seed,
    players: state.players.map((p) => ({
      id: p.id,
      name: p.name,
      place: state.finished.indexOf(p.id) === -1 ? null : state.finished.indexOf(p.id) + 1,
      isSillyHead: state.loserId === p.id,
    })),
    order: state.finished.map((id) => (findPlayer(state, id) || {}).name || 'Someone'),
    sillyHead: state.loserId ? (findPlayer(state, state.loserId) || {}).name || null : null,
    endedEarly: Boolean(state.endedEarly),
  };
}

module.exports = { viewFor, electionView, historyRecord };
