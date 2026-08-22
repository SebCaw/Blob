import { h, initials, buzz, reducedMotion } from '../ui.js';
import { topbar } from './common.js';
import { cardFace, cardBack, trickPile, sortHand, trumpBadge, suitName } from '../cards.js';

/**
 * Playing a hand — the one screen this mode adds.
 *
 * The table is an oval in the middle holding the deck with the turned trump on
 * top of it, and people sit round the outside. Each played card sits with the
 * player who played it, so nothing needs a name label: position already says
 * who. Seats are placed on an ellipse by index, so two players and eight come
 * out of one rule rather than seven hand-tuned cases.
 *
 * Nothing here decides anything. Which cards may be played arrives in
 * `you.playable`, whose turn it is arrives in `round.trick.turnId`, and a card
 * tapped in error is refused by the server exactly as a bid would be.
 */

/**
 * How wide a seat may be, as a percentage of the table.
 *
 * Seats sit on an ellipse 40% of the width from the middle, so the gap between
 * the two closest of them — the pair either side of the top — is
 * `2 × 40 × sin(step / 2)`. A seat takes a shade under that, which means one
 * rule spaces two players and eight without a single hand-tuned case: the more
 * people sit down, the smaller the seats get, exactly as far as they need to.
 */
function seatWidthPct(count) {
  const step = ARC_SWEEP / (count + 1);
  const gap = 86 * Math.sin((step / 2) * (Math.PI / 180));
  return Math.min(23.5, gap * 0.94);
}

/** Where the arc of seats begins and how far round it sweeps, in degrees. */
const ARC_START = 195;
const ARC_SWEEP = 210;

/** Below this width there is no room for a name under the badge. */
const NAME_MIN_PCT = 17;

/**
 * How long a card takes to fly out of the deck, and the gap between one card
 * and the next.
 *
 * Slow enough to watch a card arrive rather than notice that one has: a hand of
 * seven takes a little over a second and a half, which is about how long it
 * takes to deal one for real.
 */
const DEAL_MS = 520;
const DEAL_STAGGER_MS = 150;

/** The round whose deal has already been animated, so it happens once. */
let dealtFor = null;

/**
 * The seat scale the fit pass settled on, and the round it belongs to.
 *
 * Without this the table started every repaint at full size and shrank again
 * after paint — a visible jump on every single card anybody played. The scale
 * is carried into the next render instead, so the fit pass usually has nothing
 * left to do. It only ever tightens within a round: seats that grew back as a
 * trick cleared would be the same jitter wearing a different hat.
 */
let seatScale = { round: null, value: 1 };

export function playingScreen(ctx) {
  const state = ctx.state;
  const round = state.round;
  const trick = round.trick;
  const you = state.you;
  const forehead = Boolean(round.forehead);

  const seats = state.players.filter((p) => p.inRound !== false && !p.left);
  const opponents = seats.filter((p) => p.id !== you.id);

  const screen = h(
    'div.screen.screen--fixed.playing',
    topbar(state, { right: trumpBadge(round) }),
    forehead ? h('p.forehead-note', { text: 'Everyone can see your card. You cannot.' }) : null,
    table(ctx, opponents, trick, round, forehead, you),
    statusBar(ctx, you, trick, round),
    skipOffer(ctx),
    hand(ctx, you, trick, round, forehead)
  );

  const roundKey = `${state.id}:${round.index}`;
  const firstPaintOfRound = dealtFor !== roundKey;
  if (firstPaintOfRound) {
    dealtFor = roundKey;
    seatScale = { round: roundKey, value: 1 }; // a new deal, a new table
  }
  requestAnimationFrame(() => {
    fitSeats(screen);
    // The deal runs once per round, on the first paint of that round.
    if (firstPaintOfRound) dealAnimation(screen);
  });
  return screen;
}

/** The oval, the seats round it, and whatever is on it. */
function table(ctx, opponents, trick, round, forehead, you) {
  const count = opponents.length;
  const widthPct = seatWidthPct(count);
  const crowded = widthPct < NAME_MIN_PCT;
  const played = playsToShow(trick, round);

  const seatNodes = opponents.map((player, index) => {
    // Spread across the top arc: one opponent sits at the top, two at ten and
    // two o'clock, eight fan right round the sides.
    // The arc runs from just below the left edge of the table round to just
    // below the right, rather than stopping at the horizontal — the extra 30°
    // is what gives a table of eight somewhere to sit.
    const angle = ARC_START - ((index + 1) * ARC_SWEEP) / (count + 1);
    const radians = (angle * Math.PI) / 180;
    const x = 50 + Math.cos(radians) * 43;
    const y = 42 - Math.sin(radians) * 36;
    // The card they played sits between them and the middle, which is where it
    // would be on a real table — so `--in-x` / `--in-y` point inwards from here.
    return seat(ctx, player, {
      style: {
        left: `${x}%`,
        top: `${y}%`,
        '--in-x': String(-Math.cos(radians).toFixed(3)),
        '--in-y': String(Math.sin(radians).toFixed(3)),
      },
      crowded,
      card: played.get(player.id) || null,
      winning: played.size > 0 && played.winnerId === player.id,
      turn: trick && trick.turnId === player.id,
      forehead,
      foreheadCard: forehead ? player.card : null,
    });
  });

  return h(
    'div',
    {
      // The scale the last fit settled on is applied up front, so the table is
      // already the right size on the first frame rather than snapping after it.
      className: `table${crowded || seatScale.value < 0.8 ? ' table--crowded' : ''}`,
      style: { '--seat-pct': String(widthPct), '--seat-scale': String(seatScale.value) },
    },
    h('div.table__felt', { 'aria-hidden': 'true' }),
    h(
      'div.table__middle',
      h('div.deck', { 'aria-hidden': 'true' }, h('span.deck__back'), h('span.deck__back')),
      round.trumpCard ? cardFace(round.trumpCard, { size: 'sm', className: 'deck__trump' }) : null,
      round.noTrumps ? h('span.deck__no-trumps', { text: 'no trumps' }) : null
    ),
    seatNodes,
    yourPlay(played, you),
    lastTrickNote(trick, round, ctx)
  );
}

/**
 * The card you have played, sitting between you and the middle — the same
 * place it would be on a real table, and the reason no card needs a name on it.
 */
function yourPlay(played, you) {
  const cardId = played.get(you.id);
  if (!cardId) return null;
  const winning = played.winnerId === you.id;
  return h(
    'div.your-play',
    cardFace(cardId, { size: 'sm', ring: winning ? 'win' : null, crown: winning }),
    h('span.your-play__label', { text: 'you' })
  );
}

/**
 * The cards to draw on the table.
 *
 * A finished trick is cleared by the server the instant it is settled, which
 * would make the winning card vanish before anyone saw it. So while the new
 * trick is still empty, the one just played stays on the table — no timer, no
 * animation to get out of step with, and it clears itself the moment somebody
 * leads the next card.
 */
function playsToShow(trick, round) {
  const source = trick && trick.plays.length ? trick : round.lastTrick;
  const map = new Map();
  if (!source) return map;
  for (const play of source.plays) map.set(play.playerId, play.cardId);
  map.winnerId = trick && trick.plays.length ? trick.winningPlayerId : round.lastTrick && round.lastTrick.winnerId;
  map.settled = !(trick && trick.plays.length);
  return map;
}

/** "Hannah took it" — only while the finished trick is still on the table. */
function lastTrickNote(trick, round, ctx) {
  if (trick && trick.plays.length) return null;
  if (!round.lastTrick) return null;
  const winner = ctx.state.players.find((p) => p.id === round.lastTrick.winnerId);
  if (!winner) return null;
  const you = ctx.state.you && ctx.state.you.id === winner.id;
  return h('div.table__took', { role: 'status', text: you ? 'You took it' : `${winner.name} took it` });
}

/** One person round the table: who they are, how they are doing, their card. */
function seat(ctx, player, options) {
  const classes = [
    'seat',
    options.crowded ? 'seat--tight' : '',
    options.turn ? 'seat--turn' : '',
    player.connected ? '' : 'seat--gone',
    player.skipped ? 'seat--skipped' : '',
  ]
    .filter(Boolean)
    .join(' ');

  const card = options.card
    ? cardFace(options.card, {
        size: 'sm',
        ring: options.winning ? 'win' : null,
        crown: options.winning,
        className: 'seat__card',
      })
    : options.foreheadCard
    ? cardFace(options.foreheadCard, { size: 'sm', className: 'seat__card seat__card--forehead' })
    : null;

  return h(
    'div',
    { className: classes, style: options.style },
    h(
      'div.seat__who',
      h('div.seat__badge', { text: initials(player.name) }, player.isMaster ? h('span.seat__crown', { text: '♔' }) : null),
      options.crowded ? null : h('div.seat__name', { text: player.name }),
      h('div.seat__meta', {
        text: meta(player, options.forehead, options.crowded),
        title: meta(player, options.forehead, false),
      })
    ),
    card,
    player.skipped ? h('span.seat__flag', { text: 'skipped' }) : null,
    !player.connected && !player.skipped ? h('span.seat__flag', { text: 'away' }) : null
  );
}

/**
 * The two numbers that decide their score. At a full table there is no room to
 * spell it out, so it shrinks to "1/0" — bid over the line from won, the way a
 * scoresheet writes it.
 */
function meta(player, forehead, tight) {
  const bid = player.bid === null || player.bid === undefined ? '?' : player.bid;
  const won = player.tricksWon || 0;
  if (forehead) return tight ? `bid ${bid}` : `bid ${bid}`;
  return tight ? `${bid}/${won}` : `bid ${bid} · won ${won}`;
}

/**
 * Under the table: the tricks you have taken on the left, whose turn it is in
 * the middle, your bid on the right. Those two numbers are the only ones that
 * decide your score, so they get equal weight on opposite sides.
 */
function statusBar(ctx, you, trick, round) {
  const yourTurn = Boolean(you.yourTurn);
  const turnPlayer = trick ? ctx.state.players.find((p) => p.id === trick.turnId) : null;
  const follow = trick && trick.ledSuit && !yourTurn ? null : trick && trick.ledSuit ? trick.ledSuit : null;

  return h(
    'div.playbar',
    h('div.playbar__won', trickPile(you.tricksWon || 0), h('span.playbar__label', { text: 'won' })),
    h(
      'div',
      { className: `playbar__turn${yourTurn ? ' playbar__turn--you' : ''}`, role: 'status', 'aria-live': 'polite' },
      h('span.playbar__turn-name', {
        text: yourTurn ? 'Your turn' : turnPlayer ? `${turnPlayer.name}'s turn` : 'Settling…',
      }),
      follow ? h('span.playbar__follow', { text: `follow ${suitName(follow)}` }) : null
    ),
    h(
      'div.playbar__bid',
      h('span.playbar__bid-value.tabular', { text: String(you.bid === null || you.bid === undefined ? '–' : you.bid) }),
      h('span.playbar__label', { text: 'bid' })
    )
  );
}

/**
 * Your hand, fanned. Legal cards rise out of it while it is your turn and stay
 * up; the rest sit flush and cannot be pressed. It is the same information as
 * dimming, but it reads as your hand offering you the cards you can play.
 */
function hand(ctx, you, trick, round, forehead) {
  if (forehead) {
    return h(
      'div.hand.hand--forehead',
      cardBack({ size: 'lg', label: 'your card, which you cannot see' }),
      h('p.hand__note', {
        text: you.yourTurn ? 'Your turn — play it.' : 'You have one card, and you are not allowed to look.',
      }),
      you.yourTurn
        ? h('button.btn.btn--primary', {
            text: 'Play my card',
            type: 'button',
            onClick: () => playForehead(ctx),
          })
        : null
    );
  }

  const cards = sortHand(you.hand || []);
  const playable = new Set(you.playable || []);
  const yourTurn = Boolean(you.yourTurn);

  return h(
    'div',
    { className: `hand${cards.length > 7 ? ' hand--squeeze' : ''}` },
    cards.map((cardId, index) =>
      cardFace(cardId, {
        size: 'lg',
        index,
        className: 'hand__card',
        state: yourTurn ? (playable.has(cardId) ? 'playable' : 'blocked') : null,
        onClick: () => play(ctx, cardId, yourTurn, playable),
      })
    )
  );
}

async function play(ctx, cardId, yourTurn, playable) {
  if (!yourTurn) {
    ctx.toast('Not your turn yet.');
    return;
  }
  if (!playable.has(cardId)) {
    const led = ctx.state.round.trick && ctx.state.round.trick.ledSuit;
    ctx.toast(led ? `You have to follow ${suitName(led)}.` : 'You cannot play that one.');
    return;
  }
  const sent = await ctx.send({ type: 'trick/play', cardId });
  if (sent) buzz(10);
}

/**
 * The forehead round: you do not know what you are holding, so there is one
 * button rather than a hand, and the card is not named. Holding one card there
 * is nothing to choose, and the server plays the only card you have.
 */
async function playForehead(ctx) {
  const sent = await ctx.send({ type: 'trick/play' });
  if (sent) buzz(10);
}

/** The Master's way out of a hand nobody can move. */
function skipOffer(ctx) {
  const target = ctx.state.you && ctx.state.you.canSkipTurnsFor;
  if (!target) return null;
  return h(
    'div.skip-offer',
    { role: 'status' },
    h('p.skip-offer__text', { text: `${target.name} has dropped out and the hand cannot move.` }),
    h('button.btn.btn--ghost.btn--small', {
      text: `Play this hand for ${target.name}`,
      type: 'button',
      onClick: () => ctx.send({ type: 'trick/skipTurns', playerId: target.id }),
    })
  );
}

/**
 * Shrink the seats until none of them touch.
 *
 * The arc spacing gives a good first guess, but how tall a seat ends up is down
 * to the name, the numbers and the font — so the last word goes to measuring
 * rather than to arithmetic that would have to predict all three. A few passes
 * at most, and on the common counts none at all.
 */
function fitSeats(screen) {
  const table = screen.querySelector('.table');
  if (!table) return;
  const seats = [...table.querySelectorAll('.seat')];
  if (seats.length < 2) return;

  // A seat is its own box plus, when they have played, a card sitting nearer the
  // middle. They are compared piece by piece rather than as one big box: the
  // card sits on a tighter ring than the badges do, so a merged box would report
  // collisions that are not there and shrink the table for nothing.
  const piecesOf = (seat) => {
    const card = seat.querySelector('.seat__card');
    const rects = [seat.getBoundingClientRect()];
    if (card) rects.push(card.getBoundingClientRect());
    return rects;
  };
  const hits = (a, b) => a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;

  let scale = seatScale.value;
  for (let pass = 0; pass < 6; pass++) {
    const all = seats.map(piecesOf);
    if (!all[0][0].width) return; // not laid out yet — nothing to measure
    let clash = false;
    for (let i = 0; i < all.length && !clash; i++) {
      for (let j = i + 1; j < all.length && !clash; j++) {
        for (const a of all[i]) for (const b of all[j]) if (hits(a, b)) clash = true;
      }
    }
    if (!clash) return;
    scale *= 0.88;
    seatScale = { round: seatScale.round, value: scale }; // remembered for the next paint
    table.style.setProperty('--seat-scale', String(scale));
    // Once a seat is this small there is no reading a name off it anyway.
    if (scale < 0.8) table.classList.add('table--crowded');
  }
}

/**
 * Every card flies out of the deck in the middle to where it belongs.
 *
 * Positions are measured at run time rather than hard-coded, so the animation
 * survives a layout change, and it is driven by the Web Animations API rather
 * than CSS transitions: an animation leaves no inline styles behind, so it
 * cannot end up fighting the stylesheet rule that holds a card at rest, or the
 * lift that follows it.
 */
function dealAnimation(screen) {
  if (reducedMotion() || !screen.isConnected) return;
  const middle = screen.querySelector('.table__middle');
  const cards = [...screen.querySelectorAll('.hand__card'), ...screen.querySelectorAll('.seat__card')];
  if (!middle || !cards.length || typeof cards[0].animate !== 'function') return;

  const from = middle.getBoundingClientRect();
  cards.forEach((card, index) => {
    const to = card.getBoundingClientRect();
    if (!to.width) return;
    const dx = from.left + from.width / 2 - (to.left + to.width / 2);
    const dy = from.top + from.height / 2 - (to.top + to.height / 2);
    card.animate(
      [
        { transform: `translate(${dx}px, ${dy}px) scale(0.7) rotate(-8deg)`, opacity: 0 },
        { transform: 'translate(0, 0) scale(1) rotate(0deg)', opacity: 1 },
      ],
      { duration: DEAL_MS, delay: index * DEAL_STAGGER_MS, easing: 'cubic-bezier(0.22, 1, 0.36, 1)', fill: 'backwards' }
    );
  });
}
