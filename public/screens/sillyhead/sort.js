import { h } from '../../ui.js';
import { cardFace, cardBack, sortByRank, parseCard } from '../../cards.js';
import { topbar, action, fitFan } from '../common.js';
import { askBeforeStart, setAskBeforeStart } from '../../prefs.js';

/**
 * The sort — the house rule that makes Silly Head itself.
 *
 * Everybody does this at once, before a card is played: bin your 3s, stack
 * pairs to fish more cards out of the stock, and settle on the three you want
 * face up. Nobody is waiting on anybody, which is why it is not turn-based and
 * why the screen never says whose go it is.
 *
 * One interaction, used for everything: tap a card to pick it up, tap a pile to
 * put it down. That is what people do with actual cards on an actual table, and
 * it means there are no separate buttons for stacking, placing and rearranging
 * — the same two taps do all three depending on what is already on the pile.
 *
 * Two things this screen has to say out loud, because neither is guessable and
 * both decide the game half an hour later:
 *
 *   your three face-up cards are played LAST, so they want to be your best;
 *   and nothing may be left stacked when you start.
 *
 * It used to quietly unstack your pairs at the end, which meant the app picked
 * your three best cards, badly, without mentioning it.
 */

export function sortScreen(ctx) {
  if (ctx.ui.shConfirmReady) return confirmView(ctx);

  const state = ctx.state;
  const you = state.you;
  if (you.sortDone) return waitingView(ctx);

  const pick = ctx.ui.shPick;
  const picked = pick ? pick.cardId : null;
  const pickedIsThree = picked ? parseCard(picked).rank === '3' : false;
  const empty = you.up.findIndex((stack) => !stack.length);
  const stacked = you.up.some((stack) => stack.length > 1);
  // An empty pile is not a state to leave somebody sitting in. Until it is
  // filled the screen asks for nothing else, and a tap on any card fills it.
  const mustFill = empty !== -1 && you.hand.length > 0;

  const sending = (cardId) => Boolean(ctx.ui.shSending && ctx.ui.shSending.includes(cardId));

  const send = async (command, cardId) => {
    ctx.ui.shPick = null;
    ctx.ui.shSending = cardId ? [cardId] : [];
    ctx.render();
    await ctx.send(command);
    ctx.ui.shSending = null;
    ctx.render();
  };

  /** Tap a pile: put the picked card down, or pick that pile's top card up. */
  const tapPile = async (index) => {
    const stack = you.up[index] || [];
    const top = stack.length ? stack[stack.length - 1] : null;

    if (!pick) {
      if (!top) {
        ctx.toast('Tap a card in your hand to put it here.');
        return;
      }
      ctx.ui.shPick = { zone: 'pile', cardId: top, index };
      ctx.render();
      return;
    }
    if (pick.zone === 'pile' && pick.index === index) {
      ctx.ui.shPick = null;
      ctx.render();
      return;
    }

    const command = !top
      ? pick.zone === 'hand'
        ? { type: 'sort/place', cardId: pick.cardId, pileIndex: index }
        : null
      : parseCard(top).rank === parseCard(pick.cardId).rank
      ? { type: 'sort/stack', cardId: pick.cardId, pileIndex: index }
      : null;

    if (!command) {
      ctx.toast(top ? 'You can only stack cards of the same number.' : 'That card has to come from your hand.');
      return;
    }
    await send(command, pick.cardId);
  };

  const tapHandCard = async (cardId) => {
    // With a pile waiting, a tap means "that card, there" — no second tap on
    // the empty slot, because there is only one place it can go.
    if (mustFill) {
      await send({ type: 'sort/place', cardId, pileIndex: empty }, cardId);
      return;
    }
    ctx.ui.shPick = pick && pick.cardId === cardId ? null : { zone: 'hand', cardId };
    ctx.render();
  };

  const finish = () => {
    if (stacked) {
      ctx.toast('You cannot leave cards piled up. Take the spare ones back first.');
      return;
    }
    if (askBeforeStart()) {
      ctx.ui.shConfirmReady = true;
      ctx.render();
      return;
    }
    ctx.send({ type: 'sort/done' });
  };

  const screen = h(
    'div.screen.screen--fixed.sh-sort',
    topbar(state, { title: 'Sort your cards', ctx }),
    h('p.sh-sort__hint', {
      className: mustFill || stacked ? 'sh-sort__hint--urgent' : '',
      text: hint({ pick, you, mustFill, stacked }),
    }),
    h(
      'div.sh-piles',
      [0, 1, 2].map((index) =>
        pileTile(you, index, {
          picked: pick,
          wanted: mustFill && index === empty,
          sending,
          onClick: () => tapPile(index),
        })
      )
    ),
    h('p.sh-sort__why', {
      text: 'You play these three last, once the deck has gone. Put your best cards here.',
    }),
    h(
      'div.sh-sort__tools',
      pickedIsThree
        ? action('Bin this 3', () => send({ type: 'sort/bin', cardId: pick.cardId }, pick.cardId), { kind: 'ghost' })
        : null,
      pick && pick.zone === 'pile'
        ? action('Take it back', () => send({ type: 'sort/take', pileIndex: pick.index }, pick.cardId), {
            kind: 'ghost',
          })
        : null
    ),
    h(
      'div.sh-hand',
      h(
        'div.sh-hand__head',
        h('span.eyebrow', { text: `Your hand — ${you.hand.length}` }),
        h('span.eyebrow', { text: `${state.stock} left in the deck` })
      ),
      h(
        'div.hand.hand--sort',
        sortByRank(you.hand).map((cardId, i) =>
          h(
            'div.hand__card',
            { style: { '--i': String(i) } },
            cardFace(cardId, {
              size: 'lg',
              state: picked === cardId ? 'playable' : null,
              className: [picked === cardId ? 'card-face--picked' : '', sending(cardId) ? 'card-face--sending' : '']
                .filter(Boolean)
                .join(' '),
              onClick: () => tapHandCard(cardId),
            })
          )
        )
      )
    ),
    action('I am ready', finish, { disabled: mustFill })
  );

  requestAnimationFrame(() => fitFan(screen));
  return screen;
}

/** One of your three piles: the face-down card, and whatever is stacked on it. */
function pileTile(you, index, { picked, wanted, sending, onClick }) {
  const stack = you.up[index] || [];
  const top = stack.length ? stack[stack.length - 1] : null;
  const chosen = picked && picked.zone === 'pile' && picked.index === index;
  const hasDown = you.downLeft[index];

  return h(
    'button',
    {
      className: [
        'sh-pile',
        chosen ? 'sh-pile--picked' : '',
        top ? '' : 'sh-pile--empty',
        wanted ? 'sh-pile--wanted' : '',
        top && sending(top) ? 'sh-pile--sending' : '',
      ]
        .filter(Boolean)
        .join(' '),
      type: 'button',
      'aria-label': top ? `Pile ${index + 1}, showing ${stack.length} cards` : `Pile ${index + 1}, empty`,
      onClick,
    },
    hasDown ? cardBack({ size: 'lg', className: 'sh-pile__down', label: 'a face-down card' }) : null,
    top
      ? cardFace(top, { size: 'lg', className: 'sh-pile__up' })
      : h('span.sh-pile__slot', { text: wanted ? '?' : '+' }),
    stack.length > 1 ? h('span.sh-pile__count', { text: `×${stack.length}` }) : null
  );
}

function hint({ pick, you, mustFill, stacked }) {
  if (mustFill) return 'That pile is empty — tap a card to put there.';
  if (stacked) return 'Take the spare cards back before you start.';
  if (pick && pick.zone === 'hand') return 'Now tap a pile to put it down.';
  if (pick && pick.zone === 'pile') return 'Tap another pile to stack it, or take it back.';
  if (you.hand.some((c) => parseCard(c).rank === '3')) return 'Bin your 3s, and stack any pairs to draw more cards.';
  return 'Stack any pairs to draw more cards. Tap a card, then tap a pile.';
}

/**
 * The last question before you are dealt in.
 *
 * Asked because the answer decides the game half an hour later and nobody
 * meeting it for the first time knows that yet. Switchable off in Settings,
 * because somebody who has played a hundred hands does not need telling.
 */
function confirmView(ctx) {
  const state = ctx.state;
  const you = state.you;

  return h(
    'div.screen.screen--scroll.screen--centre.sh-sort',
    topbar(state, { title: 'Ready?', ctx }),
    h('div.spacer'),
    h('h2.lede.center', { text: 'Are your three best cards down?' }),
    h('p.muted.center', {
      text: 'You play these last, once the deck has gone and your hand is empty. Good cards here win you the game.',
    }),
    h(
      'div.sh-piles',
      you.up.map((stack, index) =>
        h(
          'div.sh-pile.sh-pile--still',
          you.downLeft[index] ? cardBack({ size: 'lg', className: 'sh-pile__down' }) : null,
          stack.length ? cardFace(stack[0], { size: 'lg', className: 'sh-pile__up' }) : null
        )
      )
    ),
    h('div.spacer'),
    h(
      'div.stack.stack--tight',
      action('Yes, deal me in', () => {
        ctx.ui.shConfirmReady = false;
        ctx.send({ type: 'sort/done' });
      }),
      action('Let me change them', () => {
        ctx.ui.shConfirmReady = false;
        ctx.render();
      }, { kind: 'ghost' }),
      h(
        'label.sh-dontask',
        h('input', {
          type: 'checkbox',
          'aria-label': 'Do not ask me again',
          onChange: (event) => setAskBeforeStart(!event.target.checked),
        }),
        h('span', { text: 'Do not ask me again' })
      )
    )
  );
}

/** Done, and somebody else is not. */
function waitingView(ctx) {
  const state = ctx.state;
  const waiting = state.players.filter((p) => !p.left && !p.sortDone);
  return h(
    'div.screen.screen--scroll.screen--centre',
    topbar(state, { title: 'Sorted', ctx }),
    h('div.spacer'),
    h(
      'div.stack.center',
      h('h2.lede.center', { text: 'You are ready.' }),
      h('p.muted.center', {
        text: waiting.length ? `Waiting for ${waiting.map((p) => p.name).join(', ')}.` : 'Dealing you in…',
      })
    ),
    h('div.spacer'),
    h(
      'ul.players',
      state.players
        .filter((p) => !p.left)
        .map((player) =>
          h(
            'li.player',
            h('div.player__badge', { text: player.name.slice(0, 2).toUpperCase() }),
            h('div', { style: { flex: '1' } }, h('div.player__name', { text: player.name })),
            h('span', {
              className: `player__state state--${player.sortDone ? 'in' : 'wait'}`,
              text: player.sortDone ? 'Ready' : 'Sorting',
            })
          )
        )
    )
  );
}
