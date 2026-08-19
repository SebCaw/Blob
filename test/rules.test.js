'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { roundSequence, roundCount, deckCheck, MIN_HAND_SIZE } = require('../lib/rounds');
const { scoreRound, rankPlayers, winners } = require('../lib/scoring');
const { uniqueName } = require('../lib/ids');
const game = require('../lib/game');
const { viewFor, historyRecord } = require('../lib/view');

// ── A tiny deterministic harness so the reducer is exercised as a real game ───

function ctxFactory(start = 1_000) {
  let n = 0;
  let clock = start;
  return {
    next(actorId) {
      n += 1;
      clock += 1;
      return { now: clock, newId: (p) => `${p}_${n}_${Math.random().toString(36).slice(2, 6)}`, actorId };
    },
  };
}

/** Apply a command and assert it was accepted. */
function ok(state, command, actorId, ctxf) {
  const out = game.applyCommand(state, command, ctxf.next(actorId));
  assert.equal(out.error, undefined, `expected success, got: ${out.error && out.error.message}`);
  return out;
}

/** Apply a command and assert it was refused. */
function refused(state, command, actorId, ctxf) {
  const out = game.applyCommand(state, command, ctxf.next(actorId));
  assert.ok(out.error, 'expected the command to be refused');
  return out.error;
}

/** Build a started game with `names.length` players; first is the Master. */
function startedGame(names, startHandSize = 3, opts = {}) {
  const ctxf = ctxFactory();
  let { state } = game.createGame({ hostName: names[0], code: '1234', startHandSize }, ctxf.next(null));
  const master = state.players[0];
  for (const name of names.slice(1)) {
    const out = ok(state, { type: 'player/join', name }, null, ctxf);
    state = out.state;
  }
  for (const name of opts.offline || []) {
    state = ok(state, { type: 'player/addOffline', name }, master.id, ctxf).state;
  }
  state = ok(state, { type: 'game/start' }, master.id, ctxf).state;
  return { state, ctxf, masterId: master.id };
}

/** Everyone bids `bids[playerId]`, players first, then the Master. */
function allBid(state, ctxf, bids) {
  for (const player of state.players) {
    const actor = player.isOffline || !player.connected ? state.masterId : player.id;
    state = ok(state, { type: 'bid/submit', playerId: player.id, value: bids[player.id] }, actor, ctxf).state;
  }
  return state;
}

// ── Round sequences ──────────────────────────────────────────────────────────

test('round sequence counts down to 1 and back up', () => {
  assert.deepEqual(roundSequence(3), [3, 2, 1, 2, 3]);
  assert.deepEqual(roundSequence(5), [5, 4, 3, 2, 1, 2, 3, 4, 5]);
  assert.deepEqual(roundSequence(7), [7, 6, 5, 4, 3, 2, 1, 2, 3, 4, 5, 6, 7]);
  assert.deepEqual(roundSequence(9), [9, 8, 7, 6, 5, 4, 3, 2, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
});

test('round count is (2 x start) - 1, and the sequence is symmetrical', () => {
  for (const start of [3, 5, 7, 9, 13]) {
    const seq = roundSequence(start);
    assert.equal(roundCount(start), start * 2 - 1);
    assert.deepEqual(seq, [...seq].reverse(), 'sequence should mirror itself');
    assert.equal(Math.min(...seq), 1);
    assert.equal(Math.max(...seq), start);
  }
});

test('a starting hand below the minimum is refused', () => {
  assert.equal(MIN_HAND_SIZE, 3);
  assert.throws(() => roundSequence(2), /at least 3/);
  assert.throws(() => roundSequence(0), /at least 3/);
  assert.throws(() => roundSequence(3.5), /whole number/);
});

// ── 52-card warning ──────────────────────────────────────────────────────────

test('the deck warning fires above 52 cards and never below', () => {
  assert.equal(deckCheck(7, 7).cardsNeeded, 49);
  assert.equal(deckCheck(7, 7).exceeds, false);
  assert.equal(deckCheck(7, 7).message, null);

  const big = deckCheck(8, 7);
  assert.equal(big.cardsNeeded, 56);
  assert.equal(big.exceeds, true);
  assert.equal(big.decksNeeded, 2);
  assert.match(big.message, /56 cards/);
  assert.match(big.message, /52/);

  assert.equal(deckCheck(52, 1).exceeds, false, 'exactly 52 is fine');
  assert.equal(deckCheck(53, 1).exceeds, true);
});

// ── Scoring ──────────────────────────────────────────────────────────────────

test('you score 10 + tricks only when you hit your bid exactly', () => {
  assert.equal(scoreRound(0, 0), 10);
  assert.equal(scoreRound(0, 1), 0);
  assert.equal(scoreRound(1, 1), 11);
  assert.equal(scoreRound(1, 0), 0);
  assert.equal(scoreRound(2, 2), 12);
  assert.equal(scoreRound(2, 1), 0);
  assert.equal(scoreRound(3, 3), 13);
  assert.equal(scoreRound(3, 4), 0);
  assert.equal(scoreRound(7, 7), 17);
});

test('missing a bid scores zero however close you were', () => {
  for (let bid = 0; bid <= 9; bid++) {
    for (let won = 0; won <= 9; won++) {
      const expected = bid === won ? 10 + won : 0;
      assert.equal(scoreRound(bid, won), expected, `bid ${bid} won ${won}`);
    }
  }
});

test('ranking shares a rank on a tie and skips the next one', () => {
  const ranked = rankPlayers([
    { id: 'a', total: 10 },
    { id: 'b', total: 20 },
    { id: 'c', total: 20 },
    { id: 'd', total: 5 },
  ]);
  assert.deepEqual(ranked.map((p) => [p.id, p.rank]), [['b', 1], ['c', 1], ['a', 3], ['d', 4]]);
  assert.equal(ranked[0].tied, true);
  assert.equal(ranked[2].tied, false);
  assert.deepEqual(winners([{ id: 'a', total: 20 }, { id: 'b', total: 20 }, { id: 'c', total: 1 }]), ['a', 'b']);
});

// ── Joining ──────────────────────────────────────────────────────────────────

test('two players called Alex both get in, with distinct names', () => {
  assert.equal(uniqueName('Alex', ['Bob']), 'Alex');
  assert.equal(uniqueName('Alex', ['Alex']), 'Alex 2');
  assert.equal(uniqueName('alex', ['Alex', 'Alex 2']), 'alex 3');

  const ctxf = ctxFactory();
  let { state } = game.createGame({ hostName: 'Alex', code: '1234' }, ctxf.next(null));
  state = ok(state, { type: 'player/join', name: 'Alex' }, null, ctxf).state;
  assert.deepEqual(state.players.map((p) => p.name), ['Alex', 'Alex 2']);
});

test('nobody can join after the game has started', () => {
  const { state, ctxf } = startedGame(['Seb', 'James']);
  const error = refused(state, { type: 'player/join', name: 'Latecomer' }, null, ctxf);
  assert.equal(error.code, 'already-started');
  assert.match(error.message, /already started/);
});

test('a game will not start with fewer than two players', () => {
  const ctxf = ctxFactory();
  const { state } = game.createGame({ hostName: 'Seb', code: '1234' }, ctxf.next(null));
  const error = refused(state, { type: 'game/start' }, state.masterId, ctxf);
  assert.match(error.message, /at least 2/);
});

test('only the Master can start the game or change the hand size', () => {
  const ctxf = ctxFactory();
  let { state } = game.createGame({ hostName: 'Seb', code: '1234' }, ctxf.next(null));
  state = ok(state, { type: 'player/join', name: 'James' }, null, ctxf).state;
  const james = state.players[1].id;
  assert.equal(refused(state, { type: 'game/start' }, james, ctxf).code, 'not-master');
  assert.equal(refused(state, { type: 'game/setHandSize', handSize: 9 }, james, ctxf).code, 'not-master');
  state = ok(state, { type: 'game/setHandSize', handSize: 9 }, state.masterId, ctxf).state;
  assert.equal(state.startHandSize, 9);
});

// ── Offline players ──────────────────────────────────────────────────────────

test('the Master adds an offline player who is a full player without a device', () => {
  const { state } = startedGame(['Seb', 'James'], 3, { offline: ['Grandad'] });
  const grandad = state.players.find((p) => p.name === 'Grandad');
  assert.equal(grandad.isOffline, true);
  assert.equal(grandad.connected, false);
  assert.equal(state.players.length, 3);
});

test('an offline player cannot be added once the game is under way', () => {
  const { state, ctxf, masterId } = startedGame(['Seb', 'James']);
  const error = refused(state, { type: 'player/addOffline', name: 'Late' }, masterId, ctxf);
  assert.match(error.message, /before the game starts/);
});

// ── Bidding ──────────────────────────────────────────────────────────────────

test('bids are capped at the hand size for the round', () => {
  const { state, ctxf } = startedGame(['Seb', 'James'], 3);
  const seb = state.players[0].id;
  assert.equal(state.rounds[0].handSize, 3);
  assert.equal(refused(state, { type: 'bid/submit', playerId: seb, value: 4 }, seb, ctxf).code, 'bad-bid');
  assert.equal(refused(state, { type: 'bid/submit', playerId: seb, value: -1 }, seb, ctxf).code, 'bad-bid');
  assert.equal(refused(state, { type: 'bid/submit', playerId: seb, value: 1.5 }, seb, ctxf).code, 'bad-bid');
  ok(state, { type: 'bid/submit', playerId: seb, value: 3 }, seb, ctxf);
  ok(state, { type: 'bid/submit', playerId: seb, value: 0 }, seb, ctxf);
});

test('a bid cannot be changed once it is submitted', () => {
  const { state, ctxf } = startedGame(['Seb', 'James'], 3);
  const seb = state.players[0].id;
  const after = ok(state, { type: 'bid/submit', playerId: seb, value: 2 }, seb, ctxf).state;
  const error = refused(after, { type: 'bid/submit', playerId: seb, value: 1 }, seb, ctxf);
  assert.equal(error.code, 'bid-locked');
  assert.equal(after.rounds[0].bids[seb].value, 2);
});

test('the Master cannot touch a connected player\'s bid', () => {
  const { state, ctxf, masterId } = startedGame(['Seb', 'James'], 3);
  const james = state.players[1].id;
  const error = refused(state, { type: 'bid/submit', playerId: james, value: 3 }, masterId, ctxf);
  assert.equal(error.code, 'not-allowed');

  const withBid = ok(state, { type: 'bid/submit', playerId: james, value: 1 }, james, ctxf).state;
  assert.equal(refused(withBid, { type: 'bid/submit', playerId: james, value: 3 }, masterId, ctxf).code, 'bid-locked');
  assert.equal(withBid.rounds[0].bids[james].value, 1, 'the submitted bid is untouched');
});

test('an offline player bids on the Master\'s phone, recorded as their own choice', () => {
  const { state, ctxf, masterId } = startedGame(['Seb', 'James'], 3, { offline: ['Grandad'] });
  const grandad = state.players.find((p) => p.name === 'Grandad').id;
  const after = ok(state, { type: 'bid/submit', playerId: grandad, value: 2 }, masterId, ctxf).state;
  assert.equal(after.rounds[0].bids[grandad].enteredBy, 'offline');
});

test('bidding locks exactly once, when the last bid lands', () => {
  const { state, ctxf } = startedGame(['Seb', 'James', 'Alex'], 3);
  const [seb, james, alex] = state.players.map((p) => p.id);

  let s = ok(state, { type: 'bid/submit', playerId: seb, value: 1 }, seb, ctxf).state;
  assert.equal(s.phase, 'bidding');
  assert.equal(s.rounds[0].locked, false);

  s = ok(s, { type: 'bid/submit', playerId: james, value: 2 }, james, ctxf).state;
  assert.equal(s.rounds[0].locked, false, 'still open with one bid outstanding');

  s = ok(s, { type: 'bid/submit', playerId: alex, value: 0 }, alex, ctxf).state;
  assert.equal(s.rounds[0].locked, true);
  assert.equal(s.phase, 'reveal');
  assert.ok(s.rounds[0].lockedAt);

  // Anything arriving after the lock is refused rather than re-locking.
  assert.equal(refused(s, { type: 'bid/submit', playerId: seb, value: 3 }, seb, ctxf).code, 'not-bidding');
});

test('bids stay hidden from other players until the round locks', () => {
  const { state, ctxf } = startedGame(['Seb', 'James', 'Alex'], 3);
  const [seb, james, alex] = state.players.map((p) => p.id);
  let s = ok(state, { type: 'bid/submit', playerId: seb, value: 3 }, seb, ctxf).state;
  s = ok(s, { type: 'bid/submit', playerId: james, value: 1 }, james, ctxf).state;

  const jamesView = viewFor(s, james);
  const sebRow = jamesView.players.find((p) => p.id === seb);
  assert.equal(sebRow.hasBid, true, 'James can see THAT Seb has bid');
  assert.equal(sebRow.bid, null, 'but not what Seb bid');
  assert.equal(jamesView.you.bid, 1, 'James sees his own bid');
  assert.equal(jamesView.round.bidsIn, 2);
  assert.equal(jamesView.round.bidsNeeded, 3);
  assert.equal(JSON.stringify(jamesView).includes('"bid":3'), false, 'no hidden bid value anywhere in the payload');

  s = ok(s, { type: 'bid/submit', playerId: alex, value: 0 }, alex, ctxf).state;
  const revealed = viewFor(s, james);
  assert.equal(revealed.players.find((p) => p.id === seb).bid, 3, 'revealed once locked');
});

// ── Results and scoring ──────────────────────────────────────────────────────

test('results are scored by the server and totals accumulate', () => {
  const { state, ctxf, masterId } = startedGame(['Seb', 'James', 'Alex'], 3);
  const [seb, james, alex] = state.players.map((p) => p.id);
  let s = allBid(state, ctxf, { [seb]: 2, [james]: 1, [alex]: 0 });
  assert.equal(s.phase, 'reveal');

  s = ok(s, { type: 'results/submit', tricks: { [seb]: 2, [james]: 1, [alex]: 0 } }, masterId, ctxf).state;
  assert.equal(s.phase, 'summary');
  assert.equal(s.rounds[0].scores[seb], 12);
  assert.equal(s.rounds[0].scores[james], 11);
  assert.equal(s.rounds[0].scores[alex], 10);
  assert.equal(game.findPlayer(s, seb).total, 12);
});

test('the trick total must add up to the hand size, unless the Master insists', () => {
  const { state, ctxf, masterId } = startedGame(['Seb', 'James'], 3);
  const [seb, james] = state.players.map((p) => p.id);
  const s = allBid(state, ctxf, { [seb]: 1, [james]: 2 });

  const error = refused(s, { type: 'results/submit', tricks: { [seb]: 1, [james]: 1 } }, masterId, ctxf);
  assert.equal(error.code, 'trick-total');
  assert.match(error.message, /only has 3/);

  const forced = ok(s, { type: 'results/submit', tricks: { [seb]: 1, [james]: 1 }, force: true }, masterId, ctxf).state;
  assert.equal(forced.phase, 'summary');
  assert.equal(forced.rounds[0].trickTotalOverridden, true);
});

test('tricks above the hand size are refused', () => {
  const { state, ctxf, masterId } = startedGame(['Seb', 'James'], 3);
  const [seb, james] = state.players.map((p) => p.id);
  const s = allBid(state, ctxf, { [seb]: 1, [james]: 2 });
  assert.equal(refused(s, { type: 'results/submit', tricks: { [seb]: 4, [james]: -1 } }, masterId, ctxf).code, 'bad-tricks');
});

test('submitting results twice does not double-score', () => {
  const { state, ctxf, masterId } = startedGame(['Seb', 'James'], 3);
  const [seb, james] = state.players.map((p) => p.id);
  let s = allBid(state, ctxf, { [seb]: 1, [james]: 2 });
  s = ok(s, { type: 'results/submit', tricks: { [seb]: 1, [james]: 2 } }, masterId, ctxf).state;
  assert.equal(game.findPlayer(s, seb).total, 11);

  const error = refused(s, { type: 'results/submit', tricks: { [seb]: 1, [james]: 2 } }, masterId, ctxf);
  assert.equal(error.code, 'results-in');
  assert.equal(game.findPlayer(s, seb).total, 11, 'total unchanged');
});

test('players cannot enter results — only the Master', () => {
  const { state, ctxf } = startedGame(['Seb', 'James'], 3);
  const [seb, james] = state.players.map((p) => p.id);
  const s = allBid(state, ctxf, { [seb]: 1, [james]: 2 });
  assert.equal(refused(s, { type: 'results/submit', tricks: { [seb]: 1, [james]: 2 } }, james, ctxf).code, 'not-master');
});

// ── A whole game ─────────────────────────────────────────────────────────────

test('a full 3-card game runs all five rounds and completes', () => {
  const { state, ctxf, masterId } = startedGame(['Seb', 'James'], 3);
  const [seb, james] = state.players.map((p) => p.id);
  let s = state;
  const handSizes = [];

  for (let round = 0; round < 5; round++) {
    assert.equal(s.phase, 'bidding');
    const handSize = s.rounds[s.roundIndex].handSize;
    handSizes.push(handSize);
    s = allBid(s, ctxf, { [seb]: handSize, [james]: 0 });
    s = ok(s, { type: 'results/submit', tricks: { [seb]: handSize, [james]: 0 } }, masterId, ctxf).state;
    s = ok(s, { type: 'round/next' }, masterId, ctxf).state;
  }

  assert.deepEqual(handSizes, [3, 2, 1, 2, 3]);
  assert.equal(s.phase, 'complete');
  assert.ok(s.completedAt);
  // Seb made every bid: (10+3)+(10+2)+(10+1)+(10+2)+(10+3) = 61. James bid 0 and won 0 each time: 50.
  assert.equal(game.findPlayer(s, seb).total, 61);
  assert.equal(game.findPlayer(s, james).total, 50);

  const view = viewFor(s, seb);
  assert.deepEqual(view.winners, [seb]);
  assert.equal(view.leaderboard[0].id, seb);

  const record = historyRecord(s);
  assert.equal(record.rounds.length, 5);
  assert.deepEqual(record.winners, ['Seb']);
  assert.equal(record.rounds[0].players[0].runningTotal, 13);
  assert.equal(record.startHandSize, 3);
  assert.deepEqual(record.sequence, [3, 2, 1, 2, 3]);
});

test('the game cannot be advanced past the last round', () => {
  const { state, ctxf, masterId } = startedGame(['Seb', 'James'], 3);
  const [seb, james] = state.players.map((p) => p.id);
  let s = state;
  for (let round = 0; round < 5; round++) {
    const handSize = s.rounds[s.roundIndex].handSize;
    s = allBid(s, ctxf, { [seb]: 0, [james]: handSize });
    s = ok(s, { type: 'results/submit', tricks: { [seb]: 0, [james]: handSize } }, masterId, ctxf).state;
    s = ok(s, { type: 'round/next' }, masterId, ctxf).state;
  }
  assert.equal(s.phase, 'complete');
  assert.match(refused(s, { type: 'round/next' }, masterId, ctxf).message, /not finished/);
  assert.match(refused(s, { type: 'bid/submit', playerId: seb, value: 0 }, seb, ctxf).message, /closed/);
});

// ── Rematch pointer ──────────────────────────────────────────────────────────
// The reducer only ever RECORDS that a rematch exists — creating the actual
// second game is cross-room orchestration a pure reducer cannot do (see
// server/rooms.js). This is just the announcement, and it has to behave
// itself under a double tap.

function finishedGame(names, handSize = 3) {
  const { state, ctxf, masterId } = startedGame(names, handSize);
  const ids = state.players.map((p) => p.id);
  let s = state;
  for (let round = 0; round < roundCount(handSize); round++) {
    const size = s.rounds[s.roundIndex].handSize;
    const bids = {};
    ids.forEach((id) => {
      bids[id] = 0;
    });
    s = allBid(s, ctxf, bids);
    const tricks = {};
    ids.forEach((id) => {
      tricks[id] = 0;
    });
    s = ok(s, { type: 'results/submit', tricks, force: true }, masterId, ctxf).state;
    s = ok(s, { type: 'round/next' }, masterId, ctxf).state;
  }
  return { state: s, ctxf, masterId, ids };
}

test('only the Master can start a rematch, and only once the game is over', () => {
  const { state: mid, ctxf } = startedGame(['Seb', 'James'], 3);
  const [seb, james] = mid.players.map((p) => p.id);
  assert.match(
    refused(mid, { type: 'game/rematchStarted', gameId: 'g_x', code: '1111' }, seb, ctxf).message,
    /not over yet/
  );

  const { state, masterId } = finishedGame(['Seb', 'James']);
  const nonMaster = state.players.find((p) => p.id !== masterId).id;
  assert.equal(
    refused(state, { type: 'game/rematchStarted', gameId: 'g_x', code: '1111' }, nonMaster, ctxf).code,
    'not-master'
  );

  const s = ok(state, { type: 'game/rematchStarted', gameId: 'g_new', code: '4242' }, masterId, ctxf).state;
  assert.equal(s.rematchGameId, 'g_new');
  assert.equal(s.rematchCode, '4242');
});

test('a double-tapped rematch is a no-op, not a second pointer', () => {
  const { state, masterId, ctxf } = finishedGame(['Seb', 'James']);
  const first = ok(state, { type: 'game/rematchStarted', gameId: 'g_first', code: '1000' }, masterId, ctxf).state;
  const second = ok(first, { type: 'game/rematchStarted', gameId: 'g_second', code: '2000' }, masterId, ctxf).state;
  assert.equal(second.rematchGameId, 'g_first', 'the first pointer sticks — a second call cannot overwrite it');
  assert.equal(second.rematchCode, '1000');
});

test('the rematch pointer is visible to everyone, and never carries a token', () => {
  const { state, masterId, ctxf } = finishedGame(['Seb', 'James', 'Alex']);
  const s = ok(state, { type: 'game/rematchStarted', gameId: 'g_new', code: '4242' }, masterId, ctxf).state;
  const other = s.players.find((p) => p.id !== masterId).id;
  const view = viewFor(s, other);
  assert.equal(view.rematchGameId, 'g_new');
  assert.equal(view.rematchCode, '4242');
  assert.equal(JSON.stringify(view).toLowerCase().includes('token'), false);
});
