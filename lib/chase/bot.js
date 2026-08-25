'use strict';

const { seedFrom, makeRandom } = require('../deck');

/**
 * A Chase the Ace bot.
 *
 * Driven from `viewFor(state, botId)` — the same redacted payload a phone gets —
 * so it never sees anybody's cards. That matters more here than anywhere else in
 * this app: the entire game is choosing a face-down slot, and a bot that could
 * see faces would not be a hard opponent, it would be a cheat with a scoreboard.
 *
 * What it CAN see is the log, and that is the interesting part. Every move and
 * every shuffle is public by design — the room watches you rearrange at a real
 * table — so a bot that pays attention has something honest to reason from.
 * Remembering what everybody watched is what a sharp player does, and the app is
 * allowed to do it too. It is memory, not X-ray vision.
 *
 * The heuristic, and it is the same one a person uses: **a slot somebody just
 * moved a card into is a slot worth avoiding.** Nobody rearranges at random. If
 * they have touched a card, either they are hiding the ace or they want you to
 * think they are — and either way the untouched cards are the safer bet.
 *
 * The counter is the shuffle button, which is exactly why it exists.
 */

const BOT_LEVELS = ['easy', 'medium', 'hard', 'impossible'];

/**
 * What the lobby says about each one.
 *
 * Vague about method on purpose. A bot advertising "avoids the card you just
 * moved" has told you to shuffle instead.
 */
const BOT_LEVEL_LABELS = {
  easy: 'Takes whichever card it fancies',
  medium: 'Notices when you fidget',
  hard: 'Watches your hands, and hides its own',
  impossible: 'Remembers everything you did',
};

const BOT_NAMES = [
  'Ada', 'Bo', 'Cleo', 'Dex', 'Enzo', 'Fern', 'Gus', 'Hana',
  'Iggy', 'Juno', 'Kit', 'Lex', 'Mo', 'Nia', 'Otto', 'Pip',
];

/** How often a bot ignores what it worked out and just takes one. */
const SLIP = { easy: 1, medium: 0.4, hard: 0.15, impossible: 0 };

/** Which levels bother hiding their own ace. */
const HIDES = { easy: false, medium: false, hard: true, impossible: true };

const MIN_THINK_MS = 420;
const MAX_THINK_MS = 2400;

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
 * Keyed on the view version as well as the seed, so the same bot in the same
 * position pauses the same length twice. Arranging is quicker than drawing —
 * tidying your own hand is not a decision anybody agonises over, and a bot that
 * took two seconds to shuffle would look like it was thinking about something it
 * cannot see.
 */
function thinkMs(view, secret, kind) {
  const rng = rngFrom(`${secret.seed}:pace:${view.version}:${kind}`);
  if (kind === 'arrange') return Math.round(clamp(240 + rng() * 420, 200, 900));
  return Math.round(clamp(700 + rng() * 1000, MIN_THINK_MS, MAX_THINK_MS));
}

/**
 * The slot this player most recently moved a card INTO, if they have touched
 * their hand since it last changed size.
 *
 * Read out of the public log, newest first, stopping at the point their hand
 * last changed — anything before that is about a hand that no longer exists.
 * A shuffle wipes the trail, which is the whole point of the button: it returns
 * null from here, and the bot is back to guessing.
 *
 * @param {object[]} log oldest first
 * @param {string} playerId
 * @returns {number|null}
 */
function disturbedSlot(log, playerId) {
  for (let i = log.length - 1; i >= 0; i--) {
    const event = log[i];
    if (event.kind === 'shuffle' && event.playerId === playerId) return null;
    // Their hand changed here, so anything older is about different cards.
    if (event.kind === 'draw' && (event.fromId === playerId || event.playerId === playerId)) return null;
    if (event.kind === 'deal') return null;
    if (event.kind === 'move' && event.playerId === playerId) return event.to;
  }
  return null;
}

/**
 * What the bot has decided to do.
 *
 * Never throws for a table it does not understand, and `engines.js` has its own
 * fallback on top of that. A bot that cannot decide must never leave a table
 * sitting there.
 *
 * @param {object} view the bot's own redacted view
 * @param {{seed:string, level:string}} secret
 * @param {{kind:string}} owed
 */
function chooseMove(view, secret, owed) {
  const level = normalizeLevel(secret.level);
  const kind = (owed && owed.kind) || 'draw';
  if (kind === 'bin') return bin(view);
  return kind === 'arrange' ? arrange(view, secret, level) : draw(view, secret, level);
}

/**
 * Throw a pair away.
 *
 * The first one, because there is nothing to choose between them — a pair is a
 * pair and all of them have to go. A bot bins before it does anything else, the
 * same as a person has to: the reducer refuses a draw from anybody still
 * sitting on one.
 */
function bin(view) {
  const pairs = (view.you && view.you.pairs) || [];
  if (!pairs.length) return null;
  const [a, b] = pairs[0];
  return { type: 'hand/bin', a, b };
}

/**
 * Pick a slot out of the hand on your right.
 *
 * All the bot knows is how many slots there are and what the room has watched
 * happen to them.
 */
function draw(view, secret, level) {
  const source = view.source;
  const slots = (source && source.cardsHeld) || 0;
  // `of` is the count this decision was made against, so the reducer can refuse
  // a tap aimed at a hand that has changed since. A bot is as entitled to that
  // protection as a phone, and as bound by it.
  const take = (index) => ({ type: 'draw/take', index, of: slots });
  if (!slots) return take(0);

  const rng = rngFrom(`${secret.seed}:draw:${view.version}`);
  const anywhere = () => Math.floor(rng() * slots);

  if (level === 'easy' || rng() < (SLIP[level] ?? 0)) return take(anywhere());

  const avoid = disturbedSlot(view.log || [], source.id);
  if (avoid === null || slots < 2) return take(anywhere());

  // Anything but the slot they were just fiddling with.
  const choices = [];
  for (let i = 0; i < slots; i++) if (i !== avoid) choices.push(i);
  return take(choices[Math.floor(rng() * choices.length)]);
}

/**
 * Tidy your own hand, or scramble it.
 *
 * A bot holding the ace shuffles, because a shuffle is the only move that takes
 * a read away from somebody rather than giving them one. Holding nothing
 * interesting, it moves a card instead — which is a bluff, and costs it nothing
 * to make.
 */
function arrange(view, secret, level) {
  const you = view.you || {};
  const size = (you.hand || []).length;
  if (size < 2) return null;

  const rng = rngFrom(`${secret.seed}:arrange:${view.version}`);

  if (HIDES[level] && you.hasTheAce) return { type: 'hand/shuffle' };

  // Always something, never nothing.
  //
  // An earlier version returned null here when a bot could not be bothered, and
  // that is a quiet trap: `state.tidied` is only set by a COMMAND, so a bot that
  // declines still owes the same thing on the next broadcast, and `room.js`
  // re-arms its timer forever. Nothing freezes and nobody notices, which is the
  // worst kind of bug. A bot that has nothing to hide fidgets instead, which is
  // its own sort of tell and costs it nothing.
  const from = Math.floor(rng() * size);
  let to = Math.floor(rng() * size);
  if (to === from) to = (to + 1) % size;
  return { type: 'hand/move', from, to };
}

module.exports = {
  bin,
  BOT_LEVELS,
  BOT_LEVEL_LABELS,
  BOT_NAMES,
  SLIP,
  thinkMs,
  chooseMove,
  disturbedSlot,
};
