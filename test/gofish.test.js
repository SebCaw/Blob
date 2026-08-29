'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const deck = require('../lib/gofish/deck');
const rules = require('../lib/gofish/rules');
const game = require('../lib/gofish/game');
const bot = require('../lib/gofish/bot');
const { viewFor, historyRecord, historySummary } = require('../lib/gofish/view');
const { ENGINES } = require('../lib/engines');

/**
 * Go Fish, driven through the reducer.
 *
 * Sevens, Chase the Ace and Cheat all shipped with no tests of their own and
 * nothing but the cross-engine privacy walk holding them up. This one has some,
 * because the rules here are small enough to state exactly and every one of them
 * is the sort of thing that reads as obviously right and is easy to get subtly
 * wrong: ALL of a rank rather than one, the turn staying put on a hit, a fished
 * card never being announced, and out meaning out.
 *
 * The deal is random by design, so a test that cares which cards are where rigs
 * them afterwards rather than fishing for a seed that happens to suit.
 */

// ── Harness ──────────────────────────────────────────────────────────────────

function ctxFactory(start = 1_000) {
  let n = 0;
  let clock = start;
  return {
    next(actorId) {
      n += 1;
      clock += 1;
      return { now: clock, newId: (p) => `${p}_${n}`, actorId };
    },
  };
}

function ok(state, command, actorId, ctxf) {
  const out = game.applyCommand(state, command, ctxf.next(actorId));
  assert.equal(out.error, undefined, `expected success, got: ${out.error && out.error.message}`);
  return out.state;
}

function refused(state, command, actorId, ctxf) {
  const out = game.applyCommand(state, command, ctxf.next(actorId));
  assert.ok(out.error, 'expected the command to be refused');
  return out.error;
}

/** A lobby with everyone in it. */
function lobby(names) {
  const ctxf = ctxFactory();
  let { state } = game.createGame({ hostName: names[0], code: '1234' }, ctxf.next(null));
  for (const name of names.slice(1)) {
    state = ok(state, { type: 'player/join', name }, null, ctxf);
  }
  return { state, ctxf, masterId: state.players[0].id, ids: state.players.map((p) => p.id) };
}

/** A dealt game. */
function dealt(names = ['Ann', 'Ben', 'Cal', 'Di']) {
  const g = lobby(names);
  g.state = ok(g.state, { type: 'game/start' }, g.masterId, g.ctxf);
  return g;
}

/**
 * Put exactly these cards in these hands, and the rest in the pool.
 *
 * Whoever is named first is put on turn, because nearly every test here is
 * about one specific question being asked.
 */
function rig(g, hands, pool) {
  const state = JSON.parse(JSON.stringify(g.state));
  const used = new Set();
  for (const [id, cards] of Object.entries(hands)) {
    state.hands[id] = deck.sortHand(cards);
    for (const c of cards) used.add(c);
  }
  for (const id of state.players.map((p) => p.id)) {
    if (!hands[id]) state.hands[id] = [];
  }
  state.pool = pool ? pool.slice() : deck.buildDeck().filter((c) => !used.has(c));
  state.turnId = Object.keys(hands)[0];
  state.ask = null;
  state.finished = [];
  g.state = state;
  return g;
}

// ── The deck and the deal ────────────────────────────────────────────────────

test('the deck is one plain pack, no copy tag and no joker', () => {
  const cards = deck.buildDeck();
  assert.equal(cards.length, 52);
  assert.equal(new Set(cards).size, 52);
  assert.ok(!cards.some((c) => c.includes('#')), 'ids must carry no copy tag: there is only one deck');
  assert.equal(deck.rankOf('10H'), '10');
  assert.equal(deck.suitOf('10H'), 'H');
});

test('three players get seven each, four or more get five', () => {
  assert.deepEqual(deck.dealShape(3), { each: 7, dealt: 21, pool: 31 });
  assert.deepEqual(deck.dealShape(4), { each: 5, dealt: 20, pool: 32 });
  assert.deepEqual(deck.dealShape(6), { each: 5, dealt: 30, pool: 22 });
});

test('the deal puts every card either in a hand or in the pool', () => {
  for (const names of [['A', 'B', 'C'], ['A', 'B', 'C', 'D'], ['A', 'B', 'C', 'D', 'E', 'F']]) {
    const g = dealt(names);
    const held = Object.values(g.state.hands).flat();
    const all = held.concat(g.state.pool);
    assert.equal(all.length, 52, `${names.length} players: cards went missing`);
    assert.equal(new Set(all).size, 52, `${names.length} players: a card was dealt twice`);
    assert.equal(held.length, deck.dealShape(names.length).dealt);
  }
});

test('a game needs three players and seats six', () => {
  const three = lobby(['A', 'B']);
  assert.match(refused(three.state, { type: 'game/start' }, three.masterId, three.ctxf).message, /at least 3/);

  const full = lobby(['A', 'B', 'C', 'D', 'E', 'F']);
  assert.match(refused(full.state, { type: 'player/join', name: 'G' }, null, full.ctxf).code, /game-full/);
});

// ── Asking ───────────────────────────────────────────────────────────────────

test('you may only ask for a rank you are already holding', () => {
  const g = dealt();
  const [ann, ben] = g.ids;
  rig(g, { [ann]: ['7S', '7H', '2C'], [ben]: ['7D', 'KS'] });

  assert.match(
    refused(g.state, { type: 'play/ask', targetId: ben, rank: 'K' }, ann, g.ctxf).code,
    /not-held/
  );
  g.state = ok(g.state, { type: 'play/ask', targetId: ben, rank: '7' }, ann, g.ctxf);
  assert.equal(g.state.ask.rank, '7');
});

test('you cannot ask yourself, or somebody who is out', () => {
  const g = dealt();
  const [ann, ben, cal] = g.ids;
  rig(g, { [ann]: ['7S'], [ben]: ['KS'] });
  g.state.finished = [cal];

  assert.match(refused(g.state, { type: 'play/ask', targetId: ann, rank: '7' }, ann, g.ctxf).code, /self-ask/);
  assert.match(refused(g.state, { type: 'play/ask', targetId: cal, rank: '7' }, ann, g.ctxf).code, /target-out/);
});

test('somebody else cannot ask on your turn, and two questions cannot be open at once', () => {
  const g = dealt();
  const [ann, ben] = g.ids;
  rig(g, { [ann]: ['7S'], [ben]: ['7D', 'KS'] });

  assert.match(refused(g.state, { type: 'play/ask', targetId: ann, rank: '7' }, ben, g.ctxf).code, /not-your-turn/);
  g.state = ok(g.state, { type: 'play/ask', targetId: ben, rank: '7' }, ann, g.ctxf);
  assert.match(refused(g.state, { type: 'play/ask', targetId: ben, rank: '7' }, ann, g.ctxf).code, /ask-open/);
});

// ── Answering ────────────────────────────────────────────────────────────────

test('a hit hands over ALL of them and the asker goes again', () => {
  const g = dealt();
  const [ann, ben] = g.ids;
  rig(g, { [ann]: ['7S', '2C'], [ben]: ['7D', '7H', 'KS'] });

  g.state = ok(g.state, { type: 'play/ask', targetId: ben, rank: '7' }, ann, g.ctxf);
  g.state = ok(g.state, { type: 'play/answer' }, ben, g.ctxf);

  assert.deepEqual(g.state.hands[ann].filter((c) => c[0] === '7').sort(), ['7D', '7H', '7S']);
  assert.deepEqual(g.state.hands[ben], ['KS'], 'every seven has to go, not one of them');
  assert.equal(g.state.turnId, ann, 'a hit keeps the turn');
  assert.equal(g.state.ask, null);
});

test('a miss draws one from the pool and ends the turn', () => {
  const g = dealt();
  const [ann, ben] = g.ids;
  rig(g, { [ann]: ['7S'], [ben]: ['KS'] }, ['3D', '4D']);

  g.state = ok(g.state, { type: 'play/ask', targetId: ben, rank: '7' }, ann, g.ctxf);
  g.state = ok(g.state, { type: 'play/answer' }, ben, g.ctxf);

  assert.deepEqual(g.state.hands[ann], deck.sortHand(['7S', '3D']));
  assert.deepEqual(g.state.pool, ['4D']);
  assert.notEqual(g.state.turnId, ann, 'go fish ends your turn');
});

test('with the pool empty, go fish means nothing happens at all', () => {
  const g = dealt();
  const [ann, ben] = g.ids;
  rig(g, { [ann]: ['7S'], [ben]: ['KS'] }, []);

  g.state = ok(g.state, { type: 'play/ask', targetId: ben, rank: '7' }, ann, g.ctxf);
  g.state = ok(g.state, { type: 'play/answer' }, ben, g.ctxf);

  assert.deepEqual(g.state.hands[ann], ['7S']);
  assert.equal(g.state.log.at(-1).drew, false);
  assert.notEqual(g.state.turnId, ann);
});

test('drawing the very card you asked for does NOT buy another go', () => {
  // The house rule that follows from never showing a fished card. Going again
  // would tell the table exactly what came out of the pool.
  const g = dealt();
  const [ann, ben] = g.ids;
  rig(g, { [ann]: ['7S'], [ben]: ['KS'] }, ['7D']);

  g.state = ok(g.state, { type: 'play/ask', targetId: ben, rank: '7' }, ann, g.ctxf);
  g.state = ok(g.state, { type: 'play/answer' }, ben, g.ctxf);

  assert.deepEqual(g.state.hands[ann], deck.sortHand(['7S', '7D']), 'the lucky card is in hand');
  assert.notEqual(g.state.turnId, ann, 'and the turn moved on anyway');
  const said = g.state.log.at(-1);
  assert.equal(said.kind, 'fish');
  assert.ok(!JSON.stringify(said).includes('7D'), 'and nobody was told what it was');
});

test('only the person being asked may answer', () => {
  const g = dealt();
  const [ann, ben, cal] = g.ids;
  rig(g, { [ann]: ['7S'], [ben]: ['7D'] });
  g.state = ok(g.state, { type: 'play/ask', targetId: ben, rank: '7' }, ann, g.ctxf);

  assert.match(refused(g.state, { type: 'play/answer' }, cal, g.ctxf).code, /not-yours/);
  assert.match(refused(g.state, { type: 'play/answer' }, ann, g.ctxf).code, /not-yours/);
});

// ── Books ────────────────────────────────────────────────────────────────────

test('a book is four, laid down by hand, and the rank is what is kept', () => {
  const g = dealt();
  const [ann] = g.ids;
  rig(g, { [ann]: ['7S', '7H', '7D', '7C', 'KS'] });

  assert.match(refused(g.state, { type: 'play/book', rank: 'K' }, ann, g.ctxf).code, /no-book/);
  g.state = ok(g.state, { type: 'play/book', rank: '7' }, ann, g.ctxf);
  assert.deepEqual(g.state.books[ann], ['7']);
  assert.deepEqual(g.state.hands[ann], ['KS']);
  assert.equal(game.booksMade(g.state), 1);
});

test('you must answer a question before you file any paperwork', () => {
  // Worth being precise about what this rule can and cannot do. The obvious
  // dodge - book the sevens so you do not have to hand them over - is already
  // impossible with one deck: holding all four sevens means the asker holds
  // none, and you cannot ask for a rank you are not holding. So what this
  // actually stops is somebody tidying an unrelated book while the table sits
  // waiting on them, and it keeps a genuinely awkward state off the board: an
  // asker who books their last cards mid-question and goes out, leaving a
  // question nobody is waiting on.
  const g = dealt();
  const [ann, ben] = g.ids;
  rig(g, { [ann]: ['7S', '2C'], [ben]: ['7D', 'KH', 'KD', 'KC', 'KS'] });

  g.state = ok(g.state, { type: 'play/ask', targetId: ben, rank: '7' }, ann, g.ctxf);
  assert.match(refused(g.state, { type: 'play/book', rank: 'K' }, ben, g.ctxf).code, /ask-open/);

  g.state = ok(g.state, { type: 'play/answer' }, ben, g.ctxf);
  g.state = ok(g.state, { type: 'play/book', rank: 'K' }, ben, g.ctxf);
  assert.deepEqual(g.state.books[ben], ['K']);
});

test('a book that empties your hand puts you out, books kept', () => {
  const g = dealt();
  const [ann] = g.ids;
  rig(g, { [ann]: ['7S', '7H', '7D', '7C'] });

  g.state = ok(g.state, { type: 'play/book', rank: '7' }, ann, g.ctxf);
  assert.ok(game.isOut(g.state, ann));
  assert.deepEqual(g.state.books[ann], ['7'], 'the book stays yours');
});

// ── Going out and stopping ───────────────────────────────────────────────────

test('handing over your last cards puts you out, pool or no pool', () => {
  const g = dealt(['Ann', 'Ben', 'Cal']);
  const [ann, ben, cal] = g.ids;
  rig(g, { [ann]: ['7S'], [ben]: ['7D', '7H'], [cal]: ['KS', 'QS'] }, ['3D', '4D', '5D']);

  g.state = ok(g.state, { type: 'play/ask', targetId: ben, rank: '7' }, ann, g.ctxf);
  g.state = ok(g.state, { type: 'play/answer' }, ben, g.ctxf);

  assert.ok(game.isOut(g.state, ben), 'out is out even with three cards still in the pool');
  assert.equal(g.state.pool.length, 3, 'and they do not draw back in');
});

test('it stops when there is nobody left to ask', () => {
  const g = dealt(['Ann', 'Ben', 'Cal']);
  const [ann, ben, cal] = g.ids;
  rig(g, { [ann]: ['7S'], [ben]: ['7D'], [cal]: [] }, ['3D']);
  g.state.finished = [cal];
  g.state.books[ann] = ['K'];

  g.state = ok(g.state, { type: 'play/ask', targetId: ben, rank: '7' }, ann, g.ctxf);
  g.state = ok(g.state, { type: 'play/answer' }, ben, g.ctxf);

  assert.equal(g.state.phase, 'complete', 'one hand left at the table cannot ask anybody');
  assert.deepEqual(g.state.winnerIds, [ann]);
});

test('thirteen books ends it', () => {
  const g = dealt();
  const [ann, ben] = g.ids;
  rig(g, { [ann]: ['7S', '7H', '7D', '7C'], [ben]: ['KS'] });
  g.state.books[ann] = deck.RANKS.filter((r) => r !== '7').slice(0, 12);

  g.state = ok(g.state, { type: 'play/book', rank: '7' }, ann, g.ctxf);
  assert.equal(game.booksMade(g.state), 13);
  assert.equal(g.state.phase, 'complete');
});

test('most books wins, and level is a shared win', () => {
  const g = dealt();
  const [ann, ben, cal] = g.ids;
  rig(g, { [ann]: ['7S'], [ben]: ['7D'] });
  g.state.books[ann] = ['K', 'Q'];
  g.state.books[ben] = ['J', '9'];
  g.state.books[cal] = ['3'];
  // Everybody but the two of them is already out, so Ben going out ends it.
  g.state.finished = [cal, g.ids[3]];

  g.state = ok(g.state, { type: 'play/ask', targetId: ben, rank: '7' }, ann, g.ctxf);
  g.state = ok(g.state, { type: 'play/answer' }, ben, g.ctxf);
  assert.equal(g.state.phase, 'complete');
  assert.deepEqual(g.state.winnerIds.slice().sort(), [ann, ben].sort());
});

test('the barren backstop stops a table that has nothing left to do', () => {
  // Three sevens against three eights with an empty pool: every question misses
  // and the position never changes. It should be rare and it has to terminate.
  const g = dealt(['Ann', 'Ben', 'Cal']);
  const [ann, ben, cal] = g.ids;
  rig(g, { [ann]: ['7S', '7H', '7D'], [ben]: ['8S', '8H', '8D'], [cal]: [] }, []);
  g.state.finished = [cal];

  for (let turn = 0; turn < 12 && g.state.phase === 'playing'; turn += 1) {
    const asker = g.state.turnId;
    const rank = g.state.hands[asker][0][0];
    const other = asker === ann ? ben : ann;
    g.state = ok(g.state, { type: 'play/ask', targetId: other, rank }, asker, g.ctxf);
    g.state = ok(g.state, { type: 'play/answer' }, other, g.ctxf);
  }
  assert.equal(g.state.phase, 'complete');
  assert.ok(g.state.stoppedBarren, 'and it says why it stopped');
});

test('leaving mid-game hands your seat to a bot, cards and all', () => {
  // This used to tip the hand back into the pool. That kept the deck whole and
  // was still the wrong answer - a hand reappearing in the pool changes the odds
  // for everybody left - and the same idea in Sevens and Chase deleted the cards
  // outright and stranded the game for ever. See `lib/handover.js`.
  const g = dealt();
  const [, ben] = g.ids;
  const held = g.state.hands[ben].slice();
  const pool = g.state.pool.length;

  g.state = ok(g.state, { type: 'player/remove', playerId: ben }, ben, g.ctxf);

  const seat = g.state.players.find((p) => p.id === ben);
  assert.ok(seat.isBot, 'a bot is playing the seat now');
  assert.ok(seat.handedOver, 'flagged, so the screens can say so');
  assert.ok(!seat.left, 'NOT left: a left seat is skipped by the turn order');
  assert.equal(g.state.pool.length, pool, 'nothing was tipped into the pool');
  assert.deepEqual(g.state.hands[ben], held, 'and the hand is untouched');
});

// ── What anybody may see ─────────────────────────────────────────────────────

test('the log never contains a card id', () => {
  // Not a privacy assertion so much as a design one: the log is what the room
  // HEARD, and the room hears a rank and a count.
  const g = dealt();
  let state = g.state;
  const E = ENGINES.gofish;
  for (const p of state.players) {
    p.isBot = true;
    p.botSeed = `seed_${p.id}`;
    p.botLevel = 'hard';
  }
  let steps = 0;
  while (state.phase !== 'complete' && steps < 900) {
    steps += 1;
    const owed = E.bots.owing(state);
    if (!owed) break;
    const player = game.findPlayer(state, owed.playerId);
    const command = E.bots.move(viewFor(state, player.id), { seed: player.botSeed, level: 'hard' }, owed);
    const out = game.applyCommand(state, command, g.ctxf.next(player.id));
    assert.equal(out.error, undefined, `${command.type}: ${out.error && out.error.message}`);
    state = out.state;
    const written = JSON.stringify(state.log);
    for (const card of deck.buildDeck()) {
      assert.ok(!written.includes(`"${card}"`), `${card} was written into the log`);
    }
  }
  assert.ok(steps > 20, 'the game barely moved, so this proved very little');
});

test('only the person being asked is told what the answer is', () => {
  const g = dealt();
  const [ann, ben, cal] = g.ids;
  rig(g, { [ann]: ['7S'], [ben]: ['7D', '7H'] });
  g.state = ok(g.state, { type: 'play/ask', targetId: ben, rank: '7' }, ann, g.ctxf);

  assert.equal(viewFor(g.state, ben).you.answering.handing, 2, 'they need to know before they press it');
  assert.equal(viewFor(g.state, ann).you.answering, null, 'the asker finds out when everybody does');
  assert.equal(viewFor(g.state, cal).you.answering, null);
  assert.equal(viewFor(g.state, null).ask.rank, '7', 'the question itself is public');
});

test('the view publishes the rule rather than letting the phone decide it', () => {
  const g = dealt();
  const [ann, ben] = g.ids;
  rig(g, { [ann]: ['7S', '7H', 'KD'], [ben]: ['2C'] });
  const you = viewFor(g.state, ann).you;
  assert.deepEqual(you.askable, ['7', 'K']);
  assert.ok(you.canAsk.includes(ben));
  assert.ok(!you.canAsk.includes(ann));
});

test('a book waiting in your hand is offered to you and to nobody else', () => {
  const g = dealt();
  const [ann, ben] = g.ids;
  rig(g, { [ann]: ['7S', '7H', '7D', '7C'], [ben]: ['2C'] });
  assert.deepEqual(viewFor(g.state, ann).you.ready, ['7']);
  assert.deepEqual(viewFor(g.state, ben).you.ready, []);
});

// ── Rules module ─────────────────────────────────────────────────────────────

test('the rules module knows what a hand may do', () => {
  const hand = ['2S', '7S', '7H', '7D', '7C', 'KD'];
  assert.deepEqual(rules.askableRanks(hand), ['2', '7', 'K']);
  assert.deepEqual(rules.completeBooks(hand), ['7']);
  assert.equal(rules.canAsk(hand, '7'), true);
  assert.equal(rules.canAsk(hand, 'A'), false);
  assert.deepEqual(rules.cardsOfRank(hand, '7'), ['7S', '7H', '7D', '7C']);
});

// ── The bots ─────────────────────────────────────────────────────────────────

test('a bot reads the table from the log and nothing else', () => {
  const view = {
    log: [
      { kind: 'ask', askerId: 'a', targetId: 'b', rank: '7' },
      { kind: 'give', askerId: 'a', targetId: 'b', rank: '7', count: 2 },
      { kind: 'ask', askerId: 'a', targetId: 'c', rank: 'K' },
      { kind: 'fish', askerId: 'a', targetId: 'c', rank: 'K', drew: true },
      { kind: 'book', playerId: 'a', rank: '7' },
    ],
  };
  const table = bot.readTable(view, Infinity);
  assert.equal(table.known.a['7'], 0, 'a booked the sevens, so nobody has one');
  assert.equal(table.known.b['7'], 0, 'b handed all of theirs over');
  assert.equal(table.known.c.K, 0, 'c said go fish to kings');
  assert.equal(table.drew.a, 1);
  assert.ok(table.booked.has('7'));
});

test('a bot counts, so three known sevens plus your one is a book', () => {
  const view = {
    log: [
      { kind: 'ask', askerId: 'b', targetId: 'c', rank: '7' },
      { kind: 'give', askerId: 'b', targetId: 'c', rank: '7', count: 2 },
    ],
  };
  assert.equal(bot.readTable(view, Infinity).known.b['7'], 3, 'one to ask with, plus the two handed over');
});

test('the top level asks the question that finishes a book', () => {
  const view = {
    version: 4,
    you: { id: 'me', hand: ['7S', 'KD'], askable: ['7', 'K'], canAsk: ['b', 'c'] },
    log: [
      { kind: 'ask', askerId: 'b', targetId: 'c', rank: '7' },
      { kind: 'give', askerId: 'b', targetId: 'c', rank: '7', count: 2 },
      { kind: 'ask', askerId: 'c', targetId: 'b', rank: 'K' },
    ],
  };
  const move = bot.chooseMove(view, { seed: 'x', level: 'impossible' }, { kind: 'ask' });
  assert.deepEqual(
    { rank: move.rank, targetId: move.targetId },
    { rank: '7', targetId: 'b' },
    'b is sitting on three sevens and that is the whole game'
  );
});

test('every level answers, because answering is not a decision', () => {
  for (const level of bot.BOT_LEVELS) {
    const move = bot.chooseMove({ you: { hand: [] } }, { seed: 's', level }, { kind: 'answer' });
    assert.deepEqual(move, { type: 'play/answer' });
  }
});

test('a bot never sees a hand but its own, and never the pool', () => {
  const g = dealt();
  const [ann, ben] = g.ids;
  const view = viewFor(g.state, ann);
  const payload = JSON.stringify(view);
  for (const card of g.state.hands[ben]) {
    assert.ok(!payload.includes(`"${card}"`), `${card} reached the wrong player`);
  }
  for (const card of g.state.pool) {
    assert.ok(!payload.includes(`"${card}"`), `${card} was read out of the pool`);
  }
});

test('the ladder is the right way up', () => {
  // Cheat's ladder came out perfectly inverted twice and neither time was it
  // visible without measuring, so this is here rather than in a scratch file.
  // The numbers in GO-FISH.md come from a much longer run of the same thing.
  const E = ENGINES.gofish;
  const wins = { easy: 0, medium: 0, hard: 0, impossible: 0 };
  const GAMES = 120;

  for (let n = 0; n < GAMES; n += 1) {
    const ctxf = ctxFactory(1_000 + n * 10_000);
    let { state } = E.createGame({ hostName: 'Host', code: '1234' }, ctxf.next(null));
    const master = state.masterId;
    for (const level of ['medium', 'hard', 'impossible']) {
      state = E.applyCommand(state, { type: 'player/addBot', level }, ctxf.next(master)).state;
    }
    state = JSON.parse(JSON.stringify(state));
    const host = state.players.find((p) => p.id === master);
    host.isBot = true;
    host.botSeed = `seed_host_${n}`;
    host.botLevel = 'easy';
    state = E.applyCommand(state, { type: 'game/start' }, ctxf.next(master)).state;

    let steps = 0;
    while (state.phase !== 'complete' && steps < 1_500) {
      steps += 1;
      const owed = E.bots.owing(state);
      if (!owed) break;
      const p = E.findPlayer(state, owed.playerId);
      const cmd = E.bots.move(E.viewFor(state, p.id), { seed: p.botSeed, level: p.botLevel }, owed);
      const out = E.applyCommand(state, cmd, ctxf.next(p.id));
      assert.equal(out.error, undefined, `${cmd.type}: ${out.error && out.error.message}`);
      state = out.state;
    }
    assert.equal(state.phase, 'complete', `game ${n} never finished`);
    for (const id of state.winnerIds || []) {
      const p = state.players.find((x) => x.id === id);
      wins[p.botLevel] += 1 / state.winnerIds.length;
    }
  }

  const share = (level) => wins[level] / GAMES;
  assert.ok(share('medium') > share('easy'), `medium ${share('medium')} did not beat easy ${share('easy')}`);
  assert.ok(share('hard') > share('medium'), `hard ${share('hard')} did not beat medium ${share('medium')}`);
  assert.ok(
    share('impossible') > share('hard') * 0.9,
    `impossible ${share('impossible')} fell well behind hard ${share('hard')}`
  );
  assert.ok(share('easy') < 0.12, `easy won ${share('easy')} of a four-handed table, which is not easy`);
});

// ── The record ───────────────────────────────────────────────────────────────

test('a finished game writes a record the history list can read', () => {
  const g = dealt();
  const [ann, ben] = g.ids;
  rig(g, { [ann]: ['7S'], [ben]: ['7D'] });
  g.state.books[ann] = ['K', 'Q', 'J'];
  g.state.books[ben] = ['9'];
  g.state.finished = [g.ids[2], g.ids[3]];

  g.state = ok(g.state, { type: 'play/ask', targetId: ben, rank: '7' }, ann, g.ctxf);
  g.state = ok(g.state, { type: 'play/answer' }, ben, g.ctxf);
  assert.equal(g.state.phase, 'complete');

  const record = historyRecord(g.state);
  assert.equal(record.game, 'gofish');
  assert.deepEqual(record.winners, ['Ann']);
  const line = historySummary(record);
  assert.equal(line.game, 'gofish');
  assert.deepEqual(line.winners, ['Ann']);
  assert.match(line.detail, /3 books to Ann/);
  assert.ok(!JSON.stringify(record).includes('"7S"'), 'a record is not a place to put somebody hand');
});
