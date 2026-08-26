'use strict';

const { seedFrom, makeRandom } = require('../deck');
const { OF_EACH, RANKS, rankOf } = require('./deck');
const { countByRank, completeBooks } = require('./rules');

/**
 * A Go Fish bot.
 *
 * Driven from `viewFor(state, botId)` — the same redacted payload a phone gets —
 * so it never sees the pool and never sees a hand but its own. In this game that
 * boundary is easy to hold and hard to work around, which is the point: the ONLY
 * thing there is to be good at here is remembering what was said, and what was
 * said is in `view.log`, which every player and every bot gets identically.
 *
 * **So the ladder is memory, and nothing else.** Not keenness, not risk
 * appetite, not a table of weights — there is no gamble in Go Fish to be brave
 * about. A question either lands or it does not, and the only skill is knowing
 * which one will.
 *
 *   easy         no memory at all. A rank it holds, a player at random.
 *   medium       the last turn or two. Enough to follow what just happened.
 *   hard         the whole game. Both halves of it: who HAS a rank and who
 *                said they had none.
 *   impossible   the same, plus it watches what its own questions give away.
 *
 * **What the log lets anybody work out**, and all four of these are things a
 * person at the table hears out loud:
 *
 *   somebody asked for sevens      they are holding at least one seven
 *   somebody said go fish to it    they were holding none of that rank
 *   somebody handed two over       the giver has none left; the asker has more
 *   somebody booked the sevens     the sevens are gone, all four of them
 *
 * The second one is the half people forget, and it is worth as much as the
 * first: a table of five is mostly ruling players out.
 */

const BOT_LEVELS = ['easy', 'medium', 'hard', 'impossible'];

/**
 * What the lobby says about each one.
 *
 * Straightforwardly true here, unlike Cheat's, where saying what the bot
 * notices would have told you the exact size of lie it believes. Nothing in Go
 * Fish is hidden from a person who is paying attention, so there is nothing to
 * be coy about.
 */
const BOT_LEVEL_LABELS = {
  easy: 'Forgets what was asked',
  medium: 'Remembers the last go round',
  hard: 'Remembers every question',
  impossible: 'Remembers how many, not just who',
};

const BOT_NAMES = [
  'Ada', 'Bo', 'Cleo', 'Dex', 'Enzo', 'Fern', 'Gus', 'Hana',
  'Iggy', 'Juno', 'Kit', 'Lex', 'Mo', 'Nia', 'Otto', 'Pip',
];

/**
 * How far back each level can hear, in log entries.
 *
 * `Infinity` is the whole game. Medium's window is deliberately small and
 * deliberately in EVENTS rather than in turns: a person who is half paying
 * attention remembers the last thing or two that happened, not the last complete
 * circuit of the table.
 */
const MEMORY = { easy: 0, medium: 8, hard: Infinity, impossible: Infinity };

/** How often a level ignores what it knows and asks something else instead. */
const SLIP = { easy: 1, medium: 0.18, hard: 0.05, impossible: 0 };

/**
 * What it costs to tell the table something new about your own hand.
 *
 * Only the top level pays it. Asking for sevens announces that you hold a seven,
 * so repeating a question everybody has already heard the answer to is free
 * where a fresh one is not. Deliberately small: information is real, and it is
 * still worth less than a card.
 */
const TELL_COST = 0.4;

const MIN_THINK_MS = 380;
const MAX_THINK_MS = 1900;

function normalizeLevel(level) {
  return BOT_LEVELS.includes(level) ? level : 'medium';
}

function rngFrom(key) {
  return makeRandom(seedFrom(String(key)));
}

function clamp(value, low, high) {
  return Math.max(low, Math.min(high, value));
}

/**
 * How long to sit before moving.
 *
 * Keyed on the view version as well as the seat's own seed, so the same bot in
 * the same position pauses the same length twice.
 *
 * Answering is quick, because there is nothing to decide — you either have the
 * sevens or you do not, and a bot that took two seconds over it would be acting.
 * Asking is the slow one: it is the only real decision in the game. Laying a
 * book is quicker still, and short on purpose, because at the deal three bots
 * may have one and the table should not stall while they file them.
 */
function thinkMs(view, secret, kind) {
  const rng = rngFrom(`${secret.seed}:pace:${view.version}:${kind}`);
  const fast = view.speed === 2 ? 2 : 1;
  if (kind === 'book') return Math.round(clamp(260 + rng() * 300, 220, 700) / fast);
  if (kind === 'answer') return Math.round(clamp(420 + rng() * 600, 320, 1200) / fast);
  return Math.round(clamp(700 + rng() * 900, MIN_THINK_MS, MAX_THINK_MS) / fast);
}

/**
 * What the bot has decided to do.
 *
 * Never throws for a position it does not understand, and `engines.js` has its
 * own fallback on top of that. A bot that cannot decide must never leave a table
 * sitting there.
 *
 * @param {object} view the bot's own redacted view
 * @param {{seed:string, level:string}} secret
 * @param {{kind:string, rank?:string}} owed
 */
function chooseMove(view, secret, owed) {
  const kind = (owed && owed.kind) || 'ask';
  // Answering is forced. There is nothing here to be clever with, and a level
  // that could choose would be a level that could lie.
  if (kind === 'answer') return { type: 'play/answer' };
  if (kind === 'book') {
    const rank = (owed && owed.rank) || completeBooks((view.you && view.you.hand) || [])[0];
    return rank ? { type: 'play/book', rank } : null;
  }
  return ask(view, secret, normalizeLevel(secret.level));
}

// -- What the table has said --------------------------------------------------

/**
 * What this bot can work out about everybody else, from the log alone.
 *
 * Returns `{known, drew, booked}`:
 *
 *   known[playerId][rank]  how many of that rank they are known to hold, as a
 *                          floor rather than an estimate. `0` means known NONE,
 *                          which is worth as much as knowing they have one.
 *                          Absent means nobody has said.
 *   drew[playerId]         how many unseen cards they have taken from the pool
 *   booked                 ranks that are out of the game entirely
 *
 * **Counting rather than flagging is the whole of the top rung**, and it fell
 * out of measuring: remembering WHO holds sevens took a bot from ordinary to
 * good, and remembering HOW MANY is what takes it from good to unpleasant. If a
 * player is known to be holding three sevens and you hold the fourth, that one
 * question is a book — and it looks exactly like every other question until you
 * have been keeping count.
 *
 * `drew` is what stops a stale negative being treated as gospel. Somebody who
 * said go fish to sevens four draws ago may well have one now.
 *
 * Every line of this is a deduction from something said out loud. Nothing in
 * here needs a card anybody had to peek at, which is why a bot is entitled to
 * it — the same reasoning as Cheat's `publicCards` and Silly Head's counting.
 */
function readTable(view, depth) {
  const log = view.log || [];
  const from = depth === Infinity ? 0 : Math.max(0, log.length - depth);
  /** @type {Record<string, Record<string, number>>} */
  const known = {};
  /** @type {Record<string, number>} */
  const drew = {};
  const booked = new Set();

  const at = (id) => (known[id] = known[id] || {});

  for (let i = from; i < log.length; i += 1) {
    const e = log[i];
    if (e.kind === 'ask') {
      // The rule of the game, used as evidence: you cannot ask for a rank you
      // are not holding. So an ask is a floor of one, and never lowers a floor
      // already higher than that.
      const bag = at(e.askerId);
      bag[e.rank] = Math.max(bag[e.rank] || 0, 1);
    } else if (e.kind === 'give') {
      // The asker already held at least one and has just been handed the rest of
      // somebody's. This is the line that produces a known three.
      const bag = at(e.askerId);
      bag[e.rank] = Math.min(OF_EACH, Math.max(bag[e.rank] || 1, 1) + e.count);
      // Handed over ALL of them, so the giver has none of that rank left.
      at(e.targetId)[e.rank] = 0;
    } else if (e.kind === 'fish') {
      // The half people forget, and it is worth as much as the other one. They
      // were asked and they had none.
      at(e.targetId)[e.rank] = 0;
      if (e.drew) drew[e.askerId] = (drew[e.askerId] || 0) + 1;
    } else if (e.kind === 'book') {
      booked.add(e.rank);
    } else if (e.kind === 'out') {
      known[e.playerId] = Object.fromEntries(RANKS.map((r) => [r, 0]));
    }
  }

  // A booked rank is not in anybody's hand, whatever was said about it earlier.
  for (const rank of booked) {
    for (const bag of Object.values(known)) bag[rank] = 0;
  }
  return { known, drew, booked };
}

/**
 * What a question to this player about this rank is worth.
 *
 * Not a probability and not pretending to be one — an ordering, and the two
 * things it multiplies are the two things that matter: how likely the answer is
 * yes, and how much a yes is worth. A hit that finishes a book is worth several
 * times a hit that does not, because a book is a point and everything else is
 * only a step towards one.
 *
 * The levels differ in what they are allowed to read here and nowhere else:
 * `hard` sees a floor of one as simply "yes", `impossible` sees the number.
 */
function value(table, playerId, rank, mine, level) {
  const bag = table.known[playerId] || {};
  const floor = bag[rank];

  // Nobody has said anything about it. An unknown player is more likely than not
  // to be holding nothing of a given rank, but it is the only kind of question
  // left once the obvious ones are used up.
  if (floor === undefined) return 0.35 * worth(mine + 1, 1);

  if (floor === 0) {
    // They said no. The top level allows for the cards they have drawn since,
    // which is the difference between remembering and understanding.
    const since = table.drew[playerId] || 0;
    const chance = level === 'impossible' ? Math.min(0.2, since * 0.03) : 0;
    return chance * worth(mine + 1, 1);
  }

  // A known holder. Only the top level knows how many.
  const gain = level === 'impossible' ? floor : 1;
  return worth(mine + gain, gain);
}

/** A book is the only thing in this game actually worth anything. */
function worth(total, gain) {
  return total >= OF_EACH ? 3 : 1 + gain * 0.2;
}

// -- Asking -------------------------------------------------------------------

/**
 * Who to ask, and for what.
 *
 * Every rank in hand against every player still in, scored, best one wins.
 *
 * Deliberately NOT weighted by how many cards the target is holding. It reads
 * like it should matter and it does not: a hand of nine is nine cards spread
 * across thirteen ranks, and what the log says about a specific rank is worth
 * far more than the size of the hand it sits in. Tried, measured, dropped.
 */
function ask(view, secret, level) {
  const you = view.you || {};
  const hand = you.hand || [];
  const ranks = (you.askable || []).slice();
  const targets = (you.canAsk || []).slice();
  if (!ranks.length || !targets.length) return null;

  const rng = rngFrom(`${secret.seed}:ask:${view.version}`);
  const pick = (rank, targetId) => ({ type: 'play/ask', rank, targetId });

  // Easy has no memory, and a slip on any level is the same thing for one turn.
  if (level === 'easy' || rng() < (SLIP[level] ?? 0)) {
    return pick(ranks[Math.floor(rng() * ranks.length)], targets[Math.floor(rng() * targets.length)]);
  }

  const table = readTable(view, MEMORY[level] ?? 8);
  const counts = countByRank(hand);
  const told = level === 'impossible' ? alreadyTold(view, you.id) : null;

  let best = null;
  let bestScore = -Infinity;
  for (const rank of ranks) {
    const mine = counts[rank] || 0;
    for (const targetId of targets) {
      let score = value(table, targetId, rank, mine, level);
      // What the question costs. Asking tells the table you hold this rank, and
      // the top level would rather repeat something everybody already knows than
      // hand out a fresh fact for nothing. Small on purpose: information is real
      // but it is worth less than a card.
      if (told && !told.has(rank)) score -= TELL_COST;
      // A stable tiebreak, so the same position gives the same answer twice.
      score += rng() * 0.02;
      if (score > bestScore) {
        bestScore = score;
        best = pick(rank, targetId);
      }
    }
  }
  return best || pick(ranks[0], targets[0]);
}

/**
 * The ranks the table already knows this bot is holding.
 *
 * Everything it has asked for and not since booked, plus everything it has been
 * handed in front of everybody. Asking for one of those again gives nothing
 * away.
 */
function alreadyTold(view, meId) {
  const known = new Set();
  for (const e of view.log || []) {
    if (e.kind === 'ask' && e.askerId === meId) known.add(e.rank);
    if (e.kind === 'give' && e.askerId === meId) known.add(e.rank);
    if (e.kind === 'book' && e.playerId === meId) known.delete(e.rank);
  }
  return known;
}

/** A legal ask from the view alone, for when everything else has gone wrong. */
function anyAsk(view) {
  const you = view.you || {};
  const rank = (you.askable || [])[0] || rankOf((you.hand || [])[0] || '');
  const targetId = (you.canAsk || [])[0];
  if (!rank || !targetId) return null;
  return { type: 'play/ask', rank, targetId };
}

module.exports = {
  BOT_LEVELS,
  BOT_LEVEL_LABELS,
  BOT_NAMES,
  MEMORY,
  SLIP,
  TELL_COST,
  thinkMs,
  chooseMove,
  readTable,
  alreadyTold,
  anyAsk,
};
