import { h, initials } from '../../ui.js';
import { cardFace, cardBack, sortByRank, parseCard, cardLabel } from '../../cards.js';
import { topbar, action, ownName, fitFan, fitCards, splitHand } from '../common.js';
import { uiZoom } from '../../size.js';

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

/**
 * And the width, in the app's own pixels, below which a ring of four or more
 * stops being worth drawing.
 *
 * A ring has to hold a seat east and west of the two piles, and there is a
 * width under which that cannot be done without one sitting on the other — the
 * seats end up drawn at two thirds and their cards are unreadable, which is
 * the thing this screen was supposed to fix. The compact rows already exist for
 * sixteen players and are the better answer here too.
 *
 * In the app's pixels rather than the screen's, because turning the text size
 * up narrows the app exactly as a smaller phone would: at Largest a 375px phone
 * has 268 of them to spend, and three seats and two piles do not go into that
 * however the arithmetic is arranged.
 */
const RING_MIN_WIDTH = 340;

/** How far out the ring sits, and where its middle is, in percent of the table. */
const RING_X = 40;
const RING_Y = 34;
const RING_MID_Y = 45;

/** Below this width there is no room for a name under the badge. */
const NAME_MIN_PCT = 17;

/** Past this many cards a hand stops showing you the ones you cannot play. */
const HIDE_FROM = 11;

/**
 * The widest a seat gets.
 *
 * A shade wider than Blob's 23.5%, because a Silly Head seat carries three
 * face-up cards as well as a name and those cards are how you read everybody
 * else's endgame — but only a shade, and the reason is the two piles sitting in
 * the middle of the ring.
 *
 * This was 46% for two or three players, on the grounds that at those sizes
 * nobody is sitting level with the pile. That was wrong on a phone, and it is
 * worth writing down why: the ring comes IN to keep a wide seat on the screen,
 * and coming in is exactly what walks the seats into the middle. At 46% the two
 * top seats of a three-handed table met each other at the centre with the deck
 * and the pile underneath them. On a laptop it looked fine. A phone is where
 * this game is played.
 */
function seatLimits() {
  return { maxPct: 28, capPx: 116 };
}

/** Is there room for a ring at all, at the size this player has asked for? */
function tooTightForRing(total) {
  // Two of you is one seat opposite another with the piles between them, which
  // fits whatever the screen. Three is already a triangle round the middle.
  if (total <= 2) return false;
  const zoom = uiZoom() || 1;
  return window.innerWidth / zoom < RING_MIN_WIDTH;
}

function seatAngle(index, total) {
  return -90 - (index * 360) / total;
}

/**
 * How wide a seat is and how far out the ring sits, settled together.
 *
 * A seat takes a shade under the gap to its closest neighbour, and the ring
 * comes in far enough that the outermost seat stays on the screen: pinned at
 * 40% from the middle plus half a seat, the seats east and west of you hung off
 * the right edge of a narrow phone.
 *
 * The two depend on each other — pulling the ring in shortens the arc, which
 * narrows the seats, which lets the ring back out — so it is settled by running
 * the pair round a few times rather than by one formula that cannot express it.
 */
function ringGeometry(total) {
  const step = 360 / total;
  const { maxPct, capPx } = seatLimits(total);
  let ringX = RING_X;
  let widthPct = maxPct;
  for (let pass = 0; pass < 4; pass++) {
    widthPct = Math.min(maxPct, 2 * ringX * Math.sin((step / 2) * (Math.PI / 180)) * 0.94);
    ringX = Math.min(RING_X, 50 - widthPct / 2 - 1);
  }
  return { ringX, widthPct, capPx };
}

export function tableScreen(ctx) {
  const state = ctx.state;
  const you = state.you;
  const players = state.players.filter((p) => !p.left);
  const rows = players.length >= ROWS_FROM || tooTightForRing(players.length);

  // You at the bottom, everybody else round from you in seating order.
  const start = players.findIndex((p) => p.id === you.id);
  const ordered = start === -1 ? players : players.slice(start).concat(players.slice(0, start));

  const screen = h(
    'div.screen.screen--fixed.screen--fits.sh-play',
    topbar(state, { left: countsChip(state), ctx }),
    rows ? seatRows(ctx, ordered) : null,
    rows ? middle(ctx) : ring(ctx, ordered),
    statusLine(ctx),
    yourCards(ctx),
    actions(ctx)
  );

  // In order, because each one measures what the one before it settled: the
  // cards give way until the screen fits, the seat cards take their share of
  // the seat, the ring opens until the seats clear the pile, the seats shrink
  // until none of them touch, and the fan tightens until it is on the phone.
  // Only once all of that has landed is it worth flying anything across it.
  requestAnimationFrame(() => {
    fitCards(screen);
    if (!rows) {
      fitSeatCards(screen);
      fitRing(screen);
      fitMiddle(screen);
      fitSeats(screen);
    }
    fitFan(screen);
    showLastMove(ctx, screen);
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
  const { ringX, widthPct, capPx } = ringGeometry(total);
  const crowded = widthPct < NAME_MIN_PCT;

  const seats = ordered.map((player, index) => {
    const radians = (seatAngle(index, total) * Math.PI) / 180;
    // How far up or down a seat sits is left as a sum rather than a number, so
    // the fit pass can push the whole ring open without this having to know how
    // tall the table it landed on turned out to be.
    return seat(ctx, player, {
      style: {
        left: `${50 + Math.cos(radians) * ringX}%`,
        top: `calc(${RING_MID_Y}% - var(--ring-y, ${RING_Y}) * ${Math.sin(radians).toFixed(4)} * 1%)`,
      },
    });
  });

  return h(
    'div',
    {
      className: `table${crowded ? ' table--crowded' : ''}`,
      style: { '--seat-pct': String(widthPct), '--seat-cap': `${capPx}px`, '--seat-scale': '1' },
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
  const you = ctx.state.you;
  // You are not in the list.
  //
  // The bottom half of the screen is already yours — your name is on the seat
  // nobody needs, your cards are drawn at full size where you tap them, and the
  // count of what you are holding is written above your hand. Putting your seat
  // in with the others cost a place in the row and, at three players, sat you
  // shoulder to shoulder with an opponent as though you were a pair.
  const others = ordered.filter((player) => !you || player.id !== you.id);
  // A row each, the full width of the table: name and numbers on the left, what
  // is in front of them on the right. Two seats sharing a row is what put one
  // player's cards through another's.
  return h(
    'div.sh-rows',
    others.map((player) => h('div.sh-row', seat(ctx, player, { flat: true })))
  );
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

  const ups = (player.up || []).map((stack) => (stack.length ? stack[stack.length - 1] : null));
  // What is still in front of them: the card showing on each pile, and the back
  // of a face-down card wherever the face-up one has gone.
  //
  // Only the face-up ones were drawn before, so somebody down to their last
  // three had an empty space in front of them and a small count off to one side
  // — and at a real table those are three cards you can see perfectly well, and
  // the thing everybody is watching at the end of a game.
  //
  // How many face-down cards somebody has left is public; WHICH piles they are
  // under is not in the payload and does not need to be. The cards showing keep
  // their places and whatever is left over fills the empty ones.
  let spare = Math.max(0, (player.downLeft || 0) - ups.filter(Boolean).length);
  const table = ups.map((card) => {
    if (card) return { card };
    if (spare > 0) {
      spare -= 1;
      return { back: true };
    }
    return null;
  });
  // Your own three, drawn twice.
  //
  // Once you are playing off the table they are already at the bottom of the
  // screen at full size, because that is where you tap them — and the copy in
  // your seat is the same three cards again, smaller, a few inches above. Two
  // rows of one thing reads as two things. Everybody else's seat keeps its
  // cards; it is only your own that has a bigger version of itself elsewhere.
  const doubled = you && showsOwnTable(state.you);

  return h(
    'div',
    { className: classes, style, 'data-player-id': player.id },
    h(
      'div.seat__who',
      h('div.seat__badge', { text: initials(player.name) }),
      h('div.seat__name', { text: ownName(player.name, you) }),
      h('div.seat__meta', {
        // The face-down count lives here rather than on a badge beside the
        // cards. Pinned to the corner of the row it landed on the last card,
        // and there is no spare width in a seat to give it a place of its own.
        text: player.out
          ? placeLabel(player.place)
          : `${player.cardsHeld} in hand${player.downLeft ? ` · ${player.downLeft} down` : ''}`,
      })
    ),
    player.out
      ? null
      : h(
          'div.sh-seat__table',
          // Everything in front of them, because everybody can see it at a
          // table: the cards face up, and the backs of the ones nobody has
          // turned over. Never what those are.
          doubled
            ? null
            : table.map((slot) =>
                slot ? (slot.card ? cardFace(slot.card, { size: 'xs' }) : cardBack({ size: 'xs' })) : null
              ),
        )
  );
}

/**
 * Is this player's own table already on the screen at full size?
 *
 * True once they are playing off it — their face-up cards, then their face-down
 * ones — and for the one hand-and-table move in between, where the row is on
 * screen so the move can be made at all.
 */
function showsOwnTable(you) {
  if (!you || you.out) return false;
  return you.zone === 'up' || you.zone === 'down' || Boolean(crossoverRank(you));
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

  // Two or three of a number in a row are fanned rather than stacked.
  //
  // Stacked they are one card with a line of text under the table saying there
  // are more, and the number on the pile is the single most important thing on
  // the screen: it decides whether you can go, and how close the pile is to
  // being sacked. Fanned, you can see how many there are and what they are, the
  // way you would spread them in your hand to check.
  //
  // Every card in the pile is public — the room watched each one go down — so
  // there is nothing here the view is not already sending.
  const runOf = Math.max(1, Math.min(state.pile.run || 1, state.pile.runToSack || 4));
  const runCards = (state.pile.cards || []).slice(-runOf);
  const runRank = state.pile.top ? parseCard(state.pile.top).rank : null;

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
          ? `The pile, ${state.pile.count} cards, ${
              runCards.length > 1 ? `${runCards.length} ${runRank}s in a row` : cardLabel(state.pile.top)
            } on top`
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
        ? h(
            'div.sh-discard__run',
            { style: { '--run': String(runCards.length) } },
            // Oldest first, so the one on top is the last child and paints over
            // the rest without anybody having to count z-indexes.
            runCards.map((cardId, index) => {
              const back = runCards.length - 1 - index;
              return cardFace(cardId, {
                size: 'lg',
                index: back,
                className: back === 0 ? `sh-discard__top${justLanded ? ' sh-discard__top--land' : ''}` : '',
              });
            })
          )
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
  // The face-down check comes FIRST. Down there you have nothing playable by
  // definition — you have not seen the card yet — so the stuck line fired and
  // told you to take the pile, which is the one thing the rules will not let
  // you do from there.
  else if (you.isTurn && you.zone === 'down') text = 'Turn one of your face-down cards over.';
  else if (you.isTurn && state.stuck) text = 'Nothing you can play — take the pile.';
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

  // A big hand shows only what you can put down.
  //
  // Seventeen cards is two rows of tiny ones, and on most turns three of them
  // are moves and fourteen are scenery — you are reading a wall to find the
  // pair you already know you are playing. So past a hand one row can hold, the
  // ones you cannot play this turn are tucked away and the rest are drawn from
  // the room that frees up.
  //
  // Only ever on your turn, and only when there is something playable: the view
  // says nothing about what is playable when it is not your go, so hiding then
  // would hide the lot. And it says so, with the way back one tap away —
  // cards quietly missing from your own hand would be the worst bug in the app,
  // so it must never look like one.
  const hideable = you.hand.length > HIDE_FROM && you.isTurn && playable.size > 0;
  const hiding = hideable && !ctx.ui.shShowAll;
  const inHand = hiding ? sortByRank(you.hand).filter((id) => playable.has(id)) : sortByRank(you.hand);

  // Pick the pile up twice and a hand is fifteen cards long. One row of that
  // cannot be fanned tight enough to fit a phone and still show the corner you
  // read a card by, so it comes out over two rows — or three.
  const handCard = (cardId, i) => {
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
  };

  return h(
    'div.sh-yours',
    h('span.eyebrow.center', {
      text: hiding
        ? `Your hand — ${you.hand.length}, showing the ${inHand.length} you can play`
        : `Your hand — ${you.hand.length}`,
    }),
    splitHand(inHand).map((row) => h('div.hand', row.map(handCard))),
    hideable
      ? h('button.btn.btn--link.sh-hand__toggle', {
          type: 'button',
          text: hiding ? `Show all ${you.hand.length}` : 'Show only what I can play',
          onClick: () => {
            ctx.ui.shShowAll = !ctx.ui.shShowAll;
            ctx.render();
          },
        })
      : null,
    // Your last hand card may go down with matching face-up cards, so they have
    // to be on screen for you to see the move is there — but ONLY then.
    //
    // Your three cards are already on the table in your own seat, and a second
    // copy of them under your hand for the whole game read as a bug and cost
    // about 150px of a screen that has none spare. It is drawn when the move
    // it exists for is actually available, and not otherwise.
    crossoverRank(you) ? faceUpRow(ctx, { quiet: true }) : null
  );
}

/**
 * The number your last hand card could go down with, if there is one.
 *
 * The one crossover in the game: your genuinely LAST hand card may be played
 * together with matching face-up cards. Holding a 5 and a 6 you cannot — play
 * the 6, and then the 5 goes down with three 5s showing, which is four of a
 * number, which sacks the pile and gives you another go.
 */
function crossoverRank(you) {
  if (!you.hand || you.hand.length !== 1) return null;
  const rank = parseCard(you.hand[0]).rank;
  const showing = (you.up || []).some(
    (stack) => stack.length && parseCard(stack[stack.length - 1]).rank === rank
  );
  return showing ? rank : null;
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
        : quiet
        ? `Your last ${crossoverRank(you) || 'card'} can go down with these`
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
        const isChosen = chosen.includes(cardId);
        const rank = parseCard(cardId).rank;
        // Two 8s showing go down together, the same way two 8s in your hand do.
        //
        // They could not, and it is the sort of thing you only find by playing:
        // the row put every card down on its own, so a pair on the table had to
        // be played one at a time — and the second one lands on a pile that is
        // now showing an 8, which is fine, but three of a number could never
        // finish a four and sack. The rules always allowed it; this row was the
        // only thing in the way.
        const room = chosenRank ? roomInRun(state, chosenRank) : 0;
        const joinable = chosenRank
          ? rank === chosenRank && chosen.length < room
          : you.zone === 'up' && playable.has(cardId);
        const canPlay = !giving && !quiet && you.isTurn && (isChosen || joinable);
        const canJoin = crossover && you.isTurn && (isChosen || rank === chosenRank);
        const onClick =
          ctx.ui.shSending || !you.isTurn
            ? undefined
            : giving
            ? () => takePile(ctx, index)
            : canJoin || canPlay
            ? () => toggle(ctx, cardId)
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
 * Pick cards up, or put them back.
 *
 * A tap takes every one of that number, because that is what you meant: holding
 * three 8s you are not choosing WHICH 8. Tapping a lifted card drops that one
 * back, which is how you deliberately put down two of the three — worth having,
 * because the fourth of a number sacks the pile.
 *
 * And a single card with nothing to add to it is not a decision, so it simply
 * goes. Confirming a move you have already made is a tap nobody asked for; the
 * button underneath is for a pair or more, where the count is worth reading
 * before you commit to it.
 */
function toggle(ctx, cardId) {
  const state = ctx.state;
  const you = state.you;
  const chosen = (ctx.ui.shChosen || []).slice();

  const at = chosen.indexOf(cardId);
  if (at !== -1) {
    chosen.splice(at, 1);
    ctx.ui.shChosen = chosen.length ? chosen : null;
    ctx.render();
    return;
  }
  // Already holding some out: this is one more of the same number.
  if (chosen.length) {
    chosen.push(cardId);
    ctx.ui.shChosen = chosen;
    ctx.render();
    return;
  }

  const rank = parseCard(cardId).rank;
  const playable = new Set(you.playable);
  // Where the others of that number would be coming from: your hand while you
  // have one, and the cards showing on your table once you have not.
  const pool =
    you.zone === 'up'
      ? (you.up || []).filter((stack) => stack.length).map((stack) => stack[stack.length - 1])
      : sortByRank(you.hand);
  // A run never goes past four, and a play that would push it there is refused
  // rather than truncated — so "all of them" has to stop where the pile does.
  const room = roomInRun(state, rank);
  const all = [cardId]
    .concat(pool.filter((id) => id !== cardId && parseCard(id).rank === rank && playable.has(id)))
    .slice(0, Math.max(1, room));

  // The exception: your last hand card can go down with matching face-up cards,
  // and that move is only reachable while the card is lifted rather than played.
  if (all.length === 1 && !crossoverRank(you)) {
    play(ctx, all);
    return;
  }
  ctx.ui.shChosen = all;
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
  // Each turn starts tucked again. Asking to see the whole hand is about the
  // turn you are taking, not a setting.
  ctx.ui.shShowAll = false;
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
  // The piles count as something to bump into, but only here, at the end: the
  // ring has already been opened and the middle already shrunk, so anything
  // still touching is a genuinely tight table rather than the first thing to
  // try. Shrinking is the last lever precisely because it costs the most.
  const middle = screen.querySelector('.sh-middle');

  for (let scale = 1; scale >= 0.6; scale -= 0.06) {
    table.style.setProperty('--seat-scale', String(scale));
    const boxes = seats.map((el) => el.getBoundingClientRect());
    const middleBox = middle ? middle.getBoundingClientRect() : null;
    let clash = false;
    for (let i = 0; i < boxes.length && !clash; i++) {
      if (middleBox && overlaps(boxes[i], middleBox)) clash = true;
      for (let j = i + 1; j < boxes.length && !clash; j++) {
        clash = overlaps(boxes[i], boxes[j]);
      }
    }
    if (!clash) return;
  }
}

/** How far the ring may be pushed open before a seat leaves the table. */
const RING_Y_MAX = 48;

/** The smallest the two piles in the middle are allowed to get. */
const MID_CARD_MIN = 44;

/**
 * Shrink the middle until the seats beside it are clear of it.
 *
 * The seats are placed as a percentage of the ring and the piles were drawn at
 * a fixed size, so the two came apart the moment the ring did not have the size
 * the numbers were chosen against: at the largest text setting the ring is two
 * thirds the width it is at Normal while the piles were still the same 84px,
 * and everybody east and west sat on top of them. This is the same complaint as
 * a seat hanging off the right edge, one ring further in.
 *
 * The middle gives way rather than the seats, because the seats are already as
 * small as they are useful at — and it gives way only as far as it has to, so
 * the two or three player table, which has room for all of it, keeps all of it.
 */
function fitMiddle(screen) {
  const middle = screen.querySelector('.sh-middle');
  const seats = [...screen.querySelectorAll('.seat')];
  if (!middle || !seats.length) return;
  const start = parseFloat(getComputedStyle(screen).getPropertyValue('--sh-card')) || 84;
  for (let size = Math.round(start); size >= MID_CARD_MIN; size -= 6) {
    screen.style.setProperty('--mid-card', `${size}px`);
    const box = middle.getBoundingClientRect();
    if (seats.every((seat) => !overlaps(seat.getBoundingClientRect(), box))) return;
  }
}

/**
 * Open the ring up until the seats clear the two piles in the middle.
 *
 * The ring fills the height it is given rather than claiming a fixed share of
 * its own width, which is what took the dead band out of the middle of this
 * screen — and it means how far a seat sits from the pile is a pixel question
 * that no percentage in this file can answer in advance. Three players sit
 * closer to it than eight do, because three of them are spread round the same
 * circle.
 *
 * Pushed outward rather than shrunk. Shrinking was tried first and it is the
 * wrong lever: the seats hit their floor still touching the pile, and the whole
 * table ended up drawn at 60% to solve a 12px corner.
 */
function fitRing(screen) {
  const table = screen.querySelector('.table');
  const ring = screen.querySelector('.table__ring');
  const middle = screen.querySelector('.sh-middle');
  if (!table || !ring || !middle) return;
  const seats = [...screen.querySelectorAll('.seat')];
  if (!seats.length) return;

  const ringBox = ring.getBoundingClientRect();
  let best = RING_Y;
  for (let y = RING_Y; y <= RING_Y_MAX; y += 2) {
    table.style.setProperty('--ring-y', String(y));
    const boxes = seats.map((el) => el.getBoundingClientRect());
    // Past the edge of the table is worse than close to the pile.
    if (!boxes.every((box) => box.top >= ringBox.top - 4 && box.bottom <= ringBox.bottom + 4)) break;
    best = y;
    const middleBox = middle.getBoundingClientRect();
    if (boxes.every((box) => !overlaps(box, middleBox))) break;
  }
  table.style.setProperty('--ring-y', String(best));
}

function overlaps(a, b) {
  return a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;
}

/**
 * Size the face-up cards in a seat to the seat they are sitting in.
 *
 * They were pinned at the smallest card the app draws whatever was going on,
 * which with three players left them tiny on a table with room going spare —
 * and those cards are how you read everybody else's endgame. So they are a
 * share of the seat, the same arithmetic that sizes the seat itself.
 *
 * Turned into pixels by measuring, because the percentage is of the ring and
 * how wide the ring ends up is the stylesheet's business, not this file's.
 */
function fitSeatCards(screen) {
  const table = screen.querySelector('.table');
  const seat = screen.querySelector('.seat');
  if (!table || !seat) return;
  // The seat's own width, before the fit pass scales it — `offsetWidth` ignores
  // transforms, which is exactly what is wanted here.
  //
  // Measured off the seat rather than worked out from the ring, because three
  // cards wider than the seat they sit in do not widen the seat: they hang out
  // of both sides of it, over whoever is next to it, and every box this file
  // measures afterwards says they are nowhere near each other.
  const card = Math.max(20, Math.min(56, (seat.offsetWidth - 10) / 3));
  table.style.setProperty('--seat-card', `${Math.round(card)}px`);
}

// ── The move, travelling ─────────────────────────────────────────────────────

/**
 * Cards that fly: out of a seat onto the pile, off the pile into whoever took
 * it, and off the table altogether when a pile is sacked.
 *
 * Without them the middle of the table simply changes — you cannot tell who
 * played, and a pile of eleven cards being picked up is a blink. The server
 * writes down what just happened (`lastEvent`, all of it public), and this is
 * the only thing that reads it.
 *
 * Three things this has to get right, and all three have bitten this codebase
 * before:
 *
 * Every state the server pushes rebuilds the whole screen, so "this render
 * differs from the last" replays on every repaint. The event carries a sequence
 * number and a move is flown once, for the seq that has not been seen.
 *
 * The flying cards live on the body rather than in the screen, because a
 * repaint mid-flight would take them with it — the same reason the confetti
 * lives there. That also puts them outside the zoomed subtree, so what is
 * measured and what is moved are in the same pixels for once, and there is
 * nothing to divide back out.
 *
 * And nothing waits on an animation. The state is already correct before a card
 * takes off; the flight is a picture of what has happened, so a browser with no
 * Web Animations, a phone asking for reduced motion or a seat that has since
 * left all end up in the same place, quietly.
 */
const FLY_MS = 320;
const SWEEP_MS = 300;

/** The last move this screen has shown, and the game it belonged to. */
let shownSeq = 0;
let shownGame = null;

function reducedMotion() {
  return Boolean(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
}

/** The layer the flying cards live on. Made once, and kept. */
function flyLayer() {
  let layer = document.querySelector('.fly-layer');
  if (!layer) {
    layer = h('div.fly-layer', { 'aria-hidden': 'true' });
    document.body.appendChild(layer);
  }
  return layer;
}

function centreOf(el) {
  const box = el.getBoundingClientRect();
  return { x: box.left + box.width / 2, y: box.top + box.height / 2, width: box.width, height: box.height };
}

/** Send one card-shaped thing from one point on the screen to another. */
function fly(node, from, to, options = {}) {
  const { delay = 0, ms = FLY_MS, turn = 0, fade = false, width = 0 } = options;
  if (width) node.style.setProperty('--w', `${Math.round(width)}px`);
  node.style.left = `${from.x}px`;
  node.style.top = `${from.y}px`;
  flyLayer().appendChild(node);

  if (!node.animate) {
    node.remove();
    return;
  }
  const anim = node.animate(
    [
      { transform: `translate(-50%, -50%) rotate(${-turn}deg) scale(0.94)`, opacity: 1 },
      {
        transform: `translate(-50%, -50%) translate(${to.x - from.x}px, ${to.y - from.y}px) rotate(${turn}deg) scale(1)`,
        opacity: fade ? 0 : 1,
      },
    ],
    { duration: ms, delay, easing: 'cubic-bezier(0.22, 1, 0.36, 1)', fill: 'both' }
  );
  const clear = () => node.remove();
  anim.onfinish = clear;
  anim.oncancel = clear;
}

/** Where the pile is, whether or not there is anything on it. */
function pileSpot(screen) {
  const pile = screen.querySelector('.sh-discard');
  if (!pile) return null;
  const card = screen.querySelector('.sh-discard__top') || screen.querySelector('.sh-discard__slot');
  return centreOf(card || pile);
}

/** Show the last thing that happened in the middle. Once. */
function showLastMove(ctx, screen) {
  const state = ctx.state;
  const event = state.lastEvent;
  if (!event || !event.seq) return;

  // A different game keeps its own count, or a rematch would look like a
  // repaint of the game before it.
  if (shownGame !== state.id) {
    shownGame = state.id;
    shownSeq = 0;
  }
  if (event.seq <= shownSeq) return;
  const seenOne = shownSeq > 0;
  shownSeq = event.seq;
  // Arriving mid-game, or coming back to a tab that was in the background, must
  // not replay whatever happened while you were not looking.
  if (!seenOne) return;

  // Why the pile has just gone is information, not decoration, so it is said
  // whatever the phone thinks of animations.
  if (event.type === 'play' && event.sacked) shoutSack(screen, event);
  if (reducedMotion()) return;

  if (event.type === 'play') flyPlay(screen, event);
  else if (event.type === 'pickup') flyPickup(screen, event);
}

/** How long the shout stays up. Long enough to read, short enough not to wait on. */
const SACK_MS = 1400;

/**
 * Say what just sacked the pile, out loud, over the table.
 *
 * A sacked pile is the biggest thing that happens in this game and it happened
 * in about a tenth of a second: the pile was there, and then it was not. The
 * status line could not carry it — by the time you looked down the next player
 * had gone — and knowing WHICH of the two rules did it is most of learning the
 * game. A 10 sacks whatever it lands on. Four of a number in a row sacks it
 * however they got there.
 *
 * On the body rather than in the screen, like everything else here, because a
 * pushed state rebuilds the screen and would take it away mid-sentence.
 */
function shoutSack(screen, event) {
  const rank = event.cards && event.cards.length ? parseCard(event.cards[0]).rank : null;
  const word = rank === '10' ? 'A ten!' : rank ? `Four ${rank}s!` : 'Sacked!';
  const banner = h(
    'div.sh-sack',
    { 'aria-live': 'polite' },
    h('span.sh-sack__word', { text: word }),
    h('span.sh-sack__note', { text: `Pile sacked — ${event.sacked} gone for good` })
  );
  const spot = pileSpot(screen);
  banner.style.left = `${spot ? spot.x : window.innerWidth / 2}px`;
  banner.style.top = `${spot ? spot.y : window.innerHeight / 2}px`;
  document.body.appendChild(banner);
  window.setTimeout(() => banner.remove(), SACK_MS);
}

/** A card out of somebody's seat and onto the pile. */
function flyPlay(screen, event) {
  const seat = screen.querySelector(`.seat[data-player-id="${event.playerId}"]`);
  const spot = pileSpot(screen);
  const cards = (event.cards || []).slice(0, 4);
  if (!seat || !spot || !cards.length) {
    if (event.sacked) flySack(screen, event, 0);
    return;
  }

  const from = centreOf(seat);
  const width = spot.width || 62;
  const last = FLY_MS + (cards.length - 1) * 60;
  // While the card is in the air the pile does not also show it arrived.
  document.body.classList.add('sh-flying');
  window.setTimeout(() => document.body.classList.remove('sh-flying'), last + 40);

  cards.forEach((cardId, index) => {
    fly(cardFace(cardId, { size: 'lg' }), from, { x: spot.x + index * 5, y: spot.y + index * 4 }, {
      delay: index * 60,
      turn: 6 - index * 3,
      width,
    });
  });
  if (event.sacked) flySack(screen, event, last);
}

/** The whole pile, to whoever picked it up. */
function flyPickup(screen, event) {
  const seat = screen.querySelector(`.seat[data-player-id="${event.playerId}"]`);
  const spot = pileSpot(screen);
  if (!seat || !spot) return;
  const to = centreOf(seat);
  const many = Math.min(4, Math.max(2, event.count || 2));
  for (let i = 0; i < many; i++) {
    fly(cardBack({ size: 'lg' }), { x: spot.x + i * 4, y: spot.y - i * 4 }, to, {
      delay: i * 45,
      turn: -10 + i * 5,
      fade: true,
      width: spot.width || 62,
    });
  }
}

/** And the whole pile again, off the table for good. */
function flySack(screen, event, delay) {
  const spot = pileSpot(screen);
  if (!spot) return;
  const chip = screen.querySelector('.sh-counts .chip--quiet');
  const to = chip ? centreOf(chip) : { x: spot.x, y: -spot.height };
  const many = Math.min(4, Math.max(2, event.sacked || 2));
  for (let i = 0; i < many; i++) {
    fly(cardBack({ size: 'lg' }), { x: spot.x + i * 4, y: spot.y - i * 4 }, to, {
      delay: delay + i * 40,
      ms: SWEEP_MS,
      turn: 16,
      fade: true,
      width: spot.width || 62,
    });
  }
}
