'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  SUITS,
  RANKS,
  DECK_SIZE,
  newDeck,
  parseCard,
  suitOf,
  valueOf,
  shuffle,
  deal,
  maxOnlineHandSize,
  legalPlays,
  lowestPlay,
  isLegalPlay,
  trickWinner,
} = require('../lib/deck');

// ── The deck itself ──────────────────────────────────────────────────────────

test('the deck is exactly 52 distinct cards', () => {
  const deck = newDeck();
  assert.equal(deck.length, 52);
  assert.equal(DECK_SIZE, 52);
  assert.equal(new Set(deck).size, 52);
});

test('every suit holds all thirteen ranks, and there are no jokers', () => {
  const deck = newDeck();
  for (const suit of SUITS) {
    const inSuit = deck.filter((card) => suitOf(card) === suit);
    assert.equal(inSuit.length, 13);
    assert.deepEqual(
      inSuit.map((card) => parseCard(card).rank),
      RANKS
    );
  }
});

test('a fresh deck each call, so one caller cannot disturb another', () => {
  const first = newDeck();
  first[0] = 'TAMPERED';
  assert.equal(newDeck()[0], '2S');
});

test('card ids parse, including the two-character ten', () => {
  assert.deepEqual(parseCard('10H'), { id: '10H', rank: '10', suit: 'H', value: 10, red: true });
  assert.deepEqual(parseCard('AS'), { id: 'AS', rank: 'A', suit: 'S', value: 14, red: false });
  assert.equal(valueOf('2C'), 2);
  assert.equal(valueOf('KD'), 13);
  assert.ok(valueOf('AS') > valueOf('KS'));
});

test('a card id that is not a card is refused rather than half-understood', () => {
  for (const bad of ['1H', 'ZS', 'AX', '', 'H', null, 10]) {
    assert.throws(() => parseCard(bad), /Not a card/);
  }
});

// ── Shuffling ────────────────────────────────────────────────────────────────

test('a shuffle is a permutation, not a loss', () => {
  const deck = newDeck();
  const shuffled = shuffle(deck, 'round-1');
  assert.equal(shuffled.length, 52);
  assert.equal(new Set(shuffled).size, 52);
  assert.deepEqual(shuffled.slice().sort(), deck.slice().sort());
});

test('shuffling leaves the deck it was given alone', () => {
  const deck = newDeck();
  const before = deck.slice();
  shuffle(deck, 42);
  assert.deepEqual(deck, before);
});

test('the same seed reproduces a shuffle exactly', () => {
  assert.deepEqual(shuffle(newDeck(), 'r_3f9c'), shuffle(newDeck(), 'r_3f9c'));
  assert.deepEqual(shuffle(newDeck(), 7), shuffle(newDeck(), 7));
});

test('different seeds do not', () => {
  assert.notDeepEqual(shuffle(newDeck(), 'r_3f9c'), shuffle(newDeck(), 'r_3f9d'));
  assert.notDeepEqual(shuffle(newDeck(), 1), shuffle(newDeck(), 2));
});

test('the shuffle actually moves cards rather than nudging a few', () => {
  const deck = newDeck();
  const shuffled = shuffle(deck, 'move-them');
  const stayed = shuffled.filter((card, i) => card === deck[i]).length;
  assert.ok(stayed < 6, `${stayed} cards never moved`);
});

test('no position is stuck on one card across many seeds', () => {
  const seen = new Set();
  for (let seed = 0; seed < 200; seed++) seen.add(shuffle(newDeck(), seed)[0]);
  assert.ok(seen.size > 30, `only ${seen.size} distinct cards ever led the deck`);
});

// ── Dealing ──────────────────────────────────────────────────────────────────

const FOUR = ['p_ed', 'p_hannah', 'p_sol', 'p_you'];

test('a deal gives everyone their hand size, all distinct', () => {
  const { hands } = deal('r_1', FOUR, 5);
  const all = [];
  for (const id of FOUR) {
    assert.equal(hands[id].length, 5);
    all.push(...hands[id]);
  }
  assert.equal(new Set(all).size, 20, 'a card was dealt twice');
});

test('a deal accounts for every card exactly once across hands, trump and stock', () => {
  const { hands, trumpCard, stock } = deal('r_2', FOUR, 7);
  const all = [...FOUR.flatMap((id) => hands[id]), trumpCard, ...stock];
  assert.equal(all.length, 52);
  assert.equal(new Set(all).size, 52);
  assert.deepEqual(all.slice().sort(), newDeck().sort());
});

test('the turned card sets trumps', () => {
  const { trumpCard, trumpSuit } = deal('r_3', FOUR, 5);
  assert.equal(trumpSuit, suitOf(trumpCard));
});

test('consecutive rounds shuffle independently — nothing carries over', () => {
  const a = deal('r_1', FOUR, 5);
  const b = deal('r_2', FOUR, 5);
  assert.notDeepEqual(a.hands, b.hands);
});

test('the same seed deals the same round again, so a hand can be audited', () => {
  assert.deepEqual(deal('r_9', FOUR, 6), deal('r_9', FOUR, 6));
});

test('a whole-deck deal leaves no card to turn, and that hand is no-trumps', () => {
  const { hands, trumpCard, trumpSuit, stock } = deal('r_full', FOUR, 13);
  assert.equal(trumpCard, null);
  assert.equal(trumpSuit, null);
  assert.deepEqual(stock, []);
  assert.equal(FOUR.flatMap((id) => hands[id]).length, 52);
});

test('a one-card round still has trumps — the deck is barely touched', () => {
  const { trumpSuit, stock } = deal('r_one', FOUR, 1);
  assert.ok(trumpSuit);
  assert.equal(stock.length, 47);
});

test('a deal bigger than the deck is refused, not silently duplicated', () => {
  assert.throws(() => deal('r_x', FOUR, 14), /needs 56 cards/);
  assert.throws(() => deal('r_x', ['a'], 5), /at least two players/);
  assert.throws(() => deal('r_x', FOUR, 0), /at least 1/);
});

test('the online hand-size cap keeps a card back to turn', () => {
  assert.equal(maxOnlineHandSize(4), 12);
  assert.equal(maxOnlineHandSize(5), 10);
  assert.equal(maxOnlineHandSize(7), 7);
  assert.equal(maxOnlineHandSize(10), 5);
  assert.equal(maxOnlineHandSize(17), 3);
  assert.equal(maxOnlineHandSize(0), 0);

  for (const players of [3, 4, 5, 7, 10, 17]) {
    const size = maxOnlineHandSize(players);
    assert.ok(players * size + 1 <= DECK_SIZE, `${players} at ${size} leaves nothing to turn`);
    assert.ok(players * (size + 1) + 1 > DECK_SIZE, `${players} could have taken ${size + 1}`);
  }
});

// ── Following suit ───────────────────────────────────────────────────────────

const HAND = ['9S', 'AS', 'QH', '3D'];

test('leading, every card is legal', () => {
  assert.deepEqual(legalPlays(HAND, null), HAND);
});

test('holding the led suit, only that suit is legal', () => {
  assert.deepEqual(legalPlays(HAND, 'S'), ['9S', 'AS']);
  assert.deepEqual(legalPlays(HAND, 'H'), ['QH']);
});

test('void in the led suit, anything goes', () => {
  assert.deepEqual(legalPlays(HAND, 'C'), HAND);
});

test('a card that would break suit is refused while you can follow', () => {
  assert.equal(isLegalPlay(HAND, '9S', 'S'), true);
  assert.equal(isLegalPlay(HAND, 'QH', 'S'), false);
  assert.equal(isLegalPlay(HAND, 'QH', 'C'), true);
  assert.equal(isLegalPlay(HAND, 'QH', null), true);
});

test('a card you do not hold is never legal', () => {
  assert.equal(isLegalPlay(HAND, '2C', null), false);
  assert.equal(isLegalPlay(HAND, '2C', 'C'), false);
});

// ── Winning a trick ──────────────────────────────────────────────────────────

const play = (playerId, cardId) => ({ playerId, cardId });

test('with no trump played, the highest card of the led suit takes it', () => {
  const plays = [play('a', '7S'), play('b', 'KS'), play('c', '9S'), play('d', '2S')];
  assert.equal(trickWinner(plays, 'S', 'H'), 'b');
});

test('a card of neither suit cannot win, however high', () => {
  const plays = [play('a', '7S'), play('b', 'AD'), play('c', 'AC'), play('d', '9S')];
  assert.equal(trickWinner(plays, 'S', 'H'), 'd');
});

test('any trump beats every card of the led suit', () => {
  const plays = [play('a', 'AS'), play('b', '2H'), play('c', 'KS')];
  assert.equal(trickWinner(plays, 'S', 'H'), 'b');
});

test('trumped and over-trumped, the highest trump takes it', () => {
  const plays = [play('a', 'AS'), play('b', '5H'), play('c', 'JH'), play('d', '9H')];
  assert.equal(trickWinner(plays, 'S', 'H'), 'c');
});

test('the led suit is taken from the first card played when not given', () => {
  const plays = [play('a', '4D'), play('b', 'AC'), play('c', '9D')];
  assert.equal(trickWinner(plays, null, 'S'), 'c');
});

test('leading a trump is just the led suit — highest trump still takes it', () => {
  const plays = [play('a', '4H'), play('b', 'QH'), play('c', 'AS')];
  assert.equal(trickWinner(plays, 'H', 'H'), 'b');
});

test('in a no-trumps hand only the led suit can win', () => {
  const plays = [play('a', '4D'), play('b', 'AH'), play('c', '9D'), play('d', 'AC')];
  assert.equal(trickWinner(plays, 'D', null), 'c');
});

test('a one-card trick is won by whoever played it', () => {
  assert.equal(trickWinner([play('a', '2C')], 'C', 'H'), 'a');
  assert.equal(trickWinner([], 'C', 'H'), null);
});

test('winning does not depend on the order the cards landed in', () => {
  const cards = [play('a', '7S'), play('b', '2H'), play('c', 'KS'), play('d', '9H')];
  const orders = [
    [0, 1, 2, 3],
    [3, 2, 1, 0],
    [2, 0, 3, 1],
  ];
  for (const order of orders) {
    assert.equal(trickWinner(order.map((i) => cards[i]), 'S', 'H'), 'd');
  }
});

test('every card dealt in a round can be walked through a trick', () => {
  const { hands, trumpSuit } = deal('r_walk', FOUR, 3);
  let leader = 0;
  const won = Object.fromEntries(FOUR.map((id) => [id, 0]));

  for (let trick = 0; trick < 3; trick++) {
    const plays = [];
    let ledSuit = null;
    for (let i = 0; i < FOUR.length; i++) {
      const id = FOUR[(leader + i) % FOUR.length];
      const legal = legalPlays(hands[id], ledSuit);
      assert.ok(legal.length, 'a player with cards always has something legal');
      const cardId = legal[0];
      hands[id] = hands[id].filter((c) => c !== cardId);
      if (ledSuit === null) ledSuit = suitOf(cardId);
      plays.push(play(id, cardId));
    }
    const winner = trickWinner(plays, ledSuit, trumpSuit);
    won[winner] += 1;
    leader = FOUR.indexOf(winner);
  }

  assert.equal(Object.values(won).reduce((a, b) => a + b, 0), 3);
  assert.ok(FOUR.every((id) => hands[id].length === 0));
});

// ── Playing for somebody who is not there ────────────────────────────────────

test('the card played for an absent player is their worst legal one', () => {
  // Leading: a plain suit ahead of a trump, lowest rank of what is left.
  assert.equal(lowestPlay(['9S', '2H', 'AS', '4D'], null, 'H'), '4D');
  assert.equal(lowestPlay(['9S', 'AS', '4D'], null, null), '4D');
});

test('it never spends a trump while a plain suit will do', () => {
  assert.equal(lowestPlay(['2H', '9S'], null, 'H'), '9S', 'the nine beats throwing the trump two');
  assert.equal(lowestPlay(['2H', '3H', '9S'], null, 'H'), '9S');
});

test('it still has to follow suit', () => {
  assert.equal(lowestPlay(['9S', '4S', 'AS', '2D'], 'S', 'H'), '4S');
  assert.equal(lowestPlay(['9S', '4S', '2D'], 'D', 'H'), '2D');
});

test('with nothing but trumps, the lowest trump goes', () => {
  assert.equal(lowestPlay(['KH', '2H', '9H'], null, 'H'), '2H');
  assert.equal(lowestPlay(['KH', '2H', '9H'], 'S', 'H'), '2H', 'void in spades, so anything goes');
});

test('an empty hand has nothing to play', () => {
  assert.equal(lowestPlay([], null, 'H'), null);
});
