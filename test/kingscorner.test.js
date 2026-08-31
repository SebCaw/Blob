'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const game = require('../lib/kingscorner/game');
const view = require('../lib/kingscorner/view');
const bot = require('../lib/kingscorner/bot');
const deck = require('../lib/kingscorner/deck');
const rules = require('../lib/kingscorner/rules');
const { ENGINES } = require('../lib/engines');

/**
 * Kings Corner, driven through the reducer a whole hand at a time.
 *
 * The helpers below pin a position rather than dealing one, because almost
 * everything worth testing here is a specific board: a corner with no king to
 * open it, a pile whose head fits under exactly one other pile, a table with
 * nothing legal left anywhere. Dealing until one of those turns up would be
 * slower and would prove less.
 */

// ── Harness ──────────────────────────────────────────────────────────────────

function ctxFactory(start = 1_000) {
  let n = 0;
  let clock = start;
  return (actorId) => {
    n += 1;
    clock += 1;
    return { now: clock, newId: (prefix) => `${prefix}_${n}`, actorId };
  };
}

/** A started game with `seats` players, all human, host first. */
function started(seats = 2) {
  const next = ctxFactory();
  let { state } = game.createGame({ hostName: 'Host', code: '4827' }, next(null));
  const host = state.masterId;
  for (let i = 1; i < seats; i += 1) {
    state = ok(game.applyCommand(state, { type: 'player/join', name: `P${i}` }, next(null)));
  }
  state = ok(game.applyCommand(state, { type: 'game/start' }, next(host)));
  return { state, next, ids: state.players.map((p) => p.id) };
}

/** Unwrap a successful command, or fail loudly with the refusal. */
function ok(out) {
  assert.equal(out.error, undefined, out.error && out.error.message);
  return out.state;
}

/** The refusal from a command that was supposed to be refused. */
function refused(out) {
  assert.ok(out.error, 'that command was expected to be refused and was not');
  return out.error;
}

/**
 * Overwrite the dealt position with an exact one.
 *
 * Only legal in a test: it reaches past the reducer and writes state directly,
 * which is precisely what a room may never do.
 */
function pin(state, { hands, board, stock = [], turnId }) {
  const next = JSON.parse(JSON.stringify(state));
  next.hands = hands;
  next.board = { ...rules.emptyBoard(), ...board };
  next.stock = stock;
  next.turnId = turnId || Object.keys(hands)[0];
  next.turnPlayed = false;
  next.turnMoves = 0;
  next.idleTurns = 0;
  return next;
}

// ── The deck ─────────────────────────────────────────────────────────────────

test('the ace is low and the king is high', () => {
  assert.equal(deck.valueOf('AS'), 1);
  assert.equal(deck.valueOf('KS'), 13);
  assert.equal(deck.valueOf('10H'), 10);
  // The bug this file exists to prevent: borrowing the shared value, where an
  // ace is 14 and sits above a king.
  assert.ok(deck.valueOf('AS') < deck.valueOf('2S'));
});

test('a card fits only one rank below and in the other colour', () => {
  assert.ok(deck.fits('9C', '8H'), 'red 8 goes on black 9');
  assert.ok(deck.fits('9H', '8S'), 'black 8 goes on red 9');
  assert.ok(!deck.fits('9C', '8S'), 'same colour is refused');
  assert.ok(!deck.fits('9C', '7H'), 'two ranks down is refused');
  assert.ok(!deck.fits('9C', '10H'), 'upward is refused');
  assert.ok(!deck.fits('AS', '2H'), 'nothing goes under an ace');
});

test('a card says what it is waiting for, and a king waits for nothing', () => {
  assert.deepEqual(deck.wants('9C'), { rank: '10', red: true });
  assert.deepEqual(deck.wants('AS'), { rank: '2', red: true });
  assert.equal(deck.wants('KH'), null);
});

test('the deal is seven each, four turned, the rest face down', () => {
  const dealt = deck.deal('seed', ['a', 'b', 'c', 'd']);
  assert.equal(dealt.hands.a.length, 7);
  assert.equal(dealt.cross.length, 4);
  assert.equal(dealt.stock.length, 52 - 4 * 7 - 4);
  const all = [...Object.values(dealt.hands).flat(), ...dealt.cross, ...dealt.stock];
  assert.equal(new Set(all).size, 52, 'every card appears exactly once');
});

test('six players still fit in one deck', () => {
  const dealt = deck.deal('seed', ['a', 'b', 'c', 'd', 'e', 'f']);
  assert.equal(dealt.stock.length, 6);
  assert.ok(dealt.stock.length >= 0, 'six hands of seven plus the cross is inside fifty-two');
});

// ── The board ────────────────────────────────────────────────────────────────

test('only a king opens a corner, and a bare cross slot takes anything', () => {
  const board = rules.emptyBoard();
  assert.ok(rules.canPlace('KH', 'NW', board), 'a king opens a corner');
  assert.ok(!rules.canPlace('QH', 'NW', board), 'a queen does not');
  assert.ok(rules.canPlace('2C', 'N', board), 'a bare cross slot takes a two');
  assert.ok(rules.canPlace('KH', 'N', board), 'and a king');
});

test('a pile takes one rank down in the other colour, and nothing else', () => {
  const board = { ...rules.emptyBoard(), N: ['KS', 'QH'] };
  assert.ok(rules.canPlace('JS', 'N', board), 'black jack under a red queen');
  assert.ok(!rules.canPlace('JH', 'N', board), 'a red jack is the wrong colour');
  assert.ok(!rules.canPlace('10S', 'N', board), 'a ten is too far down');
});

test('a whole pile moves by its head, not by its lowest card', () => {
  // W is headed by a black 8 and has run down to a red 6. It goes under the red
  // 9 on S because of the 8, and its own 6 has nothing to do with it.
  const board = { ...rules.emptyBoard(), W: ['8S', '7H', '6C'], S: ['10C', '9H'] };
  assert.ok(rules.canMovePile('W', 'S', board), 'the head is what has to fit');
  assert.ok(!rules.canMovePile('S', 'W', board), 'and it does not fit the other way');

  const moved = rules.movePile('W', 'S', board);
  assert.deepEqual(moved.W, [], 'the slot it came off is now bare');
  assert.deepEqual(moved.S, ['10C', '9H', '8S', '7H', '6C'], 'all of it moved, in order');
  assert.deepEqual(board.W, ['8S', '7H', '6C'], 'the board it was given is untouched');
});

test('a pile may not move into an empty slot', () => {
  const board = { ...rules.emptyBoard(), N: ['9H'] };
  assert.ok(!rules.canMovePile('N', 'S', board), 'a bare cross slot is not a target');
  assert.ok(!rules.canMovePile('N', 'NW', board), 'nor is a bare corner');
});

test('every pile move reduces the number of occupied slots', () => {
  // The property the whole turn structure rests on: because a pile can only
  // land on another pile, the piles cannot be shuffled back and forth, so a
  // turn cannot go round for ever. If this ever stops being true, the livelock
  // argument in game.js goes with it.
  const board = { ...rules.emptyBoard(), N: ['9H'], S: ['10C'], E: ['5S'] };
  const before = rules.SLOTS.filter((s) => board[s].length).length;
  const after = rules.movePile('N', 'S', board);
  assert.equal(rules.SLOTS.filter((s) => after[s].length).length, before - 1);
});

// ── Starting ─────────────────────────────────────────────────────────────────

test('a game will not start with one player and will not seat seven', () => {
  const next = ctxFactory();
  let { state } = game.createGame({ hostName: 'Host', code: '4827' }, next(null));
  const host = state.masterId;
  assert.match(refused(game.applyCommand(state, { type: 'game/start' }, next(host))).code, /too-few/);

  for (let i = 1; i < game.MAX_PLAYERS; i += 1) {
    state = ok(game.applyCommand(state, { type: 'player/join', name: `P${i}` }, next(null)));
  }
  assert.match(refused(game.applyCommand(state, { type: 'player/join', name: 'X' }, next(null))).code, /game-full/);
});

test('starting deals the cross and leaves the corners empty', () => {
  const { state } = started(4);
  assert.equal(state.phase, 'playing');
  for (const slot of rules.CROSS) assert.equal(state.board[slot].length, 1, `${slot} was turned`);
  for (const slot of rules.CORNERS) assert.equal(state.board[slot].length, 0, `${slot} is empty`);
  assert.equal(state.stock.length, 52 - 4 * 7 - 4);
  assert.equal(state.turnId, state.players[0].id);
});

// ── Playing a card ───────────────────────────────────────────────────────────

test('a card goes down, and a card that does not fit is refused in plain English', () => {
  const { state, ids } = started(2);
  const [a, b] = ids;
  let s = pin(state, { hands: { [a]: ['5H', '9C'], [b]: ['2S'] }, board: { N: ['6S'] }, turnId: a });

  s = ok(game.applyCommand(s, { type: 'play/card', cardId: '5H', slot: 'N' }, ctxFactory()(a)));
  assert.deepEqual(s.board.N, ['6S', '5H']);
  assert.deepEqual(s.hands[a], ['9C']);
  assert.equal(s.turnPlayed, true, 'a card left the hand, so no draw is coming');
  assert.equal(s.turnId, a, 'the turn does not end on its own');

  const err = refused(game.applyCommand(s, { type: 'play/card', cardId: '9C', slot: 'N' }, ctxFactory()(a)));
  assert.equal(err.code, 'not-playable');
  assert.match(err.message, /black 4/, 'the refusal says what the pile is waiting for');
});

test('a corner refuses everything but a king, and says so', () => {
  const { state, ids } = started(2);
  const [a, b] = ids;
  const s = pin(state, { hands: { [a]: ['QH', 'KS'], [b]: ['2S'] }, board: { N: ['6S'] }, turnId: a });

  const err = refused(game.applyCommand(s, { type: 'play/card', cardId: 'QH', slot: 'NW' }, ctxFactory()(a)));
  assert.match(err.message, /Only a king can open a corner/);

  const opened = ok(game.applyCommand(s, { type: 'play/card', cardId: 'KS', slot: 'NW' }, ctxFactory()(a)));
  assert.deepEqual(opened.board.NW, ['KS']);
  assert.equal(opened.lastEvent.opened, true);
});

test('a card cannot be played from somebody else’s hand, or out of turn', () => {
  const { state, ids } = started(2);
  const [a, b] = ids;
  const s = pin(state, { hands: { [a]: ['5H'], [b]: ['5C'] }, board: { N: ['6S'] }, turnId: a });

  assert.equal(refused(game.applyCommand(s, { type: 'play/card', cardId: '5C', slot: 'N' }, ctxFactory()(a))).code, 'not-yours');
  assert.equal(refused(game.applyCommand(s, { type: 'play/card', cardId: '5C', slot: 'N' }, ctxFactory()(b))).code, 'not-your-turn');
});

// ── Moving a pile ────────────────────────────────────────────────────────────

test('moving a pile empties its slot and does not count as playing', () => {
  const { state, ids } = started(2);
  const [a, b] = ids;
  let s = pin(state, {
    hands: { [a]: ['2H'], [b]: ['2S'] },
    board: { N: ['8S', '7H'], E: ['9H'], S: ['4C'], W: ['3D'] },
    stock: ['KD'],
    turnId: a,
  });

  s = ok(game.applyCommand(s, { type: 'play/movePile', from: 'N', to: 'E' }, ctxFactory()(a)));
  assert.deepEqual(s.board.N, [], 'the slot is now bare');
  assert.deepEqual(s.board.E, ['9H', '8S', '7H']);
  assert.equal(s.turnPlayed, false, 'no card left a hand');
  assert.equal(s.turnMoves, 1);

  // And therefore ending the turn still draws — the point of the house rule.
  s = ok(game.applyCommand(s, { type: 'play/endTurn' }, ctxFactory()(a)));
  assert.equal(s.hands[a].length, 2, 'they drew');
  assert.equal(s.stock.length, 0);
});

test('a pile will not move onto a bare slot', () => {
  const { state, ids } = started(2);
  const [a, b] = ids;
  const s = pin(state, { hands: { [a]: ['2H'], [b]: ['2S'] }, board: { N: ['8S'] }, turnId: a });
  const err = refused(game.applyCommand(s, { type: 'play/movePile', from: 'N', to: 'S' }, ctxFactory()(a)));
  assert.equal(err.code, 'empty-target');
});

// ── Turns and the draw ───────────────────────────────────────────────────────

test('play a card and you do not draw', () => {
  const { state, ids } = started(2);
  const [a, b] = ids;
  let s = pin(state, { hands: { [a]: ['5H', '9C'], [b]: ['2S'] }, board: { N: ['6S'] }, stock: ['KD', 'QD'], turnId: a });

  s = ok(game.applyCommand(s, { type: 'play/card', cardId: '5H', slot: 'N' }, ctxFactory()(a)));
  s = ok(game.applyCommand(s, { type: 'play/endTurn' }, ctxFactory()(a)));

  assert.deepEqual(s.hands[a], ['9C'], 'no card was drawn');
  assert.equal(s.stock.length, 2, 'the stock is untouched');
  assert.equal(s.turnId, b);
  assert.equal(s.turnPlayed, false, 'the new turn starts clean');
});

test('play nothing and you draw one, and the turn is over instantly', () => {
  const { state, ids } = started(2);
  const [a, b] = ids;
  // Every cross slot ends in an ace, the corners need a king, and this hand has
  // neither — so there is nothing legal anywhere.
  let s = pin(state, {
    hands: { [a]: ['5H'], [b]: ['2S'] },
    board: { N: ['AS'], E: ['AH'], S: ['AC'], W: ['AD'] },
    stock: ['9C', 'QD'],
    turnId: a,
  });

  s = ok(game.applyCommand(s, { type: 'play/endTurn' }, ctxFactory()(a)));
  assert.deepEqual(s.hands[a].sort(), ['5H', '9C'].sort(), 'exactly one card came off the stock');
  assert.equal(s.stock.length, 1);
  assert.equal(s.turnId, b, 'the drawn card cannot be played — the turn is over');
  assert.equal(s.lastEvent.kind, 'turn');
  assert.equal(s.lastEvent.drew, true);
  assert.equal('card' in s.lastEvent, false, 'the event never names what was drawn');
});

test('with the stock out, a turn with nothing in it simply passes', () => {
  const { state, ids } = started(2);
  const [a, b] = ids;
  let s = pin(state, {
    hands: { [a]: ['5H'], [b]: ['2S'] },
    board: { N: ['AS'], E: ['AH'], S: ['AC'], W: ['AD'] },
    stock: [],
    turnId: a,
  });

  s = ok(game.applyCommand(s, { type: 'play/endTurn' }, ctxFactory()(a)));
  assert.deepEqual(s.hands[a], ['5H'], 'nothing to draw');
  assert.equal(s.turnId, b);
  assert.equal(s.idleTurns, 1, 'and the turn counted as idle');
  assert.equal(s.phase, 'playing', 'which does not end the game on its own');
});

test('playing is optional — you may sit on a card that fits', () => {
  const { state, ids } = started(2);
  const [a, b] = ids;
  let s = pin(state, { hands: { [a]: ['5H'], [b]: ['2S'] }, board: { N: ['6S'] }, stock: ['QD'], turnId: a });

  assert.deepEqual(Object.keys(game.playableMoves(s, a).cards), ['5H'], 'it is legal');
  s = ok(game.applyCommand(s, { type: 'play/endTurn' }, ctxFactory()(a)));
  assert.equal(s.turnId, b, 'and passing on it is allowed');
  assert.equal(s.hands[a].length, 2, 'so they drew instead');
});

// ── Winning ──────────────────────────────────────────────────────────────────

test('the first player to empty their hand wins there and then', () => {
  const { state, ids } = started(3);
  const [a, b, c] = ids;
  let s = pin(state, { hands: { [a]: ['5H'], [b]: ['2S'], [c]: ['3D'] }, board: { N: ['6S'] }, turnId: a });

  s = ok(game.applyCommand(s, { type: 'play/card', cardId: '5H', slot: 'N' }, ctxFactory()(a)));
  assert.equal(s.phase, 'complete');
  assert.deepEqual(s.winnerIds, [a]);
  assert.equal(s.endReason, 'went-out');
  assert.equal(s.turnId, null);
  assert.equal(s.lastEvent.wentOut, true);
});

test('a dead board ends the game and fewest cards wins', () => {
  const { state, ids } = started(2);
  const [a, b] = ids;
  // Four aces across the cross, no kings in either hand, nothing to move: the
  // board is locked and the stock is out.
  let s = pin(state, {
    hands: { [a]: ['5H'], [b]: ['2S', '9C'] },
    board: { N: ['AS'], E: ['AH'], S: ['AC'], W: ['AD'] },
    stock: [],
    turnId: a,
  });

  for (let i = 0; i < game.IDLE_ROUNDS * 2 && s.phase === 'playing'; i += 1) {
    s = ok(game.applyCommand(s, { type: 'play/endTurn' }, ctxFactory()(s.turnId)));
  }

  assert.equal(s.phase, 'complete');
  assert.equal(s.endReason, 'dead-board');
  assert.deepEqual(s.winnerIds, [a], 'one card beats two');
});

test('a dead board that is level is a shared win, not a coin toss', () => {
  const { state, ids } = started(2);
  const [a, b] = ids;
  let s = pin(state, {
    hands: { [a]: ['5H'], [b]: ['2S'] },
    board: { N: ['AS'], E: ['AH'], S: ['AC'], W: ['AD'] },
    stock: [],
    turnId: a,
  });

  for (let i = 0; i < game.IDLE_ROUNDS * 2 && s.phase === 'playing'; i += 1) {
    s = ok(game.applyCommand(s, { type: 'play/endTurn' }, ctxFactory()(s.turnId)));
  }
  assert.equal(s.endReason, 'dead-board');
  assert.deepEqual(s.winnerIds.slice().sort(), [a, b].sort());
});

test('one move anywhere resets the idle count', () => {
  const { state, ids } = started(2);
  const [a, b] = ids;
  let s = pin(state, {
    hands: { [a]: ['5H'], [b]: ['4H', 'JD'] },
    board: { N: ['AS'], E: ['AH'], S: ['AC'], W: ['5C'] },
    stock: [],
    turnId: a,
  });

  s = ok(game.applyCommand(s, { type: 'play/endTurn' }, ctxFactory()(a)));
  assert.equal(s.idleTurns, 1);
  s = ok(game.applyCommand(s, { type: 'play/card', cardId: '4H', slot: 'W' }, ctxFactory()(b)));
  s = ok(game.applyCommand(s, { type: 'play/endTurn' }, ctxFactory()(b)));
  assert.equal(s.idleTurns, 0, 'a card going down means the table is not stuck');
});

// ── The view ─────────────────────────────────────────────────────────────────

test('the view sends the stock as a count and the board in full', () => {
  const { state, ids } = started(2);
  const [a, b] = ids;
  const s = pin(state, { hands: { [a]: ['5H'], [b]: ['2S'] }, board: { N: ['6S'] }, stock: ['QD', 'KD'], turnId: a });
  const v = view.viewFor(s, a);

  assert.equal(v.stockLeft, 2);
  assert.equal('stock' in v, false, 'the cards themselves are absent, not nulled');
  assert.deepEqual(v.board.N, ['6S'], 'the board is public');
  assert.deepEqual(v.you.hand, ['5H']);
  assert.equal(v.players.find((p) => p.id === b).cardsHeld, 1, 'how many is public');
  assert.equal('hand' in v.players.find((p) => p.id === b), false, 'which is not');
});

test('the view says what each pile wants and what you can do', () => {
  const { state, ids } = started(2);
  const [a, b] = ids;
  const s = pin(state, { hands: { [a]: ['5H', 'KD'] , [b]: ['2S'] }, board: { N: ['6S'] }, turnId: a });
  const v = view.viewFor(s, a);

  assert.deepEqual(v.piles.find((p) => p.slot === 'N').wants, { rank: '5', red: true });
  assert.deepEqual(v.you.moves.cards['5H'].includes('N'), true);
  // A king can open any of the four corners and fill any of the three bare
  // cross slots, and none of that is worked out on the phone.
  assert.equal(v.you.moves.cards.KD.length, 7);
  assert.equal(v.you.willDraw, false, 'nothing to draw from an empty stock');
});

test('a player who is not on turn is offered no moves at all', () => {
  const { state, ids } = started(2);
  const [a, b] = ids;
  const s = pin(state, { hands: { [a]: ['5H'], [b]: ['5C'] }, board: { N: ['6S'] }, turnId: a });
  const v = view.viewFor(s, b);
  assert.deepEqual(v.you.moves.cards, {});
  assert.deepEqual(v.you.moves.piles, {});
  assert.equal(v.you.isTurn, false);
});

test('hands are revealed only once the game is over', () => {
  const { state, ids } = started(2);
  const [a, b] = ids;
  let s = pin(state, { hands: { [a]: ['5H'], [b]: ['2S', '9C'] }, board: { N: ['6S'] }, turnId: a });

  assert.equal('cardsLeft' in view.viewFor(s, a).players.find((p) => p.id === b), false, 'absent mid-game');
  s = ok(game.applyCommand(s, { type: 'play/card', cardId: '5H', slot: 'N' }, ctxFactory()(a)));
  assert.equal(s.phase, 'complete');
  assert.deepEqual(view.viewFor(s, a).players.find((p) => p.id === b).cardsLeft, ['2S', '9C']);
});

test('a history record survives being summarised', () => {
  const { state, ids } = started(2);
  const [a, b] = ids;
  let s = pin(state, { hands: { [a]: ['5H'], [b]: ['2S', '9C'] }, board: { N: ['6S'] }, turnId: a });
  s = ok(game.applyCommand(s, { type: 'play/card', cardId: '5H', slot: 'N' }, ctxFactory()(a)));

  const record = view.historyRecord(s);
  const line = view.historySummary(record);
  assert.equal(line.game, 'kingscorner');
  assert.deepEqual(line.winners, ['Host']);
  assert.match(line.detail, /P1 2/, 'the line says what everybody else was left holding');
  assert.ok(record.seed, 'the seed is written down once nothing is secret');
});

// ── Refusals ─────────────────────────────────────────────────────────────────

test('a command from another game is refused rather than half-understood', () => {
  const { state } = started(2);
  const err = refused(game.applyCommand(state, { type: 'sort/bin' }, ctxFactory()(state.masterId)));
  assert.equal(err.code, 'unknown-command');
});

// ── Bots ─────────────────────────────────────────────────────────────────────

test('a bot’s key changes on every move inside one turn', () => {
  // The silent failure this game is most exposed to: a turn is a chain, so if
  // `at` did not move after each command the room's early return would leave a
  // bot sat after its first card with the whole table waiting on it.
  const engine = ENGINES.kingscorner;
  const next = ctxFactory();
  let { state } = game.createGame({ hostName: 'Host', code: '4827' }, next(null));
  const host = state.masterId;
  state = ok(game.applyCommand(state, { type: 'player/addBot', level: 'hard' }, next(host)));
  state = ok(game.applyCommand(state, { type: 'game/start' }, next(host)));

  const botId = state.players[1].id;
  state = pin(state, {
    hands: { [host]: ['2S'], [botId]: ['5H', '4C'] },
    board: { N: ['6S'] },
    stock: ['QD'],
    turnId: botId,
  });

  const first = engine.bots.owing(state);
  assert.equal(first.playerId, botId);
  const after = ok(game.applyCommand(state, { type: 'play/card', cardId: '5H', slot: 'N' }, next(botId)));
  const second = engine.bots.owing(after);
  assert.notEqual(first.at, second.at, 'the key must move or the bot never moves again');
});

test('a bot only ever plays a move the reducer accepts', () => {
  const engine = ENGINES.kingscorner;
  for (const level of bot.BOT_LEVELS) {
    let state = botTable(4, level);
    let steps = 0;
    while (state.phase === 'playing' && steps < 4_000) {
      steps += 1;
      const owed = engine.bots.owing(state);
      assert.ok(owed, 'a table of bots is never owed nothing while it is playing');
      const player = engine.findPlayer(state, owed.playerId);
      const command = engine.bots.move(engine.viewFor(state, player.id), {
        seed: player.botSeed,
        level: player.botLevel,
      });
      const out = engine.applyCommand(state, command, {
        now: 5_000 + steps,
        newId: (p) => `${p}_${steps}`,
        actorId: player.id,
      });
      assert.equal(out.error, undefined, `${level}: a bot played something illegal — ${out.error && out.error.message}`);
      state = out.state;
    }
    assert.equal(state.phase, 'complete', `${level}: the game did not finish in ${steps} steps`);
  }
});

test('twenty games of bots all reach an ending', () => {
  // The deadlock test. A turn that never moves or a player who is out and still
  // dealt one would otherwise surface as a hang in a pub rather than a red test.
  const engine = ENGINES.kingscorner;
  const reasons = {};
  for (let n = 0; n < 20; n += 1) {
    let state = botTable(4, 'hard', `run${n}`);
    let steps = 0;
    while (state.phase === 'playing' && steps < 4_000) {
      steps += 1;
      const owed = engine.bots.owing(state);
      if (!owed) break;
      const player = engine.findPlayer(state, owed.playerId);
      const command = engine.bots.move(engine.viewFor(state, player.id), {
        seed: player.botSeed,
        level: player.botLevel,
      });
      const out = engine.applyCommand(state, command, {
        now: 6_000 + steps,
        newId: (p) => `${p}_${n}_${steps}`,
        actorId: player.id,
      });
      if (out.error) break;
      state = out.state;
    }
    assert.equal(state.phase, 'complete', `game ${n} did not finish`);
    assert.ok(state.winnerIds.length >= 1, `game ${n} finished with nobody winning`);
    reasons[state.endReason] = (reasons[state.endReason] || 0) + 1;
  }
  assert.ok(reasons['went-out'] > 0, `nobody ever went out: ${JSON.stringify(reasons)}`);
});

/** A started game with every seat driven by a bot of one level. */
function botTable(seats, level, salt = '') {
  const next = ctxFactory();
  let { state } = game.createGame({ hostName: 'Host', code: '4827' }, next(null));
  const host = state.masterId;
  for (let i = 1; i < seats; i += 1) {
    state = ok(game.applyCommand(state, { type: 'player/addBot', level }, next(host)));
  }
  state = JSON.parse(JSON.stringify(state));
  const hostSeat = state.players.find((p) => p.id === host);
  hostSeat.isBot = true;
  hostSeat.botLevel = level;
  hostSeat.botSeed = `host_seed${salt}`;
  for (const p of state.players) p.botSeed = `${p.botSeed}${salt}`;
  return ok(game.applyCommand(state, { type: 'game/start' }, next(host)));
}
