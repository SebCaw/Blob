import { h } from './ui.js';

/**
 * Drawing a card, and deciding what order a hand sits in.
 *
 * The server sends card ids — `AS`, `10H` — and nothing else. Everything about
 * how a card looks lives here, so the playing screen can stay about the game.
 *
 * No game logic: what is legal to play is decided by the server and arrives in
 * `you.playable`. This file only knows which way up a card goes.
 */

const SUIT_GLYPH = { S: '♠', H: '♥', D: '♦', C: '♣' };
const SUIT_NAME = { S: 'spades', H: 'hearts', D: 'diamonds', C: 'clubs' };
const RED = ['H', 'D'];

/**
 * Split a card id into its rank and suit. `10H` needs no special case.
 *
 * A game played with more than one deck tags each card with which deck it came
 * from — `10H#2` — because two identical cards have to be told apart. The tag
 * is stripped here and nowhere else: it is bookkeeping, never something anybody
 * should see on a card.
 */
export function parseCard(cardId) {
  const raw = String(cardId);
  const hash = raw.indexOf('#');
  const face = hash === -1 ? raw : raw.slice(0, hash);
  const suit = face.slice(-1);
  const rank = face.slice(0, -1);
  return { rank, suit, red: RED.includes(suit) };
}

/** The rank of a card id, copy tag and all. */
export function rankOf(cardId) {
  return parseCard(cardId).rank;
}

/** "the ace of spades", for anyone using a screen reader. */
export function cardLabel(cardId) {
  const { rank, suit } = parseCard(cardId);
  const names = { A: 'ace', K: 'king', Q: 'queen', J: 'jack' };
  return `${names[rank] || rank} of ${SUIT_NAME[suit] || 'cards'}`;
}

export const suitGlyph = (suit) => SUIT_GLYPH[suit] || '';
export const suitName = (suit) => SUIT_NAME[suit] || '';
export const isRed = (suit) => RED.includes(suit);

/**
 * One card, face up.
 *
 * @param {string} cardId
 * @param {{size?:'xs'|'sm'|'md'|'lg', className?:string, onClick?:Function, index?:number,
 *          state?:'playable'|'blocked'|null, ring?:'win'|'turn'|null, crown?:boolean,
 *          corner?:boolean}} [options]
 */
export function cardFace(cardId, options = {}) {
  const { rank, suit, red } = parseCard(cardId);
  const classes = [
    'card-face',
    `card-face--${options.size || 'md'}`,
    red ? 'card-face--red' : 'card-face--black',
    options.state ? `card-face--${options.state}` : '',
    options.ring ? `card-face--ring-${options.ring}` : '',
    options.className || '',
  ]
    .filter(Boolean)
    .join(' ');

  const inner = [
    // The index in the top-left corner, the way it is on a real card — and for
    // the same reason. A fan works at a table because the corner is the only
    // part that has to be visible, and a hand of nine on a phone is a fan
    // whether anybody planned it or not: without this you are looking at eight
    // blank slivers and one card.
    options.corner
      ? h(
          'span.card-face__corner',
          { 'aria-hidden': 'true' },
          h('span', { text: rank }),
          h('span', { text: SUIT_GLYPH[suit] || '' })
        )
      : null,
    h('span.card-face__rank', { text: rank }),
    h('span.card-face__pip', { text: SUIT_GLYPH[suit] || '', 'aria-hidden': 'true' }),
    options.crown ? h('span.card-face__crown', { text: '♔', 'aria-hidden': 'true' }) : null,
  ];

  if (options.onClick) {
    return h(
      'button',
      {
        className: classes,
        type: 'button',
        'aria-label': cardLabel(cardId),
        'data-card': cardId,
        disabled: options.state === 'blocked',
        style: options.index === undefined ? undefined : { '--i': String(options.index) },
        onClick: options.onClick,
      },
      inner
    );
  }

  return h(
    'div',
    {
      className: classes,
      'aria-label': cardLabel(cardId),
      role: 'img',
      'data-card': cardId,
      style: options.index === undefined ? undefined : { '--i': String(options.index) },
    },
    inner
  );
}

/** A card face down — somebody else's, or your own in the forehead round. */
export function cardBack(options = {}) {
  return h(
    'div',
    {
      className: ['card-face', 'card-face--back', `card-face--${options.size || 'md'}`, options.className || '']
        .filter(Boolean)
        .join(' '),
      'aria-label': options.label || 'a face-down card',
      role: 'img',
    },
    h('span.card-face__lattice', { 'aria-hidden': 'true' })
  );
}

/** A little pile of card backs: the tricks you have taken. */
export function trickPile(count) {
  const wrap = h('div.pile', { 'aria-label': `${count} ${count === 1 ? 'trick' : 'tricks'} won` });
  for (let i = 0; i < Math.min(count, 8); i++) {
    wrap.appendChild(h('span.pile__card', { style: { '--n': String(i) }, 'aria-hidden': 'true' }));
  }
  if (!count) wrap.appendChild(h('span.pile__none', { text: '–', 'aria-hidden': 'true' }));
  return wrap;
}

/**
 * The order a hand sits in.
 *
 * Suits stay grouped — every spade together — and the groups are ordered so
 * their colours alternate: red, black, red, black. Within a group, low to high.
 * It is how a hand gets arranged for real, and for the same reason: two
 * same-coloured suits touching are the ones people misread under pressure.
 *
 * A missing suit is simply absent rather than a gap, an all-black hand is left
 * alone, and a tie on suit count opens on red.
 *
 * @param {string[]} cards
 * @returns {string[]} a new array
 */
export function sortHand(cards) {
  const groups = new Map();
  for (const cardId of cards || []) {
    const { suit } = parseCard(cardId);
    if (!groups.has(suit)) groups.set(suit, []);
    groups.get(suit).push(cardId);
  }

  const reds = ['H', 'D'].filter((suit) => groups.has(suit));
  const blacks = ['S', 'C'].filter((suit) => groups.has(suit));
  // Whichever colour has more suits leads, so the alternation runs as far as it
  // can. Level pegging opens on red.
  let a = reds.length >= blacks.length ? reds : blacks;
  let b = a === reds ? blacks : reds;

  const order = [];
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    if (a[i]) order.push(a[i]);
    if (b[i]) order.push(b[i]);
  }

  const out = [];
  for (const suit of order) out.push(...groups.get(suit).slice().sort(byRank));
  return out;
}

/**
 * Plain numerical order, low to high.
 *
 * Blob's sorter groups by suit and alternates the colours, because in Blob
 * following suit is the whole game. In Silly Head the suit means nothing at all
 * — only the number counts — so grouping by it actively hides the thing you are
 * reading your hand for. Two 7s should sit next to each other.
 *
 * @param {string[]} cards
 * @returns {string[]} a new array
 */
export function sortByRank(cards) {
  return (cards || []).slice().sort(byRank);
}

const RANK_ORDER = ['2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A'];
const rankValue = (cardId) => RANK_ORDER.indexOf(parseCard(cardId).rank);
const byRank = (x, y) => rankValue(x) - rankValue(y);

/** The trump badge: "♥ TRUMPS", or the no-trumps case. */
export function trumpBadge(round) {
  if (!round) return null;
  if (round.noTrumps) return h('span.trump.trump--none', { text: 'NO TRUMPS' });
  if (!round.trumpSuit) return null;
  const red = isRed(round.trumpSuit);
  return h(
    'span',
    {
      className: `trump${red ? ' trump--red' : ''}`,
      'aria-label': `${suitName(round.trumpSuit)} are trumps`,
    },
    h('span.trump__pip', { text: SUIT_GLYPH[round.trumpSuit], 'aria-hidden': 'true' }),
    h('span', { text: 'TRUMPS', 'aria-hidden': 'true' })
  );
}
