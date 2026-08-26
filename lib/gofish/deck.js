'use strict';

const { SUITS, RANKS, shuffle } = require('../deck');

/**
 * The deck as Go Fish needs it, and the arithmetic of the deal.
 *
 * One deck, fifty-two cards, jokers out — this app has no joker anywhere. There
 * is no variant axis here at all, which makes this the plainest deck module in
 * the repo and is worth saying out loud: Cheat needed one, two or three decks
 * because a hand too small to bluff with ruins it; Go Fish needs exactly
 * thirteen books to exist, no more and no fewer, because "most books" is the
 * whole scoreboard. A second deck would put eight of every rank in play and
 * there is no sensible answer to what a book is then.
 *
 * So card ids carry NO copy tag — `10H`, not `10H#1` — and `rankOf` here is the
 * plain one. Silly Head, Chase the Ace and Cheat all needed their own because
 * they deal more than one deck; this one does not.
 *
 * **The deal.** Seven cards each at three players, five each at four or more.
 * That is the published game and it is right: at three, five cards each leaves
 * a thirty-seven card pool and most of the evening is fishing.
 *
 *   3 players   7 each   21 out, 31 in the pool
 *   4 players   5 each   20 out, 32 in the pool
 *   5 players   5 each   25 out, 27 in the pool
 *   6 players   5 each   30 out, 22 in the pool
 */

/** How many of a rank make a book. Four, and there are thirteen of them. */
const OF_EACH = 4;

/** Every book there is. Thirteen, which is also how the game ends. */
const BOOKS_IN_DECK = RANKS.length;

/** The fewest and most this game seats. Seb's numbers. */
const MIN_PLAYERS = 3;
const MAX_PLAYERS = 6;

/**
 * How many cards each player starts with.
 *
 * The small-table bump, and the only branch in this file. Below four players a
 * five-card hand leaves too much of the deck face down, and a game of Go Fish
 * whose main activity is drawing from the pool is a game with no questions in
 * it.
 *
 * @param {number} playerCount
 */
function handSizeFor(playerCount) {
  return playerCount <= 3 ? 7 : 5;
}

/**
 * How the deal comes out, so the lobby can say so before anybody commits.
 *
 * @param {number} playerCount
 * @returns {{each:number, dealt:number, pool:number}}
 */
function dealShape(playerCount) {
  if (!playerCount) return { each: 0, dealt: 0, pool: 52 };
  const each = handSizeFor(playerCount);
  const dealt = each * playerCount;
  return { each, dealt, pool: 52 - dealt };
}

/** Every card in the pack, unshuffled. */
function buildDeck() {
  const deck = [];
  for (const suit of SUITS) {
    for (const rank of RANKS) deck.push(`${rank}${suit}`);
  }
  return deck;
}

/** The rank of a card id. One deck, so no copy tag to strip. */
function rankOf(cardId) {
  return String(cardId).slice(0, -1);
}

/** The suit of a card id. Used only for laying a hand out. */
function suitOf(cardId) {
  return String(cardId).slice(-1);
}

/**
 * Sort a hand by rank, then by suit.
 *
 * Purely presentation — nothing in this game cares what order you hold your
 * cards in, and nobody ever sees them. What it is FOR is having your three
 * sevens sat next to each other, because spotting that is how you decide what
 * to ask for, and a fan with them scattered across it makes you do the work
 * twice on every turn.
 *
 * Contrast Chase the Ace, where the order of a hand is authoritative state and
 * sorting it would hand the table a free read.
 */
function sortHand(cards) {
  return cards
    .slice()
    .sort(
      (a, b) =>
        RANKS.indexOf(rankOf(a)) - RANKS.indexOf(rankOf(b)) ||
        SUITS.indexOf(suitOf(a)) - SUITS.indexOf(suitOf(b)) ||
        a.localeCompare(b)
    );
}

/**
 * Deal, and leave the rest face down as the pool.
 *
 * Unlike every other game in this repo the deck does NOT all go out, and the
 * part left over is the object the whole game is named after.
 *
 * @param {string} seed
 * @param {string[]} playerIds
 * @returns {{hands: Record<string, string[]>, pool: string[]}}
 */
function deal(seed, playerIds) {
  const cards = shuffle(buildDeck(), seed);
  const each = handSizeFor(playerIds.length);
  /** @type {Record<string, string[]>} */
  const hands = {};
  let at = 0;
  // One card at a time round the table, the way it is actually dealt.
  for (const id of playerIds) hands[id] = [];
  for (let round = 0; round < each; round += 1) {
    for (const id of playerIds) {
      hands[id].push(cards[at]);
      at += 1;
    }
  }
  for (const id of playerIds) hands[id] = sortHand(hands[id]);
  return { hands, pool: cards.slice(at) };
}

module.exports = {
  SUITS,
  RANKS,
  OF_EACH,
  BOOKS_IN_DECK,
  MIN_PLAYERS,
  MAX_PLAYERS,
  buildDeck,
  rankOf,
  suitOf,
  handSizeFor,
  dealShape,
  sortHand,
  deal,
};
