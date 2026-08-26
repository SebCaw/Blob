import { h } from '../../ui.js';
import { cardFace, cardBack, rankOf } from '../../cards.js';
import { topbar, fitFan, splitHand } from '../common.js';

/**
 * The Chase the Ace table.
 *
 * Everybody's hand is on the screen, face down. That is not decoration — it is
 * the game. A rearrange is public by design, and a public move nobody can see
 * happen is not a bluff, it is just a tidy-up. So every player gets a row with
 * their fan in it, and when somebody shifts a card you watch the slot move.
 *
 * On your turn the hand on your right grows and becomes tappable. You are
 * choosing a POSITION — the server never tells you what is in any of them, and
 * that is the whole privacy boundary of this game. See `lib/chase/view.js`.
 */

/** How long a just-happened thing is treated as news. */
const NEWS_MS = 700;

/** How long the drawn card takes to travel. */
const FLY_MS = 380;

/** The most cards that share a row of your own fan. */
const ROW_MAX = 9;

/** How long somebody may sit on a pair before the app mentions it. */
const NUDGE_MS = 5_000;

let seen = { at: null, localAt: 0, flown: false };

function freshEvent(event) {
  if (!event || !event.at) return null;
  if (seen.at !== event.at) seen = { at: event.at, localAt: Date.now(), flown: false };
  return Date.now() - seen.localAt < NEWS_MS ? event : null;
}

function reducedMotion() {
  return window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

/**
 * How long this hand has held an unbinned pair, and a one-shot repaint when it
 * has held one long enough to be worth mentioning.
 *
 * Keyed on the pair list itself, so binning one or being drawn from starts the
 * clock again rather than leaving a stale nudge on the screen. The timer fires
 * `render` exactly once per key — on the repaint the key is unchanged, so no
 * second timer is armed and there is no loop.
 */
let nudge = { key: null, since: 0, timer: null };

function nudgeDue(ctx, you) {
  const pairs = (you && you.pairs) || [];
  if (!pairs.length) {
    if (nudge.timer) clearTimeout(nudge.timer);
    nudge = { key: null, since: 0, timer: null };
    return false;
  }
  const key = `${(you.hand || []).length}:${JSON.stringify(pairs)}`;
  if (nudge.key !== key) {
    if (nudge.timer) clearTimeout(nudge.timer);
    nudge = { key, since: Date.now(), timer: setTimeout(() => ctx.render(), NUDGE_MS + 60) };
  }
  return Date.now() - nudge.since >= NUDGE_MS;
}

export function tableScreen(ctx) {
  const state = ctx.state;
  const you = state.you || {};
  const event = freshEvent(state.lastEvent);
  const others = state.players.filter((p) => !p.left && p.id !== you.id);

  const screen = h(
    // `--fixed` so the table does not wander under your thumb, and deliberately
    // NOT `--fits`: there are buttons here that have to stay reachable, and the
    // rule in styles.css is that such a screen takes the scrolling hatch while
    // a surface you only look at shrinks instead.
    'div.screen.screen--fixed.ca-play',
    topbar(state, { left: codeChip(state), ctx }),
    metaRow(state),
    statusLine(ctx),
    h('div.ca-body', h('div.ca-seats', others.map((p) => seat(ctx, p, event))), middle(ctx, event)),
    yourHand(ctx, event),
    tools(ctx)
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
 * Let the screen scroll, but only once it has measured itself and found it must.
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
  // Sitting on a pair outranks whose turn it is, because until it is gone
  // nothing else you might do will be allowed.
  if ((you.pairs || []).length && you.isTurn) {
    return h('p.ca-status.ca-status--pair', { text: 'Throw your pair away before you take one' });
  }
  if (you.isTurn && source) {
    return h('p.ca-status.ca-status--you', { text: `Your turn — take one from ${source.name}` });
  }
  if (you.locked) {
    return h('p.ca-status.ca-status--locked', { text: `${turn ? turn.name : 'Someone'} is choosing from your hand` });
  }
  if (turn && source) return h('p.ca-status', { text: `${turn.name} is choosing from ${source.name}` });
  return h('p.ca-status', { text: 'Waiting…' });
}

// ── The middle ───────────────────────────────────────────────────────────────

/**
 * The throw-away pile.
 *
 * Everything anybody has binned, face up, because every one of those cards went
 * down in front of the room. Only the last few are drawn — the count says the
 * rest, and a fan of forty binned cards is not something anybody reads.
 */
function middle(ctx, event) {
  const state = ctx.state;
  const pile = state.discarded || [];
  const landing = event && event.kind === 'bin' ? event.pair : null;

  if (!pile.length) {
    return h(
      'div.ca-middle.ca-middle--empty',
      h('div.ca-pile__slot', { 'aria-hidden': 'true' }),
      h('span.ca-middle__label', { text: 'Pairs go here' })
    );
  }

  const shown = pile.slice(-6);
  return h(
    'div',
    { className: `ca-middle${landing ? ' ca-middle--landing' : ''}` },
    h(
      'div.ca-pile',
      { 'aria-label': `${pile.length} cards thrown away` },
      shown.map((card, i) =>
        h(
          'div',
          { className: `ca-pile__card${landing && landing.includes(card) ? ' ca-pile__card--new' : ''}`, style: { '--i': String(i) } },
          cardFace(card, { size: 'sm', corner: true })
        )
      )
    ),
    h('span.ca-middle__label', { text: `${pile.length} thrown away` })
  );
}

// ── Everybody else ───────────────────────────────────────────────────────────

function seat(ctx, player, event) {
  const state = ctx.state;
  const you = state.you || {};
  const isSource = state.source && state.source.id === player.id;
  const canTake = Boolean(you.isTurn && isSource && !you.out && !(you.pairs || []).length);

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
          Array.from({ length: Math.max(0, player.cardsHeld) }).map((_, i) =>
            h(
              'div',
              {
                className: ['ca-slot', moved && moved.to === i ? 'ca-slot--moved' : '', took && took.index === i ? 'ca-slot--taken' : '']
                  .filter(Boolean)
                  .join(' '),
                'data-slot': String(i),
              },
              cardBack({
                size: canTake ? 'md' : 'xs',
                label: canTake ? `Take the card in position ${i + 1}` : undefined,
                // `of` is the number of slots this tap was aimed at. Their hand
                // can change under you — they may bin a pair at any moment,
                // including this one — and the reducer refuses rather than
                // quietly handing you whatever slid into that position.
                onClick: canTake
                  ? () => ctx.send({ type: 'draw/take', index: i, of: player.cardsHeld })
                  : undefined,
              })
            )
          )
        )
  );
}

// ── Your own hand ────────────────────────────────────────────────────────────

/**
 * Your cards, the arranging, and the binning.
 *
 * One gesture does both jobs. Tap a card to lift it out — that is local, and
 * nobody else sees it. Tap a second: if the two are a pair they go in the
 * middle, and if they are not the first one moves to where the second was.
 * There is no separate bin control because there does not need to be, and a
 * button you only need half the time is a button in the way the other half.
 *
 * The lifted card is remembered by its CARD, not by its position. That matters
 * more than it sounds: three bots move about once a second, and every one of
 * those states rebuilds this screen. Keyed on a position, a lift was cancelled
 * by anybody's move — which made arranging effectively impossible to finish.
 */
function yourHand(ctx, event) {
  const state = ctx.state;
  const you = state.you || {};
  const cards = you.hand || [];

  if (you.out) return h('div.ca-yours.ca-yours--out', h('p.muted.center', { text: 'Your hand is gone. Nicely done.' }));
  if (!cards.length) return h('div.ca-yours');

  const picked = ctx.ui.chasePick;
  const pickedAt = picked ? cards.indexOf(picked) : -1;
  const rows = splitHand(cards, ROW_MAX);
  const due = nudgeDue(ctx, you);

  /**
   * The pairs, lit up — but only once the nudge has fired.
   *
   * The first five seconds are yours to look, which is what Seb asked for and
   * is most of what playing this game feels like. After that the app should
   * actually HELP rather than keep nagging. Saying "you have 2 pairs" while
   * refusing to say which is the worst of both: it spoils that there are pairs
   * and still makes you hunt for them.
   *
   * Off while a card is lifted, because then the fan is already answering a
   * different question - which of these matches THIS one.
   */
  const showPairs = new Set(due && !picked ? (you.pairs || []).flat() : []);
  const shuffled = event && event.kind === 'shuffle' && event.playerId === you.id;
  const moved = event && event.kind === 'move' && event.playerId === you.id ? event : null;
  const gained = event && event.kind === 'draw' && event.playerId === you.id;

  // Which cards would pair with the one in your hand, so the fan can say so
  // before you commit to the second tap.
  const partners = new Set(
    pickedAt === -1 ? [] : cards.filter((card, i) => i !== pickedAt && rankOf(card) === rankOf(cards[pickedAt]))
  );

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
            const isPicked = card === picked;
            const pairs = partners.has(card) || showPairs.has(at);
            return h(
              'div',
              {
                className: `hand__card${isPicked ? ' ca-picked' : ''}${pairs ? ' ca-partner' : ''}${
                  moved && moved.to === at ? ' ca-slot--moved' : ''
                }`,
              },
              cardFace(card, { size: 'md', corner: true, onClick: () => tap(ctx, card) })
            );
          })
        )
      )
    ),
    hint(you, picked, due)
  );
}

/**
 * What the hand is asking of you, in one line.
 *
 * Every line that asks for something says HOW. The nudge used to read "You have
 * 2 pairs to throw away" and stop there, which told somebody the game was
 * waiting on them without telling them what to do about it.
 */
function hint(you, picked, due) {
  const pairs = (you.pairs || []).length;

  if (you.locked && !pairs) return h('p.ca-hint', { text: 'Frozen while they choose' });
  if (picked) return h('p.ca-hint', { text: 'Now tap its pair to bin them, or anywhere else to move it' });
  if (pairs && due) {
    return h('p.ca-hint.ca-hint--nudge', {
      text:
        pairs === 1
          ? 'There is your pair — tap them both, or use the button'
          : `There are your ${pairs} pairs — tap a matching two, or use the button`,
    });
  }
  if (pairs) return h('p.ca-hint', { text: 'Tap two matching cards to bin them' });
  return h('p.ca-hint', { text: 'Tap a card to lift it, then tap where it should go' });
}

/**
 * A tap on one of your own cards.
 *
 * The first is local and silent. The second is a command, and which command it
 * is depends on whether the two match — which is a question about two cards you
 * are already holding and looking at, so answering it here is presentation
 * rather than a rule. The reducer decides for real either way, and says so if
 * this got it wrong.
 */
function tap(ctx, card) {
  const picked = ctx.ui.chasePick;
  const hand = (ctx.state.you && ctx.state.you.hand) || [];

  if (!picked || !hand.includes(picked)) {
    ctx.ui.chasePick = card;
    ctx.render();
    return;
  }
  if (picked === card) {
    ctx.ui.chasePick = null;
    ctx.render();
    return;
  }

  const from = hand.indexOf(picked);
  const to = hand.indexOf(card);
  ctx.ui.chasePick = null;
  if (rankOf(picked) === rankOf(card)) ctx.send({ type: 'hand/bin', a: from, b: to });
  else ctx.send({ type: 'hand/move', from, to });
}

/**
 * The one button under your hand, and WHICH button it is matters.
 *
 * While you are holding a pair the game will not let you do anything else - the
 * reducer refuses a draw until it has gone - so binning is the only thing worth
 * offering, and it gets the primary button.
 *
 * Shuffle is deliberately NOT offered in that state. It was, and it was the only
 * button on the screen, which meant a player told "throw your pair away" was
 * given exactly one action: scramble the hand and make the pair harder to find.
 * Seb hit that in a real game. An app that blocks you should not hand you the
 * one control that makes being blocked worse.
 *
 * Binning goes one pair at a time even when you hold several. Each press is a
 * command against the hand as it stands, and the positions shift underneath
 * every bin - firing two at once would send the second against a hand that no
 * longer exists. It also keeps throwing cards away an ACT, which is the thing
 * Seb asked for when he took the automatic version out.
 */
function tools(ctx) {
  const you = ctx.state.you || {};
  const pairs = you.pairs || [];

  if (pairs.length) {
    const [a, b] = pairs[0];
    return h(
      'div.ca-tools',
      h('button.btn.btn--primary.btn--small.ca-bin', {
        type: 'button',
        text: pairs.length === 1 ? 'Throw the pair away' : `Throw a pair away (${pairs.length})`,
        'aria-label': 'Throw a matching pair into the middle',
        onClick: () => {
          ctx.ui.chasePick = null;
          ctx.send({ type: 'hand/bin', a, b });
        },
      })
    );
  }

  // The counterweight to arranging: it costs you every read anybody had on you,
  // and it costs you the chance to talk somebody into a mistake. Randomised on
  // the server - a shuffle done on this phone would put the permutation on the
  // one device that must not be trusted with it.
  if (!you.canArrange) return h('div.ca-tools');
  return h(
    'div.ca-tools',
    h('button.btn.btn--ghost.btn--small.ca-shuffle', {
      type: 'button',
      text: 'Shuffle my hand',
      'aria-label': 'Shuffle your hand so nobody can follow it',
      onClick: () => {
        ctx.ui.chasePick = null;
        ctx.send({ type: 'hand/shuffle' });
      },
    })
  );
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
 * `uiZoom()` to divide back out.
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
