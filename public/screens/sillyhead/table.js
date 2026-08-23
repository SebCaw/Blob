import { h, initials } from '../../ui.js';
import { cardFace, cardBack, sortByRank, parseCard, cardLabel } from '../../cards.js';
import { topbar, action, ownName, fitFan } from '../common.js';

/**
 * The table.
 *
 * Two things make this screen different from Blob's, and both come from the
 * game rather than from taste:
 *
 * The middle is usable. In Blob everybody's played card lands within 28px of
 * the centre, so nothing small survives there. Here nothing is played to a seat
 * at all — every card goes to one pile — so the middle carries the two piles
 * that the whole game is about: the deck, neat, and the pile, messy, beside it.
 *
 * And the pile is the button. On your turn it says "Take the pile" and tapping
 * it picks up; when you have nothing legal it is the only thing on the screen
 * you can tap, so being stuck stops being a decision — which is right, because
 * then it is not one.
 */

/**
 * The card that was on top of the pile the last time this screen was drawn, and
 * when it got there.
 *
 * Module-level on purpose: it is not game state and it must not be, since it
 * exists only to tell "a card just landed" from "the screen was repainted".
 */
let lastTop = null;
let landedAt = 0;

/** How long a landing stays a landing — the length of the animation. */
const LAND_MS = 280;

/** Where the ring stops being a table and becomes a list. Four families of four. */
const ROWS_FROM = 9;

/** How far out the ring sits, and where its middle is, in percent of the table. */
const RING_X = 40;
const RING_Y = 33;
const RING_MID_Y = 45;

/** Below this width there is no room for a name under the badge. */
const NAME_MIN_PCT = 17;

function seatAngle(index, total) {
  return -90 - (index * 360) / total;
}

/** A seat takes a shade under the gap to its closest neighbour. */
function seatWidthPct(total) {
  const step = 360 / total;
  const gap = 2 * RING_X * Math.sin((step / 2) * (Math.PI / 180));
  return Math.min(23.5, gap * 0.94);
}

export function tableScreen(ctx) {
  const state = ctx.state;
  const you = state.you;
  const players = state.players.filter((p) => !p.left);
  const rows = players.length >= ROWS_FROM;

  // You at the bottom, everybody else round from you in seating order.
  const start = players.findIndex((p) => p.id === you.id);
  const ordered = start === -1 ? players : players.slice(start).concat(players.slice(0, start));

  const screen = h(
    'div.screen.screen--fixed.sh-play',
    topbar(state, { left: countsChip(state), ctx }),
    rows ? seatRows(ctx, ordered) : null,
    rows ? middle(ctx) : ring(ctx, ordered),
    statusLine(ctx),
    yourCards(ctx),
    actions(ctx)
  );

  requestAnimationFrame(() => {
    if (!rows) fitSeats(screen);
    fitFan(screen);
  });
  return screen;
}

/** What is left in the deck, and what has gone for good. */
function countsChip(state) {
  return h(
    'div.sh-counts',
    h('span.chip', { text: `${state.stock} in the deck` }),
    state.sacked ? h('span.chip.chip--quiet', { text: `${state.sacked} sacked` }) : null
  );
}

// ── The ring ─────────────────────────────────────────────────────────────────

function ring(ctx, ordered) {
  const total = ordered.length;
  const widthPct = seatWidthPct(total);
  const crowded = widthPct < NAME_MIN_PCT;

  const seats = ordered.map((player, index) => {
    const radians = (seatAngle(index, total) * Math.PI) / 180;
    return seat(ctx, player, {
      style: {
        left: `${50 + Math.cos(radians) * RING_X}%`,
        top: `${RING_MID_Y - Math.sin(radians) * RING_Y}%`,
      },
    });
  });

  return h(
    'div',
    {
      className: `table${crowded ? ' table--crowded' : ''}`,
      style: { '--seat-pct': String(widthPct), '--seat-scale': '1' },
    },
    h('div.table__ring', h('div.table__felt'), seats, middle(ctx))
  );
}

/**
 * Past eight, the ring stops working: sixteen seats round one circle are too
 * small to read whatever the arithmetic says. So the seats become two compact
 * rows and the middle keeps the space it had — the information is the same, the
 * shape is the one that fits.
 */
function seatRows(ctx, ordered) {
  const half = Math.ceil(ordered.length / 2);
  const row = (list) => h('div.sh-row', list.map((player) => seat(ctx, player, { flat: true })));
  return h('div.sh-rows', row(ordered.slice(half)), row(ordered.slice(0, half)));
}

/** One player. */
function seat(ctx, player, { style, flat } = {}) {
  const state = ctx.state;
  const you = state.you && state.you.id === player.id;
  const classes = [
    'seat',
    flat ? 'seat--flat' : '',
    player.isTurn ? 'seat--turn' : '',
    !player.connected ? 'seat--gone' : '',
    player.skipped ? 'seat--skipped' : '',
    player.out ? 'seat--out' : '',
  ]
    .filter(Boolean)
    .join(' ');

  const ups = (player.up || []).filter((stack) => stack.length).map((stack) => stack[stack.length - 1]);

  return h(
    'div',
    { className: classes, style, 'data-player-id': player.id },
    h(
      'div.seat__who',
      h('div.seat__badge', { text: initials(player.name) }),
      h('div.seat__name', { text: ownName(player.name, you) }),
      h('div.seat__meta', {
        text: player.out ? placeLabel(player.place) : `${player.cardsHeld} in hand`,
      })
    ),
    player.out
      ? null
      : h(
          'div.sh-seat__table',
          // Their face-up cards, because everybody can see those at a table.
          ups.map((cardId) => cardFace(cardId, { size: 'xs' })),
          // And how many face-down are left, which you can also see. Not what.
          player.downLeft ? h('span.sh-seat__down', { text: `▪${player.downLeft}` }) : null
        )
  );
}

function placeLabel(place) {
  if (place === 1) return 'Won';
  if (place === 2) return '2nd out';
  if (place === 3) return '3rd out';
  return `${place}th out`;
}

// ── The middle ───────────────────────────────────────────────────────────────

/**
 * The deck and the pile, side by side: one neat, one not.
 *
 * The count on the pile is not decoration. You cannot decide whether to take it
 * without knowing how much of it there is, and at a real table you can see that
 * at a glance.
 */
function middle(ctx) {
  const state = ctx.state;
  const you = state.you;
  const canTake = you.isTurn && state.pile.count > 0 && you.zone !== 'down';
  // Has a card just landed on the pile?
  //
  // Two things have to be true at once and they pull against each other. Every
  // state the server pushes rebuilds this screen, so an ungated animation would
  // replay on every repaint and the pile would twitch whenever anybody's phone
  // reconnected. But a single flag keyed on "the top card changed" is wiped
  // before it is ever painted, because playing a card renders three times in a
  // row — once to acknowledge the tap, once when the state lands, and once when
  // the request settles — and only the middle one sees a new card.
  //
  // So the arrival is remembered for as long as the animation lasts, rather
  // than for exactly one render. Same shape as `screen--enter` in `app.js`, and
  // it is the same trap that put it there.
  if ((state.pile.top || null) !== lastTop) {
    lastTop = state.pile.top || null;
    landedAt = Date.now();
  }
  const justLanded = Boolean(state.pile.top) && Date.now() - landedAt < LAND_MS;

  return h(
    'div.sh-middle',
    h(
      'div.sh-stock',
      state.stock
        ? h(
            'div.sh-stock__pile',
            // Real card backs, with the lattice on them. They were blank
            // rectangles, which read as a grey block rather than as a deck.
            [0, 1, 2].map((n) =>
              h('div.sh-stock__card', { style: { '--n': String(n) } }, cardBack({ size: 'md' }))
            )
          )
        : h('span.sh-stock__empty', { text: '—' }),
      h('span.sh-middle__label', { text: state.stock ? `${state.stock} left` : 'Deck gone' })
    ),
    h(
      canTake ? 'button' : 'div',
      {
        className: `sh-discard${canTake ? ' sh-discard--live' : ''}${state.pile.count ? '' : ' sh-discard--empty'}`,
        type: canTake ? 'button' : undefined,
        'aria-label': canTake
          ? `Take the pile, ${state.pile.count} cards`
          : state.pile.top
          ? `The pile, ${state.pile.count} cards, ${cardLabel(state.pile.top)} on top`
          : 'The pile is empty',
        onClick: canTake ? () => takePile(ctx) : undefined,
      },
      // A few backs at angles under the top card: it is a pile people have been
      // throwing cards onto, and it should look like one.
      state.pile.count > 1
        ? h('div.sh-discard__mess', [0, 1, 2].slice(0, Math.min(3, state.pile.count - 1)).map((n) =>
            h('span.sh-discard__scrap', { style: { '--n': String(n) } })
          ))
        : null,
      state.pile.top
        ? cardFace(state.pile.top, {
            size: 'lg',
            className: `sh-discard__top${justLanded ? ' sh-discard__top--land' : ''}`,
          })
        : h('span.sh-discard__slot', { text: 'Empty' }),
      state.pile.count ? h('span.sh-discard__count', { text: String(state.pile.count) }) : null,
      canTake ? h('span.sh-middle__label.sh-middle__label--action', { text: 'Take the pile' }) : null
    )
  );
}

// ── What is going on ─────────────────────────────────────────────────────────

function statusLine(ctx) {
  const state = ctx.state;
  const you = state.you;
  const turn = state.players.find((p) => p.id === state.turnId);
  const flip = state.lastFlip;
  const flipper = flip ? state.players.find((p) => p.id === flip.playerId) : null;

  let text;
  if (you.out) text = 'You are out. Watching the rest of it.';
  else if (you.isTurn && state.stuck) text = 'Nothing you can play — take the pile.';
  else if (you.isTurn && you.zone === 'down') text = 'Turn one of your face-down cards over.';
  else if (you.isTurn) text = 'Your go.';
  else text = `Waiting for ${turn ? turn.name : 'the next player'}.`;

  return h(
    'div.sh-status',
    h('p.sh-status__turn', { className: you.isTurn ? 'sh-status__turn--you' : '', text }),
    state.pile.forcesLow
      ? h('p.sh-status__rule', { text: 'A 9 is showing — the next card has to be a 9 or lower.' })
      : null,
    state.pile.run > 1
      ? h('p.sh-status__rule', {
          text: `${state.pile.run} in a row — ${state.pile.runToSack - state.pile.run} more sacks the pile.`,
        })
      : null,
    flip && flipper
      ? h('p.sh-status__flip', {
          text: `${flipper.name} turned over the ${cardLabel(flip.cardId)} and ${
            flip.played ? 'played it' : 'picked it up'
          }.`,
        })
      : null
  );
}

// ── Your cards ───────────────────────────────────────────────────────────────

/** Cards this phone has tapped and is still waiting on the server for. */
function sending(ctx, cardId) {
  return Boolean(ctx.ui.shSending && ctx.ui.shSending.includes(cardId));
}

function yourCards(ctx) {
  const state = ctx.state;
  const you = state.you;
  if (you.out) return h('div.sh-yours', h('p.hand__note', { text: 'All shed. Nothing left to play.' }));

  if (you.zone === 'down') return faceDownRow(ctx);
  if (you.zone === 'up') return faceUpRow(ctx);

  const playable = new Set(you.playable);
  const chosen = ctx.ui.shChosen || [];
  const chosenRank = chosen.length ? parseCard(chosen[0]).rank : null;
  const room = chosenRank ? roomInRun(state, chosenRank) : 0;

  return h(
    'div.sh-yours',
    h('span.eyebrow.center', { text: `Your hand — ${you.hand.length}` }),
    h(
      'div.hand',
      sortByRank(you.hand).map((cardId, i) => {
        const isChosen = chosen.includes(cardId);
        const rank = parseCard(cardId).rank;
        // Once you have picked one up, the only other cards that mean anything
        // are the same number — so everything else stops offering itself.
        const joinable = chosenRank ? rank === chosenRank && chosen.length < room : playable.has(cardId);
        const live = you.isTurn && !ctx.ui.shSending && (isChosen || joinable);
        return h(
          'div.hand__card',
          { style: { '--i': String(i) } },
          cardFace(cardId, {
            size: 'lg',
            state: you.isTurn ? (isChosen || joinable ? 'playable' : 'blocked') : null,
            className: [isChosen ? 'card-face--picked' : '', sending(ctx, cardId) ? 'card-face--sending' : '']
              .filter(Boolean)
              .join(' '),
            onClick: live ? () => toggle(ctx, cardId) : undefined,
          })
        );
      })
    ),
    // Your last hand card may go down with matching face-up cards, so they have
    // to be on screen for you to see the move is there.
    you.hand.length === 1 ? faceUpRow(ctx, { quiet: true }) : null
  );
}

function faceUpRow(ctx, { quiet } = {}) {
  const state = ctx.state;
  const you = state.you;
  const giving = Boolean(ctx.ui.shGiveUp);
  const playable = new Set(you.playable);
  const chosen = ctx.ui.shChosen || [];
  const chosenRank = chosen.length ? parseCard(chosen[0]).rank : null;
  // Your genuinely last hand card may go down with matching face-up cards —
  // the only time the two halves of your table mix. It has to be selectable
  // here, or that move simply cannot be made.
  const crossover = quiet && you.hand.length === 1 && Boolean(chosenRank);

  return h(
    'div.sh-yours',
    h('span.eyebrow.center', {
      text: giving
        ? 'Tap the card you will pick up with the pile'
        : crossover
        ? 'Your last card can go down with these'
        : quiet
        ? 'On the table'
        : 'Your face-up cards',
    }),
    h(
      'div.sh-table-row',
      you.up.map((stack, index) => {
        const cardId = stack.length ? stack[stack.length - 1] : null;
        const down = you.downLeft[index];
        if (!cardId) {
          return h(
            'div.sh-pile.sh-pile--still',
            down ? cardBack({ size: 'lg', className: 'sh-pile__down', label: 'a face-down card' }) : null,
            down ? null : h('span.sh-slot__gone', { text: '—' })
          );
        }
        const canPlay = !giving && !quiet && you.isTurn && you.zone === 'up' && playable.has(cardId);
        const isChosen = chosen.includes(cardId);
        const canJoin =
          crossover && you.isTurn && (isChosen || parseCard(cardId).rank === chosenRank);
        const onClick = ctx.ui.shSending
          ? undefined
          : giving
          ? () => takePile(ctx, index)
          : canJoin
          ? () => toggle(ctx, cardId)
          : canPlay
          ? () => play(ctx, [cardId])
          : undefined;
        // The face-down card sits proud behind the face-up one, the same way it
        // does while you are sorting — so it is obvious there are two cards
        // there, and that one of them is still a mystery.
        return h(
          'div',
          { className: `sh-pile${onClick ? '' : ' sh-pile--still'}` },
          down ? cardBack({ size: 'lg', className: 'sh-pile__down', label: 'a face-down card' }) : null,
          cardFace(cardId, {
            size: 'lg',
            state: canPlay || canJoin ? 'playable' : null,
            className: [
              'sh-pile__up',
              isChosen ? 'card-face--picked' : '',
              sending(ctx, cardId) ? 'card-face--sending' : '',
            ]
              .filter(Boolean)
              .join(' '),
            onClick,
          })
        );
      })
    )
  );
}

function faceDownRow(ctx) {
  const state = ctx.state;
  const you = state.you;
  return h(
    'div.sh-yours',
    h('span.eyebrow.center', { text: 'Your last three. Nobody knows what they are.' }),
    h(
      'div.sh-table-row',
      you.downLeft.map((there, index) =>
        there
          ? h(
              'button.sh-pile.sh-facedown',
              {
                type: 'button',
                'aria-label': `Turn over one of your face-down cards`,
                disabled: !you.isTurn || Boolean(ctx.ui.shSending),
                onClick: async () => {
                  ctx.ui.shSending = ['flip'];
                  ctx.render();
                  await ctx.send({ type: 'play/flip', pileIndex: index });
                  ctx.ui.shSending = null;
                  ctx.render();
                },
              },
              cardBack({ size: 'lg' })
            )
          : h('div.sh-pile.sh-pile--still', h('span.sh-slot__gone', { text: '—' }))
      )
    )
  );
}

// ── Doing something ──────────────────────────────────────────────────────────

function actions(ctx) {
  const state = ctx.state;
  const you = state.you;
  const chosen = ctx.ui.shChosen || [];

  // Cards pulled out of your hand, waiting to go down together.
  //
  // This replaces a "how many 7s?" row that appeared under the hand and was
  // missed completely: people tapped a card, saw nothing move, and concluded
  // that pairs did not work. Now the card lifts out where your eye already is,
  // the others of that number stay lit, and one button puts them down.
  if (chosen.length) {
    const rank = parseCard(chosen[0]).rank;
    return h(
      'div.sh-actions',
      h(
        'div.stack.stack--tight',
        action(chosen.length === 1 ? `Play the ${rank}` : `Play ${chosen.length} ${rank}s`, () => play(ctx, chosen)),
        h('button.btn.btn--link', {
          type: 'button',
          text: 'Put them back',
          onClick: () => {
            ctx.ui.shChosen = null;
            ctx.render();
          },
        })
      )
    );
  }

  if (ctx.ui.shGiveUp) {
    return h(
      'div.sh-actions',
      h('button.btn.btn--link', {
        type: 'button',
        text: 'Cancel',
        onClick: () => {
          ctx.ui.shGiveUp = false;
          ctx.render();
        },
      })
    );
  }

  // The pile is the button in the middle; this is the same act spelled out, for
  // anyone who does not read a pile of cards as something to press.
  if (you.isTurn && !you.out && you.zone !== 'down' && state.pile.count) {
    return h(
      'div.sh-actions',
      action(`Take the pile (${state.pile.count})`, () => takePile(ctx), {
        kind: state.stuck ? 'primary' : 'ghost',
      })
    );
  }
  return h('div.sh-actions');
}

/**
 * Pick a card up, or put it back.
 *
 * Tapping pulls the card out of your hand and leaves it lifted. Tap another of
 * the same number and it comes too; tap a lifted one to drop it back. One
 * button then plays whatever you are holding out — so one card is a tap and a
 * tap, and three is one tap more, rather than a different mechanism entirely.
 */
function toggle(ctx, cardId) {
  const chosen = (ctx.ui.shChosen || []).slice();
  const at = chosen.indexOf(cardId);
  if (at !== -1) chosen.splice(at, 1);
  else chosen.push(cardId);
  ctx.ui.shChosen = chosen.length ? chosen : null;
  ctx.render();
}

/** How many more of a rank the pile will take before four in a row sacks it. */
function roomInRun(state, rank) {
  const top = state.pile.top ? parseCard(state.pile.top).rank : null;
  return top === rank ? state.pile.runToSack - state.pile.run : state.pile.runToSack;
}

async function play(ctx, cardIds) {
  ctx.ui.shChosen = null;
  ctx.ui.shGiveUp = false;
  // Mark the cards as on their way BEFORE the round trip.
  //
  // Nothing is applied optimistically — the card does not move until the server
  // says so — but the tap is acknowledged instantly, which is a different
  // thing. Without it, a slow connection reads as a dead button and people tap
  // again. It also stops the second tap: a card already in flight is not
  // playable.
  ctx.ui.shSending = cardIds.slice();
  ctx.render();
  await ctx.send({ type: 'play/cards', cardIds });
  ctx.ui.shSending = null;
  ctx.render();
}

/**
 * Take the pile.
 *
 * Being stuck on your face-up cards costs you one of them, and which one is
 * your call — so that case asks, and only that case. Choosing to take the pile
 * when you had a move costs nothing and never asks.
 */
async function takePile(ctx, upIndex) {
  const state = ctx.state;
  const you = state.you;
  const mustGive = state.stuck && you.zone === 'up' && upIndex === undefined;
  if (mustGive) {
    ctx.ui.shGiveUp = true;
    ctx.render();
    return;
  }
  ctx.ui.shGiveUp = false;
  ctx.ui.shChosen = null;
  ctx.ui.shSending = ['pile'];
  ctx.render();
  await ctx.send(upIndex === undefined ? { type: 'play/takePile' } : { type: 'play/takePile', upIndex });
  ctx.ui.shSending = null;
  ctx.render();
}

// ── Fitting ──────────────────────────────────────────────────────────────────

/**
 * Shrink the seats until no two of them touch.
 *
 * The arithmetic above gets two players and eight close, but how tall a seat
 * ends up depends on the name, the numbers and how many face-up cards are still
 * in front of somebody — which is only knowable by laying it out and looking.
 */
function fitSeats(screen) {
  const table = screen.querySelector('.table');
  if (!table) return;
  const seats = [...screen.querySelectorAll('.seat')];
  if (seats.length < 3) return;

  for (let scale = 1; scale >= 0.6; scale -= 0.06) {
    table.style.setProperty('--seat-scale', String(scale));
    const boxes = seats.map((el) => el.getBoundingClientRect());
    let clash = false;
    for (let i = 0; i < boxes.length && !clash; i++) {
      for (let j = i + 1; j < boxes.length && !clash; j++) {
        clash = overlaps(boxes[i], boxes[j]);
      }
    }
    if (!clash) return;
  }
}

function overlaps(a, b) {
  return a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;
}
