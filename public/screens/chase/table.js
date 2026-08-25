import { h } from '../../ui.js';
import { cardFace, cardBack } from '../../cards.js';
import { topbar, action, fitFan, splitHand } from '../common.js';

/**
 * The Chase the Ace table.
 *
 * Everybody's hand is on the screen, face down. That is not decoration and it is
 * not a nicety — it is the game. A rearrange is public by design, and a public
 * move that nobody can see happen is not a bluff, it is just a tidy-up. So every
 * player gets a row with their fan in it, and when somebody shifts a card you
 * watch the slot move.
 *
 * On your turn the hand on your right grows and becomes tappable. You are
 * choosing a POSITION — the server never sends you what is in any of them, and
 * that is the whole privacy boundary of this game. See `lib/chase/view.js`.
 *
 * No game logic here. The server says whose turn it is, whose fan is frozen and
 * how many slots each hand has; this draws it.
 */

/** How long a just-happened thing is treated as news. */
const NEWS_MS = 700;

/** How long the drawn card takes to travel. */
const FLY_MS = 380;

/** The most cards that share a row of your own fan. */
const ROW_MAX = 9;

/**
 * The event we have already animated, and when this phone first saw it.
 *
 * Gated on a time window rather than on "this render differs from the last",
 * because every state the server pushes rebuilds the whole screen — one action
 * paints three times and anything keyed on difference alone replays on each.
 */
let seen = { at: null, localAt: 0, flown: false };

function freshEvent(event) {
  if (!event || !event.at) return null;
  if (seen.at !== event.at) seen = { at: event.at, localAt: Date.now(), flown: false };
  return Date.now() - seen.localAt < NEWS_MS ? event : null;
}

function reducedMotion() {
  return window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

export function tableScreen(ctx) {
  const state = ctx.state;
  const you = state.you || {};
  const event = freshEvent(state.lastEvent);
  const others = state.players.filter((p) => !p.left && p.id !== you.id);

  const screen = h(
    // `--fixed` so the table does not wander under your thumb, and deliberately
    // NOT `--fits`: there is a Shuffle button that has to stay reachable, and
    // the rule in styles.css is that a screen with a control takes the scrolling
    // hatch while a surface you only look at shrinks instead.
    'div.screen.screen--fixed.ca-play',
    topbar(state, { left: codeChip(state), ctx }),
    metaRow(state),
    statusLine(ctx),
    h('div.ca-seats', others.map((p) => seat(ctx, p, event))),
    yourHand(ctx, event),
    h('div.ca-tools', shuffleButton(ctx))
  );

  requestAnimationFrame(() => {
    fitFan(screen, '.ca-fan');
    spillIfNeeded(screen);
    if (event && event.kind === 'draw' && !seen.flown && !reducedMotion()) {
      seen.flown = true;
      flyDrawn(screen, event, you);
    }
  });

  return screen;
}

/**
 * Let the screen scroll, but only when it has measured itself and found it must.
 *
 * Twelve players is twelve rows, which no phone holds. Gating on measurement
 * rather than on which text size somebody picked is the lesson from Blob's bid
 * screen, where the hatch only opened at the larger sizes and the default size
 * clipped its own top with no way to reach it.
 */
function spillIfNeeded(screen) {
  screen.classList.remove('screen--spill');
  if (screen.scrollHeight > screen.clientHeight + 1) screen.classList.add('screen--spill');
}

// ── Header ───────────────────────────────────────────────────────────────────

function codeChip(state) {
  return h('span.ca-chip.ca-chip--code.tabular', {
    text: state.code,
    'aria-label': `Game code ${state.code.split('').join(' ')}`,
  });
}

function metaRow(state) {
  const you = state.you || {};
  const held = (you.hand || []).length;
  const inPlay = state.players.filter((p) => !p.left && !p.out).length;
  return h(
    'div.ca-meta',
    h('span.ca-meta__count', h('strong', { text: String(held) }), h('span', { text: held === 1 ? 'card' : 'cards' })),
    h('span.ca-chip', { text: `${(state.discarded || []).length} binned` }),
    h('span.ca-chip', { text: `${inPlay} still in` })
  );
}

function statusLine(ctx) {
  const state = ctx.state;
  const you = state.you || {};
  const turn = state.players.find((p) => p.id === state.turnId);
  const source = state.source;

  if (you.out) return h('p.ca-status', { text: 'You are out, and safe. Watching the rest of it.' });
  if (you.isTurn && source) {
    return h('p.ca-status.ca-status--you', { text: `Your turn — take one from ${source.name}` });
  }
  if (you.locked) {
    return h('p.ca-status.ca-status--locked', {
      text: `${turn ? turn.name : 'Someone'} is choosing from your hand`,
    });
  }
  if (turn && source) return h('p.ca-status', { text: `${turn.name} is choosing from ${source.name}` });
  return h('p.ca-status', { text: 'Waiting…' });
}

// ── Everybody else ───────────────────────────────────────────────────────────

/**
 * One opponent: their name, their fan face down, and how many they hold.
 *
 * The fan is the point. It is small for everybody except the person you are
 * drawing from, who gets room to be tapped — a row of thirty-pixel slivers is
 * not something anybody can pick a card out of on a phone.
 */
function seat(ctx, player, event) {
  const state = ctx.state;
  const you = state.you || {};
  const isSource = state.source && state.source.id === player.id;
  const canTake = Boolean(you.isTurn && isSource && !you.out);

  const moved = event && event.kind === 'move' && event.playerId === player.id ? event : null;
  const shuffled = event && event.kind === 'shuffle' && event.playerId === player.id;
  const took = event && event.kind === 'draw' && event.fromId === player.id ? event : null;

  const classes = [
    'ca-seat',
    isSource ? 'ca-seat--source' : '',
    player.isTurn ? 'ca-seat--turn' : '',
    player.out ? 'ca-seat--out' : '',
    shuffled ? 'ca-seat--shuffling' : '',
  ]
    .filter(Boolean)
    .join(' ');

  return h(
    'div',
    { className: classes, 'data-player-id': player.id },
    h(
      'div.ca-seat__head',
      h('span.ca-seat__name', { text: player.name }),
      player.out
        ? h('span.ca-seat__badge', { text: `out #${player.place}` })
        : h('span.ca-seat__n', { text: String(player.cardsHeld) })
    ),
    player.out
      ? null
      : h(
          'div',
          { className: `ca-fan${canTake ? ' ca-fan--live' : ''}` },
          backs(player.cardsHeld).map((_, i) =>
            h(
              'div',
              {
                className: [
                  'ca-slot',
                  moved && moved.to === i ? 'ca-slot--moved' : '',
                  took && took.index === i ? 'ca-slot--taken' : '',
                ]
                  .filter(Boolean)
                  .join(' '),
                'data-slot': String(i),
              },
              cardBack({
                size: canTake ? 'md' : 'xs',
                onClick: canTake ? () => ctx.send({ type: 'draw/take', index: i }) : undefined,
              })
            )
          )
        )
  );
}

function backs(n) {
  return Array.from({ length: Math.max(0, n) });
}

// ── Your own hand ────────────────────────────────────────────────────────────

/**
 * Your cards, and the arranging.
 *
 * Tap one to lift it out — that is the raise Seb asked for, and it is a local
 * thing, never a command. Tap a second to drop the first into that slot, which
 * IS a command and which everybody watches happen.
 *
 * While somebody is drawing from you the whole thing is frozen. Without that
 * there is a race between your reorder and their tap that the command queue
 * settles arbitrarily, and whichever way it lands somebody has been robbed.
 */
function yourHand(ctx, event) {
  const state = ctx.state;
  const you = state.you || {};
  const cards = you.hand || [];
  const pick = ctx.ui.chasePick;

  if (you.out) {
    return h('div.ca-yours.ca-yours--out', h('p.muted.center', { text: 'Your hand is gone. Nicely done.' }));
  }
  if (!cards.length) return h('div.ca-yours');

  const rows = splitHand(cards, ROW_MAX);
  const shuffled = event && event.kind === 'shuffle' && event.playerId === you.id;
  const moved = event && event.kind === 'move' && event.playerId === you.id ? event : null;
  const gained = event && event.kind === 'draw' && event.playerId === you.id;

  let index = -1;
  return h(
    'div',
    {
      className: `ca-yours${you.locked ? ' ca-yours--locked' : ''}${shuffled ? ' ca-yours--shuffling' : ''}${
        gained ? ' ca-yours--gained' : ''
      }`,
    },
    h(
      'div.ca-hands',
      rows.map((row) =>
        h(
          'div.hand.ca-fan.ca-fan--mine',
          row.map((card) => {
            index += 1;
            const at = index;
            const picked = pick === at;
            return h(
              'div.hand__card',
              {
                className: `hand__card${picked ? ' ca-picked' : ''}${moved && moved.to === at ? ' ca-slot--moved' : ''}`,
              },
              cardFace(card, {
                size: 'md',
                corner: true,
                onClick: you.locked ? () => ctx.toast('Too late — they are choosing from your hand.') : () => tap(ctx, at),
              })
            );
          })
        )
      )
    ),
    h('p.ca-hint', {
      text: you.locked
        ? 'Frozen while they choose'
        : pick == null
          ? 'Tap a card to lift it, then tap where it should go'
          : 'Now tap where it should go, or tap it again to put it back',
    })
  );
}

/** Lift a card, drop it somewhere, or put it back. Local until the second tap. */
function tap(ctx, at) {
  const pick = ctx.ui.chasePick;
  if (pick == null) {
    ctx.ui.chasePick = at;
    ctx.render();
    return;
  }
  if (pick === at) {
    ctx.ui.chasePick = null;
    ctx.render();
    return;
  }
  ctx.ui.chasePick = null;
  ctx.send({ type: 'hand/move', from: pick, to: at });
}

/**
 * The shuffle, in the corner where Seb asked for it.
 *
 * The counterweight to arranging: it costs you every read anybody had on you,
 * and it costs you the chance to talk somebody into a mistake. Randomised on the
 * server — a shuffle done on this phone would put the permutation on the one
 * device that must not be trusted with it.
 */
function shuffleButton(ctx) {
  const you = ctx.state.you || {};
  if (!you.canArrange) return null;
  return h('button.btn.btn--ghost.btn--small.ca-shuffle', {
    type: 'button',
    text: 'Shuffle my hand',
    'aria-label': 'Shuffle your hand so nobody can follow it',
    onClick: () => {
      ctx.ui.chasePick = null;
      ctx.send({ type: 'hand/shuffle' });
    },
  });
}

// ── The card travelling ──────────────────────────────────────────────────────

/**
 * Fly the drawn card from the slot it came out of to the hand it went into.
 *
 * Face DOWN the whole way, even for the player who drew it. Where it landed is
 * the one thing about this move that is nobody's business — the server slots it
 * in at random for exactly that reason — so the animation must not point at it.
 *
 * `position: fixed` on `document.body` deliberately: that is outside the zoomed
 * subtree, so coordinates and size are plain screen pixels and there is no
 * `uiZoom()` to divide back out. Measuring in one space and moving in another is
 * the trap that has bitten every fitter in this codebase.
 */
function flyDrawn(screen, event, you) {
  const fromSeat = screen.querySelector(`[data-player-id="${event.fromId}"]`);
  const source = (fromSeat && fromSeat.querySelector(`[data-slot="${event.index}"]`)) || fromSeat;
  const target =
    event.playerId === you.id
      ? screen.querySelector('.ca-yours')
      : screen.querySelector(`[data-player-id="${event.playerId}"]`);
  if (!source || !target) return;

  const from = source.getBoundingClientRect();
  const to = target.getBoundingClientRect();
  if (!from.width || !to.width) return;

  const flier = cardBack({ size: 'md' });
  Object.assign(flier.style, {
    position: 'fixed',
    left: '0px',
    top: '0px',
    margin: '0',
    zIndex: '90',
    pointerEvents: 'none',
    transformOrigin: 'top left',
    transform: `translate(${from.left}px, ${from.top}px)`,
  });
  document.body.appendChild(flier);

  requestAnimationFrame(() => {
    flier.style.transition = `transform ${FLY_MS}ms cubic-bezier(.22,.8,.3,1), opacity ${FLY_MS}ms`;
    flier.style.transform = `translate(${to.left + to.width / 2 - 20}px, ${to.top + to.height / 2 - 28}px) scale(0.8)`;
    flier.style.opacity = '0.15';
  });
  window.setTimeout(() => flier.remove(), FLY_MS + 40);
}
