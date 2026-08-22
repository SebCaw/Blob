import { h, buzz, initials } from '../ui.js';
import { mascot } from '../mascot.js';
import { topbar, roundPips, progress, action } from './common.js';
import { cardFace, cardBack, sortHand, trumpBadge } from '../cards.js';

/**
 * Bidding — the screen this app lives or dies by.
 *
 * Two rules shape the whole layout:
 *
 *  1. 0, 1 and 2 are enormous. Nearly every bid is one of those three, and they
 *     have to be a comfortable one-thumb tap without looking. Everything above
 *     2 is available but visibly secondary.
 *  2. It must not scroll on a phone. The pad flexes to whatever height is left
 *     rather than the screen growing past the fold.
 *
 * There is no confirmation step: tapping a number sets your bid, tapping
 * another changes it, and Submit is what makes it final.
 */

export function biddingScreen(ctx) {
  if (ctx.ui.takeover) return takeoverView(ctx);

  const state = ctx.state;
  const you = state.you;
  // Somebody who joined mid-game has no hand this round and nothing to bid.
  if (you.waitingToJoin) return waitingToJoinView(ctx);

  return h(
    'div.screen.screen--fixed',
    topbar(state),
    h(
      'div.bid',
      head(state),
      yourCards(ctx),
      you.hasSubmitted ? submitted(ctx) : pad(ctx),
      you.hasSubmitted ? null : h('div.bid__foot', submitBar(ctx), handoverBar(ctx))
    )
  );
}

function head(state) {
  const round = state.round;
  return h(
    'div.stack.stack--tight',
    roundPips(state),
    h(
      'div.bid__head',
      h('div.bid__cards', h('b', { text: String(round.handSize) }), h('span', { text: round.handSize === 1 ? 'card' : 'cards' })),
      state.mode === 'online' ? trumpBadge(round) : null,
      h('span.chip', { text: `${round.bidsIn} of ${round.bidsNeeded} in` })
    )
  );
}

/**
 * Online, you bid holding your cards — so they are on the screen while you
 * choose, small and unpressable. The forehead round turns it round: your own
 * card is the one thing you cannot see, and everyone else's is face up.
 */
function yourCards(ctx) {
  const state = ctx.state;
  if (state.mode !== 'online') return null;
  const round = state.round;

  if (round.forehead) {
    const others = state.players.filter((p) => p.id !== state.you.id && p.card);
    return h(
      'div.peek.peek--forehead',
      h('p.peek__note', { text: 'One card each. You can see theirs, not your own.' }),
      h(
        'div.peek__row',
        others.map((player) =>
          h(
            'div.peek__seat',
            cardFace(player.card, { size: 'sm' }),
            h('span.peek__name', { text: player.name })
          )
        ),
        h('div.peek__seat', cardBack({ size: 'sm', label: 'your card' }), h('span.peek__name', { text: 'You' }))
      )
    );
  }

  const cards = sortHand(state.you.hand || []);
  if (!cards.length) return null;
  return h('div.peek', cards.map((cardId, index) => cardFace(cardId, { size: 'sm', index, className: 'peek__card' })));
}

/** A latecomer waits out the hand that was already being played. */
function waitingToJoinView(ctx) {
  const state = ctx.state;
  return h(
    'div.screen.screen--scroll',
    topbar(state),
    h('div.spacer'),
    h(
      'div.stack.center',
      mascot('think', { size: 'lg' }),
      h('h2.lede.center', { text: "You're in from the next hand" }),
      h('p.muted.center', {
        text: 'This one was already being dealt when you arrived, so you sit it out. Nobody loses a card over it.',
      }),
      h('span.chip', { text: `Round ${state.you.joinsAtRound} is yours` })
    ),
    h('div.spacer'),
    h(
      'ul.players',
      state.players.filter((p) => p.inRound !== false && !p.left).map((player) => playerLine(player, state))
    )
  );
}

function playerLine(player, state) {
  const you = state.you && state.you.id === player.id;
  return h(
    'li.player',
    h('div.player__badge', { text: initials(player.name) }),
    h('div', { style: { flex: '1' } }, h('div.player__name', { text: player.name + (you ? ' (you)' : '') })),
    h('span', {
      className: `player__state state--${player.hasBid ? 'in' : 'offline'}`,
      text: player.hasBid ? 'Bid in' : 'Bidding',
    })
  );
}

/** The number pad, sized by how likely each bid is. */
function pad(ctx) {
  const round = ctx.state.round;
  const max = round.handSize;
  const chosen = ctx.ui.bid;

  const button = (value, big) =>
    h('button', {
      className: `bid-btn bid-btn--${big ? 'big' : 'small'}${chosen === value ? ' bid-btn--on' : ''}`,
      text: String(value),
      type: 'button',
      'aria-pressed': chosen === value ? 'true' : 'false',
      'aria-label': `Bid ${value}`,
      onClick: () => {
        ctx.ui.bid = value;
        buzz(8);
        ctx.render();
      },
    });

  // 0, 1 and 2 always get the big row — even in a one-card round, where only
  // 0 and 1 exist and the row simply holds two.
  const primary = [0, 1, 2].filter((n) => n <= max);
  const rest = [];
  for (let n = 3; n <= max; n++) rest.push(n);

  return h(
    'div',
    { className: `pad${rest.length ? '' : ' pad--simple'}` },
    h('p.bid__question', { text: 'How many tricks?' }),
    current(ctx),
    h('div.pad__primary', primary.map((n) => button(n, true))),
    rest.length ? h('div.pad__rest', rest.map((n) => button(n, false))) : null
  );
}

/** The running choice, before it is committed. */
function current(ctx) {
  const chosen = ctx.ui.bid;
  const set = chosen !== null && chosen !== undefined;
  return h(
    'div',
    { className: `bid__current${set ? ' bid__current--set' : ''}`, role: 'status', 'aria-live': 'polite' },
    h('span.bid__current-label', { text: set ? 'Your bid' : 'Pick a number' }),
    set ? h('span.bid__current-value', { text: String(chosen) }) : null
  );
}

function submitBar(ctx) {
  const chosen = ctx.ui.bid;
  const ready = chosen !== null && chosen !== undefined;
  return action(
    ready ? `Submit bid of ${chosen}` : 'Submit bid',
    async () => {
      const sent = await ctx.send({ type: 'bid/submit', playerId: ctx.state.you.id, value: chosen });
      if (!sent) return; // keep their choice on screen so they can try again
      ctx.ui.bid = null;
      buzz([12, 40, 12]);
    },
    { disabled: !ready }
  );
}

/** Anyone whose bid has to go in on this phone. */
function handoverBar(ctx) {
  const targets = (ctx.state.you && ctx.state.you.canBidFor) || [];
  if (!targets.length) return null;
  return h(
    'div.btn-row',
    targets.slice(0, 2).map((target) =>
      h('button.btn.btn--ghost.btn--small', {
        style: { flex: '1' },
        text: target.reason === 'offline' ? `Pass to ${target.name}` : `Bid for ${target.name}`,
        type: 'button',
        onClick: () => {
          ctx.ui.takeover = { ...target, stage: target.reason === 'offline' ? 'handover' : 'bid', bid: null };
          ctx.render();
        },
      })
    )
  );
}

/** Your bid is in. Now everyone waits, and the Master gets the room's status. */
function submitted(ctx) {
  const state = ctx.state;
  const you = state.you;
  const round = state.round;
  const waiting = state.players.filter((p) => !p.hasBid);

  return h(
    'div.stack',
    { style: { flex: '1', 'min-height': '0', 'overflow-y': 'auto' } },
    h(
      'div.done',
      h('span.done__tick', { text: '✓ Bid submitted' }),
      h('span.done__value', { text: String(you.bid) }),
      h('span.muted', { text: 'Locked in. No changing it now.' })
    ),
    progress(round.bidsIn, round.bidsNeeded, `${round.bidsIn} of ${round.bidsNeeded} in`),
    waiting.length
      ? h(
          'div.stack.stack--tight',
          h('span.eyebrow', { text: 'Still to bid' }),
          h(
            'ul.players',
            waiting.map((player) =>
              h(
                'li.player',
                h('div.player__name', { text: player.name }),
                h('span', {
                  className: `player__state state--${player.isOffline ? 'offline' : player.connected ? 'wait' : 'gone'}`,
                  text: player.isOffline
                    ? 'On Master phone'
                    : player.connected
                      ? 'Thinking'
                      : 'Reconnecting',
                })
              )
            )
          )
        )
      : null,
    handoverList(ctx),
    h(
      'div.center',
      { style: { 'margin-top': 'auto', 'padding-top': '10px' } },
      mascot('idle', { size: 'sm' }),
      h('p.muted.waiting-dots', { text: 'Waiting for everyone else' })
    )
  );
}

/** The Master's list of bids that have to go in on this phone. */
function handoverList(ctx) {
  const targets = (ctx.state.you && ctx.state.you.canBidFor) || [];
  if (!targets.length) return null;
  return h(
    'div.stack.stack--tight',
    h('span.eyebrow', { text: 'Needs your phone' }),
    targets.map((target) =>
      h('button.btn.btn--gold.btn--small', {
        style: { width: '100%' },
        text: target.reason === 'offline' ? `Pass the phone to ${target.name}` : `Enter a bid for ${target.name}`,
        type: 'button',
        onClick: () => {
          ctx.ui.takeover = { ...target, stage: target.reason === 'offline' ? 'handover' : 'bid', bid: null };
          ctx.render();
        },
      })
    )
  );
}

// -- Bidding on somebody else's behalf ---------------------------------------

/**
 * Two quite different situations share this view:
 *
 *  - an OFFLINE player, who chooses their own bid on the Master's phone. The
 *    Master hands the phone over and looks away; the bid is recorded as theirs.
 *  - a DISCONNECTED player, whom the Master is covering. That one is marked
 *    "entered by the Master" for everyone to see, because it is not private and
 *    should not pretend to be.
 */
function takeoverView(ctx) {
  const takeover = ctx.ui.takeover;
  const round = ctx.state.round;
  const offline = takeover.reason === 'offline';

  const close = () => {
    ctx.ui.takeover = null;
    ctx.render();
  };

  if (takeover.stage === 'handover') {
    return h(
      'div.screen.screen--fixed',
      h('div.spacer'),
      h(
        'div.stack.center',
        mascot('wow', { size: 'lg' }),
        h('h2.title', { text: `Pass the phone to ${takeover.name}` }),
        h('p.lede', { text: 'Then look away — this bid is theirs to choose, not yours.' })
      ),
      h('div.spacer'),
      h(
        'div.stack',
        action(`I'm ${takeover.name} — let me bid`, () => {
          ctx.ui.takeover = { ...takeover, stage: 'bid' };
          ctx.render();
        }),
        h('button.btn.btn--link', { text: 'Cancel', type: 'button', onClick: close })
      )
    );
  }

  if (takeover.stage === 'done') {
    return h(
      'div.screen.screen--fixed',
      h('div.spacer'),
      h(
        'div.stack.center',
        mascot('cheer', { size: 'lg' }),
        h('h2.title', { text: 'Bid taken' }),
        h('p.lede', {
          text: offline
            ? `Nobody else has seen it. Hand the phone back to ${ctx.state.masterName}.`
            : `${takeover.name}'s bid is in, marked as entered by the Master.`,
        })
      ),
      h('div.spacer'),
      action('Done', close)
    );
  }

  const chosen = takeover.bid;
  const max = round.handSize;
  const primary = [0, 1, 2].filter((n) => n <= max);
  const rest = [];
  for (let n = 3; n <= max; n++) rest.push(n);

  const button = (value, big) =>
    h('button', {
      className: `bid-btn bid-btn--${big ? 'big' : 'small'}${chosen === value ? ' bid-btn--on' : ''}`,
      text: String(value),
      type: 'button',
      'aria-pressed': chosen === value ? 'true' : 'false',
      'aria-label': `Bid ${value}`,
      onClick: () => {
        ctx.ui.takeover = { ...takeover, bid: value };
        buzz(8);
        ctx.render();
      },
    });

  return h(
    'div.screen.screen--fixed',
    h(
      'div.topbar',
      h('div.topbar__title', { text: offline ? `${takeover.name}'s bid` : `Covering ${takeover.name}` }),
      h('div.topbar__right', h('button.btn.btn--link', { text: 'Cancel', type: 'button', onClick: close }))
    ),
    h(
      'div.bid',
      h(
        'div.bid__head',
        h('div.bid__cards', h('b', { text: String(max) }), h('span', { text: max === 1 ? 'card' : 'cards' })),
        h('span.chip', { text: offline ? 'Private' : 'Entered by Master' })
      ),
      h(
        'div',
        { className: `pad${rest.length ? '' : ' pad--simple'}` },
        h('p.bid__question', { text: offline ? `${takeover.name}, how many tricks?` : `How many for ${takeover.name}?` }),
        h(
          'div',
          { className: `bid__current${chosen === null ? '' : ' bid__current--set'}`, role: 'status' },
          h('span.bid__current-label', { text: chosen === null ? 'Pick a number' : 'Their bid' }),
          chosen === null ? null : h('span.bid__current-value', { text: String(chosen) })
        ),
        h('div.pad__primary', primary.map((n) => button(n, true))),
        rest.length ? h('div.pad__rest', rest.map((n) => button(n, false))) : null
      ),
      h('div.bid__foot', action(
        'Submit bid',
        async () => {
          const sent = await ctx.send({ type: 'bid/submit', playerId: takeover.id, value: chosen });
          // Never say "bid taken" for a bid the server refused - the likely
          // reason is that the player reconnected and bid for themselves.
          if (!sent) return;
          ctx.ui.takeover = { ...takeover, stage: 'done' };
          buzz([12, 40, 12]);
          ctx.render();
        },
        { disabled: chosen === null }
      ))
    )
  );
}
