import { h } from '../../ui.js';
import { cardFace, suitGlyph, suitName, isRed } from '../../cards.js';
import { topbar, action, fitFan, splitHand } from '../common.js';

/**
 * The Sevens table.
 *
 * Four columns, one per suit, every seven sitting on one shared baseline with
 * the kings growing up and the aces growing down.
 *
 * Vertical rather than in rows, and that is load-bearing rather than a taste.
 * A finished suit is thirteen cards: laid across, that needs about 306px against
 * roughly 281px of usable width at the largest text setting — and in Sevens
 * every suit finishes, so it is the normal end state rather than an edge case.
 * Stood on end the same thirteen cards are about 330px deep and four columns are
 * only 248px across, which a phone has. Height was never the constraint; width
 * was. See `SEVENS.md`.
 *
 * No game logic lives here. The server says which cards are playable and whether
 * you are stuck, and this draws it.
 */

/** Low to high, as Sevens counts — ace first. Mirrors `lib/sevens/deck.js`. */
const RANKS = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'];
const HIGH_VALUE = RANKS.length;

/** How long a just-played card is treated as news. */
const LAND_MS = 620;

/** How long the card takes to travel. */
const FLY_MS = 380;

/**
 * The most cards that may share a row of the fan.
 *
 * Nine rather than `splitHand`'s default eleven, because a Sevens hand is fanned
 * AND rotated: a tilted card's box is wider than the card, so a row that just
 * fits flat overhangs once it is turned. Nine keeps two rows for the eighteen a
 * three-player game deals, and one row for anything four players or more get.
 */
const ROW_MAX = 9;

/**
 * The event we have already animated, and when this phone first saw it.
 *
 * Module scope, and gated on a time window rather than on "this render differs
 * from the last", because every state the server pushes rebuilds the whole
 * screen — one action paints three times, and anything keyed on difference alone
 * replays on each of them. `lastEvent.at` is the server's clock, so it is used
 * as an identity only; the window is measured against this phone's own.
 */
let seen = { at: null, localAt: 0, flown: false };

function freshEvent(event) {
  if (!event || !event.at) return null;
  if (seen.at !== event.at) seen = { at: event.at, localAt: Date.now(), flown: false };
  return Date.now() - seen.localAt < LAND_MS ? event : null;
}

function reducedMotion() {
  return window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

export function tableScreen(ctx) {
  const state = ctx.state;
  const you = state.you || {};
  const players = state.players.filter((p) => !p.left);
  const event = freshEvent(state.lastEvent);

  const screen = h(
    // `--fixed` so the table does not wander under your thumb, but deliberately
    // NOT `--fits`: Sevens has a Pass button that must be pressable, and the
    // rule in styles.css is that a screen with a control to reach takes the
    // escape hatch while a surface you only look at shrinks instead. Two rows of
    // fan plus a column thirteen deep is more than the largest text size leaves
    // room for, and an unreachable Pass is worse than a screen that moves.
    'div.screen.screen--fixed.sv-play',
    topbar(state, { left: codeChip(state), ctx }),
    suitPips(state),
    metaRow(state),
    statusLine(ctx),
    felt(ctx),
    hand(ctx),
    actions(ctx),
    counts(ctx, players)
  );

  // After paint, in order: tighten the fan until it is on the phone, then fly
  // the card that has just been played. Nothing is worth flying across a layout
  // that has not settled.
  requestAnimationFrame(() => {
    fitFan(screen, '.sv-hand');
    if (event && event.kind === 'play' && !seen.flown && !reducedMotion()) {
      seen.flown = true;
      flyPlayed(screen, event, you);
    }
  });

  return screen;
}

// ── Header ───────────────────────────────────────────────────────────────────

function codeChip(state) {
  return h('span.sv-chip.sv-chip--code.tabular', {
    text: state.code,
    'aria-label': `Game code ${state.code.split('').join(' ')}`,
  });
}

/**
 * One pip per suit, lit once its seven is down.
 *
 * Blob has round pips here and this is the same idea doing Sevens' job: a dark
 * pip is the answer to "why is that column empty", read before you have looked
 * at the table. A completed suit gets its own mark, because a finished suit and
 * a busy one otherwise look identical from up here.
 */
function suitPips(state) {
  const suits = state.suits || [];
  if (!suits.length) return null;
  return h(
    'div.sv-pips',
    { 'aria-label': 'Which suits are open' },
    suits.map((entry) =>
      h('span', {
        className: `sv-pip${entry.open ? ' sv-pip--on' : ''}${entry.complete ? ' sv-pip--done' : ''}${
          isRed(entry.suit) ? ' sv-pip--red' : ''
        }`,
        text: suitGlyph(entry.suit),
        'aria-label': `${suitName(entry.suit)}: ${
          entry.complete ? 'finished' : entry.open ? `${entry.down} down` : 'not started'
        }`,
      })
    )
  );
}

/** Your card count, and the two facts worth a glance. */
function metaRow(state) {
  const you = state.you || {};
  const held = (you.hand || []).length;
  const inPlay = state.players.filter((p) => !p.left && !p.out).length;
  return h(
    'div.sv-meta',
    h(
      'span.sv-meta__count',
      h('strong', { text: String(held) }),
      h('span', { text: held === 1 ? 'card' : 'cards' })
    ),
    h('span.sv-chip', { text: `${state.cardsDown} down` }),
    h('span.sv-chip', { text: `${inPlay} still in` })
  );
}

function statusLine(ctx) {
  const state = ctx.state;
  const you = state.you || {};
  const turn = state.players.find((p) => p.id === state.turnId);

  if (you.out) return h('p.sv-status', { text: 'You are out. Watching the rest of it.' });
  if (you.isTurn && state.stuck) return h('p.sv-status.sv-status--stuck', { text: 'Nothing you can play' });
  if (you.isTurn) return h('p.sv-status.sv-status--you', { text: 'Your turn — tap a card to play it' });
  return h('p.sv-status', { text: turn ? `Waiting for ${turn.name}` : 'Waiting…' });
}

// ── The table ────────────────────────────────────────────────────────────────

/**
 * The felt takes the slack.
 *
 * It is the flexible child and the columns are centred inside it, so leftover
 * height becomes space around the cards and redistributes itself at every text
 * size. The first draft pushed the hand down with a spacer instead, which left a
 * hole in the middle of the screen and had to be re-picked per size — the same
 * fault as item 11 on Silly Head's list.
 */
function felt(ctx) {
  const state = ctx.state;
  const event = freshEvent(state.lastEvent);
  return h(
    'div.sv-felt',
    h(
      'div.sv-cols',
      (state.suits || []).map((entry) => column(entry, event))
    )
  );
}

/**
 * One suit, stood on end.
 *
 * A card's position comes from its value alone, so every seven lands on the same
 * line whatever else is down — `top` is `(13 - value)` steps from the top of the
 * column, which puts the king at 0 and the ace at the bottom.
 *
 * The two halves need OPPOSITE z-order, which is the part that is easy to get
 * wrong. Below the seven, each new card sits on top and offset down, showing its
 * own top-left index — an ordinary tableau. Above the seven that is backwards: a
 * higher card on top would cover the index of the card beneath it, so the upward
 * half draws in reverse, the card nearest the seven frontmost and each higher
 * one peeking out above. Same look in both directions, opposite stacking.
 */
function column(entry, event) {
  const { suit, run, complete } = entry;
  const landing = event && event.kind === 'play' && event.suit === suit ? event.card : null;

  const classes = [
    'sv-col',
    isRed(suit) ? 'sv-col--red' : 'sv-col--black',
    complete ? 'sv-col--done' : '',
    landing && event.completed ? 'sv-col--completing' : '',
  ]
    .filter(Boolean)
    .join(' ');

  if (!run) {
    return h(
      'div',
      { className: `${classes} sv-col--empty`, 'data-suit': suit },
      h(
        'div.sv-slot.sv-slot--empty',
        { style: { top: slotTop(7) }, 'aria-label': `${suitName(suit)} has not started` },
        h('span.sv-slot__rank', { text: '7' }),
        h('span.sv-slot__suit', { text: suitGlyph(suit) })
      )
    );
  }

  const cards = [];
  for (let value = run.low; value <= run.high; value++) {
    const card = RANKS[value - 1] + suit;
    const up = value > 7;
    cards.push(
      h(
        'div',
        {
          className: `sv-slot${card === landing ? ' sv-slot--landing' : ''}`,
          style: { top: slotTop(value), 'z-index': String(zFor(value)) },
          'data-slot': card,
        },
        cardFace(card, { size: 'lg', corner: true })
      )
    );
    void up;
  }

  return h('div', { className: classes, 'data-suit': suit }, cards);
}

/** Where a value sits in its column. King at the top, ace at the bottom. */
function slotTop(value) {
  return `calc(${HIGH_VALUE - value} * var(--sv-step))`;
}

/**
 * Stacking, and the asymmetry the comment on `column` describes.
 *
 * The seven is the frontmost card in the middle; everything above it steps back,
 * everything below it steps forward.
 *
 * Kept low, and the column isolates its own stacking context in the stylesheet.
 * These numbers used to sit around 40, which is the settings sheet's z-index —
 * so opening settings mid-game left three columns of cards floating on top of
 * it. A local ordering must never be able to reach a global one.
 */
function zFor(value) {
  return value > 7 ? 10 - (value - 7) : 10 + (7 - value);
}

// ── Your hand ────────────────────────────────────────────────────────────────

/**
 * The fan.
 *
 * `--fan-i` is each card's offset from the middle, which is what
 * `.hand--fanned` turns into an angle — so the spread follows the hand size
 * rather than being picked per card. The hand arrives from the server already
 * sorted, by suit in the table's own order and low to high within it, so the fan
 * never reshuffles itself under somebody's thumb.
 */
function hand(ctx) {
  const state = ctx.state;
  const you = state.you || {};
  const cards = you.hand || [];
  if (!cards.length) return h('div.sv-hands.sv-hands--empty');

  const playable = new Set(you.playable || []);

  // Sevens deals the biggest hands in this app by a distance: three players is
  // eighteen cards each and four is thirteen, against Blob's thirteen at most
  // and Silly Head's nine. Eighteen cannot be fanned into one row on a phone at
  // any spacing that still shows the corner you read a card by — so it goes into
  // rows, evenly, and each one is fanned to fit on its own.
  const rows = splitHand(cards, ROW_MAX);

  return h(
    'div.sv-hands',
    rows.map((row) => {
      const middle = (row.length - 1) / 2;
      return h(
        'div.hand.hand--fanned.sv-hand',
        row.map((card, i) => {
          const legal = playable.has(card);
          return h(
            'div.hand__card',
            { style: { '--fan-i': String(i - middle) } },
            cardFace(card, {
              size: 'md',
              corner: true,
              // Deliberately NOT `blocked` for the rest.
              //
              // Blob and Silly Head dim what you cannot play, and it works there
              // because most of your hand usually is playable. Sevens is the
              // other way round: two or three legal cards out of fifteen is an
              // ordinary turn, so dimming the remainder greys out almost your
              // whole hand and you can no longer read your own cards.
              state: legal ? 'playable' : null,
              className: legal ? '' : 'card-face--idle',
              // Every card answers, even the ones that cannot be played.
              //
              // Seb pressed cards and nothing happened, and read it as the
              // corner not being tappable — it is tappable, and was all along.
              // The real fault was silence: an inert card that looks exactly
              // like a live one and gives nothing back when you press it. So an
              // unplayable card says what its suit is actually waiting for,
              // which answers the press and teaches the rule in the same breath.
              onClick: legal
                ? () => ctx.send({ type: 'play/card', cardId: card })
                : () => refuse(ctx, card),
            })
          );
        })
      );
    })
  );
}

/**
 * Why that card will not go down.
 *
 * Read off the ends the server already sends, so this is explaining rather than
 * deciding — the reducer remains the only thing that says what is legal, and it
 * would refuse this card anyway if the screen were wrong about it.
 */
function refuse(ctx, card) {
  const suit = card.slice(-1);
  const entry = (ctx.state.suits || []).find((s) => s.suit === suit);
  const where = suitName(suit);
  let why;
  if (!entry || !entry.open) why = `Nobody has played the seven of ${where} yet.`;
  else if (!entry.ends.length) why = `${cap(where)} is finished.`;
  else why = `${cap(where)} will take the ${entry.ends.map((v) => RANKS[v - 1]).join(' or the ')}.`;
  ctx.toast(why);

  // A nudge as well as a sentence: the toast explains, the movement confirms
  // that the press landed at all, which is the thing that was missing.
  const el = document.querySelector(`.sv-hand [data-card="${card}"]`);
  if (el && !reducedMotion()) {
    el.classList.remove('card-face--refused');
    void el.offsetWidth;
    el.classList.add('card-face--refused');
  }
}

function cap(word) {
  return word.charAt(0).toUpperCase() + word.slice(1);
}

/**
 * The action row, which is empty most of the time.
 *
 * There is no button while you have a legal move: you tap the card and it goes.
 * Pass appears only when the server says you are stuck, so it is never a choice
 * — it is the app telling you there is nothing to do. A voluntary-pass rule
 * would need this button on every turn, where it tempts people during turns they
 * could play. See `SEVENS.md`.
 */
function actions(ctx) {
  const state = ctx.state;
  const you = state.you || {};
  if (!you.isTurn || !state.stuck) return h('div.sv-actions.sv-actions--quiet');
  return h('div.sv-actions', action('Pass', () => ctx.send({ type: 'play/pass' })));
}

/**
 * Everybody's card count along the bottom.
 *
 * There is no seat ring here, because there is no trick to win and nothing for a
 * seat to hold — the only thing worth knowing about the other players is how
 * close they are to going out. `data-player-id` is also where a played card
 * flies from.
 */
function counts(ctx, players) {
  const state = ctx.state;
  const you = state.you || {};
  const event = freshEvent(state.lastEvent);

  return h(
    'div.sv-counts',
    players.map((p) => {
      const passing = event && event.kind === 'pass' && event.playerId === p.id;
      const wentOut = event && event.wentOut && event.playerId === p.id;
      const classes = [
        'sv-count',
        p.id === you.id ? 'sv-count--you' : '',
        p.isTurn ? 'sv-count--turn' : '',
        p.out ? 'sv-count--out' : '',
        passing ? 'sv-count--passing' : '',
        wentOut ? 'sv-count--wentout' : '',
      ]
        .filter(Boolean)
        .join(' ');

      return h(
        'div',
        { className: classes, 'data-player-id': p.id },
        h('span.sv-count__name', { text: p.name }),
        h('span.sv-count__n', { text: p.out ? `#${p.place}` : String(p.cardsHeld) }),
        passing ? h('span.sv-count__flag', { text: 'passed' }) : null
      );
    })
  );
}

// ── The card travelling ──────────────────────────────────────────────────────

/**
 * Fly the card that has just been played from its owner to its place.
 *
 * The flier is `position: fixed` on `document.body`, deliberately: that puts it
 * OUTSIDE the zoomed subtree, so its coordinates and its size are both plain
 * screen pixels straight out of `getBoundingClientRect` and there is no zoom to
 * divide back out. Measuring in one space and moving in another is the trap that
 * has bitten every fitter in this codebase, and the cheapest way to avoid it is
 * to stay in one space.
 *
 * The destination is hidden until the flight lands, or you would see the card
 * arrive instantly and then watch a copy of it fly to where it already was.
 */
function flyPlayed(screen, event, you) {
  const target = screen.querySelector(`[data-slot="${event.card}"]`);
  if (!target) return;

  const source =
    event.playerId === you.id
      ? screen.querySelector('.sv-hand') || screen.querySelector(`[data-player-id="${event.playerId}"]`)
      : screen.querySelector(`[data-player-id="${event.playerId}"]`);
  if (!source) return;

  const from = source.getBoundingClientRect();
  const to = target.getBoundingClientRect();
  if (!to.width || !from.width) return;

  target.style.visibility = 'hidden';

  const flier = cardFace(event.card, { size: 'lg', corner: true });
  Object.assign(flier.style, {
    position: 'fixed',
    left: '0px',
    top: '0px',
    width: `${to.width}px`,
    height: `${to.height}px`,
    margin: '0',
    zIndex: '90',
    pointerEvents: 'none',
    transformOrigin: 'top left',
    transform: `translate(${from.left + from.width / 2 - to.width / 2}px, ${
      from.top + from.height / 2 - to.height / 2
    }px) scale(0.7)`,
  });
  document.body.appendChild(flier);

  requestAnimationFrame(() => {
    flier.style.transition = `transform ${FLY_MS}ms cubic-bezier(.22,.8,.3,1)`;
    flier.style.transform = `translate(${to.left}px, ${to.top}px) scale(1)`;
  });

  window.setTimeout(() => {
    flier.remove();
    target.style.visibility = '';
    target.classList.add('sv-slot--landed');
  }, FLY_MS);
}
