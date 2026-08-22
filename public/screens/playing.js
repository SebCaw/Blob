import { h, initials, buzz, reducedMotion } from '../ui.js';
import { topbar } from './common.js';
import { cardFace, cardBack, trickPile, sortHand, suitName, suitGlyph, parseCard } from '../cards.js';
import { uiZoom } from '../size.js';
import { play as sound } from '../sound.js';

/**
 * Playing a hand — the one screen this mode adds.
 *
 * The table is an oval in the middle holding the deck with the turned trump on
 * top of it, and everybody sits round the outside at equal spacing — you at the
 * bottom, the rest going round from there in turn order. Each played card sits
 * with the player who played it, so nothing needs a name label: position already
 * says who.
 *
 * Nothing here decides anything. Which cards may be played arrives in
 * `you.playable`, whose turn it is arrives in `round.trick.turnId`, and a card
 * tapped in error is refused by the server exactly as a bid would be.
 */

/**
 * Everyone sits at the same spacing round the whole table, you at the bottom.
 *
 * Four players land on north, east, south and west without that being a case in
 * the code — it is what equal spacing means when there are four of you. The rest
 * follow in turn order going round, so the card about to be played always comes
 * from the next seat along.
 */
function seatAngle(index, total) {
  return -90 - (index * 360) / total;
}

/** How far out the ring sits, and where its middle is, in percent of the table. */
const RING_X = 40;
const RING_Y = 33;
const RING_MID_Y = 45;

/**
 * How wide a seat may be, as a percentage of the table.
 *
 * The closest two seats are one step apart on the ring, so a seat takes a shade
 * under that gap. One rule spaces two players and eight: the more people sit
 * down, the smaller the seats get, exactly as far as they need to.
 */
function seatWidthPct(total) {
  const step = 360 / total;
  const gap = 2 * RING_X * Math.sin((step / 2) * (Math.PI / 180));
  return Math.min(23.5, gap * 0.94);
}

/** Below this width there is no room for a name under the badge. */
const NAME_MIN_PCT = 17;

/**
 * How long a card takes to fly out of the deck, and the gap between one card and
 * the next.
 *
 * Slow enough to watch a card arrive rather than notice that one has. The gap
 * tightens when there are a lot of cards to get out, so dealing seven each to
 * eight people does not turn into a wait — the whole deal is held to about two
 * seconds however many people are sat down.
 */
const DEAL_MS = 520;
const DEAL_STAGGER_MS = 150;
const DEAL_TOTAL_MAX_MS = 1900;

/**
 * The beat between one trick and the next: the cards sit there long enough to
 * be read, then slide over to whoever won them.
 *
 * Sweeping them is what makes the winner unmistakable. A trick that simply
 * vanished left people asking who had taken it; cards travelling to a seat
 * answers that without a word, and doubles as the pause before the next lead.
 */
const TRICK_HOLD_MS = 1250;
const SWEEP_MS = 460;
const SWEEP_STAGGER_MS = 45;

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

/** The finished trick that has already been swept off the table, and its timer. */
let clearedTrick = null;
let holdingTrick = null;
let holdTimer = null;

/**
 * How many cards were on the table last paint, and which trick they belonged to.
 *
 * A card going down makes a noise whoever played it — that is most of what a
 * table sounds like, and without it the bots play in silence while you are the
 * only one anybody can hear.
 */
let heardTrick = null;
let heardPlays = 0;

export function playingScreen(ctx) {
  const state = ctx.state;
  const round = state.round;
  const trick = round.trick;
  const you = state.you;
  const forehead = Boolean(round.forehead);

  // Everyone has played and the server has already opened the next trick. Hold
  // the finished one on the table for a beat, then sweep it off.
  // A card has landed since the last paint: play it, once, whoever put it there.
  const heardKey = trick ? `${state.id}:${round.index}:${trick.number}` : null;
  if (heardKey !== heardTrick) {
    heardTrick = heardKey;
    heardPlays = trick ? trick.plays.length : 0;
  } else if (trick && trick.plays.length > heardPlays) {
    heardPlays = trick.plays.length;
    sound('card');
  }

  const settled = Boolean(trick && !trick.plays.length && round.lastTrick);
  const trickKey = settled ? `${state.id}:${round.index}:${round.lastTrick.number}` : null;
  const holding = settled && clearedTrick !== trickKey;
  if (holding && holdingTrick !== trickKey) {
    holdingTrick = trickKey;
    sound('trick');
    clearTimeout(holdTimer);
    holdTimer = setTimeout(() => {
      sweepTrick(round.lastTrick.winnerId, () => {
        clearedTrick = trickKey;
        ctx.render();
      });
    }, TRICK_HOLD_MS);
  }

  // Everyone in this hand, in turn order starting from you — so the ring reads
  // the way play travels round it.
  const inHand = state.players.filter((p) => p.inRound !== false && !p.left);
  const yourSeat = inHand.findIndex((p) => p.id === you.id);
  const ordered = yourSeat < 0 ? inHand : [...inHand.slice(yourSeat), ...inHand.slice(0, yourSeat)];

  const screen = h(
    'div.screen.screen--fixed.playing',
    topbar(state, { left: trumpCorner(round), right: roundChip(round), ctx }),
    forehead ? h('p.forehead-note', { text: 'Everyone can see your card. You cannot.' }) : null,
    table(ctx, ordered, trick, round, forehead, you, holding),
    statusBar(ctx, you, trick, round),
    skipOffer(ctx),
    hand(ctx, you, trick, round, forehead)
  );

  const roundKey = `${state.id}:${round.index}`;
  const firstPaintOfRound = dealtFor !== roundKey;
  if (firstPaintOfRound) {
    dealtFor = roundKey;
    seatScale = { round: roundKey, value: 1 }; // a new deal, a new table
    clearedTrick = null;
    holdingTrick = null;
    clearTimeout(holdTimer);
  }
  requestAnimationFrame(() => {
    fitSeats(screen);
    fitHand(screen);
    // The deal runs once per round, on the first paint of that round.
    if (firstPaintOfRound) dealAnimation(screen, ordered, you);
  });
  return screen;
}

/**
 * Trumps, in the corner your eye lands on first — and as the actual card that
 * was turned, not a word for it.
 *
 * This used to be a small pill on the right reading "♠ TRUMPS", and it was
 * missed constantly: it was competing with the game code and the settings
 * button, and a pip at that size is four almost-identical shapes. The turned
 * card is the thing everybody was already looking for, so it goes where the
 * round number used to be — the round number matters once a hand, the trump
 * suit matters on every single card you play.
 */
function trumpCorner(round) {
  if (round.noTrumps) {
    return h(
      'div.trump-corner.trump-corner--none',
      h('span.trump-corner__label', { text: 'NO' }),
      h('span.trump-corner__label', { text: 'TRUMPS' })
    );
  }
  if (!round.trumpSuit) return null;
  const red = round.trumpSuit === 'H' || round.trumpSuit === 'D';
  return h(
    'div',
    {
      className: `trump-corner${red ? ' trump-corner--red' : ''}`,
      'aria-label': `${suitName(round.trumpSuit)} are trumps`,
    },
    round.trumpCard ? cardFace(round.trumpCard, { size: 'xs', className: 'trump-corner__card' }) : null,
    h(
      'div.trump-corner__text',
      h('span.trump-corner__suit', { text: suitGlyph(round.trumpSuit), 'aria-hidden': 'true' }),
      h('span.trump-corner__label', { text: 'TRUMPS', 'aria-hidden': 'true' })
    )
  );
}

/** The round number, which the trump card displaced. */
function roundChip(round) {
  return h('span.chip.chip--round.tabular', {
    text: `${round.number}/${round.totalRounds}`,
    'aria-label': `Round ${round.number} of ${round.totalRounds}`,
  });
}

/** The oval, the seats round it, and whatever is on it. */
function table(ctx, ordered, trick, round, forehead, you, holding) {
  const total = ordered.length;
  const widthPct = seatWidthPct(total);
  const crowded = widthPct < NAME_MIN_PCT;
  const played = playsToShow(trick, round, holding);

  const seatNodes = ordered.map((player, index) => {
    const angle = seatAngle(index, total);
    const radians = (angle * Math.PI) / 180;
    const x = 50 + Math.cos(radians) * RING_X;
    const y = RING_MID_Y - Math.sin(radians) * RING_Y;
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
      you: player.id === you.id,
      card: played.get(player.id) || null,
      winning: played.size > 0 && played.winnerId === player.id,
      turn: trick && trick.turnId === player.id,
      forehead,
      foreheadCard: forehead && player.id !== you.id ? player.card : null,
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
    // Everything positioned sits inside the ring, so the percentages it is
    // placed by are percentages of a shape rather than of whatever space
    // happened to be left over.
    h(
      'div.table__ring',
      h(
        'div.table__felt',
        { 'aria-hidden': 'true' },
        // Trumps, painted on the baize. Big enough that a card laid on top of
        // it cannot hide it, behind everything so it never competes with the
        // cards, and faint enough not to shout.
        round.trumpSuit
          ? h('span', {
              className: `table__trump${round.trumpSuit === 'H' || round.trumpSuit === 'D' ? ' table__trump--red' : ''}`,
              text: suitGlyph(round.trumpSuit),
            })
          : null
      ),
      h(
        'div.table__middle',
        deckAndTrump(round)
      ),
      seatNodes,
      wonBanner(ctx, trick, round, played)
    )
  );
}

/**
 * The stock in the middle, wearing the trump suit.
 *
 * The turned card used to sit here face up beside the deck, and on a phone it
 * was underneath the cards played to every trick — measured, not guessed: the
 * top and bottom seats' cards land within 28px of the middle and are 60px tall,
 * so they cover it every single hand.
 *
 * There is no shape of table that fixes that. The ring is already as wide as
 * the phone, so the only way to buy vertical room is to take it from somewhere
 * else on a screen that has none spare — and anything small enough to sit in
 * the middle is small enough to be covered.
 *
 * So the middle stops carrying it. The turned card is in the top-left corner at
 * full size, your own trumps are gold-edged in your hand, and the suit is
 * painted across the baize behind everything, where it is far too big for a
 * card to hide. What is left here is what it says it is: the deck.
 */
function deckAndTrump(round) {
  return h(
    'div.deck',
    {
      'aria-label': round.noTrumps ? 'the deck, no trumps this hand' : 'the deck',
      role: 'img',
    },
    h('span.deck__back', { 'aria-hidden': 'true' }),
    h('span.deck__back', { 'aria-hidden': 'true' }),
    round.noTrumps ? h('span.deck__no-trumps', { text: 'NO', 'aria-hidden': 'true' }) : null
  );
}

/**
 * The cards to draw on the table.
 *
 * The server clears a finished trick the instant it settles, which would make
 * the winning card vanish before anyone saw it. So the last trick stays up for
 * a beat with its winner named, and is then swept off — the same as somebody
 * gathering the cards up before the next lead.
 *
 * @param {boolean} holding are we still showing the trick that has just finished?
 */
function playsToShow(trick, round, holding) {
  const map = new Map();
  const live = trick && trick.plays.length;
  const source = live ? trick : holding ? round.lastTrick : null;
  if (!source) return map;
  for (const play of source.plays) map.set(play.playerId, play.cardId);
  map.winnerId = live ? trick.winningPlayerId : source.winnerId;
  map.settled = !live;
  return map;
}

/**
 * Who took the trick, said plainly in the middle of the table.
 *
 * The gold ring on the winning card is easy to miss on a phone, so the moment a
 * trick settles it is spelled out — with who leads the next one, since that is
 * the question everybody asks next.
 */
function wonBanner(ctx, trick, round, played) {
  if (!played.settled || !round.lastTrick) return null;
  const winner = ctx.state.players.find((p) => p.id === round.lastTrick.winnerId);
  if (!winner) return null;
  const isYou = ctx.state.you && ctx.state.you.id === winner.id;
  return h(
    'div.won-banner',
    { role: 'status' },
    h('span.won-banner__who', { text: isYou ? 'You took it' : `${winner.name} took it` }),
    h('span.won-banner__next', { text: isYou ? 'You lead next' : `${winner.name} leads next` })
  );
}

/** One person round the table: who they are, how they are doing, their card. */
function seat(ctx, player, options) {
  const classes = [
    'seat',
    options.crowded ? 'seat--tight' : '',
    options.turn ? 'seat--turn' : '',
    options.you ? 'seat--you' : '',
    options.winning ? 'seat--won' : '',
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
    { className: classes, style: options.style, 'data-player-id': player.id },
    h(
      'div.seat__who',
      h(
        'div.seat__badge',
        { className: player.isBot ? 'seat__badge seat__badge--bot' : 'seat__badge' },
        h('span', { text: options.you ? 'YOU' : initials(player.name) }),
        player.isMaster ? h('span.seat__crown', { text: '♔' }) : null
      ),
      // Your own badge already says YOU, so the name under it would be saying it
      // twice in a place where every pixel is spoken for.
      options.crowded || options.you ? null : h('div.seat__name', { text: player.name }),
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
  const follow = trick && trick.ledSuit && yourTurn ? trick.ledSuit : null;
  // Nobody has played yet, so the person to act is opening the hand rather than
  // just taking their turn — worth saying, since it is the first thing asked.
  const opening = Boolean(trick && trick.number === 1 && !trick.plays.length);

  return h(
    'div.playbar',
    h('div.playbar__won', trickPile(you.tricksWon || 0), h('span.playbar__label', { text: 'won' })),
    h(
      'div',
      { className: `playbar__turn${yourTurn ? ' playbar__turn--you' : ''}`, role: 'status', 'aria-live': 'polite' },
      h('span.playbar__turn-name', {
        text: yourTurn ? 'Your turn' : turnPlayer ? `${turnPlayer.name}'s turn` : 'Settling…',
      }),
      follow
        ? h('span.playbar__follow', { text: `follow ${suitName(follow)}` })
        : opening
        ? h('span.playbar__follow', { text: yourTurn ? 'you lead this hand' : 'leads this hand' })
        : null
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
  const trumpSuit = round.trumpSuit || null;

  return h(
    'div',
    { className: `hand${cards.length > 7 ? ' hand--squeeze' : ''}` },
    cards.map((cardId, index) =>
      cardFace(cardId, {
        size: 'lg',
        index,
        // Marked in the hand as well as on the table. Which suit is trumps is
        // the one thing you have to hold in your head all hand, and reading it
        // off four small pips every turn is exactly the sort of work the app is
        // supposed to be doing for you.
        className: `hand__card${trumpSuit && parseCard(cardId).suit === trumpSuit ? ' hand__card--trump' : ''}`,
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
  const table = screen.querySelector('.table__ring');
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
function dealAnimation(screen, ordered, you) {
  if (reducedMotion() || !screen.isConnected) return;
  const table = screen.querySelector('.table__ring');
  const middle = screen.querySelector('.table__middle');
  const yourCards = [...screen.querySelectorAll('.hand__card')];
  if (!table || !middle || typeof middle.animate !== 'function') return;

  const from = middle.getBoundingClientRect();
  const tableBox = table.getBoundingClientRect();
  const seatEls = [...table.querySelectorAll('.seat')];
  if (!seatEls.length) return;

  // One card to each seat in turn, then round again — the way a hand is dealt.
  // Your own cards are the real ones in your hand; everyone else gets a back
  // that flies to their seat and is gathered up on arrival, because their hand
  // is theirs and never appears on this screen.
  const handSize = Math.max(yourCards.length, 1);
  const total = handSize * ordered.length;
  const stagger = Math.min(DEAL_STAGGER_MS, Math.round(DEAL_TOTAL_MAX_MS / Math.max(total, 1)));
  const flying = [];

  for (let lap = 0; lap < handSize; lap++) {
    ordered.forEach((player, seatIndex) => {
      const delay = (lap * ordered.length + seatIndex) * stagger;
      const isYou = player.id === you.id;

      if (isYou) {
        const card = yourCards[lap];
        if (!card) return;
        const to = card.getBoundingClientRect();
        if (!to.width) return;
        flyIn(card, from, to, delay);
        return;
      }

      const seatEl = seatEls[seatIndex];
      if (!seatEl) return;
      const to = seatEl.getBoundingClientRect();
      if (!to.width) return;

      const back = cardBack({ size: 'sm', className: 'deal-fly' });
      back.style.left = `${((from.left + from.width / 2 - tableBox.left) / tableBox.width) * 100}%`;
      back.style.top = `${((from.top + from.height / 2 - tableBox.top) / tableBox.height) * 100}%`;
      table.appendChild(back);
      flying.push(back);
      flyOut(back, to, delay);
    });
  }

  // Whatever is still in the air when the deal ends is swept up, so nothing is
  // left behind if the screen changes under it.
  setTimeout(() => flying.forEach((el) => el.remove()), total * stagger + DEAL_MS + 200);
}

/**
 * Overlap the fan far enough that it fits across the screen.
 *
 * Card widths come from the stylesheet and the size setting, and how many you
 * hold comes from the round, so the only honest way to know whether seven cards
 * fit is to lay them out and look. Tightening only: a hand with room to spare
 * keeps the comfortable spacing it was designed with.
 */
function fitHand(screen) {
  const hand = screen.querySelector('.hand');
  if (!hand) return;
  const cards = [...hand.querySelectorAll('.hand__card')];
  if (cards.length < 2) return;

  const zoom = uiZoom();
  const available = hand.clientWidth * zoom - 8 * zoom; // a little air either side
  const cardWidth = cards[0].getBoundingClientRect().width;
  const spread = cards[cards.length - 1].getBoundingClientRect().right - cards[0].getBoundingClientRect().left;
  if (spread <= available) return;

  // What the gap between cards has to become for the fan to fit, in the hand's
  // own pixels rather than the ones we just measured.
  const gaps = cards.length - 1;
  const overlap = (available - cards.length * cardWidth) / gaps / zoom;
  hand.style.setProperty('--fan-overlap', `${Math.min(overlap, -14)}px`);
}

/**
 * The finished trick slides over to whoever won it.
 *
 * Cards moving to a seat say who took the trick better than any label does, and
 * the travel time doubles as the reset beat between one trick and the next —
 * the pause a real table gets for free while somebody gathers the cards up.
 *
 * `done` runs whichever way this goes, so a browser without the Web Animations
 * API, a reduced-motion setting, or a screen that changed underneath still ends
 * up with a cleared table. Play must never wait on an animation.
 */
function sweepTrick(winnerId, done) {
  const table = document.querySelector('.playing .table__ring');
  if (!table || reducedMotion()) return done();

  const cards = [...table.querySelectorAll('.seat__card')];
  const target = table.querySelector(`.seat[data-player-id="${winnerId}"]`);
  if (!cards.length || !target || typeof cards[0].animate !== 'function') return done();

  const to = target.getBoundingClientRect();
  const zoom = uiZoom();
  let last = null;

  cards.forEach((card, index) => {
    const box = card.getBoundingClientRect();
    if (!box.width) return;
    // Measured on screen, moved inside the zoomed subtree — so the distance has
    // to come back out of the zoom, the same as the deal.
    const dx = (to.left + to.width / 2 - (box.left + box.width / 2)) / zoom;
    const dy = (to.top + to.height / 2 - (box.top + box.height / 2)) / zoom;
    last = card.animate(
      [
        { transform: 'translate(0, 0) scale(1)', opacity: 1 },
        { transform: `translate(${dx}px, ${dy}px) scale(0.6) rotate(4deg)`, opacity: 0 },
      ],
      {
        duration: SWEEP_MS,
        delay: index * SWEEP_STAGGER_MS,
        easing: 'cubic-bezier(0.4, 0, 0.2, 1)',
        fill: 'forwards',
      }
    );
  });

  const banner = table.querySelector('.won-banner');
  if (banner && typeof banner.animate === 'function') {
    banner.animate([{ opacity: 1 }, { opacity: 0 }], {
      duration: SWEEP_MS,
      easing: 'ease-in',
      fill: 'forwards',
    });
  }

  if (!last) return done();
  // A safety net as well as a callback: if the animation never settles because
  // the screen went away underneath it, the table still gets cleared.
  let cleared = false;
  const finish = () => {
    if (cleared) return;
    cleared = true;
    done();
  };
  last.finished.then(finish).catch(finish);
  setTimeout(finish, SWEEP_MS + cards.length * SWEEP_STAGGER_MS + 300);
}

/**
 * One of your cards arriving: it rests where it belongs, so it starts life over
 * the deck and travels back to itself.
 *
 * Driven by the Web Animations API rather than a CSS transition: an animation
 * leaves no inline styles behind, so it cannot end up fighting the stylesheet
 * rule holding a card at rest, or the lift that follows it.
 */
function flyIn(el, from, to, delay) {
  const zoom = uiZoom();
  const dx = (from.left + from.width / 2 - (to.left + to.width / 2)) / zoom;
  const dy = (from.top + from.height / 2 - (to.top + to.height / 2)) / zoom;
  el.animate(
    [
      { transform: `translate(${dx}px, ${dy}px) scale(0.7) rotate(-8deg)`, opacity: 0 },
      { transform: 'translate(0, 0) scale(1) rotate(0deg)', opacity: 1 },
    ],
    { duration: DEAL_MS, delay, easing: 'cubic-bezier(0.22, 1, 0.36, 1)', fill: 'backwards' }
  );
}

/**
 * Somebody else's card: it rests over the deck, travels out to their seat and is
 * gathered up there. Their hand is theirs, so nothing stays behind.
 */
function flyOut(el, seat, delay) {
  const box = el.getBoundingClientRect();
  const zoom = uiZoom();
  const dx = (seat.left + seat.width / 2 - (box.left + box.width / 2)) / zoom;
  const dy = (seat.top + seat.height / 2 - (box.top + box.height / 2)) / zoom;
  const animation = el.animate(
    [
      { transform: 'translate(0, 0) scale(0.7)', opacity: 0, offset: 0 },
      { transform: 'translate(0, 0) scale(1)', opacity: 1, offset: 0.12 },
      { transform: `translate(${dx}px, ${dy}px) scale(0.95) rotate(6deg)`, opacity: 1, offset: 0.82 },
      { transform: `translate(${dx}px, ${dy}px) scale(0.8) rotate(6deg)`, opacity: 0, offset: 1 },
    ],
    { duration: DEAL_MS + 160, delay, easing: 'cubic-bezier(0.22, 1, 0.36, 1)', fill: 'backwards' }
  );
  animation.finished.then(() => el.remove()).catch(() => el.remove());
}
