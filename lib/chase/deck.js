'use strict';

const { SUITS, RANKS, shuffle } = require('../deck');

/**
 * The deck as Chase the Ace needs it: everything pairs except one card.
 *
 * Aces are stripped until exactly one is left, so the ace is the odd card and
 * everybody knows it from the start. That is not a spoiler — it is the game.
 * This is not about working out WHAT the odd card is, it is about not being
 * caught holding it.
 *
 * The maths is the whole design constraint and it is worth stating plainly:
 *
 *   one deck   52 - 3 aces = 49 = 24 pairs + the ace
 *   two decks  104 - 7 aces = 97 = 48 pairs + the ace
 *
 * Both odd, both with exactly one card that cannot pair. Any other number of
 * aces and the game either never ends or ends with two losers.
 *
 * Card ids carry their copy — `10H#1`, `10H#2` — the same convention Silly Head
 * uses, so a two-deck game can tell two identical cards apart. `public/cards.js`
 * strips the tag before drawing, so it never reaches a player's eye.
 */

/** The one ace that survives the cull. Arbitrary, and fixed so a deal is replayable. */
const THE_ACE = 'AS#1';

/** How many cards each variant deals out. */
const DECK_SIZE = { 1: 49, 2: 97 };

/**
 * Every card in `copies` decks, with all aces but one removed.
 *
 * @param {number} copies 1 or 2
 * @returns {string[]}
 */
function buildDeck(copies) {
  if (copies !== 1 && copies !== 2) throw new Error(`Chase the Ace plays one deck or two, not ${copies}`);
  const deck = [];
  for (let copy = 1; copy <= copies; copy++) {
    for (const suit of SUITS) {
      for (const rank of RANKS) {
        const id = `${rank}${suit}#${copy}`;
        // Every ace but the one goes back in the box.
        if (rank === 'A' && id !== THE_ACE) continue;
        deck.push(id);
      }
    }
  }
  return deck;
}

/**
 * The rank of a card id, copy tag and suit stripped. Pairing looks at this and
 * nothing else.
 *
 * Written here rather than borrowed from `lib/deck.js`, whose `parseCard` does
 * NOT understand the `#1` copy tag and throws on one — Silly Head keeps its own
 * for the same reason. Worth knowing before reaching for the shared helper in
 * any game that deals more than one deck.
 */
function rankOf(cardId) {
  const raw = String(cardId);
  const hash = raw.indexOf('#');
  const face = hash === -1 ? raw : raw.slice(0, hash);
  return face.slice(0, -1);
}

/** Is this the card nobody wants? */
function isTheAce(cardId) {
  return cardId === THE_ACE;
}

/**
 * Which deck count a table of this size plays with.
 *
 * One deck is 49 cards, so eight players is six each and it is over quickly.
 * Past that it has to be two, and the Master may choose two earlier for a longer
 * game — which is why this is a floor rather than the answer.
 *
 * @param {number} playerCount
 */
function minimumDecks(playerCount) {
  return playerCount > 8 ? 2 : 1;
}

/**
 * Deal the whole deck out, one card at a time round the table.
 *
 * Everything goes out and hands are uneven — 97 between five is nineteen each
 * and two people get twenty. That is simply the game, and the screen has to cope
 * rather than the deal being trimmed to look tidy.
 *
 * NOT sorted. Every other game in this app sorts a hand on the way out because
 * the order is presentation; here the order is the GAME, so a dealt hand arrives
 * in the order it was dealt and the player arranges it themselves. Sorting would
 * hand every opponent a free read on where the ace probably is.
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
  return hands;
}

module.exports = {
  SUITS,
  RANKS,
  THE_ACE,
  DECK_SIZE,
  buildDeck,
  rankOf,
  isTheAce,
  minimumDecks,
  deal,
};
