'use strict';

const { MIN_PLAYERS, MAX_PLAYERS, findPlayer, isOut, playableCards } = require('./game');
const { SUIT_ORDER } = require('./deck');
const { openEnds, isComplete, cardsDown, totalDown, suitsOpen } = require('./rules');

/**
 * Turn authoritative Sevens state into the view ONE player may see.
 *
 * This is the privacy boundary, and Sevens has exactly one secret: **a hand**.
 * There are no face-down cards, no stock, no claims and no bids. The table is
 * public because every card on it was played face up in front of the room, and
 * the four runs are the whole of the game state anybody needs to reason about.
 *
 * That makes this the simplest boundary in the repo, and it is worth keeping
 * that way rather than building over it. If Sevens ever grows a second secret,
 * it goes through the same shape: named into the payload for the one viewer
 * allowed it, and ABSENT — not null, not empty — for everybody else.
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
  // This is a DELIBERATE widening of the boundary and the only one in this
  // game, so it is written as a phase gate rather than left implicit: at
  // `complete` and nowhere else, what somebody was left holding becomes public.
  // That is what happens at a real table — you put your cards down and everyone
  // sees what you were stuck with — and it is the whole joke of the end screen.
  // Nothing can leak through it mid-game, because mid-game the key is absent.
  const over = state.phase === 'complete';

  const players = state.players.map((p) => {
    const hand = dealt ? state.hands[p.id] || [] : [];
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
      // Their seat is being played by a bot because they walked out. Published
      // so a screen can say so rather than quietly relabelling a person as a
      // bot - see `lib/handover.js`.
      handedOver: Boolean(p.handedOver),
      // How many cards somebody is holding is public — you can count them across
      // a table. WHICH cards is not, and never appears here.
      cardsHeld: hand.length,
      // How often they have had nothing to play. Public, and the one number that
      // tells you who is struggling without telling you what they hold.
      passes: (state.passes && state.passes[p.id]) || 0,
      isTurn: playing && state.turnId === p.id,
      out: isOut(state, p.id),
      // Where they finished. 1 is the winner; nobody gets a place for losing.
      place: isOut(state, p.id) ? state.finished.indexOf(p.id) + 1 : null,
      skipped: Boolean(state.autoPlay && state.autoPlay[p.id]),
      isLoser: state.loserId === p.id,
      // Absent entirely until the game is over — see the note on `over` above.
      // Written as a spread rather than a null so the key does not exist mid-game
      // and cannot be quietly filled in by a later change.
      ...(over && dealt ? { cardsLeft: (state.hands[p.id] || []).slice() } : {}),
    };
  });

  const you = viewer
    ? {
        id: viewer.id,
        name: viewer.name,
        isMaster: state.masterId === viewer.id,
        // Your hand, and nobody else's. This is the only place it appears, and
        // it arrives already in the order it is held — see `sortHand`.
        hand: dealt ? (state.hands[viewer.id] || []).slice() : [],
        // What the rules would actually let you put down right now. The reducer
        // enforces this; the screen only reflects it.
        playable: playableCards(state, viewer.id),
        isTurn: playing && state.turnId === viewer.id,
        out: isOut(state, viewer.id),
        passes: (state.passes && state.passes[viewer.id]) || 0,
      }
    : null;

  // Nothing legal in hand on your own turn. Sent as a fact rather than left for
  // the screen to infer, because it is what decides whether a Pass button is on
  // the glass at all — and that decision has to be the server's.
  const stuck = Boolean(you && you.isTurn && !you.playable.length);

  return {
    game: 'sevens',
    id: state.id,
    code: state.code,
    phase: state.phase,
    version: state.version,
    updatedAt: state.updatedAt,
    masterId: state.masterId,
    minPlayers: MIN_PLAYERS,
    maxPlayers: MAX_PLAYERS,
    suitOrder: SUIT_ORDER.slice(),
    players,
    you,
    turnId: state.turnId,
    // The four runs. Entirely public: every card in them went down face up.
    //
    // Each carries its own ends and totals rather than making four phones work
    // the same sums out. `openEnds` in particular is what the screen draws as
    // the live end of a column, and it is the only thing in Sevens anybody
    // actually needs to read off the table.
    table: state.table || null,
    suits: state.table
      ? SUIT_ORDER.map((suit) => ({
          suit,
          run: state.table[suit],
          open: Boolean(state.table[suit]),
          complete: isComplete(state.table[suit]),
          down: cardsDown(state.table[suit]),
          ends: openEnds(state.table[suit]),
        }))
      : [],
    cardsDown: state.table ? totalDown(state.table) : 0,
    suitsOpen: state.table ? suitsOpen(state.table) : 0,
    // What just happened, so the screens can show the move travelling rather
    // than the table simply changing. All of it public. Absent on a game saved
    // before it existed, which is why it is written as a fallback.
    lastEvent: state.lastEvent || null,
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
    game: 'sevens',
    playedAt: state.createdAt,
    completedAt: state.completedAt,
    seed: state.seed,
    players: state.players.map((p) => ({
      id: p.id,
      name: p.name,
      place: state.finished.indexOf(p.id) === -1 ? null : state.finished.indexOf(p.id) + 1,
      passes: (state.passes && state.passes[p.id]) || 0,
      isLoser: state.loserId === p.id,
    })),
    order: state.finished.map((id) => (findPlayer(state, id) || {}).name || 'Someone'),
    loser: state.loserId ? (findPlayer(state, state.loserId) || {}).name || null : null,
    endedEarly: Boolean(state.endedEarly),
  };
}

/**
 * The one line the history list shows for a finished game.
 *
 * Here rather than in `server/store.js` because only this game knows what its
 * own record contains. The store used to reach into a record for `rounds` and
 * `players[].total`, which are Blob's shape — a Sevens record has neither, and
 * a game whose record it cannot read is a game that silently disappears from
 * the list.
 *
 * @param {object} record whatever `historyRecord` wrote
 */
function historySummary(record) {
  const players = (record.players || []).map((p) => ({ id: p.id, name: p.name, place: p.place }));
  const winner = players.find((p) => p.place === 1);
  return {
    game: 'sevens',
    players,
    winners: winner ? [winner.name] : [],
    // No rounds and no score. The shape of the game is the order people went
    // out in, so that is what the line says.
    detail: record.order && record.order.length ? record.order.join(', ') : null,
    loser: record.loser || null,
  };
}

module.exports = { viewFor, electionView, historyRecord, historySummary };
