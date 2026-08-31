'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const game = require('../lib/game');
const { viewFor, historyRecord } = require('../lib/view');
const { scoreRound } = require('../lib/scoring');
const { deal, legalPlays, lowestPlay, suitOf, trickWinner } = require('../lib/deck');

// ── Harness ──────────────────────────────────────────────────────────────────
// Ids count up rather than being random, so a deal is the same on every run and
// a failure can be reproduced from the output alone.

function ctxFactory(start = 1_000) {
  let n = 0;
  let clock = start;
  return {
    next(actorId) {
      n += 1;
      clock += 1;
      return { now: clock, newId: (prefix) => `${prefix}_${n}`, actorId };
    },
  };
}

function ok(state, command, actorId, ctxf) {
  const out = game.applyCommand(state, command, ctxf.next(actorId));
  assert.equal(out.error, undefined, `expected success, got: ${out.error && out.error.message}`);
  return out;
}

function refused(state, command, actorId, ctxf) {
  const out = game.applyCommand(state, command, ctxf.next(actorId));
  assert.ok(out.error, 'expected the command to be refused');
  return out.error;
}

/** An online game, started, with the cards dealt for round one. */
function onlineGame(names, startHandSize = 3) {
  const ctxf = ctxFactory();
  let { state } = game.createGame({ hostName: names[0], code: '1234', startHandSize, mode: 'online' }, ctxf.next(null));
  const master = state.players[0];
  for (const name of names.slice(1)) {
    state = ok(state, { type: 'player/join', name }, null, ctxf).state;
  }
  state = ok(state, { type: 'game/start' }, master.id, ctxf).state;
  return { state, ctxf, masterId: master.id };
}

/** Everyone bids what `bids` says, by player id. */
function allBid(state, ctxf, bids) {
  for (const player of state.players) {
    state = ok(state, { type: 'bid/submit', playerId: player.id, value: bids[player.id] }, player.id, ctxf).state;
  }
  return state;
}

/** Everyone bids 1, or 0 where 1 is not available. */
function bidOneEach(state, ctxf) {
  const bids = {};
  state.players.forEach((p, i) => {
    bids[p.id] = i === 0 ? 1 : 0;
  });
  return allBid(state, ctxf, bids);
}

/** Play the current trick out, each player choosing their first legal card. */
function playTrick(state, ctxf) {
  const players = state.players.length;
  for (let i = 0; i < players; i++) {
    const round = game.currentRound(state);
    if (!round.trick) break;
    const { turnId, ledSuit } = round.trick;
    const cardId = legalPlays(round.hands[turnId], ledSuit)[0];
    state = ok(state, { type: 'trick/play', cardId }, turnId, ctxf).state;
  }
  return state;
}

/** Play every trick of the current round. */
function playRound(state, ctxf) {
  const handSize = game.currentRound(state).handSize;
  for (let t = 0; t < handSize; t++) state = playTrick(state, ctxf);
  return state;
}

// ── Dealing ──────────────────────────────────────────────────────────────────

test('starting an online game deals a hand to everybody and turns a trump', () => {
  const { state } = onlineGame(['Ed', 'Hannah', 'Sol'], 4);
  const round = game.currentRound(state);

  assert.equal(state.mode, 'online');
  assert.equal(state.phase, 'bidding');
  for (const player of state.players) assert.equal(round.hands[player.id].length, 4);
  assert.ok(round.trumpCard);
  assert.equal(round.trumpSuit, suitOf(round.trumpCard));
  assert.ok(round.seed, 'the deal keeps its seed so it can be checked afterwards');
});

test("no card is dealt to two people, and the trump is nobody's", () => {
  const { state } = onlineGame(['Ed', 'Hannah', 'Sol', 'Ali'], 6);
  const round = game.currentRound(state);
  const dealt = state.players.flatMap((p) => round.hands[p.id]);
  assert.equal(new Set(dealt).size, dealt.length);
  assert.ok(!dealt.includes(round.trumpCard));
});

test('the stored seed deals the same hands again', () => {
  const { state } = onlineGame(['Ed', 'Hannah', 'Sol'], 5);
  const round = game.currentRound(state);
  const again = deal(round.seed, state.players.map((p) => p.id), round.handSize);
  assert.deepEqual(again.hands, round.hands);
  assert.equal(again.trumpCard, round.trumpCard);
});

test('every round is dealt fresh, and the lead moves round a seat', () => {
  let { state, ctxf, masterId } = onlineGame(['Ed', 'Hannah', 'Sol'], 3);
  const first = game.currentRound(state);
  state = bidOneEach(state, ctxf);
  state = playRound(state, ctxf);
  state = ok(state, { type: 'round/next' }, masterId, ctxf).state;
  const second = game.currentRound(state);

  assert.notEqual(second.seed, first.seed);
  // Relative to wherever the lead started, not to seat one: where the rotation
  // BEGINS is now drawn from the game's id, so that round one is not always the
  // person who made the room. The rotation itself is what this test is about.
  const ids = state.players.map((p) => p.id);
  const firstAt = ids.indexOf(first.leadId);
  assert.ok(firstAt >= 0, 'the lead is one of the seats');
  assert.equal(second.leadId, ids[(firstAt + 1) % ids.length], 'and it moves round a seat');
  assert.equal(second.handSize, 2, 'the round sequence still counts down');
});

// ── Bidding hands over to play, not to the Master ─────────────────────────────

test('the last bid opens the first trick instead of asking the Master for results', () => {
  let { state, ctxf } = onlineGame(['Ed', 'Hannah', 'Sol'], 3);
  state = bidOneEach(state, ctxf);
  const round = game.currentRound(state);

  assert.equal(state.phase, 'playing');
  assert.equal(round.trick.number, 1);
  assert.equal(round.trick.turnId, round.leadId);
  assert.equal(round.trick.ledSuit, null);
  assert.deepEqual(round.trick.plays, []);
});

test('a table game is untouched — it still goes to the Master for the results', () => {
  const ctxf = ctxFactory();
  let { state } = game.createGame({ hostName: 'Ed', code: '1234', startHandSize: 3 }, ctxf.next(null));
  const master = state.players[0];
  state = ok(state, { type: 'player/join', name: 'Hannah' }, null, ctxf).state;
  state = ok(state, { type: 'game/start' }, master.id, ctxf).state;
  assert.equal(state.mode, 'table');
  assert.equal(game.currentRound(state).hands, undefined, 'a table round holds no cards at all');

  for (const p of state.players) {
    state = ok(state, { type: 'bid/submit', playerId: p.id, value: 1 }, p.id, ctxf).state;
  }
  assert.equal(state.phase, 'reveal');
});

// ── Playing a card ───────────────────────────────────────────────────────────

test('only the player whose turn it is can play, and the refusal names them', () => {
  let { state, ctxf } = onlineGame(['Ed', 'Hannah', 'Sol'], 3);
  state = bidOneEach(state, ctxf);
  const round = game.currentRound(state);
  const waiting = state.players.find((p) => p.id !== round.trick.turnId);
  const turnName = state.players.find((p) => p.id === round.trick.turnId).name;

  const error = refused(state, { type: 'trick/play', cardId: round.hands[waiting.id][0] }, waiting.id, ctxf);
  assert.equal(error.code, 'not-your-turn');
  assert.match(error.message, new RegExp(turnName));
});

test('you cannot play a card you are not holding', () => {
  let { state, ctxf } = onlineGame(['Ed', 'Hannah', 'Sol'], 3);
  state = bidOneEach(state, ctxf);
  const round = game.currentRound(state);
  const other = state.players.find((p) => p.id !== round.trick.turnId);

  const error = refused(
    state,
    { type: 'trick/play', cardId: round.hands[other.id][0] },
    round.trick.turnId,
    ctxf
  );
  assert.equal(error.code, 'not-held');
});

test('you have to follow suit while you can, and the refusal says which suit', () => {
  let { state, ctxf } = onlineGame(['Ed', 'Hannah', 'Sol'], 5);
  state = bidOneEach(state, ctxf);
  let round = game.currentRound(state);

  const leaderId = round.trick.turnId;
  const order = game.roundPlayers(state, round).map((p) => p.id);
  const nextUp = order[(order.indexOf(leaderId) + 1) % order.length];

  // Lead a suit the next player can actually follow, rather than whatever
  // happens to be first in the leader's hand.
  //
  // It used to take `hands[leaderId][0]` and assert that it worked out, which
  // held only because the deal was deterministic AND the leader was always seat
  // one. Now that where the lead starts is drawn from the game's id, the same
  // line was testing the deal instead of the rule. What the rule needs is a
  // led suit the next player holds and something off-suit to refuse; this picks
  // exactly that, and still fails loudly if no such hand exists.
  const led = round.hands[leaderId].find((card) => {
    const suit = suitOf(card);
    const theirs = round.hands[nextUp];
    return theirs.some((c) => suitOf(c) === suit) && theirs.some((c) => suitOf(c) !== suit);
  });
  assert.ok(led, 'this deal should let the leader lead a suit the next player can follow');

  state = ok(state, { type: 'trick/play', cardId: led }, leaderId, ctxf).state;
  round = game.currentRound(state);

  const nextId = round.trick.turnId;
  const ledSuit = suitOf(led);
  const hand = round.hands[nextId];
  const canFollow = hand.filter((c) => suitOf(c) === ledSuit);
  const offSuit = hand.find((c) => suitOf(c) !== ledSuit);

  assert.equal(nextId, nextUp, 'and the turn passed to the player we chose the card for');
  assert.ok(canFollow.length, 'this deal should leave the second player able to follow');
  assert.ok(offSuit, 'and holding something off-suit to be refused');

  const error = refused(state, { type: 'trick/play', cardId: offSuit }, nextId, ctxf);
  assert.equal(error.code, 'must-follow');
  assert.match(error.message, /spades|hearts|diamonds|clubs/);

  // Following is always allowed.
  const legal = legalPlays(hand, ledSuit)[0];
  state = ok(state, { type: 'trick/play', cardId: legal }, nextId, ctxf).state;
  assert.equal(game.currentRound(state).trick.plays.length, 2);
});

test('a played card leaves your hand, so a double tap cannot play it twice', () => {
  let { state, ctxf } = onlineGame(['Ed', 'Hannah', 'Sol'], 3);
  state = bidOneEach(state, ctxf);
  const round = game.currentRound(state);
  const leaderId = round.trick.turnId;
  const cardId = round.hands[leaderId][0];

  state = ok(state, { type: 'trick/play', cardId }, leaderId, ctxf).state;
  assert.ok(!game.currentRound(state).hands[leaderId].includes(cardId));
  const error = refused(state, { type: 'trick/play', cardId }, leaderId, ctxf);
  assert.equal(error.code, 'not-your-turn');
});

test('the trick goes to the right player, and they lead the next one', () => {
  let { state, ctxf } = onlineGame(['Ed', 'Hannah', 'Sol'], 3);
  state = bidOneEach(state, ctxf);
  const before = game.currentRound(state);
  const plays = [];
  let ledSuit = null;

  for (let i = 0; i < state.players.length; i++) {
    const round = game.currentRound(state);
    const { turnId } = round.trick;
    const cardId = legalPlays(round.hands[turnId], round.trick.ledSuit)[0];
    if (ledSuit === null) ledSuit = suitOf(cardId);
    plays.push({ playerId: turnId, cardId });
    state = ok(state, { type: 'trick/play', cardId }, turnId, ctxf).state;
  }

  const expected = trickWinner(plays, ledSuit, before.trumpSuit);
  const round = game.currentRound(state);
  assert.equal(round.tricksWon[expected], 1);
  assert.equal(round.tricksPlayed[0].winnerId, expected);
  assert.equal(round.trick.number, 2);
  assert.equal(round.trick.turnId, expected, 'the winner leads');
  assert.equal(round.trick.ledSuit, null, 'a fresh trick has no led suit yet');
});

test('the tricks in a round always add up to the hand size', () => {
  let { state, ctxf } = onlineGame(['Ed', 'Hannah', 'Sol', 'Ali'], 5);
  state = bidOneEach(state, ctxf);
  state = playRound(state, ctxf);
  const round = game.currentRound(state);
  const total = Object.values(round.tricksWon).reduce((a, b) => a + b, 0);
  assert.equal(total, 5);
  assert.equal(round.tricksPlayed.length, 5);
});

// ── Scoring itself ───────────────────────────────────────────────────────────

test('the last trick scores the round through the same engine as a table game', () => {
  let { state, ctxf } = onlineGame(['Ed', 'Hannah', 'Sol'], 3);
  const bids = {};
  state.players.forEach((p, i) => {
    bids[p.id] = i === 0 ? 2 : 0;
  });
  state = allBid(state, ctxf, bids);
  state = playRound(state, ctxf);

  const round = game.currentRound(state);
  assert.equal(state.phase, 'summary');
  assert.ok(round.completedAt);
  for (const player of state.players) {
    const won = round.tricksWon[player.id];
    assert.equal(round.tricks[player.id], won, 'the tricks recorded are the tricks played');
    assert.equal(round.scores[player.id], scoreRound(bids[player.id], won));
    assert.equal(player.total, round.scores[player.id]);
    assert.equal(round.totalsAfter[player.id], player.total);
  }
});

test('there is nothing for the Master to type in, or to correct afterwards', () => {
  let { state, ctxf, masterId } = onlineGame(['Ed', 'Hannah', 'Sol'], 3);
  state = bidOneEach(state, ctxf);

  const tricks = Object.fromEntries(state.players.map((p, i) => [p.id, i === 0 ? 3 : 0]));
  assert.equal(refused(state, { type: 'results/submit', tricks }, masterId, ctxf).code, 'not-table');

  state = playRound(state, ctxf);
  const amend = refused(state, { type: 'results/amend', roundIndex: 0, tricks }, masterId, ctxf);
  assert.equal(amend.code, 'not-table');
});

test('a full online game reaches the end with the totals a scoresheet would give', () => {
  let { state, ctxf, masterId } = onlineGame(['Ed', 'Hannah', 'Sol'], 3);
  const expected = Object.fromEntries(state.players.map((p) => [p.id, 0]));

  while (state.phase !== 'complete') {
    const round = game.currentRound(state);
    const bids = {};
    state.players.forEach((p, i) => {
      bids[p.id] = i === 0 ? Math.min(1, round.handSize) : 0;
    });
    state = allBid(state, ctxf, bids);
    state = playRound(state, ctxf);

    const scored = game.currentRound(state);
    for (const player of state.players) expected[player.id] += scoreRound(bids[player.id], scored.tricksWon[player.id]);
    state = ok(state, { type: 'round/next' }, masterId, ctxf).state;
  }

  assert.equal(state.rounds.length, 5, '3,2,1,2,3');
  for (const player of state.players) assert.equal(player.total, expected[player.id]);

  const record = historyRecord(state);
  assert.equal(record.mode, 'online');
  assert.ok(record.rounds.every((r) => r.seed), 'every finished deal can be dealt again and checked');
});

// ── The lobby, and what a deck can stretch to ────────────────────────────────

test('the hand size is capped by the number of players, with a card kept back', () => {
  const ctxf = ctxFactory();
  let { state } = game.createGame({ hostName: 'Ed', code: '1234', startHandSize: 3, mode: 'online' }, ctxf.next(null));
  const master = state.players[0];
  for (const name of ['Hannah', 'Sol', 'Ali']) state = ok(state, { type: 'player/join', name }, null, ctxf).state;

  state = ok(state, { type: 'game/setHandSize', handSize: 12 }, master.id, ctxf).state;
  assert.equal(state.startHandSize, 12);

  const error = refused(state, { type: 'game/setHandSize', handSize: 13 }, master.id, ctxf);
  assert.equal(error.code, 'hand-too-big');
  assert.match(error.message, /turn for trumps/);
});

test('a late joiner trims the hand size rather than being turned away', () => {
  const ctxf = ctxFactory();
  let { state } = game.createGame({ hostName: 'Ed', code: '1234', startHandSize: 3, mode: 'online' }, ctxf.next(null));
  const master = state.players[0];
  state = ok(state, { type: 'player/join', name: 'Hannah' }, null, ctxf).state;
  state = ok(state, { type: 'game/setHandSize', handSize: 25 }, master.id, ctxf).state;

  state = ok(state, { type: 'player/join', name: 'Sol' }, null, ctxf).state;
  assert.equal(state.startHandSize, 17, 'three players can hold 17 each and still turn a trump');
  state = ok(state, { type: 'game/start' }, master.id, ctxf).state;
  assert.equal(game.currentRound(state).hands[master.id].length, 17);
});

test('round a table the hand size is not capped at all — bring another deck', () => {
  const ctxf = ctxFactory();
  let { state } = game.createGame({ hostName: 'Ed', code: '1234', startHandSize: 3 }, ctxf.next(null));
  const master = state.players[0];
  for (const name of ['Hannah', 'Sol', 'Ali']) state = ok(state, { type: 'player/join', name }, null, ctxf).state;
  state = ok(state, { type: 'game/setHandSize', handSize: 20 }, master.id, ctxf).state;
  assert.equal(state.startHandSize, 20);
  assert.ok(game.gameDeckCheck(state).exceeds, 'and the deck warning still says so');
});

test('online has room for 17 players and no more', () => {
  const ctxf = ctxFactory();
  let { state } = game.createGame({ hostName: 'Ed', code: '1234', startHandSize: 3, mode: 'online' }, ctxf.next(null));
  for (let i = 1; i < game.MAX_ONLINE_PLAYERS; i++) {
    state = ok(state, { type: 'player/join', name: `P${i}` }, null, ctxf).state;
  }
  assert.equal(state.players.length, 17);
  const error = refused(state, { type: 'player/join', name: 'One too many' }, null, ctxf);
  assert.equal(error.code, 'game-full');
});

test('a player with no phone cannot be dealt a hand', () => {
  const ctxf = ctxFactory();
  let { state } = game.createGame({ hostName: 'Ed', code: '1234', startHandSize: 3, mode: 'online' }, ctxf.next(null));
  const master = state.players[0];
  const error = refused(state, { type: 'player/addOffline', name: 'Nan' }, master.id, ctxf);
  assert.equal(error.code, 'needs-phone');
  assert.match(error.message, /round a table/i);
});

test('cards cannot be played in a game being played with real ones', () => {
  const ctxf = ctxFactory();
  let { state } = game.createGame({ hostName: 'Ed', code: '1234', startHandSize: 3 }, ctxf.next(null));
  const master = state.players[0];
  state = ok(state, { type: 'player/join', name: 'Hannah' }, null, ctxf).state;
  state = ok(state, { type: 'game/start' }, master.id, ctxf).state;
  assert.equal(refused(state, { type: 'trick/play', cardId: 'AS' }, master.id, ctxf).code, 'not-online');
});

// ── The privacy boundary ─────────────────────────────────────────────────────

test("another player's hand never appears in your payload", () => {
  let { state, ctxf } = onlineGame(['Ed', 'Hannah', 'Sol'], 5);
  const round = game.currentRound(state);

  for (const viewer of state.players) {
    const payload = JSON.stringify(viewFor(state, viewer.id));
    for (const other of state.players) {
      if (other.id === viewer.id) continue;
      for (const card of round.hands[other.id]) {
        assert.ok(!payload.includes(`"${card}"`), `${viewer.name} could see ${other.name}'s ${card}`);
      }
    }
    for (const card of round.hands[viewer.id]) {
      assert.ok(payload.includes(`"${card}"`), 'you can see your own hand');
    }
  }
});

test('a spectator with no seat is dealt nothing and shown nothing', () => {
  const { state } = onlineGame(['Ed', 'Hannah', 'Sol'], 5);
  const round = game.currentRound(state);
  const payload = JSON.stringify(viewFor(state, null));
  for (const player of state.players) {
    for (const card of round.hands[player.id]) {
      assert.ok(!payload.includes(`"${card}"`), 'a hand leaked to someone with no seat');
    }
  }
});

test('what you can see of someone else is the count, and the cards they play', () => {
  let { state, ctxf } = onlineGame(['Ed', 'Hannah', 'Sol'], 4);
  state = bidOneEach(state, ctxf);
  let round = game.currentRound(state);
  const leaderId = round.trick.turnId;
  const played = round.hands[leaderId][0];
  state = ok(state, { type: 'trick/play', cardId: played }, leaderId, ctxf).state;

  const watcher = state.players.find((p) => p.id !== leaderId);
  const view = viewFor(state, watcher.id);
  const leaderSeat = view.players.find((p) => p.id === leaderId);

  assert.equal(leaderSeat.cardsHeld, 3);
  assert.equal(leaderSeat.card, null);
  assert.equal(view.round.trick.plays[0].cardId, played, 'a card on the table is public');
  assert.equal(view.round.trick.ledSuit, suitOf(played));
  assert.equal(view.round.trick.winningPlayerId, leaderId, 'one card in, and it is winning');
  assert.equal(view.round.trumpCard, round.trumpCard, 'the turned card is face up for everyone');
});

test('your own view offers the cards you may legally play, and only on your turn', () => {
  let { state, ctxf } = onlineGame(['Ed', 'Hannah', 'Sol'], 4);
  state = bidOneEach(state, ctxf);
  const round = game.currentRound(state);
  const leaderId = round.trick.turnId;

  const leadView = viewFor(state, leaderId);
  assert.equal(leadView.you.yourTurn, true);
  assert.deepEqual(leadView.you.playable, round.hands[leaderId], 'leading, everything is playable');
  assert.deepEqual(leadView.you.hand, round.hands[leaderId]);

  const waiting = state.players.find((p) => p.id !== leaderId);
  const waitView = viewFor(state, waiting.id);
  assert.equal(waitView.you.yourTurn, false);
  assert.deepEqual(waitView.you.playable, []);
});

test('the forehead round: everyone can see your card except you', () => {
  let { state, ctxf, masterId } = onlineGame(['Ed', 'Hannah', 'Sol'], 3);
  // 3 -> 2 -> 1: two rounds to get through before the one-card round.
  for (let r = 0; r < 2; r++) {
    state = bidOneEach(state, ctxf);
    state = playRound(state, ctxf);
    state = ok(state, { type: 'round/next' }, masterId, ctxf).state;
  }
  const round = game.currentRound(state);
  assert.equal(round.handSize, 1);

  for (const viewer of state.players) {
    const view = viewFor(state, viewer.id);
    const payload = JSON.stringify(view);
    const own = round.hands[viewer.id][0];

    assert.equal(view.round.forehead, true);
    assert.equal(view.you.hand, undefined, 'your own card does not travel to you');
    assert.equal(view.you.cardsHeld, 1);
    assert.ok(!payload.includes(`"${own}"`), `${viewer.name} could see their own card`);

    for (const other of state.players) {
      if (other.id === viewer.id) continue;
      const seat = view.players.find((p) => p.id === other.id);
      assert.equal(seat.card, round.hands[other.id][0], 'everyone else is face up');
    }
  }
});

test('a one-card round still has trumps', () => {
  let { state, ctxf, masterId } = onlineGame(['Ed', 'Hannah', 'Sol'], 3);
  for (let r = 0; r < 2; r++) {
    state = bidOneEach(state, ctxf);
    state = playRound(state, ctxf);
    state = ok(state, { type: 'round/next' }, masterId, ctxf).state;
  }
  const view = viewFor(state, state.players[0].id);
  assert.ok(view.round.trumpSuit, 'the deck is barely touched, so there is a card to turn');
  assert.equal(view.round.noTrumps, false);
});

test('the forehead round plays out and scores like any other', () => {
  let { state, ctxf, masterId } = onlineGame(['Ed', 'Hannah', 'Sol'], 3);
  for (let r = 0; r < 2; r++) {
    state = bidOneEach(state, ctxf);
    state = playRound(state, ctxf);
    state = ok(state, { type: 'round/next' }, masterId, ctxf).state;
  }
  const bids = Object.fromEntries(state.players.map((p, i) => [p.id, i === 0 ? 1 : 0]));
  state = allBid(state, ctxf, bids);
  state = playRound(state, ctxf);

  const round = game.currentRound(state);
  assert.equal(state.phase, 'summary');
  assert.equal(Object.values(round.tricksWon).reduce((a, b) => a + b, 0), 1);
});

test('a table game says nothing about cards at all', () => {
  const ctxf = ctxFactory();
  let { state } = game.createGame({ hostName: 'Ed', code: '1234', startHandSize: 3 }, ctxf.next(null));
  const master = state.players[0];
  state = ok(state, { type: 'player/join', name: 'Hannah' }, null, ctxf).state;
  state = ok(state, { type: 'game/start' }, master.id, ctxf).state;

  const view = viewFor(state, master.id);
  assert.equal(view.mode, 'table');
  assert.equal(view.maxHandSize, null);
  assert.equal(view.round.trumpCard, null);
  assert.equal(view.round.trick, null);
  assert.equal(view.you.hand, undefined);
  assert.equal(view.players[0].cardsHeld, null);
});

// ── Joining a game already under way ─────────────────────────────────────────

test('a latecomer is dealt in from the next hand, on nothing', () => {
  let { state, ctxf, masterId } = onlineGame(['Ed', 'Hannah', 'Sol'], 4);
  state = bidOneEach(state, ctxf);
  state = playRound(state, ctxf);

  const joined = ok(state, { type: 'player/join', name: 'Ali' }, null, ctxf);
  state = joined.state;
  const ali = joined.result.player;

  assert.equal(state.players.length, 4);
  assert.equal(ali.total, 0, 'everyone starts on nothing');
  assert.equal(ali.joinsAtRound, 1, 'in from round two');
  assert.equal(game.currentRound(state).hands[ali.id], undefined, 'not dealt into the hand just played');

  state = ok(state, { type: 'round/next' }, masterId, ctxf).state;
  const round = game.currentRound(state);
  assert.equal(round.hands[ali.id].length, 3, 'dealt in properly from here');
  assert.deepEqual(round.playerIds.sort(), state.players.map((p) => p.id).sort());
});

test('a latecomer does not shrink anybody"s hand', () => {
  let { state, ctxf, masterId } = onlineGame(['Ed', 'Hannah'], 12);
  const before = game.currentRound(state).handSize;
  state = bidOneEach(state, ctxf);
  state = playRound(state, ctxf);
  state = ok(state, { type: 'player/join', name: 'Sol' }, null, ctxf).state;
  state = ok(state, { type: 'round/next' }, masterId, ctxf).state;

  assert.equal(state.startHandSize, 12, 'the starting hand size is left alone');
  assert.equal(before, 12);
  assert.equal(game.currentRound(state).handSize, 11, 'the sequence counts down as it always would');
  for (const player of state.players) assert.equal(game.currentRound(state).hands[player.id].length, 11);
});

test('the hand already being played carries on without the newcomer', () => {
  let { state, ctxf } = onlineGame(['Ed', 'Hannah', 'Sol'], 3);
  // Ali arrives with one bid already down — mid-round is the awkward case.
  const first = state.players[0];
  state = ok(state, { type: 'bid/submit', playerId: first.id, value: 1 }, first.id, ctxf).state;
  const joined = ok(state, { type: 'player/join', name: 'Ali' }, null, ctxf);
  state = joined.state;
  const ali = joined.result.player;

  // This hand is not theirs to bid in or play into.
  assert.equal(refused(state, { type: 'bid/submit', playerId: ali.id, value: 0 }, ali.id, ctxf).code, 'not-in-round');

  for (const player of state.players.slice(1, 3)) {
    state = ok(state, { type: 'bid/submit', playerId: player.id, value: 0 }, player.id, ctxf).state;
  }
  assert.equal(state.phase, 'playing', 'three bids still closed the bidding');
  assert.equal(refused(state, { type: 'trick/play', cardId: '2S' }, ali.id, ctxf).code, 'not-your-turn');

  state = playRound(state, ctxf);
  const round = game.currentRound(state);
  assert.equal(state.phase, 'summary', 'the round still finished with three players');
  assert.equal(Object.values(round.tricksWon).reduce((a, b) => a + b, 0), 3);
  assert.equal(round.scores[ali.id], undefined, 'no score for a hand you were not in');
  assert.equal(round.totalsAfter[ali.id], 0, 'but the scoreboard still has your line');
});

test('a latecomer plays the rest of the game as an equal', () => {
  let { state, ctxf, masterId } = onlineGame(['Ed', 'Hannah'], 3);
  state = bidOneEach(state, ctxf);
  state = playRound(state, ctxf);
  state = ok(state, { type: 'player/join', name: 'Sol' }, null, ctxf).state;
  const solId = state.players[2].id;

  while (state.phase !== 'complete') {
    state = ok(state, { type: 'round/next' }, masterId, ctxf).state;
    const round = game.currentRound(state);
    assert.ok(round.playerIds.includes(solId));
    const bids = Object.fromEntries(state.players.map((p, i) => [p.id, i === 0 ? Math.min(1, round.handSize) : 0]));
    state = allBid(state, ctxf, bids);
    state = playRound(state, ctxf);
    if (state.rounds.length === state.sequence.length) {
      state = ok(state, { type: 'round/next' }, masterId, ctxf).state;
    }
  }
  assert.equal(state.phase, 'complete');
  const sol = state.players.find((p) => p.id === solId);
  assert.equal(viewFor(state, solId).you.total, sol.total);
  assert.ok(sol.total > 0, 'a latecomer scores like anybody else');
  assert.ok(
    viewFor(state, solId).leaderboard.some((p) => p.id === solId),
    'and stands on the final leaderboard'
  );
});

test('nobody joins a hand the deck cannot stretch to', () => {
  let { state, ctxf } = onlineGame(['Ed', 'Hannah', 'Sol'], 17);
  state = bidOneEach(state, ctxf);
  state = playRound(state, ctxf);
  // 17 each for three is 52 with the trump. A fourth would need 69.
  const error = refused(state, { type: 'player/join', name: 'Ali' }, null, ctxf);
  assert.equal(error.code, 'game-full');
  assert.match(error.message, /not enough cards/);
});

test('nobody joins the last hand of a game, or one that is over', () => {
  let { state, ctxf, masterId } = onlineGame(['Ed', 'Hannah'], 3);
  // 3,2,1,2,3 — get to the last round.
  for (let r = 0; r < 4; r++) {
    state = bidOneEach(state, ctxf);
    state = playRound(state, ctxf);
    state = ok(state, { type: 'round/next' }, masterId, ctxf).state;
  }
  assert.equal(state.roundIndex, 4);
  assert.equal(refused(state, { type: 'player/join', name: 'Late' }, null, ctxf).code, 'too-late');

  state = bidOneEach(state, ctxf);
  state = playRound(state, ctxf);
  state = ok(state, { type: 'round/next' }, masterId, ctxf).state;
  assert.equal(state.phase, 'complete');
  assert.equal(refused(state, { type: 'player/join', name: 'Later' }, null, ctxf).code, 'game-over');
});

test('a table game still refuses a latecomer — the cards are already dealt', () => {
  const ctxf = ctxFactory();
  let { state } = game.createGame({ hostName: 'Ed', code: '1234', startHandSize: 3 }, ctxf.next(null));
  const master = state.players[0];
  state = ok(state, { type: 'player/join', name: 'Hannah' }, null, ctxf).state;
  state = ok(state, { type: 'game/start' }, master.id, ctxf).state;
  assert.equal(refused(state, { type: 'player/join', name: 'Sol' }, null, ctxf).code, 'already-started');
});

test('a latecomer sees a seat, not a hand, until they are dealt in', () => {
  let { state, ctxf } = onlineGame(['Ed', 'Hannah', 'Sol'], 4);
  state = bidOneEach(state, ctxf);
  const joined = ok(state, { type: 'player/join', name: 'Ali' }, null, ctxf);
  state = joined.state;
  const ali = joined.result.player;

  const own = viewFor(state, ali.id);
  assert.equal(own.you.waitingToJoin, true);
  assert.equal(own.you.joinsAtRound, 2, 'shown as the round number people count in');
  assert.equal(own.you.hand, undefined);
  assert.equal(own.you.cardsHeld, 0);
  assert.equal(own.round.bidsNeeded, 3, 'the round still wants three bids, not four');

  const round = game.currentRound(state);
  const payload = JSON.stringify(own);
  for (const player of state.players.slice(0, 3)) {
    for (const card of round.hands[player.id]) {
      assert.ok(!payload.includes(`"${card}"`), 'a latecomer cannot see the hand in progress either');
    }
  }

  const seat = viewFor(state, state.players[0].id).players.find((p) => p.id === ali.id);
  assert.equal(seat.inRound, false);
  assert.equal(seat.joinsAtRound, 2);
  assert.equal(seat.total, 0);
});

// ── A phone that goes mid-hand ───────────────────────────────────────────────

/** Take a player's phone away. */
function drop(state, ctxf, playerId) {
  return ok(state, { type: 'conn/set', playerId, connected: false }, null, ctxf).state;
}

test('the Master is offered the skip only once the hand has actually stalled', () => {
  let { state, ctxf, masterId } = onlineGame(['Ed', 'Hannah', 'Sol'], 3);
  state = bidOneEach(state, ctxf);
  const waitingOn = game.currentRound(state).trick.turnId;
  const other = state.players.find((p) => p.id !== waitingOn && p.id !== masterId) || state.players[1];

  // Nothing on offer while everyone is connected.
  assert.equal(viewFor(state, masterId).you.canSkipTurnsFor, null);
  assert.equal(refused(state, { type: 'trick/skipTurns', playerId: waitingOn }, masterId, ctxf).code, 'still-here');

  state = drop(state, ctxf, waitingOn);
  assert.equal(viewFor(state, masterId).you.canSkipTurnsFor, null, 'not until the server says it has stalled');

  state = ok(state, { type: 'trick/stalled', playerId: waitingOn }, null, ctxf).state;
  const offer = viewFor(state, masterId).you.canSkipTurnsFor;
  assert.equal(offer.id, waitingOn);
  assert.equal(offer.name, state.players.find((p) => p.id === waitingOn).name);
  assert.equal(viewFor(state, other.id).you.canSkipTurnsFor, null, 'and only to the Master');
});

test('a stall offer is dropped the moment they reconnect', () => {
  let { state, ctxf, masterId } = onlineGame(['Ed', 'Hannah', 'Sol'], 3);
  state = bidOneEach(state, ctxf);
  const waitingOn = game.currentRound(state).trick.turnId;

  state = drop(state, ctxf, waitingOn);
  state = ok(state, { type: 'trick/stalled', playerId: waitingOn }, null, ctxf).state;
  assert.ok(viewFor(state, masterId).you.canSkipTurnsFor);

  state = ok(state, { type: 'conn/set', playerId: waitingOn, connected: true }, null, ctxf).state;
  assert.equal(viewFor(state, masterId).you.canSkipTurnsFor, null);
  assert.equal(game.currentRound(state).stalledPlayerId, null);
});

test('skipping plays their worst legal card, and the hand moves on', () => {
  let { state, ctxf, masterId } = onlineGame(['Ed', 'Hannah', 'Sol'], 3);
  state = bidOneEach(state, ctxf);
  let round = game.currentRound(state);
  const missingId = round.trick.turnId;
  const handBefore = round.hands[missingId].slice();
  const expected = lowestPlay(handBefore, round.trick.ledSuit, round.trumpSuit);

  state = drop(state, ctxf, missingId);
  state = ok(state, { type: 'trick/stalled', playerId: missingId }, null, ctxf).state;
  state = ok(state, { type: 'trick/skipTurns', playerId: missingId }, masterId, ctxf).state;

  round = game.currentRound(state);
  assert.equal(round.trick.plays[0].playerId, missingId, 'their card went down');
  assert.equal(round.trick.plays[0].cardId, expected);
  assert.ok(!round.hands[missingId].includes(expected), 'and left their hand');
  assert.notEqual(round.trick.turnId, missingId, 'the turn moved on');
  assert.equal(round.stalledPlayerId, null, 'the offer is spent');
  assert.equal(viewFor(state, masterId).players.find((p) => p.id === missingId).skipped, true);
});

test('a skipped player keeps being played for, all the way to the end of the hand', () => {
  let { state, ctxf, masterId } = onlineGame(['Ed', 'Hannah', 'Sol'], 3);
  state = bidOneEach(state, ctxf);
  const missingId = game.currentRound(state).trick.turnId;
  state = drop(state, ctxf, missingId);
  state = ok(state, { type: 'trick/skipTurns', playerId: missingId }, masterId, ctxf).state;

  // The other two play their own cards; the missing player never blocks a turn.
  let guard = 20;
  while (state.phase === 'playing' && guard-- > 0) {
    const round = game.currentRound(state);
    const { turnId, ledSuit } = round.trick;
    assert.notEqual(turnId, missingId, 'their turn is taken for them, never waited on');
    const cardId = legalPlays(round.hands[turnId], ledSuit)[0];
    state = ok(state, { type: 'trick/play', cardId }, turnId, ctxf).state;
  }

  const round = game.currentRound(state);
  assert.equal(state.phase, 'summary', 'the hand finished without them');
  assert.equal(round.hands[missingId].length, 0, 'their cards all got played');
  assert.equal(Object.values(round.tricksWon).reduce((a, b) => a + b, 0), 3);
  assert.equal(round.scores[missingId], scoreRound(round.bids[missingId].value, round.tricksWon[missingId]));
});

test('skipping is for one hand only — a phone back between rounds is simply back', () => {
  let { state, ctxf, masterId } = onlineGame(['Ed', 'Hannah', 'Sol'], 3);
  state = bidOneEach(state, ctxf);
  const missingId = game.currentRound(state).trick.turnId;
  state = drop(state, ctxf, missingId);
  state = ok(state, { type: 'trick/skipTurns', playerId: missingId }, masterId, ctxf).state;
  state = playRound(state, ctxf);

  state = ok(state, { type: 'conn/set', playerId: missingId, connected: true }, null, ctxf).state;
  state = ok(state, { type: 'round/next' }, masterId, ctxf).state;
  const round = game.currentRound(state);
  assert.deepEqual(round.autoPlay, {}, 'the new hand starts clean');
  assert.equal(round.hands[missingId].length, 2, 'and they are dealt in as normal');
});

test('only the Master can skip, and only for somebody who is actually gone', () => {
  let { state, ctxf, masterId } = onlineGame(['Ed', 'Hannah', 'Sol'], 3);
  state = bidOneEach(state, ctxf);
  const missingId = game.currentRound(state).trick.turnId;
  const notMaster = state.players.find((p) => p.id !== masterId).id;
  state = drop(state, ctxf, missingId);

  assert.equal(refused(state, { type: 'trick/skipTurns', playerId: missingId }, notMaster, ctxf).code, 'not-master');
  const stillHere = state.players.find((p) => p.id !== missingId).id;
  assert.equal(refused(state, { type: 'trick/skipTurns', playerId: stillHere }, masterId, ctxf).code, 'still-here');

  state = ok(state, { type: 'trick/skipTurns', playerId: missingId }, masterId, ctxf).state;
  // A second tap is a no-op rather than an error.
  ok(state, { type: 'trick/skipTurns', playerId: missingId }, masterId, ctxf);
});

// ── Letting somebody go between hands ────────────────────────────────────────

test('the Master can let a lost phone go once the hand is over, and not before', () => {
  let { state, ctxf, masterId } = onlineGame(['Ed', 'Hannah', 'Sol'], 3);
  state = bidOneEach(state, ctxf);
  const missingId = game.currentRound(state).trick.turnId;
  state = drop(state, ctxf, missingId);
  state = ok(state, { type: 'trick/skipTurns', playerId: missingId }, masterId, ctxf).state;

  // Mid-hand, no.
  assert.equal(refused(state, { type: 'player/remove', playerId: missingId }, masterId, ctxf).code, 'not-between-hands');
  assert.deepEqual(viewFor(state, masterId).you.canRemove, []);

  state = playRound(state, ctxf);
  const offered = viewFor(state, masterId).you.canRemove;
  assert.deepEqual(offered.map((p) => p.id), [missingId]);

  state = ok(state, { type: 'player/remove', playerId: missingId }, masterId, ctxf).state;
  const gone = state.players.find((p) => p.id === missingId);
  assert.equal(gone.left, true, 'kept on the scoresheet rather than deleted');
  assert.ok(gone.leftAt);

  // Letting go of the Master hands the crown on rather than leaving the game
  // without one — this deal put the Master on lead, so that is what happened.
  assert.notEqual(state.masterId, missingId);
  const master = state.masterId;

  const view = viewFor(state, master);
  assert.equal(view.players.find((p) => p.id === missingId).left, true);
  assert.ok(!view.leaderboard.some((p) => p.id === missingId), 'but out of the running');

  state = ok(state, { type: 'round/next' }, master, ctxf).state;
  assert.ok(!game.currentRound(state).playerIds.includes(missingId), 'and not dealt into the next hand');
  assert.equal(viewFor(state, master).round.bidsNeeded, 2);
});

test('somebody who was let go can come back, from the next hand and on nothing', () => {
  let { state, ctxf, masterId } = onlineGame(['Ed', 'Hannah', 'Sol'], 3);
  state = bidOneEach(state, ctxf);
  const missingId = game.currentRound(state).trick.turnId;
  state = drop(state, ctxf, missingId);
  state = ok(state, { type: 'trick/skipTurns', playerId: missingId }, masterId, ctxf).state;
  state = playRound(state, ctxf);
  state = ok(state, { type: 'player/remove', playerId: missingId }, masterId, ctxf).state;

  const name = state.players.find((p) => p.id === missingId).name;
  const rejoined = ok(state, { type: 'player/join', name }, null, ctxf);
  state = rejoined.state;
  const back = rejoined.result.player;

  assert.notEqual(back.id, missingId, 'a fresh seat, not the old one');
  assert.equal(back.total, 0);
  assert.equal(back.name, `${name} 2`, 'and a name they can be told apart by');
  state = ok(state, { type: 'round/next' }, state.masterId, ctxf).state;
  assert.ok(game.currentRound(state).playerIds.includes(back.id));
  assert.equal(game.currentRound(state).hands[back.id].length, 2);
});

test('the Master cannot let go of a connected player, or the last of a pair', () => {
  let { state, ctxf, masterId } = onlineGame(['Ed', 'Hannah'], 3);
  state = bidOneEach(state, ctxf);
  state = playRound(state, ctxf);
  const other = state.players.find((p) => p.id !== masterId).id;

  assert.equal(refused(state, { type: 'player/remove', playerId: other }, masterId, ctxf).code, 'still-here');
  state = drop(state, ctxf, other);
  assert.equal(refused(state, { type: 'player/remove', playerId: other }, masterId, ctxf).code, 'too-few');
  assert.deepEqual(viewFor(state, masterId).you.canRemove, [], 'so it is never offered');
});

test('a table game still removes players only in the lobby', () => {
  const ctxf = ctxFactory();
  let { state } = game.createGame({ hostName: 'Ed', code: '1234', startHandSize: 3 }, ctxf.next(null));
  const master = state.players[0];
  state = ok(state, { type: 'player/join', name: 'Hannah' }, null, ctxf).state;
  const hannah = state.players[1].id;
  state = ok(state, { type: 'game/start' }, master.id, ctxf).state;
  assert.equal(refused(state, { type: 'player/remove', playerId: hannah }, master.id, ctxf).code, 'not-between-hands');
});

test('in the forehead round the card need not be named — there is nothing to choose', () => {
  let { state, ctxf, masterId } = onlineGame(['Ed', 'Hannah', 'Sol'], 3);
  for (let r = 0; r < 2; r++) {
    state = bidOneEach(state, ctxf);
    state = playRound(state, ctxf);
    state = ok(state, { type: 'round/next' }, masterId, ctxf).state;
  }
  const round = game.currentRound(state);
  assert.equal(round.handSize, 1);
  state = bidOneEach(state, ctxf);

  const turnId = game.currentRound(state).trick.turnId;
  const theirCard = game.currentRound(state).hands[turnId][0];
  state = ok(state, { type: 'trick/play' }, turnId, ctxf).state;
  assert.equal(game.currentRound(state).trick.plays[0].cardId, theirCard);
});

test('with more than one card in hand, a card still has to be named', () => {
  let { state, ctxf } = onlineGame(['Ed', 'Hannah', 'Sol'], 3);
  state = bidOneEach(state, ctxf);
  const turnId = game.currentRound(state).trick.turnId;
  assert.equal(refused(state, { type: 'trick/play' }, turnId, ctxf).code, 'not-held');
});
