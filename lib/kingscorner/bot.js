'use strict';

const { seedFrom, makeRandom } = require('../deck');
const { valueOf, isKing } = require('./deck');

/**
 * A Kings Corner bot.
 *
 * Driven from `viewFor(state, botId)` — the same redacted payload a phone gets —
 * so it cannot see anybody's hand and there is no wider view for it to ask for.
 *
 * **This brain returns ONE move and is asked again.** A turn here is a chain of
 * moves ended by `play/endTurn`, so the shape is Silly Head's `nextSortMove`
 * rather than every other game's one-decision-per-turn. It terminates for a
 * structural reason rather than a careful one: a pile move always reduces the
 * number of occupied slots, and the only way to make another one available is to
 * spend a card from a hand that never grows mid-turn.
 *
 * ── What the policy is ───────────────────────────────────────────────────────
 *
 * Deliberately short, because everything longer measured worse:
 *
 * - Put down everything you can, lowest card first.
 * - Prefer a real pile to a bare slot: a bare slot takes anything, so it is the
 *   only home a stuck card has, and spending it on a card that had somewhere
 *   else to go is waste.
 * - Open a corner with a king, since a king can never go onto a pile at all.
 * - Free a slot ONLY when there is nothing else left to do — and when you do,
 *   do it before playing, so the freed slot is available for the rest of your
 *   own turn.
 *
 * ── What was measured and thrown away ────────────────────────────────────────
 *
 * Recorded here so nobody adds them back on intuition, which is the same service
 * `lib/cheat/bot.js` performs for its two discarded signals. All four were
 * measured at a mixed four-seat table with the seats rotated, 2400+ games each:
 *
 * - **Freeing a slot before you are stuck.** The obvious "good play", and it is
 *   a gift: the slot you open is available to the three people who go before it
 *   comes round to you again. Roughly ten points worse. It DOES pay heads-up,
 *   where you get the slot straight back — which is exactly why heads-up turned
 *   out to be the wrong instrument for this game.
 * - **Preferring the card you hold a run behind** (Sevens' chain idea). Neutral
 *   at best: it drives one pile down to an ace and kills it.
 * - **Shedding your highest cards first.** Sounds right, since a king can never
 *   go onto a pile at all, and measured about eight points WORSE than shedding
 *   low first.
 * - **Counting the deck**, so a bot knows which piles are dead and which of its
 *   own cards can never be played again. It is the right KIND of extra
 *   knowledge — the sense in which Go Fish's counting earns the top rung — and
 *   here it is worth less than nothing: with counting on, a field of counters
 *   was markedly EASIER to beat than a field without it (46% against 24%). The
 *   knowledge is real. What it informs is a shared resource, so acting on it
 *   helps everybody at the table equally.
 *
 * ── The ladder is NOT established, and that is written down on purpose ───────
 *
 * `easy` is genuinely and repeatably weak — it puts one card down and stops —
 * and comes in around 8% at a mixed table against a 25% baseline. Above that,
 * `medium`, `hard` and `impossible` differ only in how often they take a worse
 * option than the one they found, and they measure 27–34% with **no stable
 * ordering between them**. Three separate instruments disagreed about which is
 * strongest.
 *
 * That is a finding about the game rather than a gap in the effort, and the
 * three measurements behind it are worth keeping: heads-up between two
 * competent bots is won by whoever leads 100% of the time; a uniform field of
 * any one level is easy to free-ride on, so "three of X versus one of Y" is not
 * a fair comparison either; and across every scoring variant tried, picking at
 * random among the legal moves was about as good as ranking them. There does
 * not appear to be enough stable strategic depth here to hang four rungs on.
 *
 * See KINGS-CORNER.md. This is the game's one open item.
 */

const BOT_LEVELS = ['easy', 'medium', 'hard', 'impossible'];

/**
 * What the lobby says about each one.
 *
 * Honest about the one thing actually measured — how much of a turn it uses and
 * how carefully — and vague about method, because a bot advertising its rule has
 * told you how to play against it.
 */
const BOT_LEVEL_LABELS = {
  easy: 'Puts one card down and stops',
  medium: 'Plays out its whole turn',
  hard: 'Rarely wastes a slot',
  impossible: 'Never wastes a slot',
};

const BOT_NAMES = [
  'Ada', 'Bo', 'Cleo', 'Dex', 'Enzo', 'Fern', 'Gus', 'Hana',
  'Iggy', 'Juno', 'Kit', 'Lex', 'Mo', 'Nia', 'Otto', 'Pip',
];

/** How often a bot takes a worse option than the one it found. */
const SLIP = { easy: 1, medium: 0.34, hard: 0.13, impossible: 0 };

/**
 * How many moves a bot will make in one turn before saying it is done.
 *
 * Below the reducer's `MAX_TURN_MOVES`, and for a different reason: that one is
 * a backstop against a bug, this one is so a turn stays something a person can
 * watch. Twelve moves in a row with a pause between each is not a turn, it is an
 * interlude.
 */
const MAX_MOVES_PER_TURN = 12;

/** How long a bot appears to think. Long enough to read as a person taking a turn. */
const MIN_THINK_MS = 380;
const MAX_THINK_MS = 2200;

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
 * Keyed on the view version so the same bot in the same position pauses the same
 * length twice — a think that re-rolls on every broadcast is what makes a table
 * feel jittery. Moves after the first in a turn are quicker: a chain of moves is
 * ONE person's go, and two seconds between each of them reads as four players
 * rather than one.
 */
function thinkMs(view, secret, kind) {
  const rng = rngFrom(`${secret.seed}:pace:${view.version}:${kind}`);
  const continuing = Boolean(view.you && view.you.turnMoves);
  const base = continuing ? 320 : 700;
  const spread = continuing ? 420 : 900;
  return Math.round(clamp(base + rng() * spread, continuing ? 260 : MIN_THINK_MS, MAX_THINK_MS));
}

/**
 * What the bot has decided to do next.
 *
 * Always returns a command, never null and never a throw — a bot that cannot
 * decide must not be able to leave a table sat waiting. `engines.js` has its own
 * fallback on top of this one.
 *
 * @param {object} view the bot's own redacted view
 * @param {{seed:string, level:string}} secret
 * @returns {{type:string, cardId?:string, slot?:string, from?:string, to?:string}}
 */
function chooseMove(view, secret) {
  const you = view.you || {};
  const moves = you.moves || { cards: {}, piles: {} };
  const board = view.board || {};

  const done = { type: 'play/endTurn' };
  if ((you.turnMoves || 0) >= MAX_MOVES_PER_TURN) return done;

  const level = normalizeLevel(secret.level);
  const rng = rngFrom(`${secret.seed}:move:${view.version}:${you.turnMoves || 0}`);

  const cardOptions = Object.entries(moves.cards || {});
  const pileOptions = Object.entries(moves.piles || {});
  if (!cardOptions.length && !pileOptions.length) return done;

  // Easy puts one card down and stops. It is the only rung that is clearly and
  // repeatably weaker than the rest, and this is the whole of why.
  if (level === 'easy') {
    if (!cardOptions.length || you.turnPlayed) return done;
    const [card, slots] = cardOptions[Math.floor(rng() * cardOptions.length)];
    return { type: 'play/card', cardId: card, slot: slots[Math.floor(rng() * slots.length)] };
  }

  /** @type {{score:number, move:object}[]} */
  const options = [];

  for (const [card, slots] of cardOptions) {
    // Does this card have anywhere to go other than a bare slot? If it does,
    // spending a slot on it is waste; if it does not, the slot is its only way
    // out and there is nothing to weigh against.
    const hasPile = slots.some((slot) => (board[slot] || []).length);

    for (const slot of slots) {
      const isBare = !(board[slot] || []).length;
      const corner = (view.corners || []).includes(slot);

      // Shedding a card is the objective, so everything starts well above zero
      // and the modifiers only decide WHICH card and WHERE.
      let score = 100;

      // Get rid of the low cards first. Measured, and the opposite way round
      // from how it sounds — see the discarded list at the top of this file.
      score -= valueOf(card) * 0.6;

      if (isBare && corner) score += 25; // a king has nowhere else at all to go
      else if (isBare && hasPile) score -= 30; // do not spend a slot on a card with a home
      else if (isBare && isKing(card)) score += 10;

      options.push({ score, move: { type: 'play/card', cardId: card, slot } });
    }
  }

  for (const [from, targets] of pileOptions) {
    const fromCross = (view.cross || []).includes(from);
    for (const to of targets) {
      // Free a slot only as a last resort, and then before anything else.
      //
      // Both halves are measured. Doing it early is a gift to the three people
      // who play before your next turn. Doing it after your cards wastes the
      // slot you just made, because you cannot use it until next time round.
      const worthIt = !cardOptions.length && fromCross;
      options.push({ score: worthIt ? 130 : -30, move: { type: 'play/movePile', from, to } });
    }
  }

  // Shuffle before sorting, so equal scores are broken by this bot's own seed
  // rather than by the order the options happened to be built in. Without it a
  // stable sort plays the first card in hand order into the first slot in board
  // order, every single time — a systematic choice that measured worse than
  // picking at random, and one of the things that sent the first ladder upside
  // down.
  const shuffled = options.slice();
  for (let i = shuffled.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rng() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }

  const worthwhile = shuffled.filter((o) => o.score > 0).sort((a, b) => b.score - a.score);
  if (!worthwhile.length) return done;

  const slip = SLIP[level] ?? 0;
  const chosen = slip && rng() < slip ? worthwhile[Math.floor(rng() * worthwhile.length)] : worthwhile[0];
  return chosen.move;
}

function clamp(value, low, high) {
  return Math.max(low, Math.min(high, value));
}

module.exports = {
  BOT_LEVELS,
  BOT_LEVEL_LABELS,
  BOT_NAMES,
  SLIP,
  MAX_MOVES_PER_TURN,
  thinkMs,
  chooseMove,
};
