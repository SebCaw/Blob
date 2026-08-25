'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { ENGINES } = require('../lib/engines');
const blobGame = require('../lib/game');

/**
 * The privacy boundary, checked across EVERY game at once.
 *
 * Invariant 2 says a value a player is not allowed to see must be absent from
 * the payload, not merely hidden by the UI. Until this file existed, every game
 * proved that with its own hand-written assertions — which meant a NEW game
 * proved it with none at all, and nothing went red to point that out. Sevens and
 * Chase the Ace both shipped that way.
 *
 * So this walks `ENGINES` rather than naming a game. Two things follow from
 * that, and the second is the point:
 *
 *   1. Every game gets the same check, written once.
 *   2. **A game with no fixture below FAILS.** Not skipped, not quietly passed —
 *      failed, by name, with a message saying what to add. That is the whole
 *      reason for the coverage test at the top: it turns "somebody has to
 *      remember" into "you cannot forget", which is the difference between the
 *      boundary being an invariant and being a habit.
 *
 * The assertion is deliberately the paranoid form. It works on the SERIALISED
 * payload, because a card can hide in a field nobody thought to look at, and it
 * builds its needles from the authoritative STATE rather than from the view —
 * take them from the view and they are already gone, so `includes` is vacuously
 * true and the test passes for the wrong reason.
 */

// ── Harness ──────────────────────────────────────────────────────────────────

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

/**
 * What each game hides, and from whom.
 *
 * `hiddenFrom(state, viewerId)` returns the cards THIS viewer must not be told
 * about. Both directions matter: usually it is everybody else's hand, but Blob's
 * forehead round inverts it — there the one card you may not see is your own,
 * and everybody else's is public.
 */
const FIXTURES = {
  blob: {
    create: { startHandSize: 3, mode: 'online' },
    seats: 4,
    hiddenFrom(state, viewerId) {
      const round = blobGame.currentRound(state);
      if (!round || !round.hands) return [];
      // One card each: you can see theirs and not your own.
      if (round.handSize === 1) return (round.hands[viewerId] || []).slice();
      return Object.entries(round.hands)
        .filter(([id]) => id !== viewerId)
        .flatMap(([, hand]) => hand);
    },
  },

  sillyhead: {
    create: {},
    seats: 4,
    hiddenFrom(state, viewerId) {
      if (!state.hands) return [];
      // A hand is secret MINUS the part of it the room watched arrive.
      //
      // Silly Head keeps `publicHand`: the cards somebody was seen picking up
      // off the pile and has not played since. Everybody at a real table
      // remembers those, so the app is allowed to as well — it is memory, not
      // X-ray vision, and the same reasoning as Chase the Ace's log. Getting
      // this wrong is what the first run of this test caught, which is a fair
      // demonstration of why writing the rule down beats assuming it.
      const hidden = [];
      for (const [id, hand] of Object.entries(state.hands)) {
        if (id === viewerId) continue;
        const seen = new Set((state.publicHand || {})[id] || []);
        hidden.push(...hand.filter((card) => !seen.has(card)));
      }
      // A face-down card is a secret from its OWNER too, until it is turned
      // over — which is the one thing this game hides that no other does.
      for (const piles of Object.values(state.down || {})) hidden.push(...piles.filter(Boolean));
      hidden.push(...(state.stock || []));
      return hidden;
    },
  },

  sevens: {
    create: {},
    seats: 4,
    hiddenFrom(state, viewerId) {
      // Hands stop being secret when the game does — a deliberate widening, and
      // one this test has to know about or it would fail the reveal.
      if (!state.hands || state.phase === 'complete') return [];
      return Object.entries(state.hands)
        .filter(([id]) => id !== viewerId)
        .flatMap(([, hand]) => hand);
    },
  },

  chase: {
    create: {},
    seats: 4,
    hiddenFrom(state, viewerId) {
      if (!state.hands || state.phase === 'complete') return [];
      return Object.entries(state.hands)
        .filter(([id]) => id !== viewerId)
        .flatMap(([, hand]) => hand);
    },
  },
};

/**
 * A game of any engine, dealt, with every seat driven by a bot.
 *
 * The host is turned into a bot by hand. That is a liberty a test may take and a
 * room may not, and it buys something worth having: the engine drives its own
 * game through `owing`/`move`, so this file needs no per-game knowledge of how
 * to take a turn. Whatever a game's moves are, its own bots know them.
 */
function dealtGame(id, engine) {
  const fixture = FIXTURES[id];
  const ctxf = ctxFactory();
  let { state } = engine.createGame({ hostName: 'Host', code: '1234', ...fixture.create }, ctxf.next(null));
  const master = state.masterId;

  for (let i = 1; i < fixture.seats; i += 1) {
    const out = engine.applyCommand(state, { type: 'player/addBot', level: 'hard' }, ctxf.next(master));
    assert.equal(out.error, undefined, `${id}: could not add a bot — ${out.error && out.error.message}`);
    state = out.state;
  }

  // The host plays too, so no seat is left waiting on a person who is not here.
  state = JSON.parse(JSON.stringify(state));
  const host = state.players.find((p) => p.id === master);
  host.isBot = true;
  host.botSeed = 'seed_host_private';
  host.botLevel = 'hard';

  const started = engine.applyCommand(state, { type: 'game/start' }, ctxf.next(master));
  assert.equal(started.error, undefined, `${id}: could not start — ${started.error && started.error.message}`);
  return { state: started.state, ctxf };
}

/**
 * The check itself.
 *
 * Serialised, and needled from state. Anything softer than this passes while a
 * card sits in a field the author forgot about — which is exactly the bug it is
 * here to catch.
 */
function auditPayloads(id, engine, state) {
  let checked = 0;
  const viewers = state.players.map((p) => p.id).concat([null]);

  for (const viewerId of viewers) {
    const payload = JSON.stringify(engine.viewFor(state, viewerId));

    const hidden = viewerId
      ? FIXTURES[id].hiddenFrom(state, viewerId)
      : // A spectator holds no seat, so every hand in the game is hidden from
        // them. Worth checking separately: a redaction keyed on "is this the
        // viewer's own" can pass for every seated player and still hand the
        // lot to somebody with no seat at all.
        state.players.flatMap((p) => FIXTURES[id].hiddenFrom(state, p.id));

    for (const card of new Set(hidden)) {
      assert.ok(
        !payload.includes(`"${card}"`),
        `${id}: ${viewerId || 'a spectator'} was sent ${card}, which they must not see`
      );
    }

    // A bot's private settings are a secret in every game, and unlike a hand
    // they are the same shape everywhere — so this one needs no fixture.
    assert.ok(!payload.includes('botSeed'), `${id}: a bot seed reached ${viewerId || 'a spectator'}`);
    assert.ok(!payload.includes('seed_host_private'), `${id}: a bot seed value reached ${viewerId || 'a spectator'}`);
    checked += 1;
  }
  return checked;
}

// ── The tests ────────────────────────────────────────────────────────────────

test('every registered engine has a privacy fixture', () => {
  const missing = Object.keys(ENGINES).filter((id) => !FIXTURES[id]);
  assert.deepEqual(
    missing,
    [],
    `These games are on the shelf with nothing checking their privacy boundary: ${missing.join(', ')}. ` +
      'Add a fixture to test/privacy.test.js saying what each one hides and from whom. ' +
      'This test exists so a new game cannot ship without one.'
  );
});

for (const [id, engine] of Object.entries(ENGINES)) {
  if (!FIXTURES[id]) continue; // the coverage test above is already failing

  test(`${id}: nobody is ever sent a card they may not see`, () => {
    const { state: dealt } = dealtGame(id, engine);
    let state = dealt;
    let checked = auditPayloads(id, engine, state);
    let steps = 0;

    // Play it out, auditing every single state along the way. A boundary that
    // holds at the deal and leaks three turns later is still a leak, and the
    // interesting states are always the middle ones.
    while (state.phase !== 'complete' && steps < 600) {
      steps += 1;
      const owed = engine.bots && engine.bots.owing(state);
      if (!owed) break;
      const player = engine.findPlayer(state, owed.playerId);
      const secret = { seed: player.botSeed, level: player.botLevel || 'hard' };
      const command = engine.bots.move(engine.viewFor(state, player.id), secret, owed);
      if (!command) break;
      const out = engine.applyCommand(state, command, { now: 2_000 + steps, newId: (p) => `${p}_x${steps}`, actorId: player.id });
      if (out.error) break;
      state = out.state;
      checked += auditPayloads(id, engine, state);
    }

    assert.ok(steps > 3, `${id}: the game barely moved (${steps} steps), so this proved very little`);
    assert.ok(checked > 20, `${id}: only ${checked} payloads were audited`);
  });
}

test('the audit can actually catch a leak', () => {
  // A test that never fails is worse than no test, so this proves the assertion
  // fires: the same check is run against a view deliberately given somebody
  // else's cards. If this ever passes, every test above is worthless.
  const engine = ENGINES.sevens;
  const { state } = dealtGame('sevens', engine);
  const [a, b] = state.players;

  const leaky = {
    ...engine,
    viewFor(s, viewerId) {
      const view = engine.viewFor(s, viewerId);
      // The exact bug this whole file exists to catch: somebody else's hand,
      // tucked into a field the screen would never draw.
      return { ...view, debugScratch: s.hands[b.id] };
    },
  };

  assert.throws(
    () => auditPayloads('sevens', leaky, state),
    /was sent .*which they must not see/,
    'the audit failed to notice a hand sitting in the payload'
  );
  assert.ok(a && b, 'needed two players to plant the leak');
});
