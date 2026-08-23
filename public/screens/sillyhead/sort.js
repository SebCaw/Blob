import { h } from '../../ui.js';
import { cardFace, cardBack, sortHand, parseCard } from '../../cards.js';
import { topbar, action } from '../common.js';

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
 */

export function sortScreen(ctx) {
  const state = ctx.state;
  const you = state.you;
  if (you.sortDone) return waitingView(ctx);

  const pick = ctx.ui.shPick;
  const picked = pick ? pick.cardId : null;
  const pickedIsThree = picked ? parseCard(picked).rank === '3' : false;

  /** Tap a pile: put the picked card down, or pick that pile's top card up. */
  const tapPile = async (index) => {
    const stack = you.up[index] || [];
    const top = stack.length ? stack[stack.length - 1] : null;

    if (!pick) {
      if (!top) {
        ctx.toast('Pick a card from your hand first.');
        return;
      }
      ctx.ui.shPick = { zone: 'pile', cardId: top, index };
      ctx.render();
      return;
    }
    if (pick.zone === 'pile' && pick.index === index) {
      // Tapping the pile you picked from puts it back down again.
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
    ctx.ui.shPick = null;
    ctx.ui.shSending = [pick.cardId];
    ctx.render();
    await ctx.send(command);
    ctx.ui.shSending = null;
    ctx.render();
  };

  const tapHandCard = (cardId) => {
    ctx.ui.shPick = pick && pick.cardId === cardId ? null : { zone: 'hand', cardId };
    ctx.render();
  };

  return h(
    'div.screen.screen--scroll.sh-sort',
    topbar(state, { title: 'Sort your cards', ctx }),
    h('p.sh-sort__hint', { text: hint(pick, you) }),
    h(
      'div.sh-piles',
      [0, 1, 2].map((index) => pileTile(you, index, { picked: pick, onClick: () => tapPile(index) }))
    ),
    h(
      'div.sh-sort__tools',
      pickedIsThree
        ? action('Bin this 3', async () => {
            const cardId = pick.cardId;
            ctx.ui.shPick = null;
            await ctx.send({ type: 'sort/bin', cardId });
          }, { kind: 'ghost' })
        : null,
      pick && pick.zone === 'pile'
        ? action('Take it back', async () => {
            const index = pick.index;
            ctx.ui.shPick = null;
            await ctx.send({ type: 'sort/take', pileIndex: index });
          }, { kind: 'ghost' })
        : null
    ),
    h('div.spacer'),
    h(
      'div.sh-hand',
      h(
        'div.sh-hand__head',
        h('span.eyebrow', { text: `Your hand — ${you.hand.length}` }),
        h('span.eyebrow', { text: `${state.stock} left in the deck` })
      ),
      h(
        'div.hand',
        sortHand(you.hand).map((cardId, i) =>
          h(
            'div.hand__card',
            { style: { '--i': String(i) } },
            cardFace(cardId, {
              size: 'md',
              state: picked === cardId ? 'playable' : null,
              className: [
                picked === cardId ? 'card-face--picked' : '',
                ctx.ui.shSending && ctx.ui.shSending.includes(cardId) ? 'card-face--sending' : '',
              ]
                .filter(Boolean)
                .join(' '),
              onClick: () => tapHandCard(cardId),
            })
          )
        )
      )
    ),
    action('I am ready', () => {
      ctx.ui.shPick = null;
      ctx.send({ type: 'sort/done' });
    }),
    h('p.muted.center', {
      style: { 'font-size': '13px' },
      text: 'Any pairs still stacked come back into your hand when you are ready.',
    })
  );
}

/** One of your three piles: the face-down card, and whatever is stacked on it. */
function pileTile(you, index, { picked, onClick }) {
  const stack = you.up[index] || [];
  const top = stack.length ? stack[stack.length - 1] : null;
  const chosen = picked && picked.zone === 'pile' && picked.index === index;
  const hasDown = you.downLeft[index];

  return h(
    'button',
    {
      className: `sh-pile${chosen ? ' sh-pile--picked' : ''}${top ? '' : ' sh-pile--empty'}`,
      type: 'button',
      'aria-label': top ? `Pile ${index + 1}, showing ${stack.length} cards` : `Pile ${index + 1}, empty`,
      onClick,
    },
    hasDown ? cardBack({ size: 'sm', className: 'sh-pile__down', label: 'a face-down card' }) : null,
    top ? cardFace(top, { size: 'sm', className: 'sh-pile__up' }) : h('span.sh-pile__slot', { text: '+' }),
    stack.length > 1 ? h('span.sh-pile__count', { text: `×${stack.length}` }) : null
  );
}

function hint(pick, you) {
  if (pick && pick.zone === 'hand') return 'Now tap a pile to put it down.';
  if (pick && pick.zone === 'pile') return 'Tap another pile to stack it, or take it back.';
  if (you.hand.some((c) => parseCard(c).rank === '3')) return 'Bin your 3s, and stack any pairs to draw more cards.';
  return 'Stack any pairs to draw more cards. Tap a card, then tap a pile.';
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
        text: waiting.length
          ? `Waiting for ${waiting.map((p) => p.name).join(', ')}.`
          : 'Dealing you in…',
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
