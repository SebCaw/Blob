'use strict';

/**
 * Play thousands of games against nobody, and see what breaks.
 *
 * The tests in `test/` prove that particular things are true. This proves a
 * vaguer and equally important thing: that a game of each of the six, at every
 * table size, played end to end by bots, ALWAYS FINISHES. A table that quietly
 * stops moving is the worst bug this app has - nothing is on fire, nothing is in
 * the log, everybody just sits there - and it is exactly the kind of bug a
 * family evening finds about once a year and a machine finds in a minute.
 *
 * There is precedent. A one-in-forty stall in Go Fish and a refused bot command
 * that froze a table were both found this way rather than by playing.
 *
 * **It does not use `server/room.js`.** The room schedules bot moves on real
 * timers - `thinkMs` is a second or two, deliberately, so a person can follow
 * what is happening - and a thousand games at that pace is a week. This drives
 * the reducers directly and a game takes milliseconds. What it therefore does
 * NOT cover is the room itself: presence, grace windows, elections, the command
 * queue. Those have their own tests, and `test/bot-refusal.test.js` is the one
 * that covers a bot and a room together.
 *
 * Everything is seeded. A failure that cannot be replayed is a rumour, so every
 * run prints the exact command that reproduces it.
 *
 * Usage:
 *   node tools/soak.js                        a normal run
 *   node tools/soak.js --games 200            fewer, for a quick look
 *   node tools/soak.js --engine gofish        one game only
 *   node tools/soak.js --seed 12345           replay one exact game
 *   node tools/soak.js --seats 6              one table size only
 *   node tools/soak.js --quiet                only the summary
 *   node tools/soak.js --minutes 20           stop after twenty minutes
 *   node tools/soak.js --leaver 12            somebody walks out of every game
 */

const { ENGINES } = require('../lib/engines');

/** A game that has not finished in this many commands is not going to. */
const COMMAND_CAP = 5000;

/** Where a virtual clock starts. Any fixed number; it only has to be stable. */
const CLOCK_START = 1_700_000_000_000;

/** Seat counts to try. Anything an engine refuses is skipped and counted. */
const SEAT_COUNTS = [2, 3, 4, 5, 6, 8];

const LEVELS = ['easy', 'medium', 'hard', 'impossible'];

/**
 * The taps a PERSON makes that no bot owes.
 *
 * Not every pause in a game is somebody's move. Blob stops on a scoreboard
 * between hands and waits for the Master to say go on - which is right, because
 * everybody wants a moment to look at it, and it means a table of nothing but
 * bots genuinely cannot finish a game of Blob on its own. That is a fact about
 * the game rather than a bug, so the harness plays the part of the person here.
 *
 * Keep this list SHORT and be suspicious of adding to it. Every entry is a
 * place the game cannot move without a human, and the whole point of this tool
 * is to find the places it cannot move at all. A nudge added carelessly is a
 * deadlock hidden.
 */
const NUDGES = {
  blob: [{ phase: 'summary', asMaster: true, command: { type: 'round/next' } }],
};

/** `fail()` returns an object; printing it raw gives `[object Object]`. */
function reason(err) {
  if (!err) return 'refused';
  if (typeof err === 'string') return err;
  return err.message || err.reason || JSON.stringify(err);
}

/**
 * The one card invariant that is true in all six games: nothing is in two
 * places at once.
 *
 * Deliberately NOT "no card is ever lost", which sounds like the stronger check
 * and would be wrong. Go Fish books are stored as a RANK and the four cards are
 * dropped from the hand, so the number of cards on the table falls during a
 * perfectly ordinary game; asserting conservation there would fail constantly
 * and teach everybody to ignore this. Duplication has no such excuse anywhere -
 * a card id in two hands means a deal or a transfer went wrong.
 *
 * @returns {string|null} what was duplicated, or null if all is well
 */
function duplicateCard(state) {
  const seen = new Set();
  let clash = null;
  const walk = (value) => {
    if (clash || !value) return;
    if (Array.isArray(value)) {
      for (const item of value) {
        if (typeof item === 'string') {
          if (seen.has(item)) {
            clash = item;
            return;
          }
          seen.add(item);
        } else if (item && typeof item === 'object') {
          walk(item);
        }
      }
      return;
    }
    if (typeof value === 'object') for (const item of Object.values(value)) walk(item);
  };
  // Only the places that hold CARDS. `finished` and `players` hold ids, and a
  // player id appearing twice would be a different bug with a different name.
  walk(state.hands);
  walk(state.pool);
  walk(state.pile);
  walk(state.stock);
  walk(state.table);
  walk(state.up);
  walk(state.down);
  walk(state.discarded);
  return clash;
}

// -- A small seeded random ----------------------------------------------------

/**
 * Deterministic and cheap. `lib/` never gets to see this: randomness reaches a
 * reducer only through the seeds already baked into the state, exactly as it
 * does in the real server.
 */
function rng(seed) {
  let s = seed >>> 0;
  return function next() {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// -- One game -----------------------------------------------------------------

/**
 * Deal a table of bots and play it to the end.
 *
 * @returns {{ok: boolean, reason?: string, detail?: string, commands: number}}
 */
function playOne(engineId, seats, seed, options = {}) {
  const engine = ENGINES[engineId];
  const random = rng(seed);
  // Somebody walks out partway through. See `--leaver` in the usage note.
  const leaveAfter = options.leaveAfter || 0;

  let clock = CLOCK_START;
  let ids = 0;
  // `now` advances on every command so that anything comparing timestamps sees
  // time moving, the way it does on a real server.
  const ctx = (actorId) => ({
    now: (clock += 1),
    newId: (prefix) => `${prefix}_${engineId}_${seed}_${++ids}`,
    actorId,
  });

  let state;
  try {
    const made = engine.createGame(
      { hostName: 'Host', code: '1234', mode: 'online', startHandSize: 5 },
      ctx(null)
    );
    state = made.state;
  } catch (err) {
    return { ok: false, reason: 'createGame threw', detail: err.message, commands: 0 };
  }

  const master = state.masterId;

  // Seats past the host. An engine that will not take this many says so by
  // refusing, and that is a limit rather than a failure.
  for (let i = 1; i < seats; i += 1) {
    const level = LEVELS[Math.floor(random() * LEVELS.length)];
    const out = engine.applyCommand(state, { type: 'player/addBot', level }, ctx(master));
    if (out.error) return { ok: false, reason: 'seats', detail: `${engineId} refused seat ${i + 1}: ${reason(out.error)}`, commands: 0 };
    state = out.state;
  }

  // The host plays too, so nothing is ever waiting on a person who is not here.
  //
  // Except in leaver mode, where the host stays a PERSON: the reducers refuse to
  // remove a bot once a game has started ("a bot can only be removed before the
  // game starts"), so the only way to test somebody walking out is for the seat
  // that walks out to be a real one. It removes itself, which is allowed.
  state = JSON.parse(JSON.stringify(state));
  const host = state.players.find((p) => p.id === master);
  if (!leaveAfter) {
    host.isBot = true;
    host.botSeed = `seed_host_${seed}`;
    host.botLevel = LEVELS[Math.floor(random() * LEVELS.length)];
  }

  const started = engine.applyCommand(state, { type: 'game/start' }, ctx(master));
  if (started.error) {
    return { ok: false, reason: 'seats', detail: `${engineId} would not start with ${seats}: ${reason(started.error)}`, commands: 0 };
  }
  state = started.state;

  let commands = 0;
  let refusals = 0;
  let lastRefusal = null;
  let hasLeft = false;

  /**
   * What every exit through the front door has to satisfy.
   *
   * `historyRecord` is what gets written down when a game ends, and it is the
   * one piece of the engine contract nothing else here would exercise - the
   * screens that used to read it were taken off the shelf, so a record that
   * threw would go unnoticed until the day past games came back.
   */
  const finish = () => {
    const dupe = duplicateCard(state);
    if (dupe) return { ok: false, reason: 'duplicate card', detail: `${dupe} is in two places`, commands };
    let record;
    try {
      record = engine.historyRecord(state);
    } catch (err) {
      return { ok: false, reason: 'historyRecord threw', detail: err.message, commands };
    }
    if (!record) return { ok: false, reason: 'no history record', detail: 'historyRecord returned nothing', commands };
    return { ok: true, commands };
  };

  while (commands < COMMAND_CAP) {
    if (state.phase === 'complete') return finish();

    // The walkout. After it, every remaining seat is a bot, so if the game does
    // not finish from here it is because the LEAVING broke it.
    if (leaveAfter && !hasLeft && commands >= leaveAfter) {
      hasLeft = true;
      const out = engine.applyCommand(state, { type: 'player/remove', playerId: master }, ctx(master));
      commands += 1;
      if (out.error) {
        return { ok: false, reason: 'could not leave', detail: reason(out.error), commands };
      }
      state = out.state;
      continue;
    }

    let owed = null;
    try {
      owed = engine.bots.owing(state);
    } catch (err) {
      return { ok: false, reason: 'owing threw', detail: err.message, commands };
    }

    if (owed) {
      const player = engine.findPlayer(state, owed.playerId);
      const secret = { seed: (player && player.botSeed) || owed.playerId, level: (player && player.botLevel) || 'medium' };
      let command;
      try {
        command = engine.bots.move(engine.viewFor(state, owed.playerId), secret, owed);
      } catch (err) {
        return { ok: false, reason: 'bot move threw', detail: `${owed.kind}: ${err.message}`, commands };
      }
      if (!command) {
        return { ok: false, reason: 'bot returned nothing', detail: `owed ${owed.kind}`, commands };
      }

      let out;
      try {
        out = engine.applyCommand(state, command, ctx(owed.playerId));
      } catch (err) {
        return { ok: false, reason: 'applyCommand threw', detail: `${command.type}: ${err.message}`, commands };
      }
      commands += 1;

      if (out.error) {
        // A single refusal is survivable and the room retries - see
        // `test/bot-refusal.test.js`. A refusal that repeats in the same
        // position is the freeze, because nothing about the position changed.
        refusals += 1;
        const key = `${owed.playerId}:${owed.kind}:${owed.at}:${command.type}`;
        if (lastRefusal === key) {
          return {
            ok: false,
            reason: 'refused twice in the same position',
            detail: `${command.type} refused: ${reason(out.error)}`,
            commands,
          };
        }
        lastRefusal = key;
        continue;
      }
      lastRefusal = null;
      state = out.state;
      continue;
    }

    // Nothing owed. Something the game is waiting on a clock for?
    if (typeof engine.deadline === 'function') {
      const due = engine.deadline(state, clock);
      if (due) {
        clock += Math.max(1, due.afterMs);
        let out;
        try {
          out = engine.applyCommand(state, due.command, ctx(null));
        } catch (err) {
          return { ok: false, reason: 'deadline threw', detail: `${due.command.type}: ${err.message}`, commands };
        }
        commands += 1;
        if (out.error) {
          return { ok: false, reason: 'deadline refused', detail: `${due.command.type}: ${reason(out.error)}`, commands };
        }
        state = out.state;
        continue;
      }
    }

    if (state.phase === 'complete') return finish();

    // A tap a person would make. See `NUDGES`.
    const nudge = (NUDGES[engineId] || []).find((n) => n.phase === state.phase);
    if (nudge) {
      const out = engine.applyCommand(state, nudge.command, ctx(nudge.asMaster ? state.masterId : null));
      commands += 1;
      if (out.error) {
        return { ok: false, reason: 'nudge refused', detail: `${nudge.command.type}: ${reason(out.error)}`, commands };
      }
      state = out.state;
      continue;
    }

    // In leaver mode the table can legitimately be waiting on the one seat that
    // is a person - that is not a deadlock, it is their turn. Walking out is
    // exactly what we came to test, so do it here rather than calling it a bug.
    if (leaveAfter && !hasLeft) {
      hasLeft = true;
      const out = engine.applyCommand(state, { type: 'player/remove', playerId: master }, ctx(master));
      commands += 1;
      if (out.error) return { ok: false, reason: 'could not leave', detail: reason(out.error), commands };
      state = out.state;
      continue;
    }

    // Nobody owes anything, no clock is running, and the game is not over. On a
    // table of nothing but bots that means it will sit here for ever.
    return {
      ok: false,
      reason: 'DEADLOCK',
      detail: `phase=${state.phase} turn=${state.turnId || 'none'} after ${refusals} refusal(s)`,
      commands,
    };
  }

  return { ok: false, reason: 'never finished', detail: `hit the ${COMMAND_CAP} command cap`, commands };
}

// -- The run ------------------------------------------------------------------

function parseArgs(argv) {
  const out = { games: 1200, engine: null, seed: null, seats: null, quiet: false, leaver: 0, minutes: 0 };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === '--quiet') out.quiet = true;
    else if (a === '--games') out.games = Number(argv[++i]);
    else if (a === '--engine') out.engine = argv[++i];
    else if (a === '--seed') out.seed = Number(argv[++i]);
    else if (a === '--seats') out.seats = Number(argv[++i]);
    // Play N commands, then have the one human seat walk out, and see whether
    // the bots left behind can still finish. `--leaver 1` walks out almost
    // immediately; a larger number lets the game get going first.
    else if (a === '--leaver') out.leaver = Number(argv[++i]) || 1;
    // A wall-clock budget. Stops where it has got to and reports honestly on
    // what it managed, rather than running past the time it was given.
    else if (a === '--minutes') out.minutes = Number(argv[++i]);
  }
  return out;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const engineIds = Object.keys(ENGINES).filter((id) => ENGINES[id].bots && (!args.engine || id === args.engine));
  if (!engineIds.length) {
    console.error(`No engine called "${args.engine}". Known: ${Object.keys(ENGINES).join(', ')}`);
    process.exit(2);
  }
  const seatCounts = args.seats ? [args.seats] : SEAT_COUNTS;

  const failures = [];
  const limits = [];
  const played = {};
  let total = 0;
  const startedAt = Date.now();

  // One game, replayed exactly.
  if (args.seed !== null) {
    for (const id of engineIds) {
      for (const seats of seatCounts) {
        const r = playOne(id, seats, args.seed, { leaveAfter: args.leaver });
        console.log(`${id} x${seats} seed ${args.seed}: ${r.ok ? 'ok' : r.reason} (${r.commands} commands)${r.detail ? ' - ' + r.detail : ''}`);
      }
    }
    return;
  }

  const perCombo = Math.max(1, Math.round(args.games / (engineIds.length * seatCounts.length)));

  const until = args.minutes ? startedAt + args.minutes * 60_000 : Infinity;
  let ranOut = false;

  for (const id of engineIds) {
    played[id] = 0;
    for (const seats of seatCounts) {
      let skipped = false;
      for (let i = 0; i < perCombo; i += 1) {
        if (Date.now() >= until) {
          ranOut = true;
          break;
        }
        const seed = (id.length * 7919 + seats * 104729 + i * 15485863) >>> 0;
        const r = playOne(id, seats, seed, { leaveAfter: args.leaver });
        if (!r.ok && r.reason === 'seats') {
          // Not a failure: this engine does not seat this many.
          limits.push(`${id} does not seat ${seats} (${r.detail})`);
          skipped = true;
          break;
        }
        if (!r.ok && r.reason === 'could not leave') {
          // Also not a failure. Blob refuses a walkout mid-hand on purpose -
          // "players can only be removed before the game starts, or between
          // hands" - which is its own answer to the question this mode asks.
          // Counting a rule as a bug is how a tool teaches people to ignore it.
          limits.push(`${id} does not allow leaving mid-game (${r.detail})`);
          skipped = true;
          break;
        }
        total += 1;
        played[id] += 1;
        if (!r.ok) {
          failures.push({ engine: id, seats, seed, ...r });
          if (!args.quiet) {
            console.log(`FAIL ${id} x${seats}: ${r.reason} - ${r.detail}`);
            console.log(`     replay: node tools/soak.js --engine ${id} --seats ${seats} --seed ${seed}`);
          }
        }
      }
      if (!skipped && !args.quiet) {
        console.log(`  ${id} x${seats}: ${perCombo} games`);
      }
      if (ranOut) break;
    }
    if (ranOut) break;
  }

  const seconds = ((Date.now() - startedAt) / 1000).toFixed(1);
  console.log('');
  console.log(`${total} games in ${seconds}s`);
  // Said out loud rather than left to look like a complete run. A soak that
  // quietly stopped early reads as "everything was covered" when it was not.
  if (ranOut) console.log(`STOPPED EARLY: the ${args.minutes}-minute budget ran out before every combination was played.`);
  for (const id of engineIds) console.log(`  ${id}: ${played[id]}`);
  if (limits.length) {
    console.log('');
    console.log('Table sizes not offered (a limit, not a failure):');
    for (const l of [...new Set(limits)]) console.log(`  ${l}`);
  }
  console.log('');
  if (!failures.length) {
    console.log(`No failures in ${total} games.`);
  } else {
    console.log(`${failures.length} FAILURES:`);
    const byReason = {};
    for (const f of failures) byReason[f.reason] = (byReason[f.reason] || 0) + 1;
    for (const [reason, n] of Object.entries(byReason)) console.log(`  ${reason}: ${n}`);
    console.log('');
    console.log('First few, with replays:');
    for (const f of failures.slice(0, 10)) {
      console.log(`  ${f.engine} x${f.seats}: ${f.reason} - ${f.detail}`);
      console.log(`    node tools/soak.js --engine ${f.engine} --seats ${f.seats} --seed ${f.seed}`);
    }
    process.exitCode = 1;
  }
}

main();
