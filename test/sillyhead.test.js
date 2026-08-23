'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const deck = require('../lib/sillyhead/deck');
const rules = require('../lib/sillyhead/rules');
const game = require('../lib/sillyhead/game');
const { viewFor, historyRecord } = require('../lib/sillyhead/view');

// ── Harness ──────────────────────────────────────────────────────────────────

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

/** A lobby with everyone in it. */
function lobby(names, quick = false) {
  const ctxf = ctxFactory();
  let { state } = game.createGame({ hostName: names[0], code: '1234', quick }, ctxf.next(null));
  for (const name of names.slice(1)) {
    state = ok(state, { type: 'player/join', name }, null, ctxf).state;
  }
  return { state, ctxf, masterId: state.players[0].id, ids: state.players.map((p) => p.id) };
}

/** A dealt game sitting in the sort. */
function sorting(names, quick = false) {
  const g = lobby(names, quick);
  g.state = ok(g.state, { type: 'game/start' }, g.masterId, g.ctxf).state;
  return g;
}

/**
 * A game in play with exactly the cards a test wants.
 *
 * The deal is random by design, so a test that cares which cards are where
 * rigs them afterwards rather than fishing for a seed that happens to suit.
 *
 * @param {string[]} names
 * @param {object} setup hands/up/down/stock/pile, keyed by seat index
 */
function playing(names, setup = {}) {
  const g = sorting(names);
  const { state, ids } = g;
  ids.forEach((id, seat) => {
    const hand = (setup.hands || {})[seat];
    const up = (setup.up || {})[seat];
    const down = (setup.down || {})[seat];
    // Every seat is rigged, including the ones a test says nothing about —
    // otherwise the random deal leaks into the test and it passes four times
    // in five. Filler cards use a copy number no test names.
    const filler = (rank, suit) => `${rank}${suit}#${90 + seat}`;
    state.hands[id] = hand ? hand.slice() : [filler('7', 'S')];
    state.up[id] = up
      ? up.map((c) => (c === null ? [] : [c]))
      : [[filler('8', 'S')], [filler('8', 'H')], [filler('8', 'D')]];
    state.down[id] = down ? down.slice() : [filler('9', 'S'), filler('9', 'H'), filler('9', 'D')];
    state.sortDone[id] = true;
  });
  state.stock = (setup.stock || []).slice();
  state.pile = (setup.pile || []).slice();
  state.binned = [];
  state.phase = 'playing';
  state.turnId = ids[setup.turn || 0];
  return g;
}

const C = (face) => `${face}#1`;
const D = (face) => `${face}#2`;

// ── The deck ─────────────────────────────────────────────────────────────────

test('a deck is 52 cards, and two decks are 104 with every card twice', () => {
  assert.equal(deck.buildDeck(1).length, 52);
  const two = deck.buildDeck(2);
  assert.equal(two.length, 104);
  assert.equal(new Set(two).size, 104, 'every card id is distinct even across decks');
  assert.equal(two.filter((id) => deck.parseCard(id).rank === 'A' && deck.parseCard(id).suit === 'S').length, 2);
});

test('a card id carries its copy, and parses the same as Blob otherwise', () => {
  const card = deck.parseCard('10H#2');
  assert.equal(card.rank, '10');
  assert.equal(card.suit, 'H');
  assert.equal(card.value, 10);
  assert.equal(card.red, true);
  assert.equal(card.copy, 2);
  assert.throws(() => deck.parseCard('ZZ#1'));
  assert.throws(() => deck.parseCard('10H#0'));
});

test('decks scale with the table, and the quick game is always one', () => {
  assert.equal(deck.decksFor(2), 1, 'one deck is enough for four');
  assert.equal(deck.decksFor(4), 1);
  assert.equal(deck.decksFor(5), 2, 'and a fifth player needs a second one');
  assert.equal(deck.decksFor(8), 2);
  assert.equal(deck.decksFor(9), 3);
  assert.equal(deck.decksFor(12), 3);
  assert.equal(deck.decksFor(16), 4);
  assert.equal(deck.decksFor(4, true), 1);
});

test('the deal gives everybody nine cards and leaves the rest as stock', () => {
  const ids = ['a', 'b', 'c'];
  const dealt = deck.deal('seed', ids, 2);
  for (const id of ids) {
    assert.equal(dealt.down[id].length, 3);
    assert.equal(dealt.up[id].length, 3);
    assert.equal(dealt.hands[id].length, 3);
  }
  assert.equal(dealt.stock.length, 104 - 27);
  const all = ids.flatMap((id) => [...dealt.down[id], ...dealt.up[id], ...dealt.hands[id]]).concat(dealt.stock);
  assert.equal(new Set(all).size, 104, 'no card is dealt twice');
});

test('the same seed deals the same game, a different seed does not', () => {
  const a = deck.deal('one', ['a', 'b'], 1);
  const b = deck.deal('one', ['a', 'b'], 1);
  const c = deck.deal('two', ['a', 'b'], 1);
  assert.deepEqual(a.hands, b.hands);
  assert.notDeepEqual(a.hands, c.hands);
});

test('one deck will not stretch to sixteen players', () => {
  assert.throws(() => deck.deal('seed', Array.from({ length: 16 }, (_, i) => `p${i}`), 1), /needs 144 cards/);
});

// ── The pile ─────────────────────────────────────────────────────────────────

test('equal or higher, ace high, and you may skip as far up as you like', () => {
  const pile = [C('7H')];
  assert.equal(rules.isPlayableRank('7', pile), true);
  assert.equal(rules.isPlayableRank('A', pile), true);
  assert.equal(rules.isPlayableRank('6', pile), false);
});

test('a 2 goes on anything and lets anything follow', () => {
  assert.equal(rules.isPlayableRank('2', [C('AS')]), true);
  // Nothing special-cases the reset: a 2 is the lowest card, so everything
  // already beats it.
  assert.equal(rules.isPlayableRank('3', [C('2S')]), true);
  const out = rules.resolvePlay([C('AS')], [C('2H')]);
  assert.equal(out.sacked, 0, 'the pile stays underneath a 2');
  assert.equal(out.pile.length, 2);
});

test('a 10 goes on anything, sacks the pile, and earns another go', () => {
  assert.equal(rules.isPlayableRank('10', [C('AS')]), true);
  const out = rules.resolvePlay([C('AS'), C('KH')], [C('10D')]);
  assert.deepEqual(out.pile, []);
  assert.equal(out.sacked, 3);
  assert.equal(out.playAgain, true);
});

test('a 9 plays in order, then forces the next card to 9 or lower', () => {
  assert.equal(rules.isPlayableRank('9', [C('KS')]), false, 'a 9 has to beat the pile like any card');
  assert.equal(rules.isPlayableRank('9', [C('7S')]), true);
  const pile = [C('9S')];
  assert.equal(rules.forcesLow(pile), true);
  assert.equal(rules.isPlayableRank('3', pile), true);
  assert.equal(rules.isPlayableRank('9', pile), true);
  assert.equal(rules.isPlayableRank('J', pile), false);
  assert.equal(rules.isPlayableRank('2', pile), true, 'a 2 always goes');
  assert.equal(rules.isPlayableRank('10', pile), true, 'and so does a 10');
});

test('the 9 only binds the very next card', () => {
  const after = rules.resolvePlay([C('9S')], [C('4H')]);
  assert.equal(rules.forcesLow(after.pile), false);
  assert.equal(rules.isPlayableRank('K', after.pile), true);
});

test('a 3 is simply the lowest card', () => {
  assert.equal(rules.isPlayableRank('3', []), true);
  assert.equal(rules.isPlayableRank('3', [C('2S')]), true);
  assert.equal(rules.isPlayableRank('3', [C('3S')]), true);
  assert.equal(rules.isPlayableRank('3', [C('9S')]), true);
  assert.equal(rules.isPlayableRank('3', [C('4S')]), false);
});

test('four of a number sacks the pile however they got there', () => {
  let pile = rules.resolvePlay([], [C('4S'), C('4H')]).pile;
  assert.equal(rules.runLength(pile), 2);
  pile = rules.resolvePlay(pile, [C('4D')]).pile;
  const out = rules.resolvePlay(pile, [D('4S')]);
  assert.deepEqual(out.pile, []);
  assert.equal(out.playAgain, true);
});

test('a run never goes past four, and five of a number is never legal', () => {
  const pile = [C('4S'), C('4H')];
  assert.equal(rules.maxPlayable('4', pile), 2);
  assert.equal(rules.checkPlay([C('4D'), D('4S'), D('4H')], pile).ok, false);
  assert.equal(rules.maxPlayable('5', []), rules.RUN_TO_SACK);
  assert.equal(rules.checkPlay([C('5S'), C('5H'), C('5D'), D('5S'), D('5H')], []).ok, false);
});

test('cards played together have to be the same number', () => {
  const out = rules.checkPlay([C('5S'), C('6H')], []);
  assert.equal(out.ok, false);
  assert.match(out.reason, /same number/);
});

// ── The lobby ────────────────────────────────────────────────────────────────

test('a game needs two players and seats sixteen', () => {
  const g = lobby(['Seb']);
  refused(g.state, { type: 'game/start' }, g.masterId, g.ctxf);
  let state = g.state;
  for (let i = 2; i <= 16; i++) state = ok(state, { type: 'player/join', name: `P${i}` }, null, g.ctxf).state;
  assert.equal(state.players.length, 16);
  const err = refused(state, { type: 'player/join', name: 'One too many' }, null, g.ctxf);
  assert.equal(err.code, 'game-full');
});

test('a quick game is one deck and four players', () => {
  const g = lobby(['A', 'B', 'C', 'D'], true);
  const err = refused(g.state, { type: 'player/join', name: 'E' }, null, g.ctxf);
  assert.equal(err.code, 'game-full');
  const state = ok(g.state, { type: 'game/start' }, g.masterId, g.ctxf).state;
  assert.equal(state.decks, 1);
});

test('nobody joins once the cards are out', () => {
  const g = sorting(['A', 'B']);
  const err = refused(g.state, { type: 'player/join', name: 'Late' }, null, g.ctxf);
  assert.equal(err.code, 'already-started');
});

test('the deal is random: two games from the same lobby differ', () => {
  const a = sorting(['A', 'B', 'C']);
  const b = sorting(['A', 'B', 'C']);
  assert.notEqual(a.state.seed, b.state.seed);
  assert.notDeepEqual(Object.values(a.state.hands)[0], Object.values(b.state.hands)[0]);
});

// ── The sort ─────────────────────────────────────────────────────────────────

test('the deal puts three down, three up and three in hand, and the sort opens', () => {
  const g = sorting(['A', 'B']);
  assert.equal(g.state.phase, 'sort');
  for (const id of g.ids) {
    assert.equal(g.state.down[id].length, 3);
    assert.deepEqual(g.state.up[id].map((s) => s.length), [1, 1, 1]);
    assert.equal(g.state.hands[id].length, 3);
  }
});

test('binning a 3 sends it to the middle and draws you a replacement', () => {
  const g = sorting(['A', 'B']);
  const me = g.ids[0];
  g.state.hands[me] = [C('3S'), C('KH'), C('QD')];
  g.state.stock = [C('7C'), C('8C')];
  const state = ok(g.state, { type: 'sort/bin', cardId: C('3S') }, me, g.ctxf).state;
  assert.deepEqual(state.binned, [C('3S')]);
  assert.equal(state.hands[me].length, 3);
  assert.ok(state.hands[me].includes(C('7C')));
});

test('only 3s can be binned', () => {
  const g = sorting(['A', 'B']);
  const me = g.ids[0];
  g.state.hands[me] = [C('4S'), C('KH'), C('QD')];
  refused(g.state, { type: 'sort/bin', cardId: C('4S') }, me, g.ctxf);
});

test('stacking a pair frees a pile, and filling it again earns you a card', () => {
  const g = sorting(['A', 'B']);
  const me = g.ids[0];
  g.state.up[me] = [[C('5S')], [C('5H')], [C('KD')]];
  g.state.hands[me] = [C('7C'), C('8C'), C('9C')];
  g.state.stock = [C('AS'), C('AH')];

  let state = ok(g.state, { type: 'sort/stack', cardId: C('5S'), pileIndex: 1 }, me, g.ctxf).state;
  assert.deepEqual(state.up[me][0], []);
  assert.deepEqual(state.up[me][1], [C('5H'), C('5S')]);
  assert.equal(state.hands[me].length, 3, 'no card is owed yet — the hand is still full');

  state = ok(state, { type: 'sort/place', cardId: C('7C'), pileIndex: 0 }, me, g.ctxf).state;
  assert.deepEqual(state.up[me][0], [C('7C')]);
  assert.equal(state.hands[me].length, 3);
  assert.ok(state.hands[me].includes(C('AS')), 'and the pair has fished one card out of the stock');
});

test('you can only stack matching numbers, and only on a pile that has one', () => {
  const g = sorting(['A', 'B']);
  const me = g.ids[0];
  g.state.up[me] = [[C('5S')], [C('KH')], []];
  g.state.hands[me] = [C('7C'), C('8C'), C('9C')];
  refused(g.state, { type: 'sort/stack', cardId: C('5S'), pileIndex: 1 }, me, g.ctxf);
  refused(g.state, { type: 'sort/stack', cardId: C('7C'), pileIndex: 2 }, me, g.ctxf);
});

test('swapping trades a hand card for the one showing, and fishes nothing out of the deck', () => {
  const g = sorting(['A', 'B']);
  const me = g.ids[0];
  g.state.up[me] = [[C('5S')], [C('KH')], [C('7C')]];
  g.state.hands[me] = [C('AS'), C('8C'), C('9C')];
  g.state.stock = [C('2D')];

  const state = ok(g.state, { type: 'sort/swap', cardId: C('AS'), pileIndex: 1 }, me, g.ctxf).state;
  assert.deepEqual(state.up[me][1], [C('AS')], 'the hand card is now face up');
  assert.ok(state.hands[me].includes(C('KH')), 'and the one that was showing is in the hand');
  assert.equal(state.hands[me].length, 3, 'a swap is card-neutral');
  assert.deepEqual(state.stock, [C('2D')], 'so it earns no draw — stacking a pair is what does that');
});

test('a swap needs a card in your hand and a pile with exactly one on it', () => {
  const g = sorting(['A', 'B']);
  const me = g.ids[0];
  g.state.up[me] = [[C('5S'), C('5H')], [C('KH')], []];
  g.state.hands[me] = [C('AS'), C('8C')];

  assert.equal(refused(g.state, { type: 'sort/swap', cardId: C('AS'), pileIndex: 2 }, me, g.ctxf).code, 'pile-empty');
  assert.equal(refused(g.state, { type: 'sort/swap', cardId: C('AS'), pileIndex: 0 }, me, g.ctxf).code, 'pile-stacked');
  // The card has to come from your hand: two piles cannot swap with each other.
  refused(g.state, { type: 'sort/swap', cardId: C('5H'), pileIndex: 1 }, me, g.ctxf);
  refused(g.state, { type: 'sort/swap', cardId: C('AS'), pileIndex: 9 }, me, g.ctxf);
});

test('you cannot start with an empty pile while you still hold cards', () => {
  const g = sorting(['A', 'B']);
  const me = g.ids[0];
  g.state.up[me] = [[C('5S')], [C('KH')], []];
  const err = refused(g.state, { type: 'sort/done' }, me, g.ctxf);
  assert.equal(err.code, 'piles-short');
});

test('you cannot start with cards still piled up', () => {
  // It used to unstack them for you, which quietly chose your three best cards
  // on your behalf — the one decision the sort exists to make.
  const g = sorting(['A', 'B']);
  const me = g.ids[0];
  g.state.up[me] = [[C('5S'), C('5H')], [C('KD')], [C('7C')]];
  g.state.hands[me] = [C('8C'), C('9C'), C('10C')];
  g.state.stock = [];
  const err = refused(g.state, { type: 'sort/done' }, me, g.ctxf);
  assert.equal(err.code, 'piles-stacked');
  assert.match(err.message, /piled up/);

  // Take the spare one back yourself and it is fine.
  let state = ok(g.state, { type: 'sort/take', pileIndex: 0 }, me, g.ctxf).state;
  assert.deepEqual(state.up[me].map((s) => s.length), [1, 1, 1]);
  assert.ok(state.hands[me].includes(C('5H')));
  state = ok(state, { type: 'sort/done' }, me, g.ctxf).state;
  assert.equal(state.sortDone[me], true);
});

test('play starts when the last person finishes, and the binned 3s are the pile', () => {
  const g = sorting(['A', 'B']);
  g.state.binned = [C('3S'), C('3H')];
  g.state.stock = [];
  let state = g.state;
  for (const id of g.ids) state = ok(state, { type: 'sort/done' }, id, g.ctxf).state;
  assert.equal(state.phase, 'playing');
  assert.equal(state.pile.length, 2);
  assert.equal(rules.topRank(state.pile), '3');
  assert.ok(g.ids.includes(state.turnId));
});

test('four binned 3s sack the pile before a card is played', () => {
  const g = sorting(['A', 'B']);
  g.state.binned = [C('3S'), C('3H'), C('3D'), C('3C')];
  g.state.stock = [];
  let state = g.state;
  for (const id of g.ids) state = ok(state, { type: 'sort/done' }, id, g.ctxf).state;
  assert.deepEqual(state.pile, []);
  assert.equal(state.sacked, 4);
});

test('a fifth binned 3 starts a fresh pile on its own', () => {
  const g = sorting(['A', 'B']);
  g.state.binned = [C('3S'), C('3H'), C('3D'), C('3C'), D('3S')];
  g.state.stock = [];
  let state = g.state;
  for (const id of g.ids) state = ok(state, { type: 'sort/done' }, id, g.ctxf).state;
  assert.deepEqual(state.pile, [D('3S')]);
  assert.equal(state.sacked, 4);
});

// ── Playing ──────────────────────────────────────────────────────────────────

test('you play in turn, and only in turn', () => {
  const g = playing(['A', 'B'], { hands: { 0: [C('KS')], 1: [C('AS')] }, pile: [C('7H')] });
  const err = refused(g.state, { type: 'play/cards', cardIds: [C('AS')] }, g.ids[1], g.ctxf);
  assert.equal(err.code, 'not-your-turn');
  const state = ok(g.state, { type: 'play/cards', cardIds: [C('KS')] }, g.ids[0], g.ctxf).state;
  assert.equal(state.turnId, g.ids[1]);
});

test('a card that does not beat the pile is refused, in plain English', () => {
  const g = playing(['A', 'B'], { hands: { 0: [C('4S')] }, pile: [C('7H')] });
  const err = refused(g.state, { type: 'play/cards', cardIds: [C('4S')] }, g.ids[0], g.ctxf);
  assert.equal(err.code, 'illegal-play');
  assert.match(err.message, /beat the 7/);
});

test('sacking the pile with a 10 gives you another go on a clean slate', () => {
  const g = playing(['A', 'B'], { hands: { 0: [C('10S'), C('4H')] }, pile: [C('AS'), C('KH')] });
  const state = ok(g.state, { type: 'play/cards', cardIds: [C('10S')] }, g.ids[0], g.ctxf).state;
  assert.deepEqual(state.pile, []);
  assert.equal(state.sacked, 3);
  assert.equal(state.turnId, g.ids[0], 'same player again');
  const after = ok(state, { type: 'play/cards', cardIds: [C('4H')] }, g.ids[0], g.ctxf).state;
  assert.equal(after.turnId, g.ids[1]);
});

test('four of a number built up across turns sacks it for whoever finishes it', () => {
  const g = playing(['A', 'B'], {
    hands: { 0: [C('6S'), C('6H'), D('6H')], 1: [C('6D')] },
    pile: [C('5C')],
  });
  let state = ok(g.state, { type: 'play/cards', cardIds: [C('6S'), C('6H')] }, g.ids[0], g.ctxf).state;
  assert.equal(state.pile.length, 3, 'two 6s on a 5');
  state = ok(state, { type: 'play/cards', cardIds: [C('6D')] }, g.ids[1], g.ctxf).state;
  assert.equal(state.pile.length, 4);
  state = ok(state, { type: 'play/cards', cardIds: [D('6H')] }, g.ids[0], g.ctxf).state;
  assert.deepEqual(state.pile, [], 'the fourth 6 in a row sacks it');
  assert.equal(state.turnId, g.ids[0], 'the player who completed the four goes again');
});

test('you cannot push a run past four', () => {
  const g = playing(['A', 'B'], { hands: { 0: [C('6S'), C('6H'), C('6D')] }, pile: [C('6C'), D('6C')] });
  refused(g.state, { type: 'play/cards', cardIds: [C('6S'), C('6H'), C('6D')] }, g.ids[0], g.ctxf);
  const state = ok(g.state, { type: 'play/cards', cardIds: [C('6S'), C('6H')] }, g.ids[0], g.ctxf).state;
  assert.deepEqual(state.pile, []);
});

test('taking the pile ends your turn instantly and the player to your left leads', () => {
  const g = playing(['A', 'B', 'C'], { hands: { 0: [C('4S')] }, pile: [C('KH'), C('AS')] });
  const state = ok(g.state, { type: 'play/takePile' }, g.ids[0], g.ctxf).state;
  assert.deepEqual(state.pile, []);
  assert.equal(state.hands[g.ids[0]].length, 3);
  assert.equal(state.turnId, g.ids[1]);
});

test('you may take the pile even when you could have played', () => {
  const g = playing(['A', 'B'], { hands: { 0: [C('AS')] }, pile: [C('7H')] });
  const state = ok(g.state, { type: 'play/takePile' }, g.ids[0], g.ctxf).state;
  assert.equal(state.hands[g.ids[0]].length, 2);
});

test('the table is untouchable until the stock has gone', () => {
  const g = playing(['A', 'B'], {
    hands: { 0: [C('KS')] },
    up: { 0: [C('AS'), C('AH'), C('AD')] },
    stock: [C('2C')],
    pile: [],
  });
  const err = refused(g.state, { type: 'play/cards', cardIds: [C('AS')] }, g.ids[0], g.ctxf);
  assert.equal(err.code, 'hand-first');
});

test('being stuck on your face-up cards costs you one of them, and you choose which', () => {
  const g = playing(['A', 'B'], {
    hands: { 0: [] },
    up: { 0: [C('4S'), C('5H'), C('6D')] },
    pile: [C('KH')],
  });
  const state = ok(g.state, { type: 'play/takePile', upIndex: 2 }, g.ids[0], g.ctxf).state;
  assert.deepEqual(state.up[g.ids[0]][2], []);
  assert.equal(state.hands[g.ids[0]].length, 2, 'the pile plus the face-up card you lost');
  assert.ok(state.hands[g.ids[0]].includes(C('6D')));
});

test('choosing to take the pile off the table costs you nothing', () => {
  const g = playing(['A', 'B'], {
    hands: { 0: [] },
    up: { 0: [C('AS'), C('5H'), C('6D')] },
    pile: [C('KH')],
  });
  const state = ok(g.state, { type: 'play/takePile' }, g.ids[0], g.ctxf).state;
  assert.deepEqual(state.up[g.ids[0]].map((s) => s.length), [1, 1, 1]);
  assert.equal(state.hands[g.ids[0]].length, 1);
});

test('your very last hand card may go down with matching face-up cards', () => {
  const g = playing(['A', 'B'], {
    hands: { 0: [C('5S')] },
    up: { 0: [C('5H'), C('5D'), D('5C')] },
    pile: [C('4C')],
  });
  const state = ok(
    g.state,
    { type: 'play/cards', cardIds: [C('5S'), C('5H'), C('5D'), D('5C')] },
    g.ids[0],
    g.ctxf
  ).state;
  // Four 5s is four of a number, so it sacks the pile and you go again — which
  // is exactly the move the house describes.
  assert.deepEqual(state.pile, []);
  assert.equal(state.sacked, 5);
  assert.equal(state.turnId, g.ids[0]);
});

test('but not while you are still holding something else', () => {
  const g = playing(['A', 'B'], {
    hands: { 0: [C('5S'), C('6H')] },
    up: { 0: [C('5H'), C('5D'), C('KC')] },
    pile: [C('4C')],
  });
  const err = refused(g.state, { type: 'play/cards', cardIds: [C('5S'), C('5H')] }, g.ids[0], g.ctxf);
  assert.equal(err.code, 'not-last-card');
});

test('a face-down card is turned over, and played if it beats the pile', () => {
  const g = playing(['A', 'B'], {
    hands: { 0: [] },
    up: { 0: [null, null, null] },
    down: { 0: [C('AS'), C('4H'), C('5D')] },
    pile: [C('KH')],
  });
  const state = ok(g.state, { type: 'play/flip', pileIndex: 0 }, g.ids[0], g.ctxf).state;
  assert.equal(state.lastFlip.cardId, C('AS'));
  assert.equal(state.lastFlip.played, true);
  assert.equal(rules.topRank(state.pile), 'A');
  assert.equal(state.down[g.ids[0]][0], null);
});

test('a face-down card that does not beat the pile is picked up with it', () => {
  const g = playing(['A', 'B'], {
    hands: { 0: [] },
    up: { 0: [null, null, null] },
    down: { 0: [C('4H'), C('5D'), C('6C')] },
    pile: [C('KH'), C('AS')],
  });
  const state = ok(g.state, { type: 'play/flip', pileIndex: 0 }, g.ids[0], g.ctxf).state;
  assert.equal(state.lastFlip.played, false);
  assert.deepEqual(state.pile, []);
  assert.equal(state.hands[g.ids[0]].length, 3);
  assert.equal(state.turnId, g.ids[1]);
});

test('you cannot flip while you still have cards to play', () => {
  const g = playing(['A', 'B'], { hands: { 0: [C('KS')] }, pile: [] });
  const err = refused(g.state, { type: 'play/flip', pileIndex: 0 }, g.ids[0], g.ctxf);
  assert.equal(err.code, 'not-down-yet');
});

test('shedding your last card puts you out, and the last one holding cards is the Silly Head', () => {
  const g = playing(['A', 'B', 'C'], {
    hands: { 0: [C('AS')], 1: [C('AH')], 2: [C('4C'), C('5C')] },
    up: { 0: [null, null, null], 1: [null, null, null], 2: [null, null, null] },
    down: { 0: [null, null, null], 1: [null, null, null], 2: [null, null, null] },
    pile: [C('KD')],
  });
  let state = ok(g.state, { type: 'play/cards', cardIds: [C('AS')] }, g.ids[0], g.ctxf).state;
  assert.deepEqual(state.finished, [g.ids[0]]);
  assert.equal(state.phase, 'playing');
  assert.equal(state.turnId, g.ids[1]);

  state = ok(state, { type: 'play/cards', cardIds: [C('AH')] }, g.ids[1], g.ctxf).state;
  assert.equal(state.phase, 'complete');
  assert.equal(state.loserId, g.ids[2]);
  assert.deepEqual(state.finished, [g.ids[0], g.ids[1]]);
});

test('a player who is out is skipped, not dealt back in', () => {
  const g = playing(['A', 'B', 'C'], {
    hands: { 0: [C('AS')], 1: [C('4H'), C('5H')], 2: [C('4C'), C('5C')] },
    up: { 0: [null, null, null] },
    down: { 0: [null, null, null] },
    pile: [C('KD')],
    turn: 0,
  });
  let state = ok(g.state, { type: 'play/cards', cardIds: [C('AS')] }, g.ids[0], g.ctxf).state;
  assert.equal(state.turnId, g.ids[1]);
  state = ok(state, { type: 'play/takePile' }, g.ids[1], g.ctxf).state;
  assert.equal(state.turnId, g.ids[2]);
  state = ok(state, { type: 'play/cards', cardIds: [C('4C')] }, g.ids[2], g.ctxf).state;
  assert.equal(state.turnId, g.ids[1], 'round the player who has gone out');
});

// ── The privacy boundary ─────────────────────────────────────────────────────

test('a hand never appears in anybody else\'s payload', () => {
  const g = playing(['A', 'B'], { hands: { 0: [C('AS'), C('KH')], 1: [C('2C')] }, pile: [] });
  const view = viewFor(g.state, g.ids[1]);
  const serialised = JSON.stringify(view);
  assert.ok(!serialised.includes(C('AS')), 'the other hand is absent, not hidden');
  assert.ok(!serialised.includes(C('KH')));
  const them = view.players.find((p) => p.id === g.ids[0]);
  assert.equal(them.cardsHeld, 2, 'how many they hold is public — which cards is not');
  assert.equal(them.hand, undefined);
  assert.deepEqual(view.you.hand, [C('2C')]);
});

test('your own face-down cards are absent from your own payload', () => {
  const g = playing(['A', 'B'], {
    hands: { 0: [C('AS')] },
    down: { 0: [C('7C'), C('8C'), C('9C')] },
    pile: [],
  });
  const view = viewFor(g.state, g.ids[0]);
  const serialised = JSON.stringify(view);
  for (const card of [C('7C'), C('8C'), C('9C')]) {
    assert.ok(!serialised.includes(card), 'a face-down card is a secret from its owner too');
  }
  assert.deepEqual(view.you.downLeft, [true, true, true]);
  assert.equal(view.players.find((p) => p.id === g.ids[0]).downLeft, 3);
});

test('the view says what is playable, and says nothing when it is not your turn', () => {
  const g = playing(['A', 'B'], { hands: { 0: [C('AS'), C('4H'), C('2C')] }, pile: [C('KD')] });
  const mine = viewFor(g.state, g.ids[0]);
  assert.deepEqual(mine.you.playable.sort(), [C('2C'), C('AS')].sort());
  assert.equal(mine.stuck, false);
  const theirs = viewFor(g.state, g.ids[1]);
  assert.deepEqual(theirs.you.playable, []);
});

test('the view carries the whole pile, because everybody watched it go down', () => {
  // A deliberate reversal of an earlier decision. The screen shows the top card
  // and the count and no more, because that is what is worth looking at — but
  // every card in that pile was played face up in front of the room, so hiding
  // it from the payload would only be hiding it from the people who were
  // watching. It is what lets a good player, or a good bot, keep count.
  const g = playing(['A', 'B'], { hands: { 0: [C('AS')] }, pile: [C('4C'), C('5C'), C('KD')] });
  const view = viewFor(g.state, g.ids[0]);
  assert.equal(view.pile.count, 3);
  assert.equal(view.pile.top, C('KD'));
  assert.deepEqual(view.pile.cards, [C('4C'), C('5C'), C('KD')]);
});

test('what the room saw somebody pick up is public; what they drew is not', () => {
  const g = playing(['A', 'B'], {
    hands: { 0: [C('4S')], 1: [C('4H')] },
    pile: [C('QD'), C('QH')],
    stock: [C('7C'), C('8C'), C('9C')],
  });
  let state = ok(g.state, { type: 'play/takePile' }, g.ids[0], g.ctxf).state;
  const them = viewFor(state, g.ids[1]).players.find((p) => p.id === g.ids[0]);
  // They took two queens in front of everybody, then drew unseen cards.
  assert.deepEqual(them.knownCards.slice().sort(), [C('QD'), C('QH')].sort());
  assert.ok(them.cardsHeld > them.knownCards.length, 'the drawn ones stay theirs alone');
  assert.ok(
    !JSON.stringify(viewFor(state, g.ids[1]).players).includes(C('4S')),
    'and the card they were already holding is still nobody else"s business'
  );

  // Playing one is public too, so the room stops knowing they hold it.
  state = ok(state, { type: 'play/cards', cardIds: [C('4H')] }, g.ids[1], g.ctxf).state;
  state = ok(state, { type: 'play/cards', cardIds: [C('QD')] }, g.ids[0], g.ctxf).state;
  const later = viewFor(state, g.ids[1]).players.find((p) => p.id === g.ids[0]);
  assert.deepEqual(later.knownCards, [C('QH')]);
});

test('stuck is what the screen reads to offer the pile', () => {
  const g = playing(['A', 'B'], { hands: { 0: [C('4S')] }, pile: [C('KD')] });
  assert.equal(viewFor(g.state, g.ids[0]).stuck, true);
});

// ── Absent players ───────────────────────────────────────────────────────────

test('the middle says who played what, so a screen can show the card travelling', () => {
  const g = playing(['A', 'B'], { hands: { 0: [C('9S'), D('9S')] }, pile: [C('4D')] });
  const state = ok(g.state, { type: 'play/cards', cardIds: [C('9S'), D('9S')] }, g.ids[0], g.ctxf).state;

  const event = viewFor(state, g.ids[1]).lastEvent;
  assert.equal(event.type, 'play');
  assert.equal(event.playerId, g.ids[0], 'which seat the cards flew out of');
  assert.deepEqual(event.cards, [C('9S'), D('9S')]);
  assert.equal(event.sacked, 0);
});

test('a sacked pile and a taken pile are both written down, with how big they were', () => {
  const sack = playing(['A', 'B'], { hands: { 0: [C('10S')] }, pile: [C('4D'), C('5D')] });
  const sacked = ok(sack.state, { type: 'play/cards', cardIds: [C('10S')] }, sack.ids[0], sack.ctxf).state;
  const sackEvent = viewFor(sacked, sack.ids[1]).lastEvent;
  assert.equal(sackEvent.type, 'play');
  assert.equal(sackEvent.sacked, 3, 'two on the pile and the 10 that sacked it');

  const take = playing(['A', 'B'], { hands: { 0: [C('4S')] }, pile: [C('KD'), C('QD')] });
  const first = viewFor(take.state, take.ids[1]).lastEvent;
  const took = ok(take.state, { type: 'play/takePile' }, take.ids[0], take.ctxf).state;
  const takeEvent = viewFor(took, take.ids[1]).lastEvent;
  assert.equal(takeEvent.type, 'pickup');
  assert.equal(takeEvent.playerId, take.ids[0]);
  assert.equal(takeEvent.count, 2, 'the whole pile, which is what flies to their seat');
  assert.ok(takeEvent.seq > ((first && first.seq) || 0), 'and it is a new event, not the last one repainted');
});

test('a phone that goes quiet can have its turns played, badly, by the server', () => {
  const g = playing(['A', 'B'], {
    hands: { 0: [C('4S'), C('AS'), C('2C')], 1: [C('KH')] },
    pile: [C('3C')],
  });
  let state = ok(g.state, { type: 'conn/set', playerId: g.ids[0], connected: false }, null, g.ctxf).state;
  state = ok(state, { type: 'play/skipTurns', playerId: g.ids[0] }, g.masterId, g.ctxf).state;
  // The lowest legal plain card, never the 2 while anything else will do.
  assert.equal(rules.topRank(state.pile), '4');
  assert.equal(state.turnId, g.ids[1]);
});

test('coming back stops the server playing for you', () => {
  const g = playing(['A', 'B'], { hands: { 0: [C('4S')], 1: [C('KH')] }, pile: [] });
  let state = ok(g.state, { type: 'conn/set', playerId: g.ids[1], connected: false }, null, g.ctxf).state;
  state = ok(state, { type: 'play/skipTurns', playerId: g.ids[1] }, g.masterId, g.ctxf).state;
  assert.equal(state.autoPlay[g.ids[1]], true);
  state = ok(state, { type: 'conn/set', playerId: g.ids[1], connected: true }, null, g.ctxf).state;
  assert.equal(state.autoPlay[g.ids[1]], undefined);
});

test('somebody who walks out takes their cards with them', () => {
  const g = playing(['A', 'B', 'C'], {
    hands: { 0: [C('AS')], 1: [C('KH')], 2: [C('QD')] },
    pile: [],
  });
  let state = ok(g.state, { type: 'conn/set', playerId: g.ids[2], connected: false }, null, g.ctxf).state;
  state = ok(state, { type: 'player/remove', playerId: g.ids[2] }, g.masterId, g.ctxf).state;
  assert.equal(state.players.find((p) => p.id === g.ids[2]).left, true);
  assert.equal(state.hands[g.ids[2]], undefined);
  assert.ok(!JSON.stringify(viewFor(state, g.ids[0])).includes(C('QD')));
});

// ── The record ───────────────────────────────────────────────────────────────

test('a finished game writes down the order, the Silly Head and the seed', () => {
  const g = playing(['A', 'B'], {
    hands: { 0: [C('AS')], 1: [C('4H'), C('5H')] },
    up: { 0: [null, null, null] },
    down: { 0: [null, null, null] },
    pile: [C('KD')],
  });
  const state = ok(g.state, { type: 'play/cards', cardIds: [C('AS')] }, g.ids[0], g.ctxf).state;
  assert.equal(state.phase, 'complete');
  const record = historyRecord(state);
  assert.equal(record.game, 'sillyhead');
  assert.deepEqual(record.order, ['A']);
  assert.equal(record.sillyHead, 'B');
  assert.ok(record.seed, 'the seed goes in, so a finished deal can be checked');
});

// ── A whole game, start to finish ────────────────────────────────────────────

/**
 * Deal a real game and play it out with a dim but legal strategy, several times
 * over from different shuffles.
 *
 * The point is not the play — it is that the game ENDS. Every deadlock this
 * reducer could have (a turn that never moves, a zone nothing can leave, a
 * player who is out but still dealt turns) shows up here as a hang rather than
 * as a wrong answer months later.
 */
test('a dealt game always plays out to one Silly Head', () => {
  for (let attempt = 0; attempt < 12; attempt++) {
    const g = sorting(['A', 'B', 'C', 'D']);
    let state = g.state;
    for (const id of g.ids) state = ok(state, { type: 'sort/done' }, id, g.ctxf).state;
    assert.equal(state.phase, 'playing');

    let moves = 0;
    while (state.phase === 'playing') {
      assert.ok(moves++ < 4000, 'the game should have finished by now');
      const id = state.turnId;
      assert.ok(id, 'somebody must be on turn while the game is being played');

      if (game.zoneOf(state, id) === 'down') {
        const index = state.down[id].findIndex(Boolean);
        state = ok(state, { type: 'play/flip', pileIndex: index }, id, g.ctxf).state;
        continue;
      }
      const playable = game.playableCards(state, id);
      // Once in a while, take a pile you could have beaten.
      //
      // Not padding: two players holding the last low cards with every 2 and 10
      // sacked can hand the same handful back and forth for ever, because a 9
      // on the pile blocks everything above it. It is a real property of the
      // game — the bots have a deliberate way out of it for exactly this reason
      // (see `breakoutChance` in lib/sillyhead/bot.js) and a driver this naive
      // needs one too, or this test hangs about one run in twenty.
      const standoff = !state.stock.length && state.pile.length && moves % 37 === 0;
      if (!playable.length || standoff) {
        state = ok(state, { type: 'play/takePile' }, id, g.ctxf).state;
        continue;
      }
      state = ok(state, { type: 'play/cards', cardIds: [playable[0]] }, id, g.ctxf).state;
    }

    assert.equal(state.phase, 'complete');
    assert.equal(state.finished.length, 3, 'three get out, one does not');
    assert.ok(state.loserId, 'and somebody is the Silly Head');
    assert.ok(!state.finished.includes(state.loserId));
    // Nothing leaks: every card is in somebody's hands, on the table, in the
    // middle, still in the stock, or sacked.
    const held = g.ids.flatMap((id) => [
      ...(state.hands[id] || []),
      ...(state.up[id] || []).flat(),
      ...(state.down[id] || []).filter(Boolean),
    ]);
    assert.equal(held.length + state.pile.length + state.stock.length + state.sacked, state.decks * 52);
  }
});

// ── Games that were saved before today ───────────────────────────────────────

test('a game saved before the card memory existed still works when it comes back', () => {
  // This is not hypothetical. A deploy in the middle of somebody's game brings
  // the room back off disk exactly as it was written, and a state written by
  // yesterday's code has none of today's fields. The first version of the
  // counting crashed every restored Silly Head game: the stream connected, the
  // view threw on the missing field, and the phone sat on a blank front page
  // with no idea why.
  const g = playing(['A', 'B'], {
    hands: { 0: [C('AS'), C('4H')], 1: [C('KD')] },
    pile: [C('7C')],
  });
  const state = g.state;
  // Exactly what an older save looks like: the new fields simply are not there.
  delete state.publicHand;
  delete state.sackedCards;

  assert.doesNotThrow(() => viewFor(state, g.ids[0]), 'the view must survive an older save');
  assert.deepEqual(viewFor(state, g.ids[0]).players[0].knownCards, []);

  // And the game must be playable from there, including the paths that write
  // the new fields for the first time.
  let next = ok(state, { type: 'play/cards', cardIds: [C('AS')] }, g.ids[0], g.ctxf).state;
  next = ok(next, { type: 'play/takePile' }, g.ids[1], g.ctxf).state;
  assert.ok(next.publicHand[g.ids[1]].length, 'and it starts remembering from there on');
  assert.doesNotThrow(() => viewFor(next, g.ids[1]));
});

test('a sack on a game restored without the new fields does not throw', () => {
  const g = playing(['A', 'B'], {
    hands: { 0: [C('10S')], 1: [C('KD')] },
    pile: [C('7C'), C('8C')],
  });
  delete g.state.sackedCards;
  delete g.state.publicHand;
  const state = ok(g.state, { type: 'play/cards', cardIds: [C('10S')] }, g.ids[0], g.ctxf).state;
  assert.deepEqual(state.pile, []);
  assert.equal(state.sackedCards.length, 3, 'and the sacked cards start being written down');
});
