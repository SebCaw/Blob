'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { ENGINES } = require('../lib/engines');

/**
 * Leaving a game must not break it for the people still playing.
 *
 * A PLATFORM contract, which is why it is checked against every engine rather
 * than against the one that found it. Three of the six were broken when this was
 * written, and each broke in a different costume: Sevens stranded every single
 * game, Chase the Ace most of them, Silly Head deadlocked outright. The common
 * cause was one line - the leaver's hand being deleted - and the only reason the
 * other three survived was that they happened to tip the cards somewhere.
 *
 * `tools/soak.js --leaver` is the wider version of this, playing hundreds of
 * whole games with somebody walking out of each. These are the small, fast
 * assertions that say WHY, and they run on every commit.
 */

function dealt(engineId, seats) {
  const engine = ENGINES[engineId];
  let n = 0;
  const ctx = (actorId) => ({ now: 1_700_000_000_000 + ++n, newId: (p) => `${p}_${engineId}_${n}`, actorId });

  let { state } = engine.createGame(
    { hostName: 'Host', code: '1234', mode: 'online', startHandSize: 5 },
    ctx(null)
  );
  const master = state.masterId;
  for (let i = 1; i < seats; i += 1) {
    const out = engine.applyCommand(state, { type: 'player/addBot', level: 'medium' }, ctx(master));
    assert.equal(out.error, undefined, `${engineId}: could not add a bot`);
    state = out.state;
  }
  const started = engine.applyCommand(state, { type: 'game/start' }, ctx(master));
  assert.equal(started.error, undefined, `${engineId}: could not start`);
  return { engine, state: started.state, master, ctx };
}

/** How many cards the whole table can see, wherever they are sitting. */
function countCards(state) {
  let n = 0;
  const seen = new Set();
  const walk = (value) => {
    if (!value || typeof value !== 'object' || seen.has(value)) return;
    seen.add(value);
    if (Array.isArray(value)) {
      for (const item of value) {
        if (typeof item === 'string') n += 1;
        else walk(item);
      }
      return;
    }
    for (const item of Object.values(value)) walk(item);
  };
  walk({ hands: state.hands, pool: state.pool, pile: state.pile, stock: state.stock });
  return n;
}

// Blob is absent on purpose: it refuses a walkout mid-hand at all, which is its
// own answer to the question and is covered in its own suite.
const SEATS = { sillyhead: 3, sevens: 3, chase: 4, cheat: 3, gofish: 3 };

for (const [id, seats] of Object.entries(SEATS)) {
  test(`${id}: leaving hands the seat to a bot and keeps the cards`, () => {
    const { engine, state, master, ctx } = dealt(id, seats);
    const before = countCards(state);

    const out = engine.applyCommand(state, { type: 'player/remove', playerId: master }, ctx(master));
    assert.equal(out.error, undefined, `${id}: could not leave`);
    const after = out.state;

    const seat = engine.findPlayer(after, master);
    assert.ok(seat, `${id}: the seat vanished from the table`);
    assert.equal(seat.isBot, true, `${id}: nobody took the seat over`);
    assert.equal(seat.handedOver, true, `${id}: nothing says a bot took it`);
    assert.ok(!seat.left, `${id}: marked left, so the turn order will skip it`);
    assert.equal(countCards(after), before, `${id}: cards were lost or duplicated`);
  });

  test(`${id}: the game still finishes after somebody walks out`, () => {
    // The assertion that actually matters. Everything above is the mechanism;
    // this is the thing a person at the table would notice.
    const { engine, state, master, ctx } = dealt(id, seats);
    let s = engine.applyCommand(state, { type: 'player/remove', playerId: master }, ctx(master)).state;

    let commands = 0;
    while (commands < 4000 && s.phase !== 'complete') {
      const owed = engine.bots.owing(s);
      if (!owed) {
        if (typeof engine.deadline === 'function') {
          const due = engine.deadline(s, 1_900_000_000_000);
          if (due) {
            s = engine.applyCommand(s, due.command, ctx(null)).state;
            commands += 1;
            continue;
          }
        }
        break;
      }
      const p = engine.findPlayer(s, owed.playerId);
      const move = engine.bots.move(
        engine.viewFor(s, owed.playerId),
        { seed: p.botSeed || p.id, level: p.botLevel || 'medium' },
        owed
      );
      const step = engine.applyCommand(s, move, ctx(owed.playerId));
      commands += 1;
      if (step.error) continue;
      s = step.state;
    }

    assert.equal(s.phase, 'complete', `${id}: the game never finished (${commands} commands)`);
  });
}

/**
 * The Master coming back.
 *
 * Blob had this rule and the other five did not look at the election at all, so
 * a Master whose phone dipped lost the job in five games out of six. One shared
 * rule now, checked against all of them.
 */
for (const id of Object.keys(ENGINES)) {
  test(`${id}: a Master who reconnects gets the crown back`, () => {
    const engine = ENGINES[id];
    const seats = SEATS[id] || 4;
    const { state, master, ctx } = dealt(id, seats);

    const off = engine.applyCommand(state, { type: 'conn/set', playerId: master, connected: false }, ctx(null));
    assert.equal(off.error, undefined);
    const started = engine.applyCommand(off.state, { type: 'election/start' }, ctx(null));
    // An engine that will not hold an election here has nothing to test.
    if (started.error) return;

    const back = engine.applyCommand(started.state, { type: 'conn/set', playerId: master, connected: true }, ctx(null));
    assert.equal(back.error, undefined);
    assert.equal(back.state.masterId, master, `${id}: the returning Master did not get it back`);
    assert.equal(back.state.election, null, `${id}: the vote was left running`);
  });
}
