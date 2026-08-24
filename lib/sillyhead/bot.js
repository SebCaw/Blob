'use strict';

const { seedFrom, makeRandom, RANKS, SUITS } = require('../deck');
const { rankOf, valueOf, HAND_COUNT } = require('./deck');
const { RESET_RANK, SACK_RANK, LOW_RANK, RUN_TO_SACK, VALUE } = require('./rules');

/**
 * The Silly Head bots.
 *
 * ── The one rule everything here rests on ────────────────────────────────────
 *
 * A bot is handed the SAME redacted payload a phone gets: `viewFor(state,
 * botId)`. Its own hand, everybody's face-up cards, how many cards each player
 * is holding, the top of the pile and how big it is — and nothing else. This
 * file cannot reach `state`, so it cannot see anyone's hand, and it cannot see
 * its OWN three face-down cards either. A harder bot thinks better; it never
 * sees more, and "Impossible" means very good rather than omniscient.
 *
 * That is structural rather than a promise: if the payload does not carry it,
 * no amount of skill in here can invent it.
 *
 * ── What makes one level harder than the next ────────────────────────────────
 *
 * Not card knowledge — all four see exactly the same thing. What separates them
 * is how well they answer the three questions this game actually asks:
 *
 *   1. Do I spend a special now or keep it? A 2 and a 10 are get-out-of-jail
 *      cards, and the moment you need one is the endgame, when you are playing
 *      blind off the table. Easy burns them on sight; Impossible hoards them.
 *   2. What do I leave face up? Those three cards are played LAST, against a
 *      pile nobody can duck any more, so they should be the strongest you have.
 *      Easy leaves whatever it was dealt.
 *   3. Do I shed or do I hold? Low cards want throwing early, while there is
 *      still a deck replacing them and while the pile is low enough to take
 *      them. Duplicates want going down together. Easy does neither.
 *
 * Pure, like the rest of `lib/`: no clock, no `Math.random()`. Every choice is a
 * function of the view plus the bot's own private seed, so a game can be
 * replayed exactly.
 */

/** The four settings a Master can pick, easiest first. */
const BOT_LEVELS = ['easy', 'medium', 'hard', 'impossible'];

/**
 * What the lobby says about each one.
 *
 * Deliberately vague about METHOD. A bot advertising "always saves its 10s" has
 * told you how to beat it.
 */
const BOT_LEVEL_LABELS = {
  easy: { name: 'Easy', blurb: 'Still learning. Kind to a beginner.' },
  medium: { name: 'Medium', blurb: 'Plays a sensible hand.' },
  hard: { name: 'Hard', blurb: 'Saves the good stuff for later.' },
  impossible: { name: 'Impossible', blurb: 'You have been warned.' },
};

/** Short names, so a table of bots still reads like a table of people. */
const BOT_NAMES = [
  'Ada', 'Bo', 'Cleo', 'Dex', 'Enzo', 'Fern', 'Gus', 'Hana',
  'Iggy', 'Juno', 'Kit', 'Lex', 'Mo', 'Nia', 'Otto', 'Pip',
];

/** How long a bot appears to think. Long enough to read as a person taking a turn. */
const MIN_THINK_MS = 420;
const MAX_THINK_MS = 2400;

/**
 * How often a bot ignores its own best answer and plays something else legal.
 *
 * This is what separates the top of the ladder, and it is deliberate.
 *
 * Every heuristic worth having is already in the policy below, and it was tuned
 * by playing the levels against each other several thousand times. Past a
 * point the additions stopped helping and started hurting — reading the next
 * player's face-up cards, hoarding specials harder, spending a 9 for the block:
 * all measured, all worse. Hard was sat at the ceiling of what this policy can
 * do, which left Impossible with nothing to be better AT.
 *
 * So the ladder is honest about what it is: the same good policy, followed less
 * reliably the further down you go. A harder bot is not one that sees more — it
 * still sees exactly what your phone sees — it is one that makes fewer
 * mistakes. Which is also what it means in a person.
 */
const SLIP = { easy: 1, medium: 0.34, hard: 0.13, impossible: 0 };

/** What a special is worth over and above its rank, when deciding what to keep. */
const SPECIAL_BONUS = { [RESET_RANK]: 9, [SACK_RANK]: 12, [LOW_RANK]: 3 };

function normalizeLevel(level) {
  return BOT_LEVELS.includes(level) ? level : 'medium';
}

/** A little randomness, from the bot's own seed and the position it is in. */
function rngFrom(key) {
  return makeRandom(seedFrom(String(key)));
}

/**
 * How much a bot wants to hang on to a card.
 *
 * Rank plus a bonus for the cards that get you out of trouble. It is the same
 * scale everywhere — what to leave face up, what to throw away first, what to
 * keep back — because they are all the same question asked from different ends.
 */
function keepValue(cardId) {
  const rank = rankOf(cardId);
  return VALUE[rank] + (SPECIAL_BONUS[rank] || 0);
}

/**
 * How much a bot wants this card FACE UP rather than in its hand.
 *
 * Not the same question as `keepValue`, and getting them confused is what made
 * Impossible the worst of the three good bots for a while: it was proudly
 * parking its 2s and 10s on the table. A special is an escape, and an escape is
 * only worth having when you can reach for it — which is any time it is in your
 * hand, and only at the very end when it is under one. So a high plain card is
 * what you want showing, and the specials stay where you can use them.
 */
function tableValue(cardId) {
  const rank = rankOf(cardId);
  return VALUE[rank] - (SPECIAL_BONUS[rank] || 0);
}

const isSpecial = (cardId) => {
  const rank = rankOf(cardId);
  return rank === RESET_RANK || rank === SACK_RANK;
};

// ── The sort ─────────────────────────────────────────────────────────────────

/**
 * One move in the sort, or null when this bot is happy.
 *
 * Returned one at a time because the player commands are one at a time, and a
 * bot must go through exactly the same door a phone does. The order is fixed
 * and each step strictly changes something, so it always terminates:
 *
 *   fill an empty pile  ->  bin a 3  ->  stack a pair  ->  swap something better
 *   up  ->  done
 *
 * Filling comes first because a pile left empty is the one thing that stops you
 * finishing, and the bot may have emptied it itself on the previous step.
 *
 * @param {object} view `viewFor(state, botId)`
 * @param {{seed:string, level:string}} secret
 * @returns {{type:string, [k:string]:any}|null}
 */
function nextSortMove(view, secret) {
  const level = normalizeLevel(secret.level);
  const you = view.you;
  if (!you || you.sortDone) return null;
  const hand = you.hand.slice();
  const up = you.up.map((stack) => stack.slice());
  const tops = up.map((stack) => (stack.length ? stack[stack.length - 1] : null));

  // 1. Three piles, always. A pile is only ever empty because this bot just
  //    lifted a card off it to put a better one down — or because it binned a 3
  //    — so the card that goes back is the BEST one in hand.
  //
  //    This is also what makes the swap in step 4 terminate: every cycle takes
  //    the weakest card off the table and puts a strictly better one down, so
  //    the value of the three face-up cards only ever goes up, and there are
  //    finitely many cards. Fill with the lowest instead and the bot puts the
  //    same card straight back, for ever.
  const emptyAt = tops.findIndex((card) => !card);
  if (emptyAt !== -1 && hand.length) {
    const card = level === 'easy' ? hand[0] : highestBy(hand, tableValue);
    return { type: 'sort/place', cardId: card, pileIndex: emptyAt };
  }

  // 2. Bin every 3. Even Easy does this — it is the one part of the sort that
  //    is pure upside, and a bot that kept its 3s would look broken rather than
  //    weak.
  const three = hand.find((card) => rankOf(card) === '3') || tops.find((card) => card && rankOf(card) === '3');
  if (three) return { type: 'sort/bin', cardId: three };

  // Easy stops here: dealt what it was dealt, minus the 3s.
  if (level === 'easy') return null;

  // 3. Stack a pair, which is what buys another card out of the deck. Worth
  //    doing while there is a deck to buy from — but a PAIR, and no deeper.
  //    Without that cap a bot would keep matching and drawing until it had
  //    emptied the stock into its own hand, which is not the house rule and
  //    would wreck the game for everybody else at the table.
  //
  //    The hand-size guard is what makes stacking and unstacking terminate.
  //    Fishing only pays while your hand is small enough to be refilled, and
  //    once step 4 has started handing pairs back your hand is above three — so
  //    the bot cannot fall into stacking and unstacking the same pair for ever.
  if (view.stock > 0 && hand.length <= HAND_COUNT) {
    const pair = findPair(hand, up);
    if (pair) return { type: 'sort/stack', cardId: pair.cardId, pileIndex: pair.pileIndex };
  }

  // 3b. Take the spares back. Nothing may be left piled when you say you are
  //     ready, so a bot that fished has to tidy up after itself like anybody.
  const stacked = up.findIndex((stack) => stack.length > 1);
  if (stacked !== -1) return { type: 'sort/take', pileIndex: stacked };

  // Medium fishes but does not choose. Hard and Impossible make sure the three
  // cards they will be playing blind at the end are the best they have.
  if (level === 'medium') return null;

  // 4. Swap: is a card in hand worth more face up than what is on that pile?
  //    Taking it off is a move of its own, and the fill at the top of this
  //    function puts the better one down next time round.
  //
  //    Only ever from a pile holding ONE card. A stacked pair is one this bot
  //    made on purpose in step 3, and pulling it apart here would let step 3
  //    put it straight back — which it did, for ever, until this line existed.
  //    It is also what makes the swap terminate: the single cards on the table
  //    only ever get better, and there are finitely many cards.
  const bestInHand = highestBy(hand, tableValue);
  if (!bestInHand) return null;
  const weakestPile = up.reduce(
    (worst, stack, index) =>
      stack.length !== 1 ? worst : worst === -1 || tableValue(stack[0]) < tableValue(up[worst][0]) ? index : worst,
    -1
  );
  if (weakestPile === -1) return null;
  const gain = tableValue(bestInHand) - tableValue(up[weakestPile][0]);
  // Impossible swaps for any improvement; Hard only bothers for a real one, so
  // the two do not play the same opening.
  const worthIt = gain >= 4;
  if (!worthIt) return null;
  return { type: 'sort/take', pileIndex: weakestPile };
}

/** A card in hand matching the top of a pile that is not already a pair. */
function findPair(hand, up) {
  for (let pileIndex = 0; pileIndex < up.length; pileIndex++) {
    const stack = up[pileIndex];
    if (stack.length !== 1) continue; // empty, or already doubled
    const top = stack[0];
    const match = hand.find((card) => rankOf(card) === rankOf(top));
    if (match) return { cardId: match, pileIndex };
  }
  return null;
}

// ── Playing ──────────────────────────────────────────────────────────────────

/**
 * The command a bot plays on its turn.
 *
 * Never null: a bot that cannot decide would leave a table sat waiting, which
 * is worse than any bad play. Every path ends in a legal command, and the
 * reducer is still the thing that says so.
 *
 * @param {object} view `viewFor(state, botId)`
 * @param {{seed:string, level:string}} secret
 * @returns {{type:string, [k:string]:any}}
 */
function chooseMove(view, secret) {
  const level = normalizeLevel(secret.level);
  const you = view.you;
  const rng = rngFrom(`${secret.seed}:move:${view.version}`);

  // The last three. Nobody knows what they are, so there is nothing to think
  // about — only which one to reach for.
  if (you.zone === 'down') {
    const available = you.downLeft.map((there, index) => (there ? index : -1)).filter((i) => i !== -1);
    const pileIndex = available.length ? available[Math.floor(rng() * available.length)] : 0;
    return { type: 'play/flip', pileIndex };
  }

  const playable = you.playable.slice();
  if (!playable.length) return takePile(view, level);

  // Sometimes the right move is to take a small pile you could have beaten.
  //
  // It is a real tactic — a couple of cards you can use, for a turn — and it is
  // also the only thing that reliably breaks a standoff. With every 2 and 10
  // sacked, two players holding the last low cards can hand the same handful
  // back and forth for ever: a 9 on the pile blocks everything above it, so the
  // only cards that can move are the ones already going round. Somebody has to
  // do something different, and no bot can see that it is stuck in a circle.
  // A quarter chance, only when it is nearly free, is enough to end it.
  // The chance falls away as the pile grows, because taking twenty cards is a
  // real cost and taking two is not — but it never reaches zero, which is the
  // point: a standoff that holds the pile at six would otherwise never break.
  // Easy does it too. It plays badly on purpose; it does not get to hang the
  // table, and picking up a small pile for no reason is a beginner's move
  // anyway.
  if (!beingRefilled(view) && view.pile.count > 0) {
    if (rng() < breakoutChance(view)) return takePile(view, level);
  }

  const groups = groupByRank(playable);
  // Scored first whatever happens, because scoring is also what decides HOW
  // MANY of a number may go down — a slip is playing the wrong card, not an
  // illegal one.
  // Counted once per turn, not once per candidate — it walks every card in play.
  const count = level === 'impossible' ? countCards(view) : null;
  const scored = groups.map((group) => ({ group, score: scoreGroup(view, group, level, rng, count) }));
  scored.sort((a, b) => b.score - a.score);

  const slip = SLIP[level] ?? 0;
  const chosen = slip && rng() < slip ? scored[Math.floor(rng() * scored.length)].group : scored[0].group;

  return { type: 'play/cards', cardIds: chosen.cards.slice(0, chosen.play) };
}

/**
 * Will this player actually draw a card after their turn?
 *
 * NOT the same as "there are cards left in the deck", and confusing the two
 * cost a long afternoon. You only draw back up to three, so the moment your
 * hand is bigger than that the deck stops replacing anything you play — and it
 * can sit there at thirty-nine cards, untouched, for the rest of the game while
 * two players hand each other the same sets for ever.
 *
 * Everything about how freely a bot spends cards hangs off this rather than off
 * the deck, because this is the question that was actually being asked.
 *
 * @param {object} view
 * @returns {boolean}
 */
function beingRefilled(view) {
  return view.stock > 0 && view.you.hand.length <= HAND_COUNT;
}

/**
 * How willing a bot is to take a pile it could have beaten.
 *
 * Two parts. The first falls away as the pile grows, because taking twenty
 * cards is a real cost and taking two is not. The second grows with how long
 * the game has gone on, and it is the guarantee: a normal game is settled in
 * two or three hundred commands, so past that something is going round in a
 * circle, and every extra turn makes a bot likelier to do something else.
 *
 * It has to be a guarantee rather than a hope, because the alternative is a
 * table that never finishes. Two players holding the last low cards with every
 * 2 and 10 already sacked can hand the same handful back and forth for ever —
 * a 9 on the pile blocks everything above it, so only those cards can move —
 * and no bot can see that it is in a loop. This is what gets out of one.
 *
 * @param {object} view
 * @returns {number} a probability
 */
function breakoutChance(view) {
  const size = 0.36 / Math.max(3, view.pile.count);
  const dragging = Math.max(0, (view.version || 0) - 600) / 4000;
  return Math.min(0.6, size + dragging);
}

/** Take the pile, and pick which face-up card it costs if it costs one. */
function takePile(view, level) {
  const you = view.you;
  if (you.zone !== 'up') return { type: 'play/takePile' };
  // Stuck on the table: you lose one of the three, so lose the one you would
  // least like to be holding at the end.
  const candidates = you.up
    .map((stack, index) => (stack.length ? { index, card: stack[stack.length - 1] } : null))
    .filter(Boolean);
  if (!candidates.length) return { type: 'play/takePile' };
  // Easy grabs the first one. Everyone else gives up their weakest.
  const pick =
    level === 'easy'
      ? candidates[0]
      : candidates.reduce((worst, c) => (keepValue(c.card) < keepValue(worst.card) ? c : worst));
  return { type: 'play/takePile', upIndex: pick.index };
}

// ── Counting the cards (Impossible only) ─────────────────────────────────────

/**
 * What is left in the game, and who can answer what.
 *
 * Everything this uses is public. Every card in the pile went down face up in
 * front of the room; every sacked card did too before it went; the face-up
 * cards are face up; and a pile somebody picks up is watched by everybody as
 * they take it. Add your own hand and you can work out exactly which cards are
 * still unaccounted for — which is what a person who has been paying attention
 * does, and the only thing separating Impossible from Hard.
 *
 * It is memory, not X-ray vision. Nothing in here reads a card the payload did
 * not carry, and the payload is the same one your phone gets.
 *
 * @param {object} view
 * @returns {{unseen:Record<string,number>, unseenTotal:number}}
 */
function countCards(view) {
  const decks = view.decks || 2;
  /** Every rank starts at four a deck. */
  const unseen = {};
  for (const rank of RANKS) unseen[rank] = SUITS.length * decks;

  const strike = (cards) => {
    for (const card of cards || []) {
      const rank = rankOf(card);
      if (unseen[rank] > 0) unseen[rank] -= 1;
    }
  };

  strike(view.you.hand);
  strike(view.pile.cards);
  strike(view.sackedCards);
  for (const player of view.players) {
    // Everybody's face-up cards, mine included — which is why my own are NOT
    // struck separately above. Counting them twice makes the deck look emptier
    // than it is, and every guess downstream comes out wrong.
    strike((player.up || []).flat());
    // Only what the room saw them take. The rest of their hand is theirs.
    if (player.id !== view.you.id) strike(player.knownCards);
  }

  let unseenTotal = 0;
  for (const rank of RANKS) unseenTotal += unseen[rank];
  return { unseen, unseenTotal };
}

/**
 * How close this rank is to being unbeatable, given what nobody has seen yet.
 *
 * 1 means nothing left in the game can go on top of it. A card like that is
 * worth as much as a special and wants keeping for the moment you are stuck.
 *
 * @param {string} rank
 * @param {{unseen:Record<string,number>, unseenTotal:number}} count
 * @returns {number} between 0 and 1
 */
function unbeatableness(rank, count) {
  if (!count.unseenTotal) return 0;
  let beats = 0;
  for (const r of RANKS) {
    if (r === RESET_RANK || r === SACK_RANK || VALUE[r] >= VALUE[rank]) beats += count.unseen[r];
  }
  return 1 - beats / count.unseenTotal;
}

/** Whoever plays after you, or null at a table of one. */
function nextPlayer(view) {
  const order = view.players.filter((p) => !p.out && !p.left);
  const me = order.findIndex((p) => p.id === view.you.id);
  if (me === -1 || order.length < 2) return null;
  return order[(me + 1) % order.length];
}

/** Everything a player has still to get rid of: hand, table and the hidden three. */
function remainingCards(view, player) {
  if (!player) return 0;
  return (player.cardsHeld || 0) + (player.up || []).flat().length + (player.downLeft || 0);
}

/**
 * How likely is the next player to be able to follow this rank?
 *
 * Two parts, and the first is certainty rather than guesswork: if the room
 * watched them pick up an ace, they have an ace. Beyond that it is the unseen
 * cards, spread over the hidden hands and whatever is left in the deck.
 *
 * Returns 0 when there is nobody to strand and 1 when they certainly can
 * follow, so a caller can treat it as "how safe is this card".
 *
 * @param {object} view
 * @param {string} rank the rank that would be left on top
 * @param {{unseen:Record<string,number>, unseenTotal:number}} count
 * @returns {number} between 0 and 1
 */
function chanceTheyFollow(view, rank, count) {
  const next = nextPlayer(view);
  if (!next) return 1;

  const answers = (card) => {
    const theirs = rankOf(card);
    return theirs === RESET_RANK || theirs === SACK_RANK || VALUE[theirs] >= VALUE[rank];
  };

  // Cards we KNOW they hold, and — once their hand is empty — the three in
  // front of them, which everybody can see.
  const certain = (next.knownCards || []).concat(
    next.cardsHeld === 0 ? (next.up || []).flat() : []
  );
  if (certain.some(answers)) return 1;

  // What they might be holding that nobody has seen.
  const hidden = Math.max(0, (next.cardsHeld || 0) - (next.knownCards || []).length);
  if (hidden === 0) return next.cardsHeld === 0 && !(next.up || []).flat().length ? 1 : 0;
  if (!count.unseenTotal) return 0;

  let helpful = 0;
  for (const r of RANKS) {
    if (r === RESET_RANK || r === SACK_RANK || VALUE[r] >= VALUE[rank]) helpful += count.unseen[r];
  }
  const miss = 1 - helpful / count.unseenTotal;
  // The chance that every one of their hidden cards is useless to them.
  return 1 - Math.pow(Math.max(0, miss), hidden);
}

/** Same-rank cards, with how many of them may actually go down at once. */
function groupByRank(playable) {
  const byRank = new Map();
  for (const card of playable) {
    const rank = rankOf(card);
    if (!byRank.has(rank)) byRank.set(rank, []);
    byRank.get(rank).push(card);
  }
  return [...byRank.entries()].map(([rank, cards]) => ({
    rank,
    cards: cards.slice().sort((a, b) => valueOf(a) - valueOf(b)),
    play: cards.length,
  }));
}

/**
 * How much a bot likes putting this group down, right now.
 *
 * The whole difference between the levels lives in this function. Easy scores
 * almost at random; each step up adds one more thing worth noticing.
 */
function scoreGroup(view, group, level, rng, count) {
  const you = view.you;
  const pile = view.pile;
  const rank = group.rank;
  const deckAlive = beingRefilled(view);

  // Never offer more of a number than the pile will take: four in a row sacks
  // it, and a fifth is not a legal play. Clamped here, before anything else,
  // so no level can propose a move the reducer would refuse.
  const already = pile.top && rankOf(pile.top) === rank ? pile.run : 0;
  const room = RUN_TO_SACK - already;
  const canSack = group.play >= room;
  group.play = Math.min(group.play, room);

  // A set goes down as a set.
  //
  // There was a rule here that put ONE card down once the deck was dead, and it
  // was written against a real deadlock: dumping a whole set of a number nobody
  // can beat hands the set to whoever takes the pile, and two bots traded the
  // same three aces for thousands of turns.
  //
  // Measured again, it is no longer what holds that up. Two thousand games with
  // the clamp gone — heads-up and four-handed, at every level — and not one
  // failed to finish; they came out about a quarter SHORTER, because a bot
  // shedding two cards a turn sheds them twice as fast. What actually prevents
  // the ace trade is the scoring below: a bot plays its LOWEST legal card, so
  // it never leads with an ace while it holds anything else, and the trade
  // cannot start.
  //
  // The breakout further up is a separate guarantee and stays. It was measured
  // at about one game in 250 never ending without it, and nothing here replaces
  // it.
  //
  // What the rule did cost was plain to anybody watching. One 5 down, a wait,
  // then the other 5 does not read as caution. It reads as a bot that cannot
  // count to two.
  //
  // The clamp above stays: never more of a number than the pile will take.

  let score = 0;

  // Play the lowest thing that works. While the deck is refilling you those
  // cards are free; once it is empty they are the ones that will strand you, so
  // they want shedding even more urgently. Either way the answer is the same.
  //
  // Playing your HIGHEST instead was tried and it deadlocks the game: an
  // unbeatable card forces the next player to take the pile, and they play the
  // same card straight back at you. Two bots ping-ponged three aces for two and
  // a half thousand turns before this comment existed.
  score += 20 - VALUE[rank];

  // A special is worth keeping back. How badly depends on how close the
  // endgame is — the moment you need one is when you are playing off the table.
  if (isSpecial(group.cards[0])) {
    const desperation = you.playable.length <= 1 ? 0 : 1;
    const hoard = level === 'medium' ? 8 : 14;
    score -= hoard * desperation;
    // Unless it sacks a pile worth sacking. A 10 on a big pile is not a waste,
    // it is the point of the 10.
    if (rank === SACK_RANK) score += Math.min(pile.count, 12) * (level === 'easy' ? 0 : 1.5);
  }

  // Completing four in a row sacks the pile and hands you another go, which is
  // the best thing that can happen to you in this game.
  if (canSack) {
    score += 30;
  } else if (level !== 'medium' && group.play > 1) {
    // Shedding duplicates is how you avoid being left holding a pair of kings
    // with an ace showing. Medium never thinks of it; Impossible does it
    // hardest.
    //
    // This used to apply only while the deck was still refilling you, which was
    // harmless while the rule above put one card down after the deck died — you
    // could not shed a set then anyway. Now that you can, the gate had it
    // backwards: with nothing left to replace what you play, getting rid of two
    // cards instead of one is worth MORE, not less. Without this, a bot with a
    // dead deck picked a lone king over a pair of 5s and looked exactly as
    // one-at-a-time as before.
    score += 4 * (group.play - 1);
  }

  // Hard and up: do not hand the next player an easy ride when somebody is
  // nearly out. Impossible keeps this AND the counted version below — measured,
  // and it is better with both than with either alone.
  if (level === 'hard' || level === 'impossible') {
    const closest = Math.min(...view.players.filter((p) => !p.out && p.id !== you.id).map((p) => p.cardsHeld || 0), 99);
    if (closest <= 2 && !canSack) score += VALUE[rank] * 0.8;
  }

  // Impossible remembers.
  //
  // It knows every card that has been played, every card that has been sacked,
  // and every card the room watched somebody pick up — so it can work out what
  // is left and how likely the next player is to have an answer. A card they
  // probably cannot follow puts them under; one they certainly can is worth
  // nothing extra.
  //
  // Weighed against the cost of the card rather than added on top, because the
  // ace that strands them is still an ace you no longer have. Stranding
  // somebody with a 7 is the good version of this move.
  if (level === 'impossible' && count) {
    // ...but only when it is worth doing, and mostly it is NOT.
    //
    // Measured, and it was a surprise: putting somebody under is usually a bad
    // move. They pick the pile up, yes — and the pile is then EMPTY and it is
    // their go, and leading an empty pile is the best seat at the table. Doing
    // it on principle made Impossible lose more games than Hard.
    //
    // Where it does pay is against somebody about to go out. Then the cards you
    // load them with matter more than the lead you hand them, because the
    // alternative is that they finish. So the count is spent on exactly that:
    // knowing, rather than guessing, whether the player who is nearly home can
    // answer what you are about to leave on top.
    const left = remainingCards(view, nextPlayer(view));
    if (left > 0 && left <= 5) {
      const follow = chanceTheyFollow(view, rank, count);
      score += (1 - follow) * ((6 - left) / 5) * 20;
    }
    // And the other way round: a card nobody can beat any more is an escape,
    // and escapes are for later. Once both aces have gone, a king is as good as
    // a 2 and should be treated like one.
    score -= unbeatableness(rank, count) * 22;
  }

  // A whisker of noise, so two bots at the same level are not the same bot.
  return score + rng() * 2;
}

// ── Pacing ───────────────────────────────────────────────────────────────────

/**
 * How long before the bot moves.
 *
 * Sorting is quick and everybody is doing it at once, so those steps are short
 * — a bot that took a second per step would still be tidying when the humans
 * had finished. A play is slower, because it should read as somebody deciding.
 *
 * @param {object} view
 * @param {{seed:string, level:string}} secret
 * @param {'sort'|'play'} kind
 * @returns {number}
 */
function thinkMs(view, secret, kind) {
  const rng = rngFrom(`${secret.seed}:pace:${view.version}:${kind}`);
  const base = kind === 'sort' ? 260 : 800;
  const spread = kind === 'sort' ? 260 : 900;
  return Math.round(clamp(base + rng() * spread, kind === 'sort' ? 200 : MIN_THINK_MS, MAX_THINK_MS));
}

function clamp(value, low, high) {
  return Math.max(low, Math.min(high, value));
}

function lowestBy(list, score) {
  return list.reduce((best, item) => (best === undefined || score(item) < score(best) ? item : best), undefined);
}

function highestBy(list, score) {
  return list.reduce((best, item) => (best === undefined || score(item) > score(best) ? item : best), undefined);
}

module.exports = {
  BOT_LEVELS,
  SLIP,
  BOT_LEVEL_LABELS,
  BOT_NAMES,
  nextSortMove,
  chooseMove,
  thinkMs,
  // Exported for the tests, which check the valuation on hands built by hand.
  keepValue,
  scoreGroup,
  countCards,
  chanceTheyFollow,
  remainingCards,
};
