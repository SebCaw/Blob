'use strict';

const {
  SUITS,
  parseCard,
  suitOf,
  valueOf,
  newDeck,
  legalPlays,
  trickWinner,
  seedFrom,
  makeRandom,
} = require('./deck');

/**
 * The bots.
 *
 * ── The one rule everything here rests on ────────────────────────────────────
 *
 * A bot is handed the SAME redacted payload a phone gets: `viewFor(state,
 * botId)`. Its own hand, the cards face up on the table, everyone's bids once
 * they are revealed, how many cards each player is holding — and nothing else.
 * There is no second, wider view for bots, and this file cannot reach `state`
 * at all. So a harder bot is one that thinks better, never one that sees more,
 * and "Impossible" means very good rather than omniscient.
 *
 * That is a promise the code keeps structurally: if the payload does not carry
 * it, no amount of skill in here can invent it.
 *
 * ── Why there are three of each ──────────────────────────────────────────────
 *
 * One policy per level would be readable after a couple of hands: play against
 * it twice and you know it always leads its ace, always ducks with its lowest.
 * So every level has three PERSONAS — different bidding nerve, different leads,
 * different ways of throwing a card away — and each bot picks one afresh every
 * round from a private seed. The persona never leaves the server, never appears
 * in a view, and never appears in the history. All anyone can see is the level
 * they chose.
 *
 * Pure, like the rest of `lib/`: no clock, no `Math.random()`. Every choice is
 * a function of the view plus the bot's own seed, so a hand can be replayed.
 */

/** The four settings a Master can pick, easiest first. */
const BOT_LEVELS = ['easy', 'medium', 'hard', 'impossible'];

/**
 * What the lobby says about each one.
 *
 * Deliberately vague about METHOD. A bot that advertises "always leads trumps"
 * has told you how to beat it, which defeats the point of hiding the personas.
 */
const BOT_LEVEL_LABELS = {
  easy: { name: 'Easy', blurb: 'Still learning. Kind to a beginner.' },
  medium: { name: 'Medium', blurb: 'Plays a sensible hand.' },
  hard: { name: 'Hard', blurb: 'Pays attention. Hard to shake off.' },
  impossible: { name: 'Impossible', blurb: 'You have been warned.' },
};

/** Short names, so a table of bots still reads like a table of people. */
const BOT_NAMES = [
  'Ada', 'Bo', 'Cleo', 'Dex', 'Enzo', 'Fern', 'Gus', 'Hana',
  'Iggy', 'Juno', 'Kit', 'Lex', 'Mo', 'Nia', 'Otto', 'Pip',
];

/**
 * Three ways to play at each level.
 *
 *  bidBias  nerve — how far off the honest estimate it is willing to bid
 *  lead     what it leads when it wants tricks
 *  duck     what it throws when it does not
 *  noise    how often it takes the next-best card instead of the best
 *  pace     how long it sits there before moving
 *
 * PRIVATE. Never send any of this to a client.
 */
const PERSONAS = {
  easy: [
    { bidBias: 0.0, lead: 'low', duck: 'low', noise: 0.3, pace: 0.8 },
    { bidBias: 0.6, lead: 'top', duck: 'high', noise: 0.22, pace: 1.2 },
    { bidBias: -0.6, lead: 'ruff', duck: 'low', noise: 0.38, pace: 1.0 },
  ],
  medium: [
    { bidBias: 0.0, lead: 'top', duck: 'low', noise: 0.12, pace: 1.0 },
    { bidBias: 0.35, lead: 'trump', duck: 'high', noise: 0.1, pace: 0.85 },
    { bidBias: -0.35, lead: 'low', duck: 'low', noise: 0.14, pace: 1.15 },
  ],
  hard: [
    { bidBias: 0.0, lead: 'top', duck: 'high', noise: 0.05, pace: 1.0 },
    { bidBias: 0.25, lead: 'trump', duck: 'high', noise: 0.04, pace: 0.9 },
    { bidBias: -0.25, lead: 'low', duck: 'low', noise: 0.06, pace: 1.2 },
  ],
  impossible: [
    { bidBias: 0.0, lead: 'top', duck: 'high', noise: 0.02, pace: 1.0 },
    { bidBias: 0.15, lead: 'trump', duck: 'high', noise: 0.02, pace: 0.8 },
    { bidBias: -0.15, lead: 'low', duck: 'high', noise: 0.03, pace: 1.15 },
  ],
};

const normalizeLevel = (level) => (BOT_LEVELS.includes(level) ? level : 'medium');

/** A seeded stream of numbers. Same seed, same game — that is the point. */
const rngFrom = (seed) => makeRandom(seedFrom(String(seed)));

/**
 * Which of the three this bot is being, this round.
 *
 * Rechosen every hand, so somebody who reads it correctly in round three is
 * reading the wrong bot in round four.
 */
function personaFor(level, seed, roundIndex) {
  const list = PERSONAS[normalizeLevel(level)];
  const pick = seedFrom(`${seed}:persona:${roundIndex}`) % list.length;
  return list[pick];
}

const clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, n));

/** Fisher-Yates over a copy, driven by a seeded stream. */
function shuffled(list, rng) {
  const out = list.slice();
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    const swap = out[i];
    out[i] = out[j];
    out[j] = swap;
  }
  return out;
}

/** Would `x` beat `c`, given what was led and what is trumps? */
function beatsCard(x, c, ledSuit, trumpSuit) {
  const plays = [
    { playerId: 'c', cardId: c },
    { playerId: 'x', cardId: x },
  ];
  return trickWinner(plays, ledSuit, trumpSuit) === 'x';
}

/** The card currently taking the trick. */
function currentWinnerCard(plays, ledSuit, trumpSuit) {
  const id = trickWinner(plays, ledSuit, trumpSuit);
  const play = plays.find((p) => p.playerId === id);
  return play ? play.cardId : null;
}

const byValueAsc = (a, b) => valueOf(a) - valueOf(b);

/** Pick whichever scores highest; ties go to the first, so callers sort first. */
function bestBy(list, score) {
  let best = null;
  let bestScore = -Infinity;
  for (const item of list) {
    const s = score(item);
    if (s > bestScore) {
      bestScore = s;
      best = item;
    }
  }
  return best;
}

const suitLength = (hand, suit) => hand.filter((c) => suitOf(c) === suit).length;

// ── Reading the hand ─────────────────────────────────────────────────────────

/**
 * Roughly how many tricks this hand is worth.
 *
 * Not a simulation — a valuation, the way a person counts up before bidding:
 * aces are usually good, a king is better with a card to spare underneath it,
 * long trumps mop up at the end, and a short suit is only worth something if
 * you have a trump left to ruff with. More players at the table makes a plain
 * honour slightly less reliable, because there are more hands it has to beat.
 */
function estimateTricks(hand, trumpSuit, players, handSize) {
  const bySuit = new Map(SUITS.map((s) => [s, []]));
  for (const card of hand) bySuit.get(suitOf(card)).push(valueOf(card));
  const trumps = trumpSuit ? bySuit.get(trumpSuit) : [];
  const crowd = clamp(1 - 0.04 * (players - 3), 0.7, 1.05);
  let total = 0;

  for (const suit of SUITS) {
    const values = bySuit.get(suit);
    if (!values.length) continue;
    const len = values.length;
    if (suit === trumpSuit) {
      for (const v of values) {
        total += v === 14 ? 1 : v === 13 ? 0.9 : v === 12 ? 0.72 : v === 11 ? 0.52 : v === 10 ? 0.36 : 0.14;
      }
      if (len > 3) total += (len - 3) * 0.35;
    } else {
      for (const v of values) {
        if (v === 14) total += 0.86 * crowd;
        else if (v === 13) total += (len >= 2 ? 0.6 : 0.32) * crowd;
        else if (v === 12) total += (len >= 3 ? 0.34 : 0.12) * crowd;
        else if (v === 11) total += (len >= 4 ? 0.14 : 0.04) * crowd;
      }
      // A ruff needs a trump to make it with, and a hand short enough to run
      // out of the suit before everyone else does.
      if (trumpSuit && trumps.length && handSize >= 4) {
        if (len === 1) total += Math.min(trumps.length, 2) * 0.16;
        else if (len === 2) total += Math.min(trumps.length, 2) * 0.07;
      }
    }
  }

  // A void is the best short suit there is — but in a three-card hand you are
  // void in something no matter what you hold, so it means nothing there.
  if (trumpSuit && trumps.length && handSize >= 5) {
    for (const suit of SUITS) {
      if (suit === trumpSuit) continue;
      if (!bySuit.get(suit).length) total += Math.min(trumps.length, 3) * 0.22;
    }
  }

  return clamp(total, 0, handSize);
}

/** How a beginner counts: aces, and the top of the trump suit. */
function easyEstimate(hand, trumpSuit) {
  let n = 0;
  for (const card of hand) {
    const { suit, value } = parseCard(card);
    if (value === 14) n += 1;
    else if (suit === trumpSuit && value >= 11) n += 1;
    else if (suit === trumpSuit && value >= 9) n += 0.5;
  }
  return n;
}

// ── The situation in front of it ─────────────────────────────────────────────

/**
 * Everything the bot is allowed to know, arranged for deciding with.
 *
 * Built from the view and only the view. `memory` is the difference between the
 * lower two levels and the upper two: with it the pool of unknown cards is the
 * cards nobody has seen, and a player who failed to follow a suit is remembered
 * as void in it. Without it the bot is working from what is on the table right
 * now, like somebody who has not been keeping track.
 */
function situationFrom(view, level) {
  const round = view.round;
  const you = view.you;
  const trick = round.trick || null;
  const meId = you.id;
  const order = (round.playerIds || view.players.filter((p) => !p.left).map((p) => p.id)).slice();
  const hand = (you.hand || []).slice();
  const ledSuit = trick ? trick.ledSuit || null : null;
  const playable = (you.playable && you.playable.length ? you.playable : legalPlays(hand, ledSuit)).slice();
  const plays = trick ? trick.plays.map((p) => ({ playerId: p.playerId, cardId: p.cardId })) : [];
  const trumpSuit = round.trumpSuit || null;
  const memory = level === 'hard' || level === 'impossible';

  // What has already gone. Everything below is public — it was played face up
  // in front of everybody, and the turned trump card is on the table.
  const log = round.trickLog || [];
  const onTable = new Set(hand);
  if (round.trumpCard) onTable.add(round.trumpCard);
  for (const play of plays) onTable.add(play.cardId);
  const seen = new Set(onTable);
  for (const past of log) for (const play of past.plays) seen.add(play.cardId);

  const voids = new Map(order.map((id) => [id, new Set()]));
  if (memory) {
    for (const past of log) {
      for (const play of past.plays) {
        if (suitOf(play.cardId) !== past.ledSuit) {
          const set = voids.get(play.playerId);
          if (set) set.add(past.ledSuit);
        }
      }
    }
    if (ledSuit) {
      for (const play of plays) {
        if (suitOf(play.cardId) !== ledSuit) {
          const set = voids.get(play.playerId);
          if (set) set.add(ledSuit);
        }
      }
    }
  }

  const known = memory ? seen : onTable;
  const pool = newDeck().filter((card) => !known.has(card));

  const byId = new Map(view.players.map((p) => [p.id, p]));
  const opponents = order
    .filter((id) => id !== meId)
    .map((id) => {
      const p = byId.get(id) || {};
      const bid = typeof p.bid === 'number' ? p.bid : null;
      return {
        id,
        cardsHeld: p.cardsHeld || 0,
        bid,
        need: bid == null ? null : bid - (p.tricksWon || 0),
        voids: voids.get(id) || new Set(),
      };
    });
  const oppById = new Map(opponents.map((o) => [o.id, o]));

  // Whoever has not played into this trick yet, in the order they will.
  const meIndex = order.indexOf(meId);
  const afterIds = [];
  for (let i = 1; i <= order.length - plays.length - 1; i++) {
    afterIds.push(order[(meIndex + i) % order.length]);
  }

  const bid = typeof you.bid === 'number' ? you.bid : 0;
  const won = you.tricksWon || 0;

  return {
    meId,
    order,
    hand,
    playable,
    trumpSuit,
    ledSuit,
    plays,
    bid,
    won,
    need: bid - won,
    cardsLeft: hand.length,
    afterIds,
    opponents,
    oppById,
    pool,
    memory,
  };
}

/**
 * The chance one particular opponent takes this trick off me.
 *
 * A hypergeometric guess rather than a certainty: out of the cards nobody has
 * seen, how many would beat mine, and how many of those unseen cards is this
 * player holding. Trumps only count if they are out of the suit that was led —
 * known for certain once they have shown void, estimated from the pool
 * otherwise.
 *
 * With memory the bot also weighs whether they would even WANT it. Somebody who
 * has already made their bid is trying to lose tricks, so their ace is much
 * less dangerous than it looks.
 */
function threatFrom(sit, cardId, opp) {
  if (!opp || !opp.cardsHeld || !sit.pool.length) return 0;
  const led = sit.ledSuit || suitOf(cardId);
  const size = sit.pool.length;
  let ledCount = 0;
  let inLed = 0;
  let offBeat = 0;
  for (const card of sit.pool) {
    if (suitOf(card) === led) {
      ledCount += 1;
      if (beatsCard(card, cardId, led, sit.trumpSuit)) inLed += 1;
    } else if (beatsCard(card, cardId, led, sit.trumpSuit)) {
      offBeat += 1;
    }
  }

  const held = Math.min(opp.cardsHeld, size);
  const pFollow = 1 - Math.pow(1 - inLed / size, held);
  const voidChance = opp.voids.has(led) ? 1 : Math.pow(1 - ledCount / size, held);
  const pRuff = voidChance * (1 - Math.pow(1 - offBeat / size, held));
  let p = 1 - (1 - pFollow) * (1 - pRuff);

  // Somebody who has already made their bid would rather duck — but only if
  // they have a choice. Following suit with their only card in it wins whether
  // they like it or not, so this is a discount, not a dismissal.
  if (sit.memory && opp.need != null && opp.need <= 0) p *= 0.55;
  return clamp(p, 0, 1);
}

/** The chance this card is still winning once everyone left has played. */
function safety(sit, cardId) {
  let survives = 1;
  for (const id of sit.afterIds) survives *= 1 - threatFrom(sit, cardId, sit.oppById.get(id));
  return survives;
}

/** Would this card be taking the trick if it went down now? */
function wouldWin(sit, cardId) {
  if (!sit.plays.length) return true;
  const led = sit.ledSuit || suitOf(sit.plays[0].cardId);
  const best = currentWinnerCard(sit.plays, led, sit.trumpSuit);
  return best ? beatsCard(cardId, best, led, sit.trumpSuit) : true;
}

// ── The policies ─────────────────────────────────────────────────────────────

/**
 * Easy. It is not counting anything and it does not know what it bid.
 *
 * Three flavours: one that always throws its lowest, one that leads its highest
 * and sheds its biggest useless card, and one that trumps in whenever it can.
 * All three are beatable; none of them is the same as the others.
 */
function easyChoice(sit, persona) {
  const sorted = sit.playable.slice().sort(byValueAsc);
  if (persona.lead === 'top') {
    if (!sit.plays.length) return sorted[sorted.length - 1];
    const losers = sorted.filter((c) => !wouldWin(sit, c));
    return losers.length ? losers[losers.length - 1] : sorted[0];
  }
  if (persona.lead === 'ruff' && sit.plays.length && sit.trumpSuit && sit.ledSuit !== sit.trumpSuit) {
    const trumps = sorted.filter((c) => suitOf(c) === sit.trumpSuit);
    const followingSomethingElse = sorted.every((c) => suitOf(c) !== sit.ledSuit);
    if (followingSomethingElse && trumps.length) return trumps[0];
  }
  return sorted[0];
}

/**
 * Medium and Hard, which are the same shape.
 *
 * It knows what it bid and how many it has won, so every trick is either one it
 * wants or one it is trying to give away. The difference between the two levels
 * is entirely in how good `safety()` is — Hard is working from the cards that
 * have actually gone and who has shown void, Medium from what is on the table.
 */
function coreChoice(sit, persona) {
  return sit.plays.length ? followCard(sit, persona) : leadCard(sit, persona);
}

function followCard(sit, persona) {
  const sorted = sit.playable.slice().sort(byValueAsc);
  const winners = sorted.filter((c) => wouldWin(sit, c));
  const losers = sorted.filter((c) => !wouldWin(sit, c));
  const mustWin = sit.need >= sit.cardsLeft;

  if (mustWin) {
    if (!winners.length) return sorted[0];
    return bestBy(winners, (c) => safety(sit, c) * 100 - valueOf(c) * 0.1);
  }

  if (sit.need > 0) {
    // Still short of the bid and this trick is gone: throw the LOWEST, whatever
    // the persona would rather do. A high card thrown away here is a trick this
    // hand still needs, and the duck style is about which card to shed once
    // there is nothing left to win — not about giving away winners.
    if (!winners.length) return losers[0];
    // The cheapest card that will probably still be winning at the end of the
    // trick. Winning with an ace when a nine would have done is how a hand runs
    // out of high cards two tricks early.
    const safeEnough = winners.filter((c) => safety(sit, c) >= 0.55);
    if (safeEnough.length) return safeEnough[0];
    // Nothing looks safe. Worth a go anyway if the tricks are running out.
    if (sit.need >= sit.cardsLeft - 1) return bestBy(winners, (c) => safety(sit, c));
    return losers.length ? losers[0] : winners[0];
  }

  // Bid already made: the trick is somebody else's problem.
  if (losers.length) return persona.duck === 'high' ? losers[losers.length - 1] : losers[0];
  return winners[0];
}

function leadCard(sit, persona) {
  const sorted = sit.playable.slice().sort(byValueAsc);

  // Trying NOT to win: lead the card least likely to survive.
  if (sit.need <= 0) return bestBy(sorted, (c) => (1 - safety(sit, c)) * 100 - valueOf(c) * 0.1);

  if (sit.need >= sit.cardsLeft) return bestBy(sorted, (c) => safety(sit, c) * 100 + valueOf(c) * 0.1);

  if (persona.lead === 'trump' && sit.trumpSuit) {
    const trumps = sorted.filter((c) => suitOf(c) === sit.trumpSuit);
    if (trumps.length >= 2) return trumps[trumps.length - 1];
  }
  if (persona.lead === 'low') {
    // Low, out of a short suit — running out of a suit is what makes a trump
    // useful later.
    return bestBy(sorted, (c) => -valueOf(c) - suitLength(sit.hand, suitOf(c)) * 2);
  }
  return bestBy(sorted, (c) => safety(sit, c) * 100 + valueOf(c) * 0.5);
}

/**
 * A small, deliberate wobble.
 *
 * Takes the card next door in rank instead of the best one, now and then. It
 * costs very little — the two are usually near enough the same play — and it is
 * what stops the same table position producing the same card every single time,
 * which is the thing that makes a bot readable.
 */
function wobble(sit, card, persona, rng) {
  if (!card || rng() >= persona.noise) return card;
  const sorted = sit.playable.slice().sort(byValueAsc);
  if (sorted.length < 2) return card;
  const at = sorted.indexOf(card);
  const step = rng() < 0.5 ? -1 : 1;
  return sorted[clamp(at + step, 0, sorted.length - 1)];
}

// ── Rolling a hand out ───────────────────────────────────────────────────────

/**
 * A quick, unthinking play, used inside simulations only.
 *
 * Deliberately cheap: the strength of the top level comes from playing a
 * position out a hundred different ways, not from each of those ways being
 * played brilliantly.
 */
function rolloutPick(hand, plays, ledSuit, trumpSuit, need) {
  const legal = legalPlays(hand, ledSuit);
  if (legal.length <= 1) return legal[0] || null;
  const sorted = legal.slice().sort(byValueAsc);
  if (!plays.length) return need > 0 ? sorted[sorted.length - 1] : sorted[0];
  const led = ledSuit || suitOf(plays[0].cardId);
  const best = currentWinnerCard(plays, led, trumpSuit);
  const winners = sorted.filter((c) => beatsCard(c, best, led, trumpSuit));
  if (need > 0) return winners.length ? winners[0] : sorted[0];
  const losers = sorted.filter((c) => !beatsCard(c, best, led, trumpSuit));
  return losers.length ? losers[losers.length - 1] : sorted[0];
}

/** Play a whole hand out from the top. Returns tricks won by player id. */
function runHand({ order, hands, trumpSuit, leaderId, needs, budget }) {
  const tricksWon = Object.fromEntries(order.map((id) => [id, 0]));
  let leadIndex = Math.max(0, order.indexOf(leaderId));
  while (order.some((id) => hands[id].length) && budget.left > 0) {
    const plays = [];
    let ledSuit = null;
    for (let i = 0; i < order.length; i++) {
      const id = order[(leadIndex + i) % order.length];
      if (!hands[id].length) continue;
      const card = rolloutPick(hands[id], plays, ledSuit, trumpSuit, (needs[id] || 0) - tricksWon[id]);
      if (!card) continue;
      hands[id] = hands[id].filter((c) => c !== card);
      plays.push({ playerId: id, cardId: card });
      if (!ledSuit) ledSuit = suitOf(card);
      budget.left -= 1;
    }
    if (!plays.length) break;
    const winnerId = trickWinner(plays, ledSuit, trumpSuit);
    tricksWon[winnerId] += 1;
    leadIndex = order.indexOf(winnerId);
  }
  return tricksWon;
}

/**
 * Deal the unseen cards out into a table that could actually be the one in
 * front of it: right number of cards each, and nobody handed a suit they have
 * already shown they are out of.
 *
 * Greedy with a reshuffle on failure, which is plenty — the constraints are
 * loose enough that it almost always lands first time.
 */
function sampleHands(sit, rng) {
  const live = sit.opponents.filter((o) => o.cardsHeld > 0);
  if (!live.length) return {};
  const total = live.reduce((n, o) => n + o.cardsHeld, 0);
  if (total > sit.pool.length) return null;
  // Most constrained first, or the fussy hand gets left with cards it cannot take.
  const targets = live.slice().sort((a, b) => b.voids.size - a.voids.size);

  for (let attempt = 0; attempt < 24; attempt += 1) {
    const bag = shuffled(sit.pool, rng);
    const used = new Set();
    const hands = {};
    let complete = true;
    for (const target of targets) {
      const got = [];
      for (let i = 0; i < bag.length && got.length < target.cardsHeld; i += 1) {
        const card = bag[i];
        if (used.has(card) || target.voids.has(suitOf(card))) continue;
        used.add(card);
        got.push(card);
      }
      if (got.length < target.cardsHeld) {
        complete = false;
        break;
      }
      hands[target.id] = got;
    }
    if (complete) return hands;
  }
  return null;
}

/** Finish this trick and the rest of the hand. Did I land exactly on my bid? */
function playOut(sit, dealt, candidate, budget) {
  const order = sit.order;
  const hands = {};
  for (const id of order) hands[id] = (dealt[id] || []).slice();
  hands[sit.meId] = sit.hand.filter((c) => c !== candidate);

  const tricksWon = Object.fromEntries(order.map((id) => [id, 0]));
  const needs = { [sit.meId]: sit.need };
  for (const opp of sit.opponents) needs[opp.id] = opp.need == null ? 0 : opp.need;

  const plays = sit.plays.map((p) => ({ playerId: p.playerId, cardId: p.cardId }));
  plays.push({ playerId: sit.meId, cardId: candidate });
  const ledSuit = sit.ledSuit || suitOf(candidate);

  const meIndex = order.indexOf(sit.meId);
  for (let i = 1; plays.length < order.length; i += 1) {
    const id = order[(meIndex + i) % order.length];
    const card = rolloutPick(hands[id], plays, ledSuit, sit.trumpSuit, (needs[id] || 0) - tricksWon[id]);
    if (!card) return false;
    hands[id] = hands[id].filter((c) => c !== card);
    plays.push({ playerId: id, cardId: card });
    budget.left -= 1;
  }

  const firstWinner = trickWinner(plays, ledSuit, sit.trumpSuit);
  tricksWon[firstWinner] += 1;

  const rest = runHand({
    order,
    hands,
    trumpSuit: sit.trumpSuit,
    leaderId: firstWinner,
    needs: Object.fromEntries(order.map((id) => [id, (needs[id] || 0) - tricksWon[id]])),
    budget,
  });
  return tricksWon[sit.meId] + (rest[sit.meId] || 0) === sit.need;
}

/**
 * Impossible, in play: try every legal card against a hundred tables that fit
 * everything it has seen, and keep whichever lands on its bid most often.
 *
 * Returns null when the position is too big to be worth simulating, and the
 * Hard policy takes over — which is why the top level never stalls the table.
 */
function monteCarloCard(sit, rng) {
  const candidates = sit.playable.slice().sort(byValueAsc);
  if (candidates.length < 2) return candidates[0] || null;
  if (sit.need < 0) return null; // bid already blown; nothing left to aim at
  const unknown = sit.opponents.reduce((n, o) => n + o.cardsHeld, 0);
  if (!unknown || unknown > 24 || sit.order.length > 8) return null;

  const samples = unknown <= 8 ? 60 : unknown <= 16 ? 36 : 20;
  const budget = { left: 7000 };
  const hits = new Map(candidates.map((c) => [c, 0]));
  let runs = 0;

  for (let s = 0; s < samples && budget.left > 0; s += 1) {
    const dealt = sampleHands(sit, rng);
    if (!dealt) continue;
    runs += 1;
    for (const card of candidates) {
      if (playOut(sit, dealt, card, budget)) hits.set(card, hits.get(card) + 1);
    }
  }
  if (!runs) return null;

  // Ties go to the cheapest card, because `candidates` is sorted low to high
  // and the comparison is strict.
  let best = null;
  let bestScore = -1;
  for (const card of candidates) {
    const score = hits.get(card) / runs;
    if (score > bestScore) {
      bestScore = score;
      best = card;
    }
  }
  return best;
}

/**
 * Impossible, bidding: deal itself a hundred possible tables, play each one
 * out, and bid the number that came up most often.
 *
 * Its opponents in those tables bid what their own cards are worth and play to
 * that, so it is not assuming anybody is helping it.
 */
function monteCarloBid(view, persona, rng) {
  const round = view.round;
  const you = view.you;
  const hand = you.hand || [];
  const handSize = round.handSize;
  const order = (round.playerIds || view.players.filter((p) => !p.left).map((p) => p.id)).slice();
  if (order.length < 2 || order.length > 8 || handSize > 8 || !hand.length) return null;

  const seen = new Set(hand);
  if (round.trumpCard) seen.add(round.trumpCard);
  const pool = newDeck().filter((c) => !seen.has(c));
  const meId = you.id;
  const others = order.filter((id) => id !== meId);
  if (others.length * handSize > pool.length) return null;

  const trumpSuit = round.trumpSuit || null;
  const mine = Math.round(estimateTricks(hand, trumpSuit, order.length, handSize));
  const budget = { left: 9000 };
  const counts = new Array(handSize + 1).fill(0);
  let runs = 0;

  for (let s = 0; s < 90 && budget.left > 0; s += 1) {
    const bag = shuffled(pool, rng);
    const hands = { [meId]: hand.slice() };
    const needs = { [meId]: mine };
    let at = 0;
    for (const id of others) {
      hands[id] = bag.slice(at, at + handSize);
      at += handSize;
      needs[id] = Math.round(estimateTricks(hands[id], trumpSuit, order.length, handSize));
    }
    const won = runHand({
      order,
      hands,
      trumpSuit,
      leaderId: round.leadId || order[0],
      needs,
      budget,
    });
    counts[clamp(won[meId] || 0, 0, handSize)] += 1;
    runs += 1;
  }
  if (!runs) return null;

  let best = mine;
  let bestCount = -1;
  const bold = persona.bidBias > 0;
  for (let b = 0; b <= handSize; b += 1) {
    if (counts[b] > bestCount || (counts[b] === bestCount && bold && b > best)) {
      best = b;
      bestCount = counts[b];
    }
  }
  return best;
}

// ── The forehead round ───────────────────────────────────────────────────────

/**
 * One card each, held up on your forehead: everyone else's is public and your
 * own is the one card in the game you cannot see.
 *
 * So the bot does what a person does — looks round the table, works out how
 * many of the cards it might be holding would beat what it can see, and bids
 * accordingly. It knows who is leading, which decides the suit, so this is a
 * real read rather than a coin toss.
 */
function foreheadBid(view, persona, rng) {
  const round = view.round;
  const trumpSuit = round.trumpSuit || null;
  const visible = view.players.filter((p) => p.inRound && p.card).map((p) => ({ id: p.id, card: p.card }));
  if (!visible.length) return rng() < 0.5 ? 0 : 1;

  const seen = new Set(visible.map((v) => v.card));
  if (round.trumpCard) seen.add(round.trumpCard);
  const pool = newDeck().filter((c) => !seen.has(c));
  if (!pool.length) return 0;

  const leader = visible.find((v) => v.id === round.leadId);
  let winners = 0;
  for (const mine of pool) {
    const plays = visible.map((v) => ({ playerId: v.id, cardId: v.card }));
    plays.push({ playerId: 'me', cardId: mine });
    // If somebody else is leading, their card sets the suit; if it is my lead,
    // mine does.
    const ledSuit = leader ? suitOf(leader.card) : suitOf(mine);
    if (trickWinner(plays, ledSuit, trumpSuit) === 'me') winners += 1;
  }
  return winners / pool.length + persona.bidBias * 0.12 > 0.5 ? 1 : 0;
}

// ── What the server calls ────────────────────────────────────────────────────

/**
 * What this bot bids.
 *
 * @param {object} view the redacted payload for this bot — `viewFor(state, botId)`
 * @param {{seed:string, level:string}} secret its own private settings
 * @returns {number}
 */
function chooseBid(view, secret) {
  const level = normalizeLevel(secret.level);
  const round = view.round;
  const handSize = round.handSize;
  const persona = personaFor(level, secret.seed, round.index);
  const rng = rngFrom(`${secret.seed}:bid:${round.index}`);
  const you = view.you || {};

  if (!you.hand || !you.hand.length) return clamp(foreheadBid(view, persona, rng), 0, handSize);

  const players = round.bidsNeeded || view.players.length;
  const trumpSuit = round.trumpSuit || null;

  if (level === 'impossible') {
    const simulated = monteCarloBid(view, persona, rng);
    if (simulated != null) return clamp(simulated, 0, handSize);
  }

  const raw =
    level === 'easy'
      ? easyEstimate(you.hand, trumpSuit)
      : estimateTricks(you.hand, trumpSuit, players, handSize);
  let value = Math.round(clamp(raw + persona.bidBias, 0, handSize));
  if (rng() < persona.noise) value += rng() < 0.5 ? -1 : 1;
  return clamp(value, 0, handSize);
}

/**
 * What this bot plays.
 *
 * @param {object} view the redacted payload for this bot
 * @param {{seed:string, level:string}} secret
 * @returns {string|null} a card id, or null in the forehead round — where it is
 *   holding one card it is not allowed to see, and the reducer plays it unnamed
 */
function chooseCard(view, secret) {
  const round = view && view.round;
  const you = view && view.you;
  if (!round || !you || !you.yourTurn || !round.trick) return null;
  // Forehead round: no hand travels to it, there is nothing to choose, and the
  // card goes down without anybody naming it.
  if (!you.hand) return null;

  const level = normalizeLevel(secret.level);
  const sit = situationFrom(view, level);
  if (!sit.playable.length) return null;
  if (sit.playable.length === 1) return sit.playable[0];

  const persona = personaFor(level, secret.seed, round.index);
  const trick = round.trick;
  const rng = rngFrom(`${secret.seed}:play:${round.index}:${trick.number}:${trick.plays.length}`);

  let card = null;
  if (level === 'easy') card = easyChoice(sit, persona);
  else if (level === 'impossible') card = monteCarloCard(sit, rng);
  if (!card) card = coreChoice(sit, persona);
  return wobble(sit, card, persona, rng);
}

/**
 * How long a finished trick is still on everybody's screen.
 *
 * The server settles a trick the instant the last card lands, but the playing
 * screen holds it up to be read and then slides it over to the winner — and it
 * is doing that while the server has already opened the next trick. A bot
 * leading straight away plays into an animation nobody can see through, and its
 * card is simply THERE the moment the table clears, looking like it never
 * thought at all.
 *
 * So a bot leading a new trick waits the sweep out first. Paired with
 * `TRICK_HOLD_MS + SWEEP_MS` in `public/screens/playing.js` — if either of those
 * changes, this moves with them.
 */
const SETTLE_ALLOWANCE_MS = 1600;

/**
 * How long to leave it before moving.
 *
 * Instant answers make a table feel like a spreadsheet, and identical pauses
 * make four bots feel like one. Each persona has its own rhythm.
 *
 * @param {object} view
 * @param {{seed:string, level:string}} secret
 * @param {'bid'|'play'} kind
 * @returns {number} milliseconds
 */
function thinkMs(view, secret, kind) {
  const level = normalizeLevel(secret.level);
  const round = (view && view.round) || { index: 0 };
  const persona = personaFor(level, secret.seed, round.index || 0);
  const trick = round.trick;
  const at = trick ? `${trick.number}:${trick.plays.length}` : 'bid';
  const rng = rngFrom(`${secret.seed}:pace:${round.index}:${kind}:${at}`);
  const base = kind === 'bid' ? 1100 : 750;
  const spread = kind === 'bid' ? 900 : 700;
  let ms = clamp((base + rng() * spread) * persona.pace, 400, 3200);
  // Leading a trick that is not the first one: the last one is still being
  // swept off everyone's table.
  if (kind === 'play' && trick && trick.number > 1 && !trick.plays.length) {
    ms += SETTLE_ALLOWANCE_MS;
  }
  return Math.round(ms);
}

module.exports = {
  BOT_LEVELS,
  SETTLE_ALLOWANCE_MS,
  BOT_LEVEL_LABELS,
  BOT_NAMES,
  chooseBid,
  chooseCard,
  thinkMs,
  // Exported for the tests, which check the valuation on hands built by hand.
  estimateTricks,
  easyEstimate,
  personaFor,
};
