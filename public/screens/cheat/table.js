import { h } from '../../ui.js';
import { cardFace, cardBack } from '../../cards.js';
import { topbar, splitHand } from '../common.js';

/**
 * The Cheat table.
 *
 * Almost nothing on this screen is a card. That is the game: a pile nobody can
 * see, a claim everybody can hear, and a few seconds to decide whether to
 * believe it. The only face-up cards in the whole game are your own hand and the
 * ones somebody has just been made to turn over.
 *
 * The one thing here that has no equivalent at a real table is the WINDOW. In a
 * room, calling is a shout and the fastest voice wins; on a screen that would
 * hand it to whoever has the best connection. So a claim sits open for a few
 * seconds with a bar running down, and nobody may play on top of it until it
 * shuts. See `lib/cheat/game.js`.
 *
 * The countdown is drawn, never counted. A CSS animation describes the whole
 * window and a negative delay fast-forwards it to where the claim actually is —
 * so the bar survives a repaint mid-window, and no timer here has to agree with
 * the server's about when the moment ends.
 */

/** How long a just-happened thing is treated as news, for the animations. */
const NEWS_MS = 900;

/** The most cards that share a row of your own fan. */
const ROW_MAX = 10;

const RANK_ONE = {
  A: 'ace', 2: 'two', 3: 'three', 4: 'four', 5: 'five', 6: 'six', 7: 'seven',
  8: 'eight', 9: 'nine', 10: 'ten', J: 'jack', Q: 'queen', K: 'king',
};
const RANK_MANY = {
  A: 'aces', 2: 'twos', 3: 'threes', 4: 'fours', 5: 'fives', 6: 'sixes', 7: 'sevens',
  8: 'eights', 9: 'nines', 10: 'tens', J: 'jacks', Q: 'queens', K: 'kings',
};
const COUNT_WORD = ['no', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten'];

/** "three nines", "one king". The whole game is said out loud in this shape. */
function saying(rank, count) {
  const number = COUNT_WORD[count] || String(count);
  return `${number} ${count === 1 ? RANK_ONE[rank] : RANK_MANY[rank]}`;
}

/** "nines" or "nine" - the word after the count, sized to be read at a glance. */
function rankWord(rank, count) {
  return count === 1 ? RANK_ONE[rank] : RANK_MANY[rank];
}

/** "Nines" - the label on a rank button. */
function rankLabel(rank) {
  const word = RANK_MANY[rank] || rank;
  return word.charAt(0).toUpperCase() + word.slice(1);
}

let seen = { at: null, localAt: 0 };

function freshEvent(event) {
  if (!event || !event.at) return null;
  if (seen.at !== event.at) seen = { at: event.at, localAt: Date.now() };
  return Date.now() - seen.localAt < NEWS_MS ? event : null;
}

function reducedMotion() {
  return window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

/**
 * When this phone first saw the claim that is on the table.
 *
 * The bar is drawn from THIS rather than from the server's clock, so a phone
 * whose clock is four minutes out still sees a three second window. All the
 * server contributes is how long the window is, which is a rule, not a moment.
 */
let window_ = { openedAt: null, localAt: 0 };

function windowElapsed(claim) {
  if (!claim) return 0;
  if (window_.openedAt !== claim.openedAt) window_ = { openedAt: claim.openedAt, localAt: Date.now() };
  return Date.now() - window_.localAt;
}

export function tableScreen(ctx) {
  const state = ctx.state;
  const you = state.you || {};
  const event = freshEvent(state.lastEvent);
  const others = state.players.filter((p) => !p.left && p.id !== you.id);

  const screen = h(
    // `--fixed` so the table does not wander under your thumb while a window is
    // running, and deliberately NOT `--fits`: the call button has to stay
    // reachable, and the rule in styles.css is that a screen with something to
    // press takes the scrolling hatch while one you only look at shrinks.
    'div.screen.screen--fixed.ch-play',
    topbar(state, { left: codeChip(state), ctx }),
    metaRow(ctx),
    statusLine(ctx),
    h('div.ch-body', h('div.ch-seats', others.map((p) => seat(ctx, p, event))), middle(ctx, event)),
    yourHand(ctx),
    tools(ctx)
  );

  requestAnimationFrame(() => spillIfNeeded(screen));
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

// -- Header -------------------------------------------------------------------

function codeChip(state) {
  return h('span.ch-chip.ch-chip--code.tabular', {
    text: state.code,
    'aria-label': `Game code ${state.code.split('').join(' ')}`,
  });
}

function metaRow(ctx) {
  const state = ctx.state;
  const you = state.you || {};
  const held = (you.hand || []).length;
  const inPlay = state.players.filter((p) => !p.left && !p.out).length;
  return h(
    'div.ch-meta',
    h('span.ch-meta__count', h('strong', { text: String(held) }), h('span', { text: held === 1 ? 'card' : 'cards' })),
    h('span.ch-chip', { text: `${state.pileCount} in the middle` }),
    h('span.ch-chip', { text: `${inPlay} still in` }),
    speedToggle(ctx)
  );
}

/**
 * Double speed, offered only when there is nobody left to wait for.
 *
 * Watching four bots think at a person's pace is not pace, it is a wait — so
 * once every player still holding cards is a bot, the Master can halve both the
 * thinking and the window. It disappears the moment a person is back in it,
 * because then the pauses are somebody's turn again.
 */
function speedToggle(ctx) {
  const state = ctx.state;
  const you = state.you || {};
  if (!state.canSpeedUp || !you.isMaster) return null;
  const fast = state.speed === 2;
  return h('button.ch-chip.ch-chip--speed', {
    type: 'button',
    className: `ch-chip ch-chip--speed${fast ? ' ch-chip--on' : ''}`,
    text: fast ? 'x2 on' : 'x2',
    'aria-pressed': fast ? 'true' : 'false',
    'aria-label': fast ? 'Back to normal speed' : 'Speed the bots up',
    onClick: () => ctx.send({ type: 'game/setSpeed', speed: fast ? 1 : 2 }),
  });
}

function statusLine(ctx) {
  const state = ctx.state;
  const you = state.you || {};
  const claim = state.claim;
  const turn = state.players.find((p) => p.id === state.turnId);

  if (claim) {
    const mine = claim.playerId === you.id;
    return h('p.ch-status.ch-status--claim', {
      text: mine ? `You said ${saying(claim.rank, claim.count)}` : `${claim.name} says ${saying(claim.rank, claim.count)}`,
    });
  }
  if (you.out) return h('p.ch-status', { text: 'You are out, and safe. Watching the rest of it.' });
  if (you.canClaim) {
    return h('p.ch-status.ch-status--you', {
      text: state.lastRank
        ? `Your turn — ${state.legalRanks.map((r) => rankLabel(r)).join(', ')}`
        : 'Your turn — say anything you like',
    });
  }
  if (turn) return h('p.ch-status', { text: `${turn.name} is deciding what to say` });
  return h('p.ch-status', { text: 'Waiting…' });
}

// -- The middle ---------------------------------------------------------------

/**
 * The pile, the claim on it, or what was under the last one.
 *
 * Three states and only one of them shows a face. The pile itself never does —
 * `lib/cheat/view.js` sends a height and nothing else, so there is not a card id
 * on this phone for the middle to leak even if it wanted to.
 */
function middle(ctx, event) {
  const state = ctx.state;
  const claim = state.claim;
  if (claim) return claimView(ctx, claim, event);

  const last = state.lastEvent;
  if (last && last.kind === 'call' && last.cards) return revealView(ctx, last, event);
  return pileView(state, event);
}

function pileView(state, event) {
  const landed = event && event.kind === 'stands';
  if (!state.pileCount) {
    return h(
      'div.ch-middle.ch-middle--empty',
      h('div.ch-pile__slot', { 'aria-hidden': 'true' }),
      h('span.ch-middle__label', { text: 'Nothing down yet' })
    );
  }
  return h(
    'div',
    { className: `ch-middle${landed ? ' ch-middle--landed' : ''}` },
    stack(state.pileCount),
    h('span.ch-middle__label', {
      text: `${state.pileCount} face down${state.lastRank ? ` — last said ${RANK_MANY[state.lastRank]}` : ''}`,
    })
  );
}

/** A few backs, overlapping, however high the pile actually is. */
function stack(count) {
  const shown = Math.min(4, count);
  return h(
    'div.ch-pile',
    { 'aria-label': `${count} cards face down` },
    Array.from({ length: shown }, (_, i) =>
      h('div.ch-pile__card', { style: { '--i': String(i) } }, cardBack({ size: 'sm' }))
    )
  );
}

/**
 * A claim, waiting to be believed.
 *
 * The cards are face down and stay that way. What is on the screen is the
 * SAYING — how many and what they are called — which is public the instant it is
 * made, and the bar showing how long is left to doubt it.
 */
function claimView(ctx, claim, event) {
  const state = ctx.state;
  const you = state.you || {};
  const elapsed = windowElapsed(claim);
  const fresh = event && event.kind === 'claim';

  return h(
    'div',
    { className: `ch-middle ch-middle--claim${fresh ? ' ch-middle--landed' : ''}` },
    // Who, then WHAT, and the what is the biggest thing on the screen. This used
    // to be a 24px line sitting under a row of card backs, and reading it was
    // costing most of the window it was counting down.
    h('p.ch-claim__who', {
      text: claim.playerId === you.id ? 'You said' : `${claim.name} says`,
    }),
    h(
      'p.ch-claim__saying',
      h('span.ch-claim__count', { text: String(claim.count) }),
      h('span.ch-claim__rank', { text: rankWord(claim.rank, claim.count) })
    ),
    h(
      'div.ch-claim__cards',
      { 'aria-hidden': 'true' },
      Array.from({ length: Math.min(5, claim.count) }, (_, i) =>
        h('div.ch-claim__card', { style: { '--i': String(i) } }, cardBack({ size: 'sm' }))
      ),
      claim.count > 5 ? h('span.ch-claim__more', { text: `+${claim.count - 5}` }) : null
    ),
    claim.wentOut ? h('p.ch-claim__out', { text: 'Their last cards.' }) : null,
    // Drawn, never counted. See the note at the top of this file.
    h('div.ch-window', { 'aria-hidden': 'true' }, h('div.ch-window__bar', {
      style: reducedMotion()
        ? { width: '0%' }
        : { 'animation-duration': `${claim.windowMs}ms`, 'animation-delay': `-${Math.min(elapsed, claim.windowMs)}ms` },
    }))
  );
}

/**
 * What was under the last claim.
 *
 * The only moment in this game where cards from the middle are shown, and only
 * the ones that were just played — never the pile beneath them. It stays up
 * until somebody makes the next claim, because it is the thing everybody at the
 * table is talking about.
 */
function revealView(ctx, call, event) {
  const state = ctx.state;
  const you = state.you || {};
  const loser = state.players.find((p) => p.id === call.loserId);
  const caller = state.players.find((p) => p.id === call.callerId);
  const claimer = state.players.find((p) => p.id === call.claimerId);
  const fresh = Boolean(event && event.kind === 'call');

  return h(
    'div',
    { className: `ch-middle ch-middle--reveal${fresh ? ' ch-middle--flip' : ''}` },
    h('span.ch-middle__label', {
      text: `${caller ? caller.name : 'Someone'} called ${claimer ? claimer.name : 'them'}`,
    }),
    h(
      'div.ch-reveal',
      call.cards.map((card, i) => h('div.ch-reveal__card', { style: { '--i': String(i) } }, cardFace(card, { size: 'sm', corner: true })))
    ),
    h('p', {
      className: `ch-verdict ${call.honest ? 'ch-verdict--honest' : 'ch-verdict--lie'}`,
      text: call.honest ? `They really were ${RANK_MANY[call.rank]}.` : `Not ${RANK_MANY[call.rank]}.`,
    }),
    h('p.ch-middle__label', {
      text: `${loser && loser.id === you.id ? 'You' : loser ? loser.name : 'Someone'} picked up ${call.picked}.`,
    })
  );
}

// -- Everybody else -----------------------------------------------------------

function seat(ctx, player, event) {
  const state = ctx.state;
  const claim = state.claim;
  const picking = event && event.kind === 'call' && event.loserId === player.id;
  const claiming = claim && claim.playerId === player.id;

  const classes = ['ch-seat'];
  if (player.out) classes.push('ch-seat--out');
  if (player.isTurn || claiming) classes.push('ch-seat--turn');
  if (picking) classes.push('ch-seat--picked');

  return h(
    'div',
    { className: classes.join(' '), 'data-player-id': player.id },
    h(
      'div.ch-seat__head',
      h('span.ch-seat__name', { text: player.name }),
      h('span.ch-seat__count', { text: player.out ? 'out' : String(player.cardsHeld) })
    ),
    known(player),
    // Deliberately NOT showing who is mid-decision.
    //
    // It used to say "deciding" under each bot and clear as each one answered,
    // which meant three seats changing under your eyes during the four seconds
    // you are trying to read a claim. Seb described the screen as refreshing
    // while the bots made their minds up, and this is what he was describing.
    // Nothing about somebody else's deliberation is yours to act on anyway.
    !player.connected && !player.isBot ? h('span.ch-seat__state', { text: 'away' }) : null
  );
}

/**
 * The cards everybody knows this player is holding.
 *
 * Only ever cards the whole room watched get turned over and picked up, so
 * showing them is memory rather than a leak — the same reasoning Silly Head uses
 * for the cards it saw somebody take off the pile. Knowing that Dex is sitting
 * on two kings is most of how you decide whether to believe his next claim.
 */
function known(player) {
  const cards = player.publicCards || [];
  if (!cards.length || player.out) return null;
  const shown = cards.slice(0, 4);
  return h(
    'div.ch-seat__known',
    { 'aria-label': `${player.name} is known to hold ${cards.length} cards` },
    shown.map((card) => cardFace(card, { size: 'xs' })),
    cards.length > shown.length ? h('span.ch-seat__more', { text: `+${cards.length - shown.length}` }) : null
  );
}

// -- Your hand ----------------------------------------------------------------

/**
 * Your cards, and which of them are going down.
 *
 * Tap to pick, tap again to put back. No cap on how many — the house rule says
 * you may put down as many as you like, and the app does not second-guess it.
 * What it will not do is let you choose while a claim is open: the window is not
 * your turn, and half-picking a hand you cannot play yet only reads as broken.
 */
function yourHand(ctx) {
  const state = ctx.state;
  const you = state.you || {};
  const hand = you.hand || [];
  const picked = new Set(ctx.ui.cheatPick || []);
  const usable = Boolean(you.canClaim);

  if (you.out) return h('div.ch-hand.ch-hand--empty', h('p.muted.center', { text: 'Your hand is gone. Nicely done.' }));
  if (!hand.length) return h('div.ch-hand.ch-hand--empty');

  const rows = splitHand(hand, ROW_MAX);
  return h(
    'div.ch-hand',
    rows.map((row, rowIndex) =>
      h(
        'div.ch-fan',
        { style: { '--n': String(row.length) } },
        row.map((card, i) =>
          h(
            'div',
            {
              className: `ch-hand__card${picked.has(card) ? ' ch-hand__card--picked' : ''}`,
              style: { '--i': String(i) },
              // On the wrapper, not on the card. `cardFace` builds its own
              // attributes and passes nothing else through, so an aria-* handed
              // to it is quietly dropped - which is worse than not setting one,
              // because it looks done.
              'aria-selected': picked.has(card) ? 'true' : 'false',
            },
            cardFace(card, {
              size: 'md',
              corner: true,
              state: picked.has(card) ? 'picked' : null,
              onClick: usable
                ? () => {
                    const next = new Set(ctx.ui.cheatPick || []);
                    if (next.has(card)) next.delete(card);
                    else next.add(card);
                    ctx.ui.cheatPick = [...next];
                    ctx.render();
                  }
                : null,
            })
          )
        )
      )
    )
  );
}

// -- The buttons --------------------------------------------------------------

function tools(ctx) {
  const state = ctx.state;
  const you = state.you || {};
  if (you.canClaim) return claimBar(ctx);
  // Everything else shows the call button, live or not.
  //
  // It used to appear only while a claim was open, which made the one control
  // in this game that is on a clock also the one that moved. Now it is always
  // in the same place at the same size and simply goes live, so by the time you
  // need it your thumb already knows where it is.
  return callBar(ctx, Boolean(you.canCall));
}

/**
 * The one button that matters, and it is deliberately the biggest thing on the
 * screen while it is there.
 *
 * There is no button for letting it go. Saying nothing IS letting it go, the
 * same as at a table, and a second button next to this one would only be
 * something to hit by accident in the three seconds that count.
 */
function callBar(ctx, live) {
  const state = ctx.state;
  const claim = state.claim;
  const you = state.you || {};
  const turn = state.players.find((p) => p.id === state.turnId);

  return h(
    'div',
    { className: `ch-tools ch-tools--call${live ? ' ch-tools--live' : ''}` },
    h('button', {
      className: `btn btn--primary ch-call${live ? '' : ' ch-call--idle'}`,
      type: 'button',
      text: 'Cheat!',
      disabled: !live,
      'aria-label': live
        ? `Call ${claim ? claim.name : 'them'} on ${claim ? saying(claim.rank, claim.count) : 'that claim'}`
        : 'Nothing to call yet',
      onClick: () => ctx.send({ type: 'play/call' }),
    }),
    h('span.ch-tools__hint', {
      text: live
        ? 'Or say nothing and let it stand.'
        : you.out
          ? 'You are out, and safe.'
          : claim
            ? 'Your own claim - you cannot call it.'
            : `Waiting on ${turn ? turn.name : 'the next player'}.`,
    })
  );
}

/**
 * Pick your cards, then say what they are.
 *
 * The rank buttons ARE the send — tapping one puts the selected cards down and
 * claims them. Two taps for a whole turn, which is what it should be for a game
 * whose real content is happening in people's faces rather than on the phone.
 */
function claimBar(ctx) {
  const state = ctx.state;
  const picked = ctx.ui.cheatPick || [];
  const ranks = state.legalRanks || [];
  const free = ranks.length > 3;

  const say = (rank) => {
    if (!picked.length) {
      ctx.toast('Pick the cards you are putting down first.');
      return;
    }
    ctx.send({ type: 'play/claim', rank, cardIds: picked });
    ctx.ui.cheatPick = [];
  };

  return h(
    'div.ch-tools.ch-tools--claim',
    h('span.ch-tools__hint', {
      text: picked.length
        ? `Put ${COUNT_WORD[picked.length] || picked.length} down and say they are…`
        : 'Tap the cards you are putting down.',
    }),
    h(
      'div',
      { className: `ch-ranks${free ? ' ch-ranks--all' : ''}` },
      ranks.map((rank) =>
        h('button', {
          className: `ch-rank${picked.length ? '' : ' ch-rank--waiting'}`,
          type: 'button',
          text: free ? rank : rankLabel(rank),
          'aria-label': rankLabel(rank),
          onClick: () => say(rank),
        })
      )
    )
  );
}
