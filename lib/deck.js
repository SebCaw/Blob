'use strict';

/**
 * The deck, the deal, and the two rules that decide a trick.
 *
 * Online mode only. In table mode the cards are in people's hands and the app
 * never sees them — nothing in here is reachable from a table game.
 *
 * Pure, like the rest of `lib/`: no clock, no `Math.random()`. A deal is driven
 * by a seed the caller supplies and stores, so the same round can be dealt again
 * exactly — which is what turns a suspicious hand into something auditable
 * rather than something to argue about.
 */

/** Suit letters, in the order a deck is built. Card ids end with one of these. */
const SUITS = ['S', 'H', 'D', 'C'];

/** Rank codes, low to high. `10` is two characters, so ids are parsed, never sliced blind. */
const RANKS = ['2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A'];

/** The red suits. Kept here so the hand sorter and the card faces agree on one answer. */
const RED_SUITS = ['H', 'D'];

/** A standard deck, and the hard ceiling online — no second deck, ever. */
const DECK_SIZE = SUITS.length * RANKS.length;

/**
 * Every card, in a fixed order: 52 distinct ids, no jokers.
 *
 * Built from scratch on every call, so a caller that shuffles cannot disturb
 * anyone else's deck.
 *
 * @returns {string[]} card ids, e.g. `["2S", "3S", ..., "AC"]`
 */
function newDeck() {
  const deck = [];
  for (const suit of SUITS) {
    for (const rank of RANKS) deck.push(rank + suit);
  }
  return deck;
}

/**
 * Split a card id into its parts. The suit is the last character and the rank is
 * everything before it, so `10H` needs no special case.
 *
 * @param {string} cardId
 * @returns {{id:string, rank:string, suit:string, value:number, red:boolean}}
 */
function parseCard(cardId) {
  if (typeof cardId !== 'string' || cardId.length < 2) throw new Error(`Not a card: ${cardId}`);
  const suit = cardId.slice(-1);
  const rank = cardId.slice(0, -1);
  const index = RANKS.indexOf(rank);
  if (!SUITS.includes(suit) || index === -1) throw new Error(`Not a card: ${cardId}`);
  return { id: cardId, rank, suit, value: index + 2, red: RED_SUITS.includes(suit) };
}

/**
 * The suit of a card id.
 * @param {string} cardId
 * @returns {string}
 */
function suitOf(cardId) {
  return parseCard(cardId).suit;
}

/**
 * The rank value of a card id: 2 low, 14 for an ace.
 * @param {string} cardId
 * @returns {number}
 */
function valueOf(cardId) {
  return parseCard(cardId).value;
}

/**
 * Turn any seed — a number, or a round id like `r_3f9c` — into a 32-bit integer.
 * Strings are hashed (xmur3) so a seed can be something readable that the game
 * already has to hand.
 *
 * @param {number|string} seed
 * @returns {number}
 */
function seedFrom(seed) {
  if (typeof seed === 'number' && Number.isFinite(seed)) return seed >>> 0;
  const str = String(seed);
  let h = 1779033703 ^ str.length;
  for (let i = 0; i < str.length; i++) {
    h = Math.imul(h ^ str.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  h = Math.imul(h ^ (h >>> 16), 2246822507);
  h = Math.imul(h ^ (h >>> 13), 3266489909);
  return (h ^ (h >>> 16)) >>> 0;
}

/**
 * mulberry32 — a small, fast PRNG, inlined rather than depended on.
 *
 * @param {number} seed 32-bit
 * @returns {() => number} successive floats in [0, 1)
 */
function makeRandom(seed) {
  let a = seed >>> 0;
  return function random() {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Fisher-Yates, unbiased, over the whole deck. Returns a new array; the input is
 * left alone.
 *
 * Deliberately not `sort(() => Math.random() - 0.5)`, which is neither uniform
 * nor stable and quietly favours the order it started from.
 *
 * @param {string[]} deck
 * @param {number|string} seed
 * @returns {string[]}
 */
function shuffle(deck, seed) {
  const random = makeRandom(seedFrom(seed));
  const out = deck.slice();
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    const swap = out[i];
    out[i] = out[j];
    out[j] = swap;
  }
  return out;
}

/**
 * Deal a round: a fresh 52-card deck, shuffled from this round's own seed, so
 * nothing carries over from the hand before.
 *
 * The card turned after the deal sets trumps. When the deal consumes the whole
 * deck there is no card left to turn, and that hand is no-trumps — the only way
 * no-trumps ever happens.
 *
 * @param {number|string} seed this round's seed
 * @param {string[]} playerIds seating order; hands are dealt in this order
 * @param {number} handSize cards each
 * @returns {{hands:Object<string,string[]>, trumpCard:string|null, trumpSuit:string|null, stock:string[]}}
 */
function deal(seed, playerIds, handSize) {
  if (!Array.isArray(playerIds) || playerIds.length < 2) {
    throw new Error('A deal needs at least two players');
  }
  if (!Number.isInteger(handSize) || handSize < 1) {
    throw new Error('Hand size must be a whole number of at least 1');
  }
  const needed = playerIds.length * handSize;
  if (needed > DECK_SIZE) {
    throw new Error(
      `${playerIds.length} players at ${handSize} cards each needs ${needed} cards, and a deck has ${DECK_SIZE}`
    );
  }

  const deck = shuffle(newDeck(), seed);
  const hands = {};
  let at = 0;
  for (const id of playerIds) {
    hands[id] = deck.slice(at, at + handSize);
    at += handSize;
  }
  const trumpCard = at < deck.length ? deck[at] : null;
  return {
    hands,
    trumpCard,
    trumpSuit: trumpCard ? suitOf(trumpCard) : null,
    stock: deck.slice(trumpCard ? at + 1 : at),
  };
}

/**
 * The largest starting hand a given number of players can be dealt online, so
 * the lobby can cap its stepper rather than refusing at start time.
 *
 * A card is kept back to turn for trumps, so the biggest round must leave one:
 * `players × handSize + 1 ≤ 52`.
 *
 * @param {number} playerCount
 * @returns {number} 0 if even one card each is impossible
 */
function maxOnlineHandSize(playerCount) {
  if (!Number.isInteger(playerCount) || playerCount < 1) return 0;
  return Math.floor((DECK_SIZE - 1) / playerCount);
}

/**
 * The cards in a hand that may legally be played: follow the led suit if you
 * can, otherwise anything. Leading, everything is legal.
 *
 * The reducer enforces this; the lift in the UI only reflects it.
 *
 * @param {string[]} hand
 * @param {string|null} [ledSuit] null when leading
 * @returns {string[]} the playable subset, in hand order
 */
function legalPlays(hand, ledSuit) {
  if (!ledSuit) return hand.slice();
  const following = hand.filter((cardId) => suitOf(cardId) === ledSuit);
  return following.length ? following : hand.slice();
}

/**
 * Is this card legal to play from this hand right now?
 *
 * @param {string[]} hand
 * @param {string} cardId
 * @param {string|null} [ledSuit]
 * @returns {boolean}
 */
function isLegalPlay(hand, cardId, ledSuit) {
  return hand.includes(cardId) && legalPlays(hand, ledSuit).includes(cardId);
}

/**
 * The card to play for somebody who is not there to choose.
 *
 * Their worst legal card: a plain suit ahead of a trump, and the lowest rank of
 * whatever is left. It is what you would throw if you had given up on the trick,
 * and it never spends a trump that a returning player might want — but it is
 * deliberately a poor play, because being absent should cost you the hand rather
 * than quietly play it well on your behalf.
 *
 * @param {string[]} hand
 * @param {string|null} ledSuit
 * @param {string|null} trumpSuit
 * @returns {string|null} null only for an empty hand
 */
function lowestPlay(hand, ledSuit, trumpSuit) {
  const legal = legalPlays(hand, ledSuit);
  if (!legal.length) return null;
  const plain = trumpSuit ? legal.filter((cardId) => suitOf(cardId) !== trumpSuit) : legal;
  const pool = plain.length ? plain : legal;
  return pool.reduce((worst, cardId) => (valueOf(cardId) < valueOf(worst) ? cardId : worst));
}

/**
 * Who takes the trick: the highest trump if any trump was played, otherwise the
 * highest card of the suit that was led. A card of neither suit cannot win, no
 * matter how high it is.
 *
 * @param {Array<{playerId:string, cardId:string}>} plays in the order played
 * @param {string|null} [ledSuit] defaults to the suit of the first card played
 * @param {string|null} [trumpSuit] null in a no-trumps hand
 * @returns {string|null} the winning player id, or null for an empty trick
 */
function trickWinner(plays, ledSuit, trumpSuit) {
  if (!Array.isArray(plays) || plays.length === 0) return null;
  const led = ledSuit || suitOf(plays[0].cardId);

  let winner = null;
  let best = -1;
  for (const play of plays) {
    const card = parseCard(play.cardId);
    let rank = -1;
    if (trumpSuit && card.suit === trumpSuit) rank = 100 + card.value;
    else if (card.suit === led) rank = card.value;
    if (rank > best) {
      best = rank;
      winner = play.playerId;
    }
  }
  return winner;
}

module.exports = {
  SUITS,
  RANKS,
  RED_SUITS,
  DECK_SIZE,
  newDeck,
  parseCard,
  suitOf,
  valueOf,
  seedFrom,
  makeRandom,
  shuffle,
  deal,
  maxOnlineHandSize,
  legalPlays,
  isLegalPlay,
  lowestPlay,
  trickWinner,
};
