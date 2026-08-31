import { h, plural } from '../../ui.js';
import { cardFace, cardBack, rankOf } from '../../cards.js';
import { topbar, action, splitHand } from '../common.js';
import { uiZoom } from '../../size.js';

/**
 * The Kings Corner table.
 *
 * The board is a three-by-three grid with the stock in the middle, which is not
 * a compromise for the phone — it is what the layout already is. Four cross
 * slots on the edges, four corners on the corners, and it comes out square,
 * which is the one shape a 560px column has plenty of.
 *
 * No game logic lives here. The server sends every legal move in
 * `you.moves` — which slots take each card in your hand, and which piles can
 * move where — and this screen draws them. A card that cannot be played is
 * refused by the reducer whatever this file believes.
 *
 * ── Two things pull against each other on this screen ────────────────────────
 *
 * **Both ends of a pile matter**, which is unique in this app. The LOWEST card
 * decides what can be played onto it; the HEAD decides where the whole pile can
 * move. So a slot has to show both, and never make you tap it to find out what
 * it will take.
 *
 * **A turn is a chain.** You may make many moves before you are done, so the
 * screen has to stay put between them: nothing about the selection goes in the
 * screen key, and the entry animation must not fire when you put down your third
 * card of the same turn.
 */

/** How long a just-played card is treated as news. */
const LAND_MS = 620;

/**
 * The most cards that may share a row of the fan.
 *
 * A hand here only grows when you are stuck, one card at a time, so it is rarely
 * more than about ten — but it CAN grow, unlike every other game where the hand
 * only shrinks. Eleven is the shared default and it holds; two rows appear if
 * somebody has a bad run of turns.
 */
const ROW_MAX = 11;

/**
 * The event we have already reacted to, and when this phone first saw it.
 *
 * Module scope, gated on the event's own identity plus a time window rather than
 * on "this render differs from the last" — every state the server pushes
 * rebuilds the whole screen, so one action paints three times and anything keyed
 * on difference alone fires on each of them.
 */
let seen = { at: null, localAt: 0 };

function freshEvent(event) {
  if (!event || !event.at) return null;
  if (seen.at !== event.at) seen = { at: event.at, localAt: Date.now() };
  return Date.now() - seen.localAt < LAND_MS ? event : null;
}

// ── The screen ───────────────────────────────────────────────────────────────

export function tableScreen(ctx) {
  const state = ctx.state;
  const you = state.you || {};
  const event = freshEvent(state.lastEvent);

  const screen = h(
    // `--fixed` so the board does not wander under your thumb, and deliberately
    // NOT `--fits`: there is a turn button that must be pressable, and the rule
    // in styles.css is that a screen with a control to reach takes the escape
    // hatch while a surface you only look at shrinks instead.
    'div.screen.screen--fixed.kc-play',
    // A title rather than a `left:` chip. `topbar` already draws the game code on
    // the right, so passing a chip shows it twice - which Cheat's table does and
    // nobody has noticed. But its DEFAULT title is Blob's "Round N of M", falling
    // back to "Lobby" - so a game with no rounds that passes neither sits under
    // the word Lobby for the whole game. Both halves had to be got right.
    topbar(state, { title: 'Kings Corner', ctx }),
    statusLine(ctx),
    // The board is wrapped rather than placed directly, so the wrapper can take
    // the height going spare and centre the board in it. Without that the whole
    // screen stacked at the top of a tall window with a third of it empty
    // underneath, which is what Seb saw.
    h('div.kc-boardwrap', board(ctx, event)),
    yours(ctx),
    turnButton(ctx),
    seats(ctx)
  );

  requestAnimationFrame(() => {
    fitHand(screen);
  });

  return screen;
}

/** How much of a card behind another one still has to show. */
const FAN_MIN_SHOW = 0.34;

/** Clear space kept either side of the fan, in the app's pixels. */
const HAND_GUTTER = 14;

/**
 * How far apart to fan the hand, in both directions.
 *
 * The shared `fitFan` only ever TIGHTENS - it caps at the resting overlap, on
 * the reasoning that a fan is a fan. That is right for a screen the width of a
 * phone and wrong on a laptop, where this game's hand is seven cards in a
 * seven-hundred pixel column and they huddled in the middle of it with the room
 * going spare either side. Seb saw it immediately.
 *
 * So this measures the same way and clamps at BOTH ends: never tighter than a
 * card you can still read by its corner, and never further apart than a small
 * gap - past that they stop reading as one hand and start reading as seven
 * cards that happen to be near each other.
 *
 * Measured rather than keyed on a breakpoint, so it needs no rule about which
 * screens are wide: a big hand on a laptop still tightens, and a small one on a
 * phone still spreads if the room is there.
 */
function fitHand(screen) {
  const zoom = uiZoom();
  for (const hand of screen.querySelectorAll('.kc-hand')) {
    const cards = [...hand.querySelectorAll('.hand__card')];
    if (cards.length < 2) continue;

    // Clear the last answer before measuring, or the fit reads its own output
    // and creeps every render.
    hand.style.removeProperty('--fan-overlap');
    // The ROOM, not the fan.
    //
    // `hand.clientWidth` is the fan itself, which is centred and shrink-to-fit -
    // so measuring it says the hand is exactly as wide as the hand, every time,
    // and there is never any room going spare. That is why the first version of
    // this looked like it did nothing. The room is the block the fan sits in.
    // `.kc-hands` is centred inside `.kc-yours` and therefore shrink-to-fit as
    // well, so it is no better a measure than the fan. The block with the ring
    // round it is the one that is actually the width of the screen.
    const block = hand.closest('.kc-yours') || hand.parentElement || hand;
    const room = block.getBoundingClientRect().width;
    const available = room - HAND_GUTTER * 2 * zoom;
    const cardWidth = cards[0].getBoundingClientRect().width;
    if (!available || !cardWidth) continue;

    const gaps = cards.length - 1;
    const wanted = (available - cards.length * cardWidth) / gaps / zoom;
    const tightest = -(cardWidth / zoom) * (1 - FAN_MIN_SHOW);
    const loosest = 10;
    // Floored rather than rounded: a fan a pixel too tight is invisible, and a
    // pixel too wide runs off the phone.
    hand.style.setProperty('--fan-overlap', `${Math.floor(Math.min(Math.max(wanted, tightest), loosest))}px`);
  }
}

// ── The status line ──────────────────────────────────────────────────────────

/**
 * One line, and it is about what to do next rather than about what happened.
 *
 * The line is reserved even when it is empty, so a status that grows by a word
 * does not resize every card on the board — `styles.css` has the same note
 * against Blob's.
 */
function statusLine(ctx) {
  const state = ctx.state;
  const you = state.you || {};
  const lifted = liftedCard(ctx);
  const pile = ctx.ui.kcPile;

  let text;
  if (you.out) {
    text = 'You are out. Waiting for the rest.';
  } else if (!you.isTurn) {
    const turn = state.players.find((p) => p.id === state.turnId);
    text = turn ? `${turn.name} is playing.` : 'Waiting.';
  } else if (lifted) {
    text = 'Tap where it goes.';
  } else if (pile) {
    text = 'Tap the pile to drop it on.';
  } else if (state.stuck) {
    text = you.willDraw ? 'Nothing you can do. Take a card.' : 'Nothing you can do.';
  } else if (you.turnPlayed) {
    text = 'Keep going, or end your turn.';
  } else {
    text = 'Your go.';
  }

  return h('p.kc-status', { text });
}

// ── The board ────────────────────────────────────────────────────────────────

/**
 * Nine cells: eight slots and the stock.
 *
 * Laid out in the order the server sends, with the stock spliced into the
 * middle, so the grid and `lib/kingscorner/rules.js` cannot drift apart.
 */
function board(ctx, event) {
  const state = ctx.state;
  const piles = state.piles || [];
  const bySlot = Object.fromEntries(piles.map((p) => [p.slot, p]));
  const order = ['NW', 'N', 'NE', 'W', null, 'E', 'SW', 'S', 'SE'];

  return h(
    'div.kc-board',
    { 'aria-label': 'The board' },
    order.map((slot) => (slot === null ? stockCell(state) : slotCell(ctx, bySlot[slot], event)))
  );
}

/** The middle of the cross: how many cards are still face down. */
function stockCell(state) {
  const left = state.stockLeft || 0;
  return h(
    'div.kc-cell.kc-cell--stock',
    left
      ? cardBack({ size: 'sm', label: `${left} cards face down` })
      : h('div.kc-stock__gone', { 'aria-hidden': 'true' }),
    h('span.kc-stock__count.tabular', {
      text: String(left),
      'aria-label': left ? `${left} cards in the stock` : 'The stock is empty',
    })
  );
}

/**
 * One slot.
 *
 * What it draws, in order of what you need from it: the card the pile has run
 * down to, big enough to read, because that is what decides everything you can
 * play; the head peeking out behind it, because that decides where the pile can
 * go; and how many cards are in it.
 *
 * An empty slot says what it will take rather than being a hole. A bare corner
 * that looked like a bare cross slot was the first thing to get confusing on
 * paper, and they behave completely differently.
 */
function slotCell(ctx, pile, event) {
  if (!pile) return h('div.kc-cell');
  const state = ctx.state;
  const you = state.you || {};
  const lifted = liftedCard(ctx);
  const heldPile = ctx.ui.kcPile;

  const canTakeCard = Boolean(lifted && (((you.moves || {}).cards || {})[lifted] || []).includes(pile.slot));
  const canTakePile = Boolean(heldPile && (((you.moves || {}).piles || {})[heldPile] || []).includes(pile.slot));
  const canLift = Boolean(!lifted && !heldPile && ((you.moves || {}).piles || {})[pile.slot]);
  const isHeld = heldPile === pile.slot;
  // With hints off the screen stops POINTING, and nothing else changes: the
  // move is just as legal, the tap still works, and a wrong one still says why.
  const hints = state.hints !== false;
  const target = hints && (canTakeCard || canTakePile);

  const classes = [
    'kc-cell',
    'kc-slot',
    pile.corner ? 'kc-slot--corner' : 'kc-slot--cross',
    pile.count ? '' : 'kc-slot--bare',
    target ? 'kc-slot--target' : '',
    isHeld ? 'kc-slot--held' : '',
    hints && canLift ? 'kc-slot--liftable' : '',
    event && event.kind === 'play' && event.slot === pile.slot ? 'kc-slot--landed' : '',
  ]
    .filter(Boolean)
    .join(' ');

  return h(
    'button',
    {
      className: classes,
      type: 'button',
      'aria-label': slotLabel(pile),
      onClick: () => tapSlot(ctx, pile, { canTakeCard, canTakePile, canLift, isHeld }),
    },
    pile.count ? pileFace(pile) : emptyFace(pile),
    pile.count > 1 ? h('span.kc-slot__count.tabular', { text: String(pile.count) }) : null
  );
}

/** The pile itself: the head behind, the exposed card in front. */
function pileFace(pile) {
  return h(
    'span.kc-pile',
    pile.count > 1
      ? h('span.kc-pile__head', cardFace(pile.head, { size: 'xs', corner: true }))
      : null,
    h('span.kc-pile__low', cardFace(pile.lowest, { size: 'sm', corner: true }))
  );
}

/**
 * An empty slot, saying what it will take.
 *
 * The two kinds are not the same hole and must not look like it: a corner takes
 * a king and nothing else for the whole game, and a bare cross slot is the only
 * place in the game that will take absolutely anything — which makes it the most
 * valuable square on the board and worth drawing as such.
 */
function emptyFace(pile) {
  return h(
    'span.kc-empty',
    { className: pile.corner ? 'kc-empty--corner' : 'kc-empty--any' },
    h('span.kc-empty__mark', { text: pile.corner ? '♚' : '+', 'aria-hidden': 'true' }),
    h('span.kc-empty__note', { text: pile.corner ? 'Kings' : 'Any card' })
  );
}

function slotLabel(pile) {
  const where = pile.corner ? 'corner' : 'slot';
  if (!pile.count) {
    return pile.corner ? `Empty ${where}, kings only` : `Empty ${where}, takes any card`;
  }
  const wants = pile.wants
    ? `wants a ${pile.wants.red ? 'red' : 'black'} ${pile.wants.rank}`
    : 'is finished, nothing goes under an ace';
  return `${pile.slot} ${where}, ${plural(pile.count, 'card', 'cards')}, showing ${rankOf(pile.lowest)}, ${wants}`;
}

/**
 * What a tap on a slot means, which depends on what you are already holding.
 *
 * Deliberately one control doing three jobs rather than three controls: the slot
 * is the thing on screen you are looking at, and a separate "move pile" button
 * somewhere else would mean finding it.
 */
function tapSlot(ctx, pile, can) {
  const lifted = liftedCard(ctx);

  if (lifted) {
    if (can.canTakeCard) {
      ctx.send({ type: 'play/card', cardId: lifted, slot: pile.slot });
      ctx.ui.kcCard = null;
      return;
    }
    ctx.toast(refuseCard(ctx, lifted, pile));
    return;
  }

  if (ctx.ui.kcPile) {
    if (can.canTakePile) {
      ctx.send({ type: 'play/movePile', from: ctx.ui.kcPile, to: pile.slot });
      ctx.ui.kcPile = null;
      return;
    }
    if (can.isHeld) {
      ctx.ui.kcPile = null;
      ctx.render();
      return;
    }
    ctx.toast(refusePile(ctx, ctx.ui.kcPile, pile));
    return;
  }

  if (can.canLift) {
    ctx.ui.kcPile = pile.slot;
    ctx.render();
    return;
  }

  // Every control answers, including the ones that do nothing. An inert cell
  // that looks live gets reported as a broken hitbox — that has already cost a
  // wrong diagnosis and a browser session once on this project.
  ctx.toast(idleSlot(ctx, pile));
}

// ── Your cards ───────────────────────────────────────────────────────────────

/**
 * Your hand, in a block that carries the gold ring while the game waits on you.
 *
 * The ring is on the block your own cards live in rather than on a caption at
 * the top, because at a table of five it was still possible to sit there while
 * everybody waited — your eyes are on your hand working out what you can play,
 * not on a status line above the board.
 *
 * `outline` and `box-shadow`, never a border or padding: `fitFan` measures this
 * block after paint, and a turn that changed its height would resize the fan
 * every time it came round to you.
 */
function yours(ctx) {
  const state = ctx.state;
  const you = state.you || {};
  const cards = you.hand || [];
  const moves = (you.moves || {}).cards || {};
  const lifted = liftedCard(ctx);
  const hints = state.hints !== false;

  const rows = splitHand(cards, ROW_MAX);

  return h(
    'div.kc-yours',
    { className: you.isTurn ? 'kc-yours--turn' : '' },
    cards.length
      ? h(
          'div.kc-hands',
          rows.map((row) => {
            const middle = (row.length - 1) / 2;
            return h(
              'div.hand.hand--fanned.kc-hand',
              row.map((card, i) => {
                const legal = Boolean(moves[card]);
                const isLifted = lifted === card;
                return h(
                  'div.hand__card',
                  { style: { '--fan-i': String(i - middle) } },
                  cardFace(card, {
                    size: 'md',
                    corner: true,
                    // Deliberately NOT dimming what you cannot play.
                    //
                    // Blob and Silly Head dim it and it reads well there because
                    // most of a hand usually is playable. Here two legal cards
                    // out of ten is an ordinary turn, so the same rule would
                    // grey out almost the whole hand and you could not read your
                    // own cards. Sevens learned this the same way.
                    state: isLifted ? 'lifted' : hints && legal && you.isTurn ? 'playable' : null,
                    className: [
                      hints && legal && you.isTurn ? '' : 'card-face--idle',
                      ctx.ui.kcNew && ctx.ui.kcNew.includes(card) ? 'kc-card--fresh' : '',
                    ]
                      .filter(Boolean)
                      .join(' '),
                    onClick: () => tapCard(ctx, card, legal),
                  })
                );
              })
            );
          })
        )
      : h('p.kc-hands__empty', { text: 'Your hand is empty.' })
  );
}

function tapCard(ctx, card, legal) {
  const you = ctx.state.you || {};
  if (!you.isTurn) {
    ctx.toast('Not your go yet.');
    return;
  }
  // Putting a pile down to pick a card up, rather than refusing. Two things
  // half-selected is a state nobody asked for.
  ctx.ui.kcPile = null;
  if (ctx.ui.kcCard === card) {
    ctx.ui.kcCard = null;
    ctx.render();
    return;
  }
  if (!legal) {
    ctx.toast(waitingFor(ctx, card));
    return;
  }
  ctx.ui.kcCard = card;
  ctx.render();
}

// ── The one button ───────────────────────────────────────────────────────────

/**
 * One control, always in the same place, and its label is what will happen.
 *
 * Never three buttons appearing and disappearing under the thumb. Cheat's call
 * button taught this: the one thing you have to press must not also be the thing
 * whose position you cannot learn.
 *
 * The server decides which of the three this is — `you.willDraw` — because the
 * rule behind it is the house rule the whole game turns on and the client owns
 * no rules.
 */
function turnButton(ctx) {
  const state = ctx.state;
  const you = state.you || {};

  if (!you.isTurn) {
    const turn = state.players.find((p) => p.id === state.turnId);
    return h('div.kc-actions', h('p.kc-waiting', { text: turn ? `Waiting for ${turn.name}` : 'Waiting' }));
  }

  const label = you.turnPlayed ? 'End turn' : you.willDraw ? 'Draw and pass' : 'Pass';

  // Filled ONLY when there is nothing else you could do.
  //
  // Seb played it and reported pressing this while still holding a playable
  // card, which is exactly what a big solid button in the accent colour asks
  // you to do - it was the loudest thing on the screen whether or not it was
  // the right move. Now it is an outline while you still have a move, and goes
  // solid the moment it becomes the only thing left. Same button, same place,
  // same words: only the shouting moves.
  const stuck = Boolean(ctx.state.stuck);

  return h(
    'div.kc-actions',
    action(
      label,
      () => {
        ctx.ui.kcCard = null;
        ctx.ui.kcPile = null;
        ctx.send({ type: 'play/endTurn' });
      },
      { kind: stuck ? 'primary' : 'ghost' }
    ),
    stuck && !you.turnPlayed && you.willDraw
      ? h('p.kc-actions__note', { text: 'Nothing goes. You pick one up.' })
      : null
  );
}

// ── Who else is here ─────────────────────────────────────────────────────────

/**
 * Everybody, and how many cards they hold.
 *
 * The count is the only running score this game produces, and it is public — you
 * can count somebody's cards across a table. Whose turn it is gets the ring.
 */
function seats(ctx) {
  const state = ctx.state;
  const you = state.you || {};
  return h(
    'div.kc-seats',
    state.players
      .filter((p) => !p.left)
      .map((player) =>
        h(
          'div.kc-seat',
          {
            className: [
              player.id === state.turnId ? 'kc-seat--turn' : '',
              player.out ? 'kc-seat--out' : '',
              player.id === you.id ? 'kc-seat--you' : '',
              !player.connected && !player.isBot ? 'kc-seat--away' : '',
            ]
              .filter(Boolean)
              .join(' '),
          },
          h('span.kc-seat__name', { text: player.name }),
          player.out
            ? h('span.kc-seat__place', {
                text: player.place === 1 ? '1st' : `${player.place}${ordinal(player.place)}`,
                'aria-label': `${player.name} went out ${player.place === 1 ? 'first' : `${player.place}th`}`,
              })
            : h('span.kc-seat__count.tabular', {
                text: String(player.cardsHeld),
                'aria-label': `${player.name} is holding ${player.cardsHeld}`,
              })
        )
      )
  );
}

// ── Saying why ───────────────────────────────────────────────────────────────
//
// All four of these read off what the server already sent, so they explain
// rather than decide. The reducer would refuse anything they got wrong.

/** 1st, 2nd, 3rd, 4th. Small, and only ever used on a place. */
function ordinal(n) {
  if (n === 2) return 'nd';
  if (n === 3) return 'rd';
  return 'th';
}

function liftedCard(ctx) {
  const hand = ((ctx.state || {}).you || {}).hand || [];
  return ctx.ui.kcCard && hand.includes(ctx.ui.kcCard) ? ctx.ui.kcCard : null;
}

function waitingFor(ctx, card) {
  const want = (((ctx.state.you || {}).moves || {}).wants || {})[card];
  if (!want) return 'A king only goes in a corner, or on a slot that has emptied.';
  return `That needs a ${want.red ? 'red' : 'black'} ${want.rank} to sit on.`;
}

function refuseCard(ctx, card, pile) {
  if (!pile.count) {
    return pile.corner ? 'Only a king can open a corner.' : 'That slot takes anything — but not from here.';
  }
  if (!pile.wants) return 'That pile has run down to an ace. Nothing goes under it.';
  return `That pile wants a ${pile.wants.red ? 'red' : 'black'} ${pile.wants.rank}.`;
}

function refusePile(ctx, from, pile) {
  if (!pile.count) {
    return pile.corner
      ? 'Only a pile headed by a king can go into a corner.'
      : 'A pile can only go onto another pile.';
  }
  const head = (ctx.state.piles || []).find((p) => p.slot === from);
  if (!head || !head.head) return 'That pile will not go there.';
  return `That pile starts with a ${rankOf(head.head)} — it needs a pile showing one rank higher, in the other colour.`;
}

function idleSlot(ctx, pile) {
  const you = ctx.state.you || {};
  if (!you.isTurn) return 'Not your go yet.';
  if (!pile.count) {
    return pile.corner ? 'Empty corner. Only a king opens one.' : 'Empty slot. Any card in your hand will go there.';
  }
  if (!pile.wants) return 'Run down to an ace. Nothing else goes on it.';
  return `Wants a ${pile.wants.red ? 'red' : 'black'} ${pile.wants.rank}. Pick a card first.`;
}
