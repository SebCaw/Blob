'use strict';

const { MIN_PLAYERS, MAX_PLAYERS, findPlayer, playableMoves } = require('./game');
const { takes } = require('./deck');
const { SLOTS, CROSS, CORNERS, isCorner, headOf, lowestOf, cardsDown } = require('./rules');

/**
 * Turn authoritative Kings Corner state into the view ONE player may see.
 *
 * This is the privacy boundary, and it is the **shortest in the repo** — shorter
 * even than Go Fish's. There are exactly two secrets: the cards in each hand,
 * and the cards in the stock. Everything else is public by construction, because
 * every card that reaches the board was turned face up in front of the room and
 * stays there for the rest of the game. There is no pile to remember, no claim
 * to disbelieve and no answer to deduce.
 *
 * So the board goes out whole — every card in every slot, in order — and that is
 * not laziness. A pile is read from BOTH ends here (its lowest card decides what
 * can be played onto it, its head decides where the whole pile can move), and
 * everything between them was watched going down. Sending counts instead would
 * be withholding something nobody at a real table is without.
 *
 * The stock is a **count**. Not the cards, not the order, and — the part worth
 * checking twice — not what anybody drew off it. `lastEvent` says that somebody
 * drew, never what.
 *
 * @param {object} state
 * @param {string|null} viewerId
 * @returns {object}
 */
function viewFor(state, viewerId) {
  const viewer = findPlayer(state, viewerId);
  const playing = state.phase === 'playing';
  const dealt = Boolean(state.hands);

  // Once it is over, hands stop being secret.
  //
  // The same deliberate widening Sevens makes, written as a phase gate rather
  // than left implicit: at `complete` and nowhere else, what somebody was left
  // holding becomes public — which is what happens at a real table when the
  // cards go down. Nothing can leak through it mid-game, because mid-game the
  // key is absent rather than empty.
  const over = state.phase === 'complete';
  const winners = state.winnerIds || [];

  const players = state.players.map((p) => {
    const hand = dealt ? state.hands[p.id] || [] : [];
    return {
      id: p.id,
      name: p.name,
      connected: p.connected,
      awaitingTakeover: p.awaitingTakeover,
      isMaster: state.masterId === p.id,
      // That a seat is a bot is public — playing against one without being told
      // would be a lie the table could not check. Its private seed is never
      // here, which is what stops a level meaning "sees more".
      isBot: Boolean(p.isBot),
      botLevel: p.isBot ? p.botLevel || 'medium' : null,
      left: Boolean(p.left),
      handedOver: Boolean(p.handedOver),
      // How many cards somebody holds is public — you can count them across a
      // table, and in this game it is the only running score there is. WHICH
      // cards is not, and never appears here.
      cardsHeld: hand.length,
      isTurn: playing && state.turnId === p.id,
      skipped: Boolean(state.autoPlay && state.autoPlay[p.id]),
      isWinner: winners.includes(p.id),
      // Absent entirely until the game is over. A spread rather than a null, so
      // the key does not exist mid-game and cannot be quietly filled in later.
      ...(over && dealt ? { cardsLeft: (state.hands[p.id] || []).slice() } : {}),
    };
  });

  const moves = viewer ? playableMoves(state, viewer.id) : { cards: {}, piles: {}, wants: {} };

  const you = viewer
    ? {
        id: viewer.id,
        name: viewer.name,
        isMaster: state.masterId === viewer.id,
        // Your hand, and nobody else's. The only place it appears, and already
        // in the order it is held — see `sortHand`.
        hand: dealt ? (state.hands[viewer.id] || []).slice() : [],
        // Every move the rules would let you make right now: which slots take
        // each card, and which piles can move where. The reducer enforces all of
        // it; the screen only reflects it.
        moves,
        isTurn: playing && state.turnId === viewer.id,
        // Has a card left your hand this turn, and how many moves you have made.
        // These are what the one turn button reads to know what it will do.
        turnPlayed: playing && state.turnId === viewer.id ? Boolean(state.turnPlayed) : false,
        turnMoves: playing && state.turnId === viewer.id ? state.turnMoves || 0 : 0,
        // Whether ending your turn now would draw you a card. Sent as a fact
        // rather than left for the screen to work out, because the rule behind
        // it — you only draw if you played nothing — is the house rule this
        // whole game turns on.
        willDraw:
          playing && state.turnId === viewer.id && !state.turnPlayed && Boolean(state.stock && state.stock.length),
      }
    : null;

  // Your turn and there is nothing you can do at all. A fact rather than an
  // inference, because it is what decides whether the turn button says PASS.
  const stuck = Boolean(
    you && you.isTurn && !Object.keys(moves.cards).length && !Object.keys(moves.piles).length,
  );

  return {
    game: 'kingscorner',
    id: state.id,
    code: state.code,
    phase: state.phase,
    version: state.version,
    updatedAt: state.updatedAt,
    masterId: state.masterId,
    minPlayers: MIN_PLAYERS,
    maxPlayers: MAX_PLAYERS,
    // The layout, so the screen does not carry a second copy of it. Slots in
    // grid order; which of them are corners.
    slots: SLOTS.slice(),
    cross: CROSS.slice(),
    corners: CORNERS.slice(),
    players,
    you,
    turnId: state.turnId,
    // The whole board, entirely public. Head first in every pile.
    board: state.board || null,
    // The same thing again with the sums done once here rather than six times on
    // six phones: both ends of each pile, and what it will take next.
    piles: state.board
      ? SLOTS.map((slot) => {
          const pile = state.board[slot] || [];
          const lowest = lowestOf(pile);
          return {
            slot,
            corner: isCorner(slot),
            cards: pile.slice(),
            count: pile.length,
            head: headOf(pile),
            lowest,
            // What would go onto it next, as a rank and a colour. Null for an
            // empty slot and for a pile built down to an ace, which is dead.
            wants: lowest ? takes(lowest) : null,
          };
        })
      : [],
    // A count. Never the cards, and never their order.
    stockLeft: state.stock ? state.stock.length : 0,
    cardsDown: state.board ? cardsDown(state.board) : 0,
    // What just happened, so the screen can show the move travelling rather than
    // the board simply changing. All of it public — including a pile crossing
    // the table, which the whole room watches. A draw says THAT, never WHAT.
    lastEvent: state.lastEvent || null,
    stuck,
    winnerIds: winners.slice(),
    winnerNames: winners.map((id) => (findPlayer(state, id) || {}).name || 'Someone'),
    endReason: state.endReason || null,
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
  const winners = state.winnerIds || [];
  return {
    id: state.id,
    code: state.code,
    game: 'kingscorner',
    playedAt: state.createdAt,
    completedAt: state.completedAt,
    seed: state.seed,
    players: state.players.map((p) => ({
      id: p.id,
      name: p.name,
      // What they were left holding. Zero for whoever went out.
      cardsLeft: state.hands ? (state.hands[p.id] || []).length : null,
      isWinner: winners.includes(p.id),
    })),
    winners: winners.map((id) => (findPlayer(state, id) || {}).name || 'Someone'),
    // How it stopped, because a dead board and somebody going out are different
    // results and a list that showed them the same would be lying quietly.
    endReason: state.endReason || null,
    endedEarly: Boolean(state.endedEarly),
  };
}

/**
 * The one line the history list shows for a finished game.
 *
 * Here rather than in `server/store.js` because only this game knows what its
 * own record contains — a Kings Corner record has no rounds and no totals, and a
 * game whose record the store cannot read is a game that silently disappears
 * from the list.
 *
 * @param {object} record whatever `historyRecord` wrote
 */
function historySummary(record) {
  const players = (record.players || []).map((p) => ({
    id: p.id,
    name: p.name,
    place: p.isWinner ? 1 : null,
  }));
  const held = (record.players || [])
    .filter((p) => !p.isWinner && typeof p.cardsLeft === 'number')
    .sort((a, b) => a.cardsLeft - b.cardsLeft)
    .map((p) => `${p.name} ${p.cardsLeft}`);
  return {
    game: 'kingscorner',
    players,
    winners: (record.winners || []).slice(),
    // No rounds and no score, so the line is what everybody else was left
    // holding — which is the only measure this game produces.
    detail: held.length ? held.join(', ') : null,
    loser: null,
  };
}

module.exports = { viewFor, electionView, historyRecord, historySummary };
