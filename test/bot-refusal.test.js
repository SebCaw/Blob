'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { Room } = require('../server/room');
const { ENGINES } = require('../lib/engines');

/**
 * A refused bot move must never leave a table frozen.
 *
 * This is a PLATFORM contract rather than a game rule, which is why it is its
 * own file and why it is checked against every engine that has bots rather than
 * against the one that found it.
 *
 * **The bug it exists for.** `_afterChange` — and with it `_scheduleBotMove` —
 * only runs when a command SUCCEEDS, and `_runBotMove` clears both its timer and
 * `botFor` before dispatching. So a bot whose command the reducer refused left
 * nothing pending and nothing to re-arm from: the seat thought for ever, in
 * silence, and the game stopped. Seb hit it in a real game of Go Fish.
 *
 * **It does not need a broken brain to happen**, which is the part worth
 * understanding. Commands are serialized, so there is a window between a bot
 * deciding and its command being applied, and anything a person does lands in
 * that window. In Go Fish: a bot is about to lay a book, you ask that bot for a
 * rank, your question is applied first, and laying a book while a question is on
 * the table is refused. Perfectly legal play on both sides, one refusal, dead
 * table.
 *
 * `ADDING-A-GAME.md` already warned that a refusal strands a table exactly as a
 * thrown brain does. Nothing enforced it. This does.
 */

/** The least a Room needs to exist. Nothing here is under test. */
function fakeStore() {
  return {
    saveLiveDebounced() {},
    saveHistory: async () => {},
  };
}

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Wait for the table to move, rather than for a fixed number of seconds.
 *
 * Bots pause for as long as their own `thinkMs` says, and Chase the Ace opens
 * with a settle window on top of that - so a flat sleep is either flaky or slow,
 * and this suite would have been both.
 */
async function movesWithin(room, ms) {
  const from = room.state.version;
  const until = Date.now() + ms;
  while (Date.now() < until) {
    if (room.state.version > from) return true;
    await wait(50);
  }
  return false;
}

/**
 * A dealt room whose every seat is a bot, with `bots.move` wrapped.
 *
 * The wrap is what makes this a test rather than a hope: the first move a bot
 * tries is replaced with one the reducer is certain to refuse, so the recovery
 * path is exercised on purpose rather than waited for.
 */
function dealtRoom(gameId, sabotage) {
  const engine = ENGINES[gameId];
  let n = 0;
  const ctx = (actorId) => ({ now: Date.now(), newId: (p) => `${p}_${gameId}_${++n}`, actorId });

  // Blob only deals - and therefore only runs bots - in an online game. Every
  // other engine ignores the extra arguments.
  let { state } = engine.createGame(
    { hostName: 'Host', code: '1234', mode: 'online', startHandSize: 5 },
    ctx(null)
  );
  const master = state.masterId;
  const seats = { gofish: 3, cheat: 3, sevens: 3, chase: 3, sillyhead: 3, blob: 3 }[gameId] || 3;
  for (let i = 0; i < seats; i += 1) {
    const out = engine.applyCommand(state, { type: 'player/addBot', level: 'hard' }, ctx(master));
    assert.equal(out.error, undefined, `${gameId}: could not add a bot`);
    state = out.state;
  }
  // The host plays too, so nothing is ever waiting on a person who is not here.
  state = JSON.parse(JSON.stringify(state));
  const host = state.players.find((p) => p.id === master);
  host.isBot = true;
  host.botSeed = 'seed_host';
  host.botLevel = 'hard';

  const started = engine.applyCommand(state, { type: 'game/start' }, ctx(master));
  assert.equal(started.error, undefined, `${gameId}: could not start`);

  const wrapped = {
    ...engine,
    bots: { ...engine.bots, move: (view, secret, owed) => sabotage(engine.bots.move(view, secret, owed), owed) },
  };

  const room = new Room(started.state, { store: fakeStore() });
  room.engine = wrapped;
  return room;
}

test('a bot whose move is refused does not freeze the table', async () => {
  // One refusal, then honest play. The table must still be moving afterwards.
  let refusalsInjected = 0;
  const room = dealtRoom('gofish', (command) => {
    if (refusalsInjected === 0) {
      refusalsInjected += 1;
      // Certain to be refused: there is no question on the table to answer.
      return { type: 'play/answer' };
    }
    return command;
  });

  room._scheduleBotMove();
  const moved = await movesWithin(room, 8_000);
  room.dispose();

  assert.equal(refusalsInjected, 1, 'the refusal was never injected, so this proved nothing');
  assert.ok(moved, 'the table froze after one refused bot move');
});

test('a bot that is refused every single time gives up rather than looping for ever', async () => {
  // The other half of the contract. A refusal changes nothing, so the same
  // position produces the same command - without a cap this is an infinite loop
  // at whatever pace `thinkMs` returns, which is worse than a stuck table
  // because it also fills the log and burns the CPU.
  let attempts = 0;
  const room = dealtRoom('gofish', () => {
    attempts += 1;
    return { type: 'play/answer' };
  });

  room._scheduleBotMove();
  await wait(6_000);
  room.dispose();

  assert.ok(attempts >= 2, `it did not retry at all (${attempts} attempts)`);
  assert.ok(attempts <= 6, `it kept retrying for ever (${attempts} attempts in six seconds)`);
});

for (const [id, engine] of Object.entries(ENGINES)) {
  if (!engine.bots) continue;
  test(`${id}: the same recovery holds`, async () => {
    let injected = 0;
    const room = dealtRoom(id, (command) => {
      if (injected === 0) {
        injected += 1;
        // Not a command any engine here knows, so every reducer refuses it.
        return { type: 'play/thisIsNotAMove' };
      }
      return command;
    });

    room._scheduleBotMove();
    const moved = await movesWithin(room, 12_000);
    room.dispose();

    assert.equal(injected, 1, `${id}: the refusal was never injected`);
    assert.ok(moved, `${id}: the table froze after one refused bot move`);
  });
}
