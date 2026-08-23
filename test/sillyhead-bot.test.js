'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const game = require('../lib/sillyhead/game');
const bot = require('../lib/sillyhead/bot');
const { viewFor } = require('../lib/sillyhead/view');
const { engineFor } = require('../lib/engines');

/**
 * The Silly Head bots.
 *
 * Two things are asserted hard and one is only measured.
 *
 * Hard: a bot never proposes an illegal move, and a bot never sees anything a
 * phone would not. Those are correctness and they are not allowed to wobble.
 *
 * Measured: that the levels actually separate. Bot strength is noisy — a bad
 * deal beats good play often enough that a strict assertion would fail on
 * Tuesdays — so the ordering is checked over enough games to mean something and
 * with enough slack to survive luck.
 */

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

/** A lobby of bots at the given levels, with one human Master who never plays. */
function botLobby(levels) {
  const ctxf = ctxFactory();
  let { state } = game.createGame({ hostName: 'Host', code: '1234' }, ctxf.next(null));
  const masterId = state.players[0].id;
  for (const level of levels) {
    state = ok(state, { type: 'player/addBot', level }, masterId, ctxf).state;
  }
  return { state, ctxf, masterId };
}

const secretFor = (player) => ({ seed: player.botSeed || player.id, level: player.botLevel || 'medium' });

/**
 * A dealt game with exactly the cards a test wants, mid-play.
 *
 * The deal is random by design, so a test about counting rigs the table rather
 * than fishing for a seed that happens to suit.
 */
function playing2(names, setup = {}) {
  const ctxf = ctxFactory();
  let { state } = game.createGame({ hostName: names[0], code: '1234' }, ctxf.next(null));
  for (const name of names.slice(1)) state = ok(state, { type: 'player/join', name }, null, ctxf).state;
  const ids = state.players.map((p) => p.id);
  state = ok(state, { type: 'game/start' }, ids[0], ctxf).state;
  ids.forEach((id, seat) => {
    const filler = (rank, suit) => `${rank}${suit}#${90 + seat}`;
    state.hands[id] = ((setup.hands || {})[seat] || [filler('7', 'S')]).slice();
    state.up[id] = ((setup.up || {})[seat] || [filler('8', 'S'), filler('8', 'H'), filler('8', 'D')]).map((c) => [c]);
    state.down[id] = ((setup.down || {})[seat] || [filler('9', 'S'), filler('9', 'H'), filler('9', 'D')]).slice();
    state.sortDone[id] = true;
  });
  state.stock = (setup.stock || []).slice();
  state.pile = (setup.pile || []).slice();
  state.sackedCards = [];
  state.publicHand = {};
  state.phase = 'playing';
  state.turnId = ids[setup.turn || 0];
  return { state, ctxf, ids };
}

/**
 * Play a whole game with every seat driven by a brain.
 *
 * Deliberately routed through the engine the server uses rather than calling
 * the brain directly — so this exercises the same `owing` / `move` pair that
 * `server/room.js` does, and a scheduling mistake shows up here too.
 */
function playOut(levels, { maxMoves = 6000 } = {}) {
  const g = botLobby(levels);
  const engine = engineFor(g.state);
  let state = ok(g.state, { type: 'game/start' }, g.masterId, g.ctxf).state;

  // The Master is a human who is not playing, so they are the only seat that
  // has to be told to finish sorting.
  let moves = 0;
  while (state.phase === 'sort' || state.phase === 'playing') {
    assert.ok(moves++ < maxMoves, `the game should have finished by now (phase ${state.phase})`);
    const owed = engine.bots.owing(state);
    if (!owed) {
      if (state.phase === 'sort') {
        state = ok(state, { type: 'sort/done' }, g.masterId, g.ctxf).state;
        continue;
      }
      // A human's turn in a game that is meant to be all bots: play the first
      // legal thing so the table keeps moving.
      const id = state.turnId;
      if (game.zoneOf(state, id) === 'down') {
        state = ok(state, { type: 'play/flip', pileIndex: state.down[id].findIndex(Boolean) }, id, g.ctxf).state;
        continue;
      }
      const playable = game.playableCards(state, id);
      state = playable.length
        ? ok(state, { type: 'play/cards', cardIds: [playable[0]] }, id, g.ctxf).state
        : ok(state, { type: 'play/takePile' }, id, g.ctxf).state;
      continue;
    }

    const player = game.findPlayer(state, owed.playerId);
    const view = viewFor(state, owed.playerId);
    const command = engine.bots.move(view, secretFor(player), owed);
    const out = game.applyCommand(state, command, g.ctxf.next(owed.playerId));
    assert.equal(
      out.error,
      undefined,
      `a bot proposed something illegal: ${JSON.stringify(command)} -> ${out.error && out.error.message}`
    );
    state = out.state;
  }
  return { state, players: state.players };
}

// ── Legality ─────────────────────────────────────────────────────────────────

test('a table of bots always finishes, and never proposes an illegal move', () => {
  for (let attempt = 0; attempt < 8; attempt++) {
    const { state } = playOut(['easy', 'medium', 'hard', 'impossible']);
    assert.equal(state.phase, 'complete');
    assert.ok(state.loserId, 'somebody is the Silly Head');
    assert.equal(state.finished.length, 4, 'four of the five seats get out');
  }
});

test('two bots on their own finish too', () => {
  const { state } = playOut(['medium']);
  assert.equal(state.phase, 'complete');
});

test('bots sort themselves and the game starts without anybody being asked twice', () => {
  const g = botLobby(['hard', 'hard']);
  const engine = engineFor(g.state);
  let state = ok(g.state, { type: 'game/start' }, g.masterId, g.ctxf).state;
  let steps = 0;
  while (engine.bots.owing(state)) {
    assert.ok(steps++ < 200, 'a bot is stuck in the sort');
    const owed = engine.bots.owing(state);
    const player = game.findPlayer(state, owed.playerId);
    const command = engine.bots.move(viewFor(state, owed.playerId), secretFor(player), owed);
    state = ok(state, command, owed.playerId, g.ctxf).state;
  }
  for (const player of state.players.filter((p) => p.isBot)) {
    assert.equal(state.sortDone[player.id], true);
    assert.deepEqual(state.up[player.id].map((s) => s.length), [1, 1, 1], 'every pair came back off');
    assert.ok(state.hands[player.id].length >= 3);
  }
});

test('a bot never drains the deck during the sort', () => {
  const g = botLobby(['impossible', 'impossible', 'impossible']);
  const engine = engineFor(g.state);
  let state = ok(g.state, { type: 'game/start' }, g.masterId, g.ctxf).state;
  const before = state.stock.length;
  let steps = 0;
  while (engine.bots.owing(state)) {
    assert.ok(steps++ < 300, 'a bot is stuck in the sort');
    const owed = engine.bots.owing(state);
    const player = game.findPlayer(state, owed.playerId);
    state = ok(state, engine.bots.move(viewFor(state, owed.playerId), secretFor(player), owed), owed.playerId, g.ctxf).state;
  }
  // Three bots, and a stack is capped at a pair, so at most a handful of extra
  // cards each. A bot that kept matching would empty the stock into its hand.
  assert.ok(before - state.stock.length < 30, `the sort took ${before - state.stock.length} cards out of the deck`);
});

// ── A bot is a client too ────────────────────────────────────────────────────

test('a bot seat is public, and its private seed never is', () => {
  const g = botLobby(['impossible']);
  const state = g.state;
  const seat = state.players.find((p) => p.isBot);
  assert.ok(seat.botSeed, 'the seed exists on the server');

  for (const viewerId of [g.masterId, seat.id, null]) {
    const payload = JSON.stringify(viewFor(state, viewerId));
    assert.ok(!payload.includes(seat.botSeed), 'the seed must never leave the server');
  }
  const view = viewFor(state, g.masterId);
  const shown = view.players.find((p) => p.id === seat.id);
  assert.equal(shown.isBot, true, 'that a seat is a bot is public');
  assert.equal(shown.botLevel, 'impossible', 'and so is the level, because you chose it');
});

test('a bot cannot be Master, and is never voted for', () => {
  const g = botLobby(['medium', 'medium']);
  assert.deepEqual(game.eligibleForMaster(g.state), []);
  assert.equal(g.state.masterId, g.masterId);
});

test('a bot has no phone to lose', () => {
  const g = botLobby(['medium']);
  const seat = g.state.players.find((p) => p.isBot);
  const state = ok(g.state, { type: 'conn/set', playerId: seat.id, connected: false }, null, g.ctxf).state;
  assert.equal(state.players.find((p) => p.id === seat.id).connected, true);
  const engine = engineFor(state);
  assert.equal(engine.stallWatch(state), null);
});

test('bots can only be seated in the lobby, and only by the Master', () => {
  const g = botLobby(['medium']);
  const notMaster = g.state.players.find((p) => p.isBot).id;
  const err = game.applyCommand(g.state, { type: 'player/addBot' }, g.ctxf.next(notMaster)).error;
  assert.equal(err.code, 'not-master');
  const started = ok(g.state, { type: 'game/start' }, g.masterId, g.ctxf).state;
  const late = game.applyCommand(started, { type: 'player/addBot' }, g.ctxf.next(g.masterId)).error;
  assert.ok(late);
});

// ── Counting the cards ───────────────────────────────────────────────────────

test('the counter works out exactly what is left, from public cards only', () => {
  const g = playing2(['A', 'B'], {
    hands: { 0: ['AS#1', '4H#1'], 1: ['KD#1', 'KD#2', '2C#1'] },
    up: { 0: ['9S#1', '9H#1', '9D#1'], 1: ['3S#1', '3H#1', '3D#1'] },
    pile: ['7C#1', '7D#1'],
  });
  const view = viewFor(g.state, g.ids[0]);
  const { unseen } = bot.countCards(view);

  // Two decks: eight of every rank. Struck off: my two, everybody's face-ups,
  // and the pile.
  assert.equal(unseen['A'], 7, 'my own ace is accounted for');
  assert.equal(unseen['9'], 5, 'my three 9s are face up for all to see');
  assert.equal(unseen['3'], 5, 'and so are theirs');
  assert.equal(unseen['7'], 6, 'two 7s are in the pile, where everybody watched them land');
  // Their hand is NOT public, so it is still counted as unseen.
  assert.equal(unseen['K'], 8, 'nobody saw those kings arrive');
  assert.equal(unseen['2'], 8);
});

test('the counter never reads a card the payload did not carry', () => {
  const g = playing2(['A', 'B'], {
    hands: { 0: ['AS#1'], 1: ['KD#1', 'KD#2'] },
    pile: [],
  });
  const view = viewFor(g.state, g.ids[0]);
  const before = JSON.stringify(bot.countCards(view));

  // Change what the OTHER player is holding without telling anybody. A counter
  // that reads state rather than the view would notice; this one cannot.
  g.state.hands[g.ids[1]] = ['3C#1', '3C#2'];
  const after = JSON.stringify(bot.countCards(viewFor(g.state, g.ids[0])));
  assert.equal(before, after, 'a hidden hand changing must be invisible to the count');
});

test('a card the room watched somebody take is one the counter knows they hold', () => {
  const g = playing2(['A', 'B'], {
    hands: { 0: ['4S#1'], 1: ['5H#1'] },
    pile: ['AS#1', 'AH#1'],
  });
  // B is stuck on two aces and takes them in front of everybody.
  const state = ok(g.state, { type: 'play/takePile' }, g.ids[0], g.ctxf).state;
  const view = viewFor(state, g.ids[1]);
  const count = bot.countCards(view);

  // They hold an ace for certain, so nothing beats leaving a king on top: the
  // answer must be a flat 1, not a guess.
  assert.equal(bot.chanceTheyFollow(view, 'K', count), 1);
});

// ── Do the levels actually separate? ─────────────────────────────────────────

test('a bot only ever plays what the view says it may', () => {
  // Not a strength test — a direct check that the brain reads `playable` and
  // nothing else. Every card it ever names has to be in that list.
  const g = botLobby(['easy', 'hard']);
  const engine = engineFor(g.state);
  let state = ok(g.state, { type: 'game/start' }, g.masterId, g.ctxf).state;
  while (state.phase === 'sort') {
    const owed = engine.bots.owing(state);
    if (!owed) {
      state = ok(state, { type: 'sort/done' }, g.masterId, g.ctxf).state;
      continue;
    }
    const player = game.findPlayer(state, owed.playerId);
    state = ok(state, engine.bots.move(viewFor(state, owed.playerId), secretFor(player), owed), owed.playerId, g.ctxf).state;
  }

  let checked = 0;
  let guard = 0;
  while (state.phase === 'playing' && guard++ < 3000) {
    const owed = engine.bots.owing(state);
    const actorId = owed ? owed.playerId : state.turnId;
    const player = game.findPlayer(state, actorId);
    const view = viewFor(state, actorId);
    let command;
    if (owed) {
      command = engine.bots.move(view, secretFor(player), owed);
      if (command.type === 'play/cards') {
        for (const card of command.cardIds) {
          assert.ok(view.you.playable.includes(card), `${card} was not in this bot's playable list`);
        }
        checked += 1;
      }
    } else if (game.zoneOf(state, actorId) === 'down') {
      command = { type: 'play/flip', pileIndex: state.down[actorId].findIndex(Boolean) };
    } else {
      const playable = game.playableCards(state, actorId);
      command = playable.length ? { type: 'play/cards', cardIds: [playable[0]] } : { type: 'play/takePile' };
    }
    state = ok(state, command, actorId, g.ctxf).state;
  }
  assert.ok(checked > 5, 'the bots should have played a good few cards');
});

/**
 * Two bots, head to head, and nobody else.
 *
 * Measured this way rather than in a five-way game because the variance is far
 * lower: exactly one of the two loses every time, so a few hundred games say
 * something. In a table of five, luck of the deal swamps the difference and
 * three hundred games still cannot tell medium from impossible.
 */
function duel(a, b, ctxf) {
  let { state } = game.createGame({ hostName: 'Host', code: '1234' }, ctxf.next(null));
  const host = state.players[0].id;
  state = ok(state, { type: 'player/addBot', level: a }, host, ctxf).state;
  state = ok(state, { type: 'player/addBot', level: b }, host, ctxf).state;
  state = ok(state, { type: 'player/remove', playerId: host }, host, ctxf).state;
  state.masterId = state.players[0].id;
  state = ok(state, { type: 'game/start' }, state.masterId, ctxf).state;

  const engine = engineFor(state);
  let moves = 0;
  while (state.phase === 'sort' || state.phase === 'playing') {
    assert.ok(moves++ < 20000, 'a two-bot game should not run for ever');
    const owed = engine.bots.owing(state);
    assert.ok(owed, 'with only bots at the table, somebody always owes a move');
    const player = game.findPlayer(state, owed.playerId);
    const command = engine.bots.move(viewFor(state, owed.playerId), secretFor(player), owed);
    state = ok(state, command, owed.playerId, ctxf).state;
  }
  const loser = state.players.find((p) => p.id === state.loserId);
  return loser ? loser.botLevel : null;
}

test('the levels are a ladder: every rung beats the one below it', () => {
  const ctxf = ctxFactory();
  // Only the two rungs wide enough to prove in a reasonable number of games.
  // Measured over several thousand duels while tuning: easy loses to medium
  // about 79% of the time and medium to hard about 60%, so both of these clear
  // half by a distance that survives a bad afternoon.
  //
  // Hard against impossible is about 56%, and that is NOT assertable here: at
  // fifty-six percent you would need over a thousand duels to tell it from a
  // coin, and a test that runs a thousand games to fail one time in six is
  // worse than no test. It is pinned structurally instead, below.
  //
  // The counts are chosen so the assertion is safe, not so the test is quick.
  // Easy against medium is 79%, which is never in doubt at sixty games. Medium
  // against hard is 60%, and at a hundred games that is only two standard
  // deviations clear of half — it failed about one run in ten, which is a test
  // that cries wolf. Two hundred puts it near three, which is a test.
  const rungs = [
    ['easy', 'medium', 60],
    ['medium', 'hard', 200],
  ];
  for (const [lower, higher, games] of rungs) {
    let lowerLost = 0;
    for (let i = 0; i < games; i++) {
      if (duel(lower, higher, ctxf) === lower) lowerLost += 1;
    }
    assert.ok(
      lowerLost > games / 2,
      `${lower} lost only ${lowerLost} of ${games} against ${higher} — the ladder is upside down`
    );
  }
});

test('impossible is the one that never slips, and the slips are ordered', () => {
  // What actually separates the top of the ladder, asserted directly rather
  // than measured: the same policy, followed less reliably the further down you
  // go. This is deterministic, so it cannot flake — and if somebody reorders
  // the levels it fails immediately rather than in one run out of four.
  const slips = ['easy', 'medium', 'hard', 'impossible'].map((level) => bot.SLIP[level]);
  assert.equal(slips[3], 0, 'impossible always plays its own best answer');
  for (let i = 1; i < slips.length; i++) {
    assert.ok(slips[i] < slips[i - 1], 'each level up should slip less often than the one below');
  }
});
