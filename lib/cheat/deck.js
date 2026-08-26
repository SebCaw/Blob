'use strict';

const { SUITS, RANKS, shuffle } = require('../deck');

/**
 * The deck as Cheat needs it, and the arithmetic the whole game rests on.
 *
 * Nothing is removed. Jokers were never in — this app has no joker anywhere —
 * so a deck is the plain 52. What IS unusual here is that the number of decks
 * depends on how many people turned up, because the one thing that makes this
 * game bad is a hand too small to bluff with.
 *
 * **Seven cards each is the floor.** Below that you are dealt one legal claim
 * and no room to lie, and it is over in three turns.
 *
 *   one deck    52 cards, seven each up to SEVEN players
 *   two decks  104 cards, seven each up to fourteen
 *   three      156 cards, and nobody is ever short
 *
 * So one deck is a CHOICE up to seven and impossible above it, and from eight
 * players the Master picks two or three. Three is never forced: it is there for
 * a long, gentle game where big honest claims are actually possible, because
 * with twelve of every rank in the pack "four kings" stops being a tell.
 *
 * The table caps at twelve to match Chase the Ace, so the two big-table games
 * seat the same number and nobody has to remember which is which.
 *
 * Card ids carry their copy — `10H#1`, `10H#2` — the same convention Silly Head
 * and Chase the Ace use. `public/cards.js` strips the tag before drawing, so it
 * never reaches a player's eye.
 */

/**
 * The rank order claims move along, and it is a RING.
 *
 * Deliberately not `RANKS` from `lib/deck.js`, which runs two-low to ace-high
 * because that is what wins a trick. Nothing here wins a trick. This is the
 * order a claim may step along — same, one up or one down — and the house rule
 * joins the king back round to the ace, so it has no ends. Written out rather
 * than derived so the join is visible in the data instead of buried in an index
 * calculation.
 */
const CYCLE = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'];

/** The fewest cards a hand may be dealt. Below this there is nothing to play with. */
const MIN_CARDS_EACH = 7;

/** How many of one rank exist per deck. Four, and it is what makes a big claim a lie. */
const OF_EACH = 4;

/** Every deck count the game knows how to build. */
const DECK_COUNTS = [1, 2, 3];

/** What each variant seats. Capped at twelve to match the other big-table game. */
const MAX_PLAYERS = { 1: 7, 2: 12, 3: 12 };

/**
 * Every card in `copies` decks.
 *
 * @param {number} copies 1, 2 or 3
 * @returns {string[]}
 */
function buildDeck(copies) {
  if (!DECK_COUNTS.includes(copies)) throw new Error(`Cheat plays one, two or three decks, not ${copies}`);
  const deck = [];
  for (let copy = 1; copy <= copies; copy++) {
    for (const suit of SUITS) {
      for (const rank of RANKS) deck.push(`${rank}${suit}#${copy}`);
    }
  }
  return deck;
}

/**
 * The rank of a card id, copy tag and suit stripped.
 *
 * Written here rather than borrowed from `lib/deck.js`, whose `parseCard` does
 * NOT understand the `#1` copy tag and throws on one. Every game in this app
 * that deals more than one deck has needed its own, which is worth knowing
 * before reaching for the shared helper.
 */
function rankOf(cardId) {
  const raw = String(cardId);
  const hash = raw.indexOf('#');
  const face = hash === -1 ? raw : raw.slice(0, hash);
  return face.slice(0, -1);
}

/** The suit of a card id, copy tag stripped. Used only for sorting a hand. */
function suitOf(cardId) {
  const raw = String(cardId);
  const hash = raw.indexOf('#');
  const face = hash === -1 ? raw : raw.slice(0, hash);
  return face.slice(-1);
}

/**
 * The fewest decks a table of this size can play with.
 *
 * A floor, not the answer — see `deckOptions`.
 *
 * @param {number} playerCount
 */
function minimumDecks(playerCount) {
  return playerCount * MIN_CARDS_EACH > 52 ? 2 : 1;
}

/**
 * The deck counts the Master may choose from at this table size.
 *
 * Up to seven it is one or two: one is the sharp game, two is the forgiving
 * one. From eight, one deck cannot give everybody seven cards, so it drops off
 * the list entirely and three appears in its place.
 *
 * @param {number} playerCount
 * @returns {number[]}
 */
function deckOptions(playerCount) {
  return playerCount >= 8 ? [2, 3] : [1, 2];
}

/**
 * How the deal comes out, so the lobby can say so before anybody commits.
 *
 * Returned rather than described, because "eight each, and four of you get
 * nine" is exactly the sort of thing people want to see before picking a deck
 * count and exactly the sort of thing that is tedious to work out in your head.
 *
 * @param {number} playerCount
 * @param {number} copies
 * @returns {{each:number, extra:number, cards:number}}
 */
function dealShape(playerCount, copies) {
  const cards = 52 * copies;
  if (!playerCount) return { each: 0, extra: 0, cards };
  return { each: Math.floor(cards / playerCount), extra: cards % playerCount, cards };
}

/**
 * Sort a hand: by rank along the claim ring, then by suit.
 *
 * Sorted, unlike Chase the Ace, and for the opposite reason. There the order of
 * a hand is the game and sorting it would hand the table a free read. Here
 * nobody ever sees your hand at all, so the order is pure presentation — and
 * having your three nines sat together is most of how you spot what you can
 * honestly claim. Sorting along the CYCLE rather than by trick value means the
 * ace sits next to the two, which is where these rules say it is.
 */
function sortHand(cards) {
  return cards
    .slice()
    .sort(
      (a, b) =>
        CYCLE.indexOf(rankOf(a)) - CYCLE.indexOf(rankOf(b)) ||
        SUITS.indexOf(suitOf(a)) - SUITS.indexOf(suitOf(b)) ||
        a.localeCompare(b)
    );
}

/**
 * Deal the whole deck out, one card at a time round the table.
 *
 * Everything goes out and hands are uneven. That is simply the game — there is
 * no stock to draw from, so a card held back would be a card that can never be
 * played, and a game that can never end.
 *
 * @param {string} seed
 * @param {string[]} playerIds
 * @param {number} copies
 * @returns {Record<string, string[]>}
 */
function deal(seed, playerIds, copies) {
  const cards = shuffle(buildDeck(copies), seed);
  /** @type {Record<string, string[]>} */
  const hands = {};
  for (const id of playerIds) hands[id] = [];
  cards.forEach((card, i) => {
    hands[playerIds[i % playerIds.length]].push(card);
  });
  for (const id of playerIds) hands[id] = sortHand(hands[id]);
  return hands;
}

module.exports = {
  SUITS,
  RANKS,
  CYCLE,
  OF_EACH,
  DECK_COUNTS,
  MIN_CARDS_EACH,
  MAX_PLAYERS,
  buildDeck,
  rankOf,
  suitOf,
  minimumDecks,
  deckOptions,
  dealShape,
  sortHand,
  deal,
};
