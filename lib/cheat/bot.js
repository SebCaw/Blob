'use strict';

const { seedFrom, makeRandom } = require('../deck');
const { OF_EACH, rankOf } = require('./deck');
const { legalRanks, countByRank, cardsOfRank, impossible } = require('./rules');

/**
 * A Cheat bot.
 *
 * Driven from `viewFor(state, botId)` — the same redacted payload a phone gets —
 * so it never sees the pile, never sees a hand but its own, and never learns
 * what is under a claim until it has decided whether to call it. That matters
 * more here than in any other game in this app: a bot that could see the cards
 * would not be a hard opponent, it would be an oracle, and every call it made
 * would be right.
 *
 * **What it is allowed to know**, and it is all memory rather than X-ray vision:
 *
 *   its own hand
 *   how many cards everybody holds
 *   the cards the whole room watched somebody pick up at a reveal (`publicCards`)
 *   the log of claims, calls and outcomes
 *
 * From those it can do the one thing that is never a gamble — count. Claim four
 * kings while a bot holds two of them and there are only four in the pack, and
 * it does not need to read your face. **Every level calls an impossible claim**,
 * on purpose: with no cap on how many cards go down, a table that let those go
 * would hand any player a free win by dumping their whole hand on a lie.
 *
 * Everything above that line is judgement, and that is where the ladder lives.
 */

const BOT_LEVELS = ['easy', 'medium', 'hard', 'impossible'];

/**
 * What the lobby says about each one.
 *
 * Vague about method on purpose. A bot advertising "calls when the arithmetic
 * says so" has just told you the exact size of lie it will believe.
 */
const BOT_LEVEL_LABELS = {
  easy: 'Believes almost anything',
  medium: 'Doubts a claim that is too good',
  hard: 'Counts what it has seen',
  impossible: 'Remembers every card that was turned over',
};

const BOT_NAMES = [
  'Ada', 'Bo', 'Cleo', 'Dex', 'Enzo', 'Fern', 'Gus', 'Hana',
  'Iggy', 'Juno', 'Kit', 'Lex', 'Mo', 'Nia', 'Otto', 'Pip',
];

/**
 * Which evidence each level is able to use.
 *
 * **This is the ladder, and it is about what a bot can SEE rather than how keen
 * it is.** Two earlier versions made keenness the ladder and both came out
 * inverted, because of the one fact that governs this whole game:
 *
 *   Calling is a coin toss you pay for. Get it wrong and you pick up everything
 *   on the table. So a call is only worth making when the claim is more likely
 *   than not to be a lie — and across a hundred and twenty measured games, only
 *   19% of all claims are lies.
 *
 * A bot that calls on a hunch loses. A bot that never calls lets everybody walk
 * out. The difference between a weak player and a strong one is knowing which
 * claims are the exceptions, so `EVIDENCE` says which tells each level notices
 * and every thinking level acts on the same threshold.
 *
 * The weights below are measured lie rates, not guesses. See `WEIGHT`.
 */
const EVIDENCE = {
  easy: [],
  medium: ['nearlyOut', 'wentOut'],
  hard: ['nearlyOut', 'wentOut', 'threeCards', 'protectLead'],
  // The same tells as hard, deliberately. Impossible is not better at DOUBTING —
  // measurement said there is nothing left worth doubting on — it is better at
  // being doubted. See `claim`: it lies about the rank hardest to disprove, and
  // it never leaves a bluff sitting at the size everybody watches for.
  impossible: ['nearlyOut', 'wentOut', 'threeCards', 'protectLead'],
};

/**
 * What each tell is worth, on top of the base rate.
 *
 * Measured across 120 four-handed games, as the share of claims carrying that
 * tell which turned out to be lies:
 *
 *   base rate, any claim at all             19%
 *   claimer down to two cards, claiming 2+  59%   <- the only strong one
 *   exactly three cards                     47%
 *   their last cards, going out             47%
 *   same rank twice running                 37%
 *   four cards                              15%   <- BELOW the base rate
 *
 * That last line is the one worth remembering. A big claim is not a suspicious
 * claim — it is usually somebody with a genuinely good hand, because nobody
 * makes up a lie that large. Both earlier versions of this bot treated size as
 * the main tell and both were wrong in the same direction.
 */
const BASE_LIE_RATE = 0.19;
const WEIGHT = {
  nearlyOut: 0.4,
  wentOut: 0.34,
  threeCards: 0.22,
  protectLead: -0.15,
};

/**
 * Two tells that were measured and then thrown away, recorded so nobody adds
 * them back on intuition:
 *
 *   same rank twice running   37% lie rate
 *   a pile of fifteen or more  no measurable effect
 *
 * Both are things a person would swear by. Both sit below the even-money line a
 * call has to clear, and a level given them called more and won less.
 */

/** Better than an even chance of being a lie, and the call pays for itself. */
const GATE = 0.5;

/** How often each level calls on nothing at all. Easy is nothing but noise. */
const NOISE = { easy: 0.1, medium: 0.04, hard: 0.02, impossible: 0 };

/**
 * How many cards of a rank a level will put down honestly.
 *
 * The counter-intuitive one, and it falls straight out of the economics above.
 * Being called on an HONEST claim is a good outcome — the caller picks up
 * everything. So a big honest claim is not a risk, it is bait, and the better
 * levels take it while the timid ones dribble one card out at a time and never
 * get anywhere.
 */
const BAIT = { easy: 1, medium: 2, hard: 4, impossible: 4 };

/** How willing each level is to tell a big lie rather than a small one. */
const NERVE = { easy: 0.15, medium: 0.3, hard: 0.45, impossible: 0.6 };

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
 * position pauses the same length twice.
 *
 * Deciding whether to call is quicker than deciding what to play — at a table it
 * is a reaction, not a deliberation, and a bot that took two seconds over it
 * would burn most of the window every time. The pause after a reveal is longer
 * on purpose: cards have just been turned over and somebody has picked up a
 * pile, and the next claim landing on top of that animation would make the most
 * dramatic moment in the game unreadable.
 *
 * Halved when the table has switched to double speed, which only ever happens
 * when there is nobody left waiting on any of it.
 */
function thinkMs(view, secret, kind) {
  const rng = rngFrom(`${secret.seed}:pace:${view.version}:${kind}`);
  const fast = view.speed === 2 ? 2 : 1;
  if (kind === 'respond') return Math.round(clamp(320 + rng() * 700, 250, 1400) / fast);
  const afterReveal = view.lastEvent && view.lastEvent.kind === 'call';
  const base = afterReveal ? 1900 : 700;
  return Math.round(clamp(base + rng() * 1000, MIN_THINK_MS, afterReveal ? 3200 : MAX_THINK_MS) / fast);
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
  const kind = (owed && owed.kind) || 'claim';
  return kind === 'respond' ? respond(view, secret, level) : claim(view, secret, level);
}

/**
 * Every card this bot can legitimately account for.
 *
 * Its own hand plus every card the room watched go into somebody else's hand.
 * `publicCards` is the view's name for the second half, and it is sent to every
 * player — somebody tracking the same thing is just paying attention.
 */
function knownCards(view) {
  const mine = (view.you && view.you.hand) || [];
  const watched = (view.players || [])
    .filter((p) => p.id !== (view.you && view.you.id))
    .flatMap((p) => p.publicCards || []);
  return mine.concat(watched);
}

/** The same, narrowed to one rank. */
function accountedFor(view, rank) {
  return knownCards(view).filter((card) => rankOf(card) === rank).length;
}

/**
 * Call it, or let it go.
 *
 * One certainty and then a weighed-up guess. The certainty is arithmetic and
 * every level takes it; the guess is the sum of whichever tells this level is
 * able to notice, started from the base rate at which claims are lies at all.
 */
function respond(view, secret, level) {
  const claimOnTable = view.claim;
  const pass = { type: 'play/pass' };
  if (!claimOnTable) return pass;

  const rng = rngFrom(`${secret.seed}:call:${view.version}`);

  // Certain. Every level, always. Asked of `rules.js` rather than worked out
  // here, so the bot and the game agree on what counts as impossible.
  //
  // Not optional and not tuned. With no cap on how many cards may go down, a
  // table that let an impossible claim stand would hand anybody a free win by
  // dumping their whole hand and naming a rank.
  if (
    impossible({
      rank: claimOnTable.rank,
      count: claimOnTable.count,
      decks: view.decks || 1,
      known: knownCards(view),
    })
  ) {
    return { type: 'play/call' };
  }

  const noise = NOISE[level] ?? 0.04;
  const tells = EVIDENCE[level] || [];
  if (!tells.length) return rng() < noise ? { type: 'play/call' } : pass;

  const showing = tellsShowing(view, claimOnTable);
  let odds = BASE_LIE_RATE;
  for (const tell of tells) if (showing[tell]) odds += WEIGHT[tell];

  if (odds >= GATE) return { type: 'play/call' };
  return rng() < noise ? { type: 'play/call' } : pass;
}

/**
 * Which tells this claim is showing, from what the view is allowed to say.
 *
 * Every one of these is something a person at the table can see: how many cards
 * somebody is holding, how many they just put down, what they said last time,
 * and how big the pile has got.
 */
function tellsShowing(view, claimOnTable) {
  const you = view.you || {};
  const claimer = (view.players || []).find((p) => p.id === claimOnTable.playerId);
  return {
    // Down to almost nothing, and still claiming more than one. With two cards
    // left you have two chances of holding a legal rank, and usually hold
    // neither. The strongest tell in the game by a distance.
    nearlyOut: Boolean(claimer && claimer.cardsHeld <= 2 && claimOnTable.count >= 2),
    // Their last cards. Letting this stand ends their game, so it is worth a
    // gamble that would not otherwise be worth taking.
    wentOut: Boolean(claimOnTable.wentOut),
    // Three is the size of a bluff hiding behind a pair. Two is ordinary and
    // four is usually the truth; three is the awkward middle.
    threeCards: claimOnTable.count === 3,
    // Nearly out yourself. Do not risk a winning position on a hunch.
    protectLead: (you.hand || []).length <= 3,
  };
}

/**
 * Put cards down and say something.
 *
 * Honest whenever it can be, because an honest claim is free — there is nothing
 * to catch. The two decisions that matter are what to say when it cannot be
 * honest, and HOW MANY to put down, which turns out to be the more important of
 * the two.
 *
 * **Size is a tell.** With thirteen cards out of fifty-two you would expect to
 * hold about one of any rank, so one card is invisible, two is ordinary, and
 * four makes the whole table look up — whether or not it is true. The first
 * version of this bot always dumped every card of its best rank and was called
 * almost every time, honest or not, which is a fair result and a terrible game.
 * So it plays small until it has a reason not to.
 */
function claim(view, secret, level) {
  const hand = ((view.you && view.you.hand) || []).slice();
  const legal = view.legalRanks && view.legalRanks.length ? view.legalRanks : legalRanks(view.lastRank);
  const rng = rngFrom(`${secret.seed}:claim:${view.version}`);
  const say = (rank, cardIds) => ({ type: 'play/claim', rank, cardIds });
  if (!hand.length) return say(legal[0], []);

  const counts = countByRank(hand);
  const honestRanks = legal.filter((rank) => counts[rank]);

  // The ceiling on any claim, honest or not: there are only so many of a rank in
  // the pack, and claiming more than that is a lie ANYBODY can prove without
  // holding a single card.
  const inPack = OF_EACH * (view.decks || 1);

  // Everything in one go, and the game is over. Taken whenever it is honest,
  // because there is no risk left to manage.
  for (const rank of honestRanks) {
    if (counts[rank] === hand.length && hand.length <= inPack) return say(rank, cardsOfRank(hand, rank));
  }

  if (honestRanks.length) {
    const best = honestRanks.slice().sort((a, b) => counts[b] - counts[a])[0];
    const all = cardsOfRank(hand, best);
    // How much of it to put down. See `BAIT`: an honest claim that gets called
    // is a good outcome, so the timid levels dribble one card out at a time and
    // the confident ones shed the lot and dare somebody to doubt it.
    const cards = all.slice(0, Math.max(1, Math.min(inPack, BAIT[level] ?? 2)));

    // Hide a passenger in an honest-looking claim: two real nines and one other
    // card that goes down with them. Costs the whole play if it is called, which
    // is why only the braver levels try it — and only when the total still fits
    // inside the pack, or it is not a bluff, it is an announcement.
    if (cards.length >= 2 && cards.length < inPack && rng() < NERVE[level] * 0.5) {
      // Not if it would land on three, for the top level. See the note below.
      const wouldBe = cards.length + 1;
      if (!(level === 'impossible' && wouldBe === 3)) {
        const spare = worstCard(hand, legal, counts, cards);
        if (spare) return say(best, cards.concat([spare]));
      }
    }
    return say(best, cards);
  }

  // Nothing legal in hand, so it has to lie.
  //
  // WHICH rank to lie about is a real decision and only the top level makes it:
  // name the one with the most copies still unaccounted for, because that is the
  // one nobody can argue with. Naming a rank the doubter is holding three of is
  // how a bluff gets called on arithmetic alone.
  const rank =
    level === 'impossible'
      ? legal.slice().sort((a, b) => spareOf(view, b) - spareOf(view, a))[0]
      : legal[Math.floor(rng() * legal.length)];
  let bulk = Math.max(1, Math.min(hand.length, inPack, 1 + Math.floor(rng() * (NERVE[level] * 4))));
  // Never three. Measured across 120 games, a claim of exactly three cards was a
  // lie 47% of the time and a claim of four only 15% — because nobody makes up a
  // lie that big, which is precisely why the top level does.
  if (level === 'impossible' && bulk === 3) bulk = hand.length >= 4 ? 4 : 2;
  if (bulk === 1) return say(rank, [worstCard(hand, legal, counts, []) || hand[0]]);

  // A bigger lie, built from the cards it least wants. Only ever worth it when
  // the hand is nearly done and there is no time left to be careful.
  const junk = hand
    .slice()
    .sort((a, b) => (counts[rankOf(a)] || 0) - (counts[rankOf(b)] || 0))
    .slice(0, bulk);
  return say(rank, junk);
}

/** How many of a rank could still honestly be anywhere but in front of this bot. */
function spareOf(view, rank) {
  return Math.max(0, OF_EACH * (view.decks || 1) - accountedFor(view, rank));
}

/**
 * The card it would least mind losing: fewest of its rank, and never a legal one.
 *
 * `taken` is what is already going down. Without it the passenger could be a
 * card that is already in the claim, and the reducer refuses a claim naming the
 * same card twice — which is exactly how this was found.
 */
function worstCard(hand, legal, counts, taken) {
  const already = new Set(taken || []);
  const free = hand.filter((card) => !already.has(card));
  const useless = free.filter((card) => !legal.includes(rankOf(card)));
  const pool = useless.length ? useless : free;
  return pool.slice().sort((a, b) => (counts[rankOf(a)] || 0) - (counts[rankOf(b)] || 0))[0] || null;
}

module.exports = {
  BOT_LEVELS,
  BOT_LEVEL_LABELS,
  BOT_NAMES,
  EVIDENCE,
  WEIGHT,
  GATE,
  NOISE,
  BAIT,
  NERVE,
  thinkMs,
  chooseMove,
  tellsShowing,
  accountedFor,
};
