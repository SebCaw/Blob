import { h, fragment } from '../../ui.js';
import { cardFace, cardBack } from '../../cards.js';
import { topbar, splitHand } from '../common.js';
import { uiZoom } from '../../size.js';

/**
 * The Go Fish table.
 *
 * The asking is the game, so the asking is the screen. A turn is two taps: a
 * card out of your own hand to choose the rank, and then the person you are
 * asking — and the person is a SEAT rather than a button in a list, because
 * pointing at somebody is what you actually do at a table.
 *
 * **The one moment worth building for is the answer.** When you are asked,
 * everybody looks at you, and the app must not resolve it before you have said
 * anything. So the target taps, and only the target's own payload carries what
 * the button will say — `you.answering` in `lib/gofish/view.js` is the single
 * asymmetry in the whole game. To everybody else the table is simply waiting on
 * Kate, which is exactly what it is at a real table.
 *
 * **There is no clock on any of it.** Unlike Cheat, nothing here is time
 * critical: there is no window to miss and nothing is decided by not acting. The
 * only thing waiting on a missing phone is `stallWatch`, which is the Master's
 * problem rather than the screen's.
 *
 * **Nothing on a seat says what that seat is known to hold.** Cheat annotates
 * seats with the cards the room watched, and it is right to, because a reveal
 * there is a rare and memorable event. Here a handover is most of what happens,
 * and a seat carrying everything it has been given would be the app playing the
 * game. What is on the screen is the transcript, the same words everybody heard.
 */

/** How long a just-happened thing is treated as news, for the animations. */
const NEWS_MS = 1_100;

/** The most cards that share a row of your own fan. */
const ROW_MAX = 9;

/** How many lines of the transcript are worth showing. */
const HEARD = 4;

/**
 * The ring, and when there is no room for one.
 *
 * Seb asked for a table rather than a list of names, in the same words for both
 * this and Cheat: make it into a table like in Silly Head and Blob, it will fill
 * the space much better. He is right, and the reason is sharper here than
 * anywhere else on the shelf: a Go Fish seat is something you POINT AT. The
 * second half of every turn is choosing a person, and a person is easier to find
 * in a place than in a list.
 *
 * The numbers are lifted from Silly Head's ring, which has already been through
 * a phone. `RING_MIN_WIDTH` is in the APP's pixels rather than the screen's,
 * because turning the text size up narrows the app exactly as a smaller phone
 * would: at Largest a 375px phone has 268 of them to spend, and six seats round
 * a pool do not go into that however the arithmetic is arranged. Under it the
 * seats fall back to the list, which is a worse table and a perfectly good
 * screen.
 */
const RING_MIN_WIDTH = 240;
/** And what each seat past the third adds to that. Six need a wider table. */
const RING_WIDTH_PER_SEAT = 30;
const RING_X = 38;
/*
  Taller than it is round, and deliberately.

  A circle puts the seats as close to the middle vertically as it does
  horizontally, and the middle of this table is the only place in the app that
  has something long to say - "Ada had no fives", "Cleo takes one from the pool"
  - stacked three deep while a turn plays out. On a phone that block grew up and
  down into the name plates above and below it. Seb sent a photo of it sitting on
  top of Ada's.

  Pushing the ring out sideways instead would not have helped: the message is
  narrow and tall, so the crowding is vertical, and a phone has no width to give
  anyway. So the ring became an ellipse - same width, more height - which buys
  the gap exactly where the words are.
*/
const RING_Y = 41;
const RING_MID_Y = 45;
/** The widest a seat gets. Narrower than Silly Head's: no face-up cards on it. */
const SEAT_MAX_PCT = 26;

/** Is there room for a ring at all, at the size this player has asked for? */
function tooTightForRing(total) {
  const need = RING_MIN_WIDTH + Math.max(0, total - 3) * RING_WIDTH_PER_SEAT;
  return window.innerWidth / (uiZoom() || 1) < need;
}

function seatAngle(index, total) {
  return -90 - (index * 360) / total;
}

/**
 * How wide a seat is and how far out the ring sits, settled together.
 *
 * A seat takes a shade under the gap to its closest neighbour, and the ring
 * comes in far enough that the outermost seat stays on the screen. The two
 * depend on each other - pulling the ring in shortens the arc, which narrows the
 * seats, which lets the ring back out - so it is settled by running the pair
 * round a few times rather than by one formula that cannot express it.
 */
function ringGeometry(total) {
  const step = 360 / total;
  let ringX = RING_X;
  let widthPct = SEAT_MAX_PCT;
  for (let pass = 0; pass < 4; pass += 1) {
    widthPct = Math.min(SEAT_MAX_PCT, 2 * ringX * Math.sin((step / 2) * (Math.PI / 180)) * 0.94);
    ringX = Math.min(RING_X, 50 - widthPct / 2 - 3);
  }
  return { ringX, widthPct };
}

const RANK_ONE = {
  A: 'ace', 2: 'two', 3: 'three', 4: 'four', 5: 'five', 6: 'six', 7: 'seven',
  8: 'eight', 9: 'nine', 10: 'ten', J: 'jack', Q: 'queen', K: 'king',
};
const RANK_MANY = {
  A: 'aces', 2: 'twos', 3: 'threes', 4: 'fours', 5: 'fives', 6: 'sixes', 7: 'sevens',
  8: 'eights', 9: 'nines', 10: 'tens', J: 'jacks', Q: 'queens', K: 'kings',
};
const COUNT_WORD = ['no', 'one', 'two', 'three', 'four'];

/** "sevens" or "seven" — the word after a count. */
function rankWord(rank, count) {
  return count === 1 ? RANK_ONE[rank] : RANK_MANY[rank];
}

let seen = { at: null, localAt: 0 };

/**
 * What the last measuring pass worked out, so the next render can start there.
 *
 * **This is a tap-target fix, not a performance one.** The seats are placed by
 * formula and then settled by measurement a frame later, and every push rebuilds
 * the whole screen — so each time a bot moved or a line arrived in the
 * transcript, the table painted at full size and then shrank under your thumb a
 * frame afterwards. Aiming at a name and hitting nothing, or hitting the seat
 * next to it, is the whole of Seb's "clicking to ask somebody is a bit funny".
 *
 * The measuring pass cannot go: how tall a seat ends up with a long name and
 * three books on it is not something the formula can predict. But its ANSWER can
 * be remembered, and the answer only changes when something about the shape of
 * the screen changes — which is what the key is. So the first render at a given
 * size still settles visibly, and every render after it is already right.
 */
let settled = { key: null, scale: 1, quiet: false, spill: false };

/**
 * Everything that can change what the measuring pass decides.
 *
 * The window, the zoom (which is how the text-size control makes a phone
 * narrower), and the number of people at the table. Not the state of the game:
 * a card moving does not move a seat, and keying on it would put the jump back.
 */
function settleKey(total) {
  return `${total}:${window.innerWidth}x${window.innerHeight}:${uiZoom() || 1}`;
}

/**
 * Whether what just happened is still news.
 *
 * Gated on the event's own identity plus a time window, never on "this render
 * differs from the last one". Every push rebuilds the whole screen, so a one-shot
 * flag would be wiped before it painted — see the note in ADDING-A-GAME.md.
 */
function freshEvent(event) {
  if (!event || !event.at) return null;
  if (seen.at !== event.at) seen = { at: event.at, localAt: Date.now() };
  return Date.now() - seen.localAt < NEWS_MS ? event : null;
}

export function tableScreen(ctx) {
  const state = ctx.state;
  const you = state.you || {};
  const event = freshEvent(state.lastEvent);
  const here = state.players.filter((p) => !p.left);
  const ring = !tooTightForRing(here.length);

  // You at the bottom, everybody else round from you in seating order - the
  // same convention as Blob and Silly Head, so the shelf keeps one idea of where
  // you are sitting.
  const start = here.findIndex((p) => p.id === you.id);
  const ordered = start === -1 ? here : here.slice(start).concat(here.slice(0, start));
  const others = here.filter((p) => p.id !== you.id);

  const screen = h(
    // `--fixed` so the table does not wander under your thumb, and deliberately
    // NOT `--fits`: there is always a control to reach here, so the rule in
    // styles.css says it takes the scrolling hatch rather than shrinking itself.
    'div.screen.screen--fixed.gf-play',
    topbar(state, { title: 'Go Fish', ctx }),
    metaRow(ctx),
    statusLine(ctx),
    ring ? ringTable(ctx, ordered, event) : middle(ctx, event),
    ring ? null : h('div.gf-seats', others.map((p) => seat(ctx, p, event))),
    heard(ctx),
    // Your own books sit on your own seat once there is a table to sit at, so
    // the strip only appears when the seats are a list.
    ring ? null : yourBooks(ctx),
    yourHand(ctx),
    tools(ctx)
  );

  // Both of these are what the last pass settled on, put back BEFORE the first
  // paint so the screen arrives at the size it is going to stay at.
  const key = settleKey(here.length);
  if (settled.key === key) {
    if (settled.quiet) screen.classList.add('gf-play--quiet');
    if (settled.spill) screen.classList.add('screen--spill');
  }

  requestAnimationFrame(() => {
    spillIfNeeded(screen, key);
    fitSeats(screen, key);
  });
  return screen;
}

/**
 * The table: everybody round a felt, with the pool and the question in the
 * middle of it.
 *
 * The middle is deliberately the same `middle()` the list layout draws. There is
 * one question on the table and it should look the same wherever it is put - two
 * versions of the loudest thing on the screen is two things to keep in step.
 */
function ringTable(ctx, ordered, event) {
  const total = ordered.length;
  const { ringX, widthPct } = ringGeometry(total);

  const seats = ordered.map((player, index) => {
    const radians = (seatAngle(index, total) * Math.PI) / 180;
    return seat(ctx, player, event, {
      left: `${50 + Math.cos(radians) * ringX}%`,
      top: `calc(${RING_MID_Y}% - ${RING_Y} * ${Math.sin(radians).toFixed(4)} * 1%)`,
    });
  });

  return h(
    'div.table.gf-table',
    {
      style: {
        '--seat-pct': String(widthPct),
        // Where the last pass finished, so the seats do not move under a thumb
        // that is already on its way to one. See `settled`.
        '--seat-scale': String(settled.key === settleKey(total) ? settled.scale : 1),
      },
    },
    h('div.table__ring', h('div.table__felt'), seats, h('div.gf-centre', middle(ctx, event)))
  );
}

/**
 * Shrink the seats until no two of them touch.
 *
 * `ringGeometry` gets six seats close, and how tall a seat ends up once a long
 * name and three books have had their say is not something it can predict - so
 * the formula places them and a measuring pass settles it, which is the same
 * split Blob's table uses.
 *
 * Boxes are compared against each other rather than against the ring, because
 * seats lean out of a ring by design and asking whether the ring overflows
 * counts collisions that are not there.
 */
function fitSeats(screen, key) {
  const table = screen.querySelector('.gf-table');
  if (!table) return;
  const seats = [...table.querySelectorAll('.gf-seat')];
  if (seats.length < 2) return;

  // The whole sweep happens inside one frame, so none of the sizes it tries on
  // the way down is ever painted - only the one it stops at.
  for (let scale = 100; scale >= 70; scale -= 6) {
    table.style.setProperty('--seat-scale', String(scale / 100));
    const boxes = seats.map((el) => el.getBoundingClientRect());
    let clash = false;
    for (let i = 0; i < boxes.length && !clash; i += 1) {
      for (let j = i + 1; j < boxes.length && !clash; j += 1) {
        const a = boxes[i];
        const b = boxes[j];
        clash = a.left < b.right - 1 && b.left < a.right - 1 && a.top < b.bottom - 1 && b.top < a.bottom - 1;
      }
    }
    if (!clash) {
      settled = { ...settled, key, scale: scale / 100 };
      return;
    }
  }
  // Still touching at the smallest we go. Remembering it anyway is the point:
  // the next render should start here rather than at full size and shrink again.
  settled = { ...settled, key, scale: 0.7 };
}

/**
 * Fit the screen, and let it scroll only if it still will not go.
 *
 * Two steps, in order of what is worth losing. Six seats, a transcript, a fan
 * and a button is a lot for a short phone at the largest text size — measured,
 * it overruns by about seventy pixels — and the transcript is the one part of
 * this screen that is a convenience rather than a control or the question you
 * are answering. So it goes first, and only if that is not enough does the
 * screen become one that moves under your thumb.
 *
 * Gating on measurement rather than on which text size somebody picked is the
 * lesson from Blob's bid screen, where the hatch only opened at the larger sizes
 * and the default size clipped its own top with no way to reach it. It also
 * means this needs no rule about player counts: five short names and five long
 * ones are different screens, and only one of them has to give anything up.
 *
 * **Two measurements, not one, and the second caught a real bug.**
 * `scrollHeight > clientHeight` only detects an overflow that is being CLIPPED —
 * and a screen that has GROWN past the window is not clipping anything, so the
 * two numbers come back equal and everything looks fine while the button sits
 * below the fold. That is what `flex: 1` on `.screen` does to a `--fixed`
 * screen, and it is why `.gf-play` is pinned with `flex: 0 0 auto`. The second
 * check is here to notice if that ever comes undone.
 *
 * The obvious way to write that second check — is the screen's bottom past the
 * bottom of the window — is wrong, and wrong in the direction that hides the
 * fix: this screen is SUPPOSED to be exactly one window tall, and it starts a
 * few pixels down, so its bottom is always a few pixels past. It reported an
 * overflow at every size and quietly threw the transcript away on a screen that
 * fitted perfectly well. So it compares against `--app-h` instead, which is what
 * the screen was actually told to be.
 *
 * Both classes come off before anything is measured. A fitter that reads its own
 * last answer creeps tighter on every render, which is written down in
 * `common.js` and is easy to walk into again here.
 */
function spillIfNeeded(screen, key) {
  screen.classList.remove('screen--spill', 'gf-play--quiet');
  let quiet = false;
  let spill = false;
  if (overruns(screen)) {
    quiet = true;
    screen.classList.add('gf-play--quiet');
    if (overruns(screen)) {
      spill = true;
      screen.classList.add('screen--spill');
    }
  }
  settled = { ...settled, key, quiet, spill };
}

function overruns(screen) {
  const clipped = screen.scrollHeight > screen.clientHeight + 1;
  const told = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--app-h'));
  const grew = Number.isFinite(told) && told > 0 && screen.clientHeight > told + 1;
  return clipped || grew;
}

// -- Header -------------------------------------------------------------------

// No code chip in the left slot. `topbar` already puts one on the right, and
// passing a second one shows the game code twice - which Cheat's table does and
// nobody has noticed yet.

function metaRow(ctx) {
  const state = ctx.state;
  const you = state.you || {};
  const held = (you.hand || []).length;
  return h(
    'div.gf-meta',
    h('span.gf-meta__count', h('strong', { text: String(held) }), h('span', { text: held === 1 ? 'card' : 'cards' })),
    h('span.gf-chip', { text: `${state.poolCount} in the pool` }),
    h('span.gf-chip', { text: `${state.booksMade}/${state.booksInDeck} books` }),
    speedToggle(ctx)
  );
}

/**
 * Double speed, offered only when there is nobody left to wait for.
 *
 * The same control the other games have, and here for the same reason: once
 * every player still holding cards is a bot, the pauses have stopped being pace.
 */
function speedToggle(ctx) {
  const state = ctx.state;
  const you = state.you || {};
  if (!state.canSpeedUp || !you.isMaster) return null;
  const fast = state.speed === 2;
  return h('button', {
    className: `gf-chip gf-chip--speed${fast ? ' gf-chip--on' : ''}`,
    type: 'button',
    text: fast ? 'x2 on' : 'x2',
    'aria-pressed': fast ? 'true' : 'false',
    'aria-label': fast ? 'Back to normal speed' : 'Speed the bots up',
    onClick: () => ctx.send({ type: 'game/setSpeed', speed: fast ? 1 : 2 }),
  });
}

function statusLine(ctx) {
  const state = ctx.state;
  const you = state.you || {};
  const ask = state.ask;
  const picked = ctx.ui.gfRank;

  if (ask) {
    if (you.answering) return h('p.gf-status.gf-status--you', { text: `${ask.askerName} is asking YOU` });
    return h('p.gf-status', { text: `Waiting on ${ask.targetName}` });
  }
  if (you.out) return h('p.gf-status', { text: 'Your hand is gone. Watching the rest of it.' });
  if (you.isTurn) {
    return h('p.gf-status.gf-status--you', {
      text: picked ? `Who has a ${RANK_ONE[picked]}? Tap them.` : 'Your turn — tap a card to ask for it',
    });
  }
  const turn = state.players.find((p) => p.id === state.turnId);
  if (turn) return h('p.gf-status', { text: `${turn.name} is deciding who to ask` });
  return h('p.gf-status', { text: 'Waiting…' });
}

// -- The middle ---------------------------------------------------------------

/**
 * The question on the table, what just came of one, or the pool.
 *
 * Never a card that anybody still holds. The only faces that appear here are the
 * ones physically crossing the table on a handover, which the whole room watches
 * — see the note about `lastEvent` in `lib/gofish/view.js`.
 */
function middle(ctx, event) {
  const state = ctx.state;
  if (state.ask) return askView(ctx, state.ask, event);
  if (event && event.kind === 'give') return giveView(ctx, event);
  if (event && event.kind === 'fish') return fishView(ctx, event);
  if (event && event.kind === 'book') return bookView(ctx, event);
  return poolView(state);
}

function poolView(state) {
  if (!state.poolCount) {
    return h(
      'div.gf-middle.gf-middle--empty',
      h('div.gf-pool__slot', { 'aria-hidden': 'true' }),
      h('span.gf-middle__label', { text: 'The pool is empty' })
    );
  }
  return h(
    'div.gf-middle',
    stack(state.poolCount),
    h('span.gf-middle__label', { text: `${state.poolCount} left in the pool` })
  );
}

/** A few backs, overlapping, however deep the pool actually is. */
function stack(count) {
  const shown = Math.min(4, count);
  return h(
    'div.gf-pool',
    { 'aria-label': `${count} cards in the pool` },
    Array.from({ length: shown }, (_, i) =>
      h('div.gf-pool__card', { style: { '--i': String(i) } }, cardBack({ size: 'sm' }))
    )
  );
}

/**
 * The question, and it is the biggest thing on the screen while it is there.
 *
 * The lesson from Cheat, where the one object the table had to react to was a
 * 24px line under a row of card backs and reading it cost most of the window.
 * Nothing here is on a clock, but the same thing is true for a duller reason:
 * this is the only sentence on the screen and it may as well be legible from the
 * other side of a room.
 */
function askView(ctx, ask, event) {
  const you = ctx.state.you || {};
  const fresh = Boolean(event && event.kind === 'ask');
  const mine = ask.askerId === you.id;
  const yours = Boolean(you.answering);

  return h(
    'div',
    { className: `gf-middle gf-middle--ask${fresh ? ' gf-middle--landed' : ''}` },
    h('p.gf-ask__who', {
      text: mine ? `You asked ${ask.targetName}` : `${ask.askerName} asks ${yours ? 'you' : ask.targetName}`,
    }),
    h(
      'p.gf-ask__saying',
      h('span.gf-ask__rank', { text: ask.rank }),
      h('span.gf-ask__word', { text: `any ${RANK_MANY[ask.rank]}?` })
    )
  );
}

/** Cards crossing the table. The one place a face appears outside a hand. */
function giveView(ctx, event) {
  const state = ctx.state;
  const you = state.you || {};
  const name = (id) => (state.players.find((p) => p.id === id) || {}).name || 'Someone';
  const cards = event.cards || [];
  return h(
    'div.gf-middle.gf-middle--give',
    h('span.gf-middle__label', {
      text: `${event.targetId === you.id ? 'You hand' : `${name(event.targetId)} hands`} over ${
        COUNT_WORD[event.count] || event.count
      }`,
    }),
    h(
      'div.gf-cross',
      cards.map((card, i) => h('div.gf-cross__card', { style: { '--i': String(i) } }, cardFace(card, { size: 'sm', corner: true })))
    ),
    h('p.gf-verdict.gf-verdict--hit', {
      text: `${event.askerId === you.id ? 'You go' : `${name(event.askerId)} goes`} again.`,
    })
  );
}

/**
 * Go fish, and what came of it — which is nothing anybody may see.
 *
 * The card drawn is deliberately a BACK even to the person who drew it, because
 * this beat is what everybody else is looking at. Your own new card turns up in
 * your fan a moment later, which is where it belongs.
 */
function fishView(ctx, event) {
  const state = ctx.state;
  const you = state.you || {};
  const name = (id) => (state.players.find((p) => p.id === id) || {}).name || 'Someone';
  return h(
    'div.gf-middle.gf-middle--fish',
    h('span.gf-middle__label', { text: `${name(event.targetId)} had no ${RANK_MANY[event.rank]}` }),
    h('p.gf-verdict.gf-verdict--fish', { text: 'Go fish' }),
    event.drew
      ? h(
          'div.gf-drawn',
          h('div.gf-drawn__card', cardBack({ size: 'sm' })),
          h('span.gf-middle__label', {
            text: `${event.askerId === you.id ? 'You take' : `${name(event.askerId)} takes`} one from the pool`,
          })
        )
      : h('span.gf-middle__label', { text: 'Nothing left to fish for' })
  );
}

function bookView(ctx, event) {
  const state = ctx.state;
  const you = state.you || {};
  const name = (id) => (state.players.find((p) => p.id === id) || {}).name || 'Someone';
  return h(
    'div.gf-middle.gf-middle--book',
    h('span.gf-middle__label', {
      text: `${event.playerId === you.id ? 'You put down' : `${name(event.playerId)} puts down`}`,
    }),
    h(
      'div.gf-book__four',
      ['S', 'H', 'D', 'C'].map((suit, i) =>
        h('div.gf-book__card', { style: { '--i': String(i) } }, cardFace(`${event.rank}${suit}`, { size: 'sm', corner: true }))
      )
    ),
    h('p.gf-verdict.gf-verdict--book', { text: `The ${RANK_MANY[event.rank]}.` })
  );
}

// -- Everybody else -----------------------------------------------------------

/**
 * One other player, and on your turn a target.
 *
 * The seat IS the button, once you have chosen a rank. Pointing at somebody is
 * the whole physical act of this game, and a row of names in a control strip
 * would have been the same information with the gesture taken out of it.
 *
 * The row stays exactly where it is whether it is live or not — an inert control
 * that moves when it wakes up is one you have to find again every turn.
 */
function seat(ctx, player, event, at) {
  const state = ctx.state;
  const you = state.you || {};
  const picked = ctx.ui.gfRank;
  const askable = Boolean(picked && (you.canAsk || []).includes(player.id) && !state.ask);
  const giving = Boolean(event && event.kind === 'give' && event.targetId === player.id);
  const asked = player.isAsked;

  const classes = ['gf-seat'];
  if (at) classes.push('gf-seat--placed');
  if (player.id === you.id) classes.push('gf-seat--you');
  if (player.out) classes.push('gf-seat--out');
  if (player.isTurn || asked) classes.push('gf-seat--turn');
  if (askable) classes.push('gf-seat--target');
  if (giving) classes.push('gf-seat--gave');

  const body = [
    h(
      'div.gf-seat__head',
      h('span.gf-seat__name', { text: player.id === you.id ? 'You' : player.name }),
      h('span.gf-seat__count', { text: player.out ? 'out' : String(player.cardsHeld) })
    ),
    books(player),
    askable ? h('span.gf-seat__cue', { text: `Any ${RANK_MANY[picked]}?` }) : null,
    // "thinking" is what the rest of the table sees while it waits on somebody.
    // On your OWN seat it is nonsense - you are not thinking, you are being
    // asked - and the middle and the button underneath both already say so.
    asked && player.id !== you.id
      ? h('span.gf-seat__cue.gf-seat__cue--waiting', { text: 'thinking' })
      : null,
    !player.connected && !player.isBot ? h('span.gf-seat__state', { text: 'away' }) : null,
  ];

  if (!askable) {
    return h('div', { className: classes.join(' '), style: at || undefined, 'data-player-id': player.id }, ...body);
  }
  return h(
    'button',
    {
      className: classes.join(' '),
      style: at || undefined,
      type: 'button',
      'data-player-id': player.id,
      'aria-label': `Ask ${player.name} for ${RANK_MANY[picked]}`,
      onClick: () => {
        ctx.send({ type: 'play/ask', targetId: player.id, rank: picked });
        ctx.ui.gfRank = null;
      },
    },
    ...body
  );
}

/** The books in front of somebody. Face up on the table, so face up here. */
function books(player) {
  const laid = player.books || [];
  if (!laid.length) return null;
  return h(
    'div.gf-seat__books',
    { 'aria-label': `${player.name} has booked ${laid.join(', ')}` },
    laid.map((rank) => h('span.gf-book', { text: rank }))
  );
}

// -- What the table has said --------------------------------------------------

/**
 * The last few things anybody said, and the whole of what there is to remember.
 *
 * Deliberately a transcript rather than a summary. Working out that Ben is
 * sitting on three sevens is the game, and an app that put "three sevens" next
 * to his name would have played it for you. What this does is the thing a room
 * does for free: it stops you missing what was said while you were looking at
 * your own cards.
 */
function heard(ctx) {
  const state = ctx.state;
  const you = state.you || {};
  const name = (id) => {
    if (id === you.id) return 'You';
    return (state.players.find((p) => p.id === id) || {}).name || 'Someone';
  };
  const lines = (state.log || [])
    .filter((e) => e.kind === 'ask' || e.kind === 'give' || e.kind === 'fish' || e.kind === 'book')
    .slice(-HEARD)
    .map((e) => line(e, name));

  return h(
    'div.gf-heard',
    { 'aria-label': 'What has been said' },
    lines.length
      ? lines.map((text, i) =>
          h('span.gf-heard__line', { className: i === lines.length - 1 ? 'gf-heard__line--last' : '', text })
        )
      : h('span.gf-heard__line', { text: 'Nothing said yet.' })
  );
}

function line(e, name) {
  if (e.kind === 'ask') return `${name(e.askerId)} → ${name(e.targetId)}: any ${RANK_MANY[e.rank]}?`;
  if (e.kind === 'give') return `${name(e.targetId)} gave ${e.count} ${rankWord(e.rank, e.count)}`;
  if (e.kind === 'fish') return `${name(e.targetId)}: go fish`;
  return `${name(e.playerId)} booked the ${RANK_MANY[e.rank]}`;
}

// -- Your own side of the table -----------------------------------------------

function yourBooks(ctx) {
  const you = ctx.state.you || {};
  const laid = you.books || [];
  if (!laid.length) return null;
  return h(
    'div.gf-mine',
    h('span.gf-mine__label', { text: 'Your books' }),
    laid.map((rank) => h('span.gf-book.gf-book--mine', { text: rank }))
  );
}

/**
 * Your cards, and the rank you are asking for.
 *
 * Tapping any card picks its RANK, and every card of that rank lifts together —
 * because the rank is what you ask for and lifting one of three sevens would be
 * drawing a distinction the game does not have.
 *
 * Cards are inert when it is not your turn, and they say so rather than simply
 * not responding: an inert control that looks live is a bug report waiting to
 * happen, which is exactly what Sevens found out.
 */
/**
 * The mark on a card that has just arrived in your hand.
 *
 * A hand is kept in order, so a card you have just been given or just fished
 * does not land at the end where you could see it — it files itself between two
 * cards that were already there, and the hand simply looks one card longer.
 * Which one is new is the thing you most want to know and the one thing the
 * screen was not saying.
 *
 * Drawn rather than set in type, like the crown and the cog: a star from the
 * system font arrives as an emoji at whatever size and colour it fancies.
 */
function freshPip() {
  const wrap = h('span.gf-fresh', { 'aria-label': 'just picked up' });
  wrap.appendChild(
    fragment(
      '<svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">' +
        '<path d="M12 1 L14.4 8.6 L22 11 L14.4 13.4 L12 21 L9.6 13.4 L2 11 L9.6 8.6 Z" fill="currentColor"/>' +
        '</svg>'
    )
  );
  return wrap;
}

function yourHand(ctx) {
  const state = ctx.state;
  const you = state.you || {};
  const hand = you.hand || [];
  const picked = ctx.ui.gfRank;
  const usable = Boolean(you.isTurn && !state.ask);
  const arrived = new Set(ctx.ui.gfNew || []);

  if (you.out) return h('div.gf-hand.gf-hand--empty', h('p.muted.center', { text: 'Your hand is empty. Nicely done.' }));
  if (!hand.length) return h('div.gf-hand.gf-hand--empty');

  const rows = splitHand(hand, ROW_MAX);
  return h(
    'div.gf-hand',
    rows.map((row) =>
      h(
        'div.gf-fan',
        { style: { '--n': String(row.length) } },
        row.map((card, i) => {
          const rank = card.slice(0, -1);
          const on = picked === rank;
          const fresh = arrived.has(card);
          return h(
            'div',
            {
              className: `gf-hand__card${on ? ' gf-hand__card--picked' : ''}${
                fresh ? ' gf-hand__card--fresh' : ''
              }`,
              style: { '--i': String(i) },
              // On the wrapper, not on the card. `cardFace` builds its own
              // attributes and quietly drops anything else handed to it.
              'aria-selected': on ? 'true' : 'false',
            },
            cardFace(card, {
              size: 'md',
              corner: true,
              state: on ? 'picked' : null,
              onClick: usable
                ? () => {
                    ctx.ui.gfRank = on ? null : rank;
                    ctx.render();
                  }
                : null,
            }),
            fresh ? freshPip() : null
          );
        })
      )
    )
  );
}

// -- The one control that matters ---------------------------------------------

/**
 * The bottom strip, and it is one slot in one place at one height.
 *
 * Whatever is happening, the thing you might have to press is here. The lesson
 * from Cheat is that a control which only appears when it is needed is a
 * control whose position you never learn — and while nothing in Go Fish is on a
 * clock, being asked a question in front of four people is quite enough pressure
 * without hunting for the button.
 */
function tools(ctx) {
  const state = ctx.state;
  const you = state.you || {};
  if (you.answering) return answerBar(ctx, you.answering);
  if ((you.ready || []).length) return bookBar(ctx, you.ready);
  if (you.isTurn && !state.ask) return askBar(ctx);
  return idleBar(ctx);
}

/**
 * Hand them over, or say go fish.
 *
 * One button, and which one it is comes off `you.answering.handing` — a number
 * only this phone is sent. There is nothing to choose: you cannot lie in Go
 * Fish, and the app does not offer you the chance to try. What the tap buys is
 * the second before it, which is the whole game.
 */
function answerBar(ctx, answering) {
  const giving = answering.handing > 0;
  const count = answering.handing;
  return h(
    'div.gf-tools.gf-tools--live',
    h('button', {
      className: `btn btn--primary gf-answer${giving ? ' gf-answer--give' : ' gf-answer--fish'}`,
      type: 'button',
      text: giving
        ? `Hand over your ${COUNT_WORD[count] || count} ${rankWord(answering.rank, count)}`
        : 'Go fish',
      'aria-label': giving
        ? `Hand over your ${count} ${rankWord(answering.rank, count)}`
        : `Tell them to go fish — you have no ${RANK_MANY[answering.rank]}`,
      onClick: () => ctx.send({ type: 'play/answer' }),
    }),
    h('span.gf-tools__hint', {
      text: giving ? 'All of them — that is the rule.' : `You have no ${RANK_MANY[answering.rank]}.`,
    })
  );
}

/**
 * A book waiting to go down.
 *
 * It outranks everything else in this strip on purpose, including your own turn.
 * A book still in your hand can still be asked for, and being asked for four
 * sevens you were about to score is the one genuinely painful thing that can
 * happen in this game.
 */
function bookBar(ctx, ready) {
  const rank = ready[0];
  return h(
    'div.gf-tools.gf-tools--live.gf-tools--book',
    h('button', {
      className: 'btn btn--primary gf-answer gf-answer--book',
      type: 'button',
      text: `Lay down your ${RANK_MANY[rank]}`,
      onClick: () => ctx.send({ type: 'play/book', rank }),
    }),
    h('span.gf-tools__hint', {
      text: ready.length > 1 ? `And your ${RANK_MANY[ready[1]]} after that.` : 'Before somebody asks you for them.',
    })
  );
}

/** Your turn. A rank picked, or the prompt to pick one. */
function askBar(ctx) {
  const picked = ctx.ui.gfRank;
  if (!picked) {
    return h(
      'div.gf-tools',
      h('div.gf-picked.gf-picked--empty', { text: 'Pick a card' }),
      h('span.gf-tools__hint', { text: 'Tap any card in your hand to ask for that rank.' })
    );
  }
  return h(
    'div.gf-tools.gf-tools--live',
    h(
      'div.gf-picked',
      h('span.gf-picked__rank', { text: picked }),
      h('span.gf-picked__word', { text: `Asking for ${RANK_MANY[picked]}` }),
      h('button.btn--tiny', {
        text: 'Change',
        type: 'button',
        onClick: () => {
          ctx.ui.gfRank = null;
          ctx.render();
        },
      })
    ),
    h('span.gf-tools__hint', { text: 'Now tap whoever you are asking.' })
  );
}

/** Nothing for you to do, and it says whose fault that is. */
function idleBar(ctx) {
  const state = ctx.state;
  const you = state.you || {};
  const ask = state.ask;
  const turn = state.players.find((p) => p.id === state.turnId);
  return h(
    'div.gf-tools',
    h('div.gf-picked.gf-picked--empty', { text: you.out ? 'Out, and safe' : 'Not your turn' }),
    h('span.gf-tools__hint', {
      text: ask
        ? `${ask.targetName} has been asked for ${RANK_MANY[ask.rank]}.`
        : `Waiting on ${turn ? turn.name : 'the next player'}.`,
    })
  );
}
