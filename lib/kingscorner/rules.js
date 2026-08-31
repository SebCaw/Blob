'use strict';

const { fits, isKing } = require('./deck');

/**
 * The board, and what it will accept.
 *
 * Everything in here is about the eight piles and nothing else — it does not
 * know who is playing, whose turn it is, or where a card came from. That belongs
 * to the reducer. Keeping the two apart is what makes the rules testable one at
 * a time, and this game has four kinds of legal move to test.
 *
 * Pure, like the rest of `lib/`.
 */

/** The four slots that start with a card turned into them. */
const CROSS = ['N', 'E', 'S', 'W'];

/** The four that start empty and only a king may open. */
const CORNERS = ['NW', 'NE', 'SE', 'SW'];

/**
 * Every slot, in the order the screen lays them out: a three-by-three grid
 * read left to right, top to bottom, with the stock in the middle.
 *
 *      NW  N  NE
 *      W   .  E
 *      SW  S  SE
 */
const SLOTS = ['NW', 'N', 'NE', 'W', 'E', 'SW', 'S', 'SE'];

/** @param {string} slot */
function isCorner(slot) {
  return CORNERS.includes(slot);
}

/** @param {string} slot */
function isSlot(slot) {
  return SLOTS.includes(slot);
}

/**
 * A fresh board: eight slots, all empty.
 *
 * A pile is an array with the **head first**. `pile[0]` is the highest card,
 * the one it was started with and the one that decides whether the whole pile
 * can be picked up; the last entry is the lowest card, the exposed one anything
 * new lands on. Both ends are load-bearing, which is unusual — every other pile
 * in this app is read from one end — so nothing here says "top" or "bottom".
 *
 * @returns {Record<string, string[]>}
 */
function emptyBoard() {
  return Object.fromEntries(SLOTS.map((slot) => [slot, []]));
}

/** The exposed card of a pile: the lowest one, what anything new goes onto. */
function lowestOf(pile) {
  return pile.length ? pile[pile.length - 1] : null;
}

/** The head of a pile: the highest card, what decides where the pile can move. */
function headOf(pile) {
  return pile.length ? pile[0] : null;
}

/**
 * Can this card from a hand go into this slot?
 *
 * Three cases and no others:
 *
 * - the slot holds cards -> one rank lower and the other colour;
 * - the slot is an empty corner -> a king, and nothing else;
 * - the slot is an empty cross slot -> anything at all.
 *
 * @param {string} cardId
 * @param {string} slot
 * @param {Record<string,string[]>} board
 * @returns {boolean}
 */
function canPlace(cardId, slot, board) {
  if (!isSlot(slot)) return false;
  const pile = board[slot] || [];
  if (pile.length) return fits(lowestOf(pile), cardId);
  return isCorner(slot) ? isKing(cardId) : true;
}

/**
 * Can the whole of one pile move onto another?
 *
 * The moving pile's **head** has to sit under the target's **lowest** card. All
 * of it moves or none of it: you cannot split a pile and you cannot lift a card
 * back off one.
 *
 * **And a king in the cross may move to an empty corner**, taking whatever has
 * been built under it. Seb asked for this after a king was turned into the cross
 * at the deal and the app would not let him put it where kings go. A king that
 * came off the stock into a cross slot is in the wrong place through no
 * decision of anybody's, and it blocks that slot for the rest of the game.
 *
 * Otherwise a pile may not land in an empty slot: relocating one to a bare slot
 * achieves nothing except moving the hole about.
 *
 * ── Why the turn still cannot go round for ever ─────────────────────────────
 *
 * The original argument was that every pile move empties one slot and fills
 * none, so the piles cannot be shuffled back and forth. The king move breaks
 * that measure — it vacates one slot and fills another — so it needs its own,
 * and it has one: it only ever goes **cross to corner**, never corner to corner
 * or corner to cross. So the number of occupied CROSS slots strictly falls, and
 * it can happen at most four times. Refilling a cross slot to do it again costs
 * a card from a hand that never grows mid-turn.
 *
 * If that direction is ever relaxed, the termination argument goes with it: a
 * king pile could hop between empty corners for ever.
 *
 * @param {string} from
 * @param {string} to
 * @param {Record<string,string[]>} board
 * @returns {boolean}
 */
function canMovePile(from, to, board) {
  if (!isSlot(from) || !isSlot(to) || from === to) return false;
  const source = board[from] || [];
  const target = board[to] || [];
  if (!source.length) return false;
  if (!target.length) return !isCorner(from) && isCorner(to) && isKing(headOf(source));
  return fits(lowestOf(target), headOf(source));
}

/**
 * Every slot this card could go into, in board order.
 *
 * @param {string} cardId
 * @param {Record<string,string[]>} board
 * @returns {string[]}
 */
function slotsFor(cardId, board) {
  return SLOTS.filter((slot) => canPlace(cardId, slot, board));
}

/**
 * Every pile move available, as `from -> [to, ...]`.
 *
 * Slots with nowhere to go are left out rather than carried as empty arrays, so
 * the screen can ask whether a key exists instead of checking a length.
 *
 * @param {Record<string,string[]>} board
 * @returns {Record<string, string[]>}
 */
function pileMoves(board) {
  /** @type {Record<string, string[]>} */
  const moves = {};
  for (const from of SLOTS) {
    const to = SLOTS.filter((slot) => canMovePile(from, slot, board));
    if (to.length) moves[from] = to;
  }
  return moves;
}

/**
 * Put a card into a slot. Returns the new board, never the one it was given.
 *
 * @param {string} cardId
 * @param {string} slot
 * @param {Record<string,string[]>} board
 * @returns {Record<string,string[]>}
 */
function place(cardId, slot, board) {
  return { ...board, [slot]: [...(board[slot] || []), cardId] };
}

/**
 * Move a whole pile. Returns the new board with the source slot empty.
 *
 * @param {string} from
 * @param {string} to
 * @param {Record<string,string[]>} board
 * @returns {Record<string,string[]>}
 */
function movePile(from, to, board) {
  return { ...board, [from]: [], [to]: [...board[to], ...board[from]] };
}

/** How many cards are on the board altogether. */
function cardsDown(board) {
  return SLOTS.reduce((sum, slot) => sum + (board[slot] || []).length, 0);
}

module.exports = {
  CROSS,
  CORNERS,
  SLOTS,
  isCorner,
  isSlot,
  emptyBoard,
  lowestOf,
  headOf,
  canPlace,
  canMovePile,
  slotsFor,
  pileMoves,
  place,
  movePile,
  cardsDown,
};
