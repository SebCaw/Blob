'use strict';

/**
 * Measure the Kings Corner bot ladder.
 *
 * Run it:
 *
 *   node tools/kc-ladder.js [games]
 *
 * ── Two instruments that do NOT work here, and why ───────────────────────────
 *
 * Both were used first, both gave confident wrong answers, and both are worth
 * knowing about before anybody measures another shared-board game.
 *
 * **Heads-up is invalid.** In a mirror match between two competent bots, the
 * player who leads wins 100% of the time. Every heads-up rung therefore comes
 * out at exactly 50% whatever the two policies are, because the seats are
 * swapped every other game. It looks like a perfectly balanced measurement and
 * it is measuring the seat.
 *
 * **One challenger against three of a kind is invalid too.** This game has a
 * shared resource — the eight slots — so a uniform field can be free-ridden.
 * A bot that never pays to free a slot does very well against three that do,
 * which produced the flatly contradictory pair "hard beats a field of mediums"
 * AND "medium beats a field of hards". Both were true. Neither meant anything
 * about which plays better.
 *
 * **So: one bot of each level at one table, seats rotated.** Every seat plays
 * the same board against the same opponents, and the rotation cancels the
 * first-player advantage, which in this game is large.
 */

const { ENGINES } = require('../lib/engines');

const engine = ENGINES.kingscorner;
const GAMES = Number(process.argv[2] || 3200);
const LEVELS = ['easy', 'medium', 'hard', 'impossible'];

/** A four-seat table with one bot of each level, rotated by `n`. */
function table(levels, n) {
  let ids = 0;
  let clock = 1_000;
  const next = (actorId) => ({ now: (clock += 1), newId: (p) => `${p}_${(ids += 1)}`, actorId });

  let { state } = engine.createGame({ hostName: 'S0', code: '4827' }, next(null));
  const host = state.masterId;
  for (let i = 1; i < levels.length; i += 1) {
    state = engine.applyCommand(state, { type: 'player/addBot', level: 'medium' }, next(host)).state;
  }
  state = JSON.parse(JSON.stringify(state));
  state.players.forEach((p, i) => {
    p.isBot = true;
    p.botLevel = levels[i];
    p.botSeed = `s${i}_${n}`;
  });
  const started = engine.applyCommand(state, { type: 'game/start' }, next(host));
  return { state: started.state, order: started.state.players.map((p) => p.id) };
}

function playOut(state) {
  let steps = 0;
  let refused = null;
  while (state.phase === 'playing' && steps < 6_000) {
    steps += 1;
    const owed = engine.bots.owing(state);
    if (!owed) break;
    const player = engine.findPlayer(state, owed.playerId);
    const command = engine.bots.move(engine.viewFor(state, player.id), {
      seed: player.botSeed,
      level: player.botLevel,
    });
    const out = engine.applyCommand(state, command, {
      now: 9_000 + steps,
      newId: (p) => `${p}_${steps}`,
      actorId: player.id,
    });
    if (out.error) {
      refused = out.error.message;
      break;
    }
    state = out.state;
  }
  return { state, steps, refused };
}

const wins = Object.fromEntries(LEVELS.map((l) => [l, 0]));
const reasons = {};
let refusals = 0;
let totalSteps = 0;

for (let n = 0; n < GAMES; n += 1) {
  const rot = n % LEVELS.length;
  const levels = LEVELS.map((_, i) => LEVELS[(i + rot) % LEVELS.length]);
  const { state, order } = table(levels, n);
  const done = playOut(state);
  if (done.refused) refusals += 1;
  totalSteps += done.steps;
  reasons[done.state.endReason] = (reasons[done.state.endReason] || 0) + 1;
  levels.forEach((level, seat) => {
    if ((done.state.winnerIds || []).includes(order[seat])) wins[level] += 1;
  });
}

console.log(`Kings Corner ladder — ${GAMES} four-seat games, one bot of each level, seats rotated.`);
console.log('25% is the baseline. Higher is stronger.\n');
for (const level of LEVELS) {
  console.log(`  ${level.padEnd(12)}${((wins[level] / GAMES) * 100).toFixed(1)}%`);
}
console.log(
  `\n  ${Math.round(totalSteps / GAMES)} moves a game, endings: ${JSON.stringify(reasons)}` +
    `${refusals ? `, ${refusals} REFUSED` : ''}`
);
console.log(
  '\nAs it stands only `easy` is properly separated. See the note at the top of\n' +
    'lib/kingscorner/bot.js: medium, hard and impossible sit within a few points\n' +
    'of each other with no stable ordering, and four heuristics that should have\n' +
    'spread them were measured and thrown away for making the bots worse.'
);
