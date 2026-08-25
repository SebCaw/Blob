'use strict';

const { seedFrom, makeRandom } = require('../deck');
const { SUIT_ORDER, SEVEN_VALUE, suitOf, valueOf } = require('./deck');

/**
 * A Sevens bot.
 *
 * Driven from `viewFor(state, botId)` — the same redacted payload a phone gets —
 * so it cannot see anybody's hand and there is no wider view for it to ask for.
 * "Impossible" means it thinks well, and that is structural rather than a
 * promise: the payload does not carry the information a cheat would need.
 *
 * The interesting thing about Sevens is how LITTLE there is to decide. You must
 * play if you can, so a bot only has a choice when two or more of its cards fit,
 * and it has none at all when exactly one does — which is most turns. All the
 * skill lives in the handful of turns where a suit could be opened or a run
 * extended two ways.
 *
 * Three ideas, in order of how much they matter:
 *
 * **Follow your own chain.** Playing a card you hold the next one behind is free
 * progress — it puts a card down and leaves you able to put the next one down
 * too. This is most of what good play in Sevens is.
 *
 * **Do not open a suit you are short in.** Laying a seven hands the table two
 * new ends. If you hold two cards of that suit and somebody else holds nine, you
 * have just done them a favour. Sevens punishes generosity more than it rewards
 * cleverness.
 *
 * **Get rid of the far cards first.** A king is only playable once the whole run
 * has climbed to the queen. Given an otherwise equal choice, play the card
 * nearer the outside, because the inside ones will keep.
 */

const BOT_LEVELS = ['easy', 'medium', 'hard', 'impossible'];

/**
 * What the lobby says about each one.
 *
 * Deliberately vague about METHOD. A bot advertising "never opens a short suit"
 * has told you how to beat it.
 */
const BOT_LEVEL_LABELS = {
  easy: 'Plays the first thing that fits',
  medium: 'Knows what it is doing',
  hard: 'Watches what it gives away',
  impossible: 'Counts every card that has gone down',
};

const BOT_NAMES = [
  'Ada', 'Bo', 'Cleo', 'Dex', 'Enzo', 'Fern', 'Gus', 'Hana',
  'Iggy', 'Juno', 'Kit', 'Lex', 'Mo', 'Nia', 'Otto', 'Pip',
];

/** How often a bot takes a worse option than the one it found. */
const SLIP = { easy: 1, medium: 0.34, hard: 0.13, impossible: 0 };

/** How long a bot appears to think. Long enough to read as a person taking a turn. */
const MIN_THINK_MS = 420;
const MAX_THINK_MS = 2400;

function normalizeLevel(level) {
  return BOT_LEVELS.includes(level) ? level : 'medium';
}

/** A little randomness, from the bot's own seed and the position it is in. */
function rngFrom(key) {
  return makeRandom(seedFrom(String(key)));
}

/**
 * How long to sit before moving.
 *
 * Keyed on the view version as well as the seed, so the same bot in the same
 * position pauses the same length twice — a think that re-rolls on every
 * broadcast is what makes a table feel jittery.
 */
function thinkMs(view, secret, kind) {
  const rng = rngFrom(`${secret.seed}:pace:${view.version}:${kind}`);
  return Math.round(clamp(700 + rng() * 900, MIN_THINK_MS, MAX_THINK_MS));
}

/**
 * How far this card is from the middle of its run.
 *
 * A seven is 0 and an ace or a king is 6. Higher means harder to get rid of
 * later, so higher is better to play now.
 */
function distanceFromSeven(cardId) {
  return Math.abs(valueOf(cardId) - SEVEN_VALUE);
}

/**
 * How many cards this bot holds in a suit.
 * @param {string[]} hand
 * @param {string} suit
 */
function heldInSuit(hand, suit) {
  return hand.filter((card) => suitOf(card) === suit).length;
}

/**
 * How many cards the bot could play in a row off this one, in the direction it
 * is going.
 *
 * The whole of the "follow your own chain" idea. Playing the 8 when you also
 * hold the 9 and the 10 is worth three cards, not one.
 *
 * @param {string} cardId the card being considered
 * @param {string[]} hand everything the bot holds
 * @param {{low:number, high:number}|null} run the suit's run before this card lands
 */
function chainLength(cardId, hand, run) {
  const suit = suitOf(cardId);
  const value = valueOf(cardId);
  const mine = new Set(hand.filter((c) => suitOf(c) === suit).map((c) => valueOf(c)));

  // An unopened suit is a seven, which can then run in either direction; count
  // both sides, because both become available the moment it goes down.
  if (!run) {
    let length = 1;
    for (let v = value - 1; mine.has(v); v--) length += 1;
    for (let v = value + 1; mine.has(v); v++) length += 1;
    return length;
  }

  const step = value < run.low ? -1 : 1;
  let length = 1;
  for (let v = value + step; mine.has(v); v += step) length += 1;
  return length;
}

/**
 * What the bot has decided to do.
 *
 * Never throws for a table it does not understand — a null-ish view returns a
 * pass, and `engines.js` has its own fallback on top of that. A bot that cannot
 * decide must never be able to leave a table sat waiting.
 *
 * @param {object} view the bot's own redacted view
 * @param {{seed:string, level:string}} secret
 * @returns {{type:string, cardId?:string}}
 */
function chooseMove(view, secret) {
  const you = view.you || {};
  const playable = (you.playable || []).slice();
  if (!playable.length) return { type: 'play/pass' };

  const level = normalizeLevel(secret.level);
  const rng = rngFrom(`${secret.seed}:move:${view.version}`);
  const hand = you.hand || [];
  const table = view.table || {};

  if (level === 'easy') {
    return { type: 'play/card', cardId: playable[Math.floor(rng() * playable.length)] };
  }

  const scored = playable
    .map((card) => {
      const suit = suitOf(card);
      const run = table[suit] || null;
      const chain = chainLength(card, hand, run);
      const held = heldInSuit(hand, suit);

      // Chain dominates, because it is the only thing that reliably shortens the
      // hand. Distance breaks ties toward the cards that keep worst.
      let score = chain * 10 + distanceFromSeven(card);

      // Opening a suit gives the whole table two new ends. Worth it when this
      // hand is the one that benefits, expensive when it is not. Below `hard`
      // the bot does not think about what it is giving away at all.
      if (!run && (level === 'hard' || level === 'impossible')) {
        score += held >= 4 ? 6 : -14;
      }

      // The best bots also prefer the suit they are longest in, so their own
      // cards keep flowing rather than stalling behind one they do not hold.
      if (level === 'impossible') score += held;

      return { card, score };
    })
    .sort((a, b) => b.score - a.score || a.card.localeCompare(b.card));

  const slip = SLIP[level] ?? 0;
  const chosen = slip && rng() < slip ? scored[Math.floor(rng() * scored.length)] : scored[0];
  return { type: 'play/card', cardId: chosen.card };
}

function clamp(value, low, high) {
  return Math.max(low, Math.min(high, value));
}

module.exports = {
  BOT_LEVELS,
  BOT_LEVEL_LABELS,
  BOT_NAMES,
  SLIP,
  SUIT_ORDER,
  thinkMs,
  chooseMove,
  chainLength,
  distanceFromSeven,
};
