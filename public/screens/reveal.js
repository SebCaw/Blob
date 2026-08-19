import { h, fill } from '../ui.js';
import { mascot } from '../mascot.js';
import { topbar, action } from './common.js';

/**
 * Bids are locked and on show, and the table plays the actual cards. The app
 * has nothing to do here but hold the numbers and stay out of the way — it
 * does not know or care what a trump is.
 */

export function revealScreen(ctx) {
  const state = ctx.state;
  const round = state.round;
  const isMaster = state.you && state.you.isMaster;

  if (isMaster && ctx.ui.entering) return resultsEntry(ctx);

  const bidTotal = state.players.reduce((sum, p) => sum + (p.bid || 0), 0);

  return h(
    'div.screen.screen--scroll',
    topbar(state),
    h(
      'div.center.stack.stack--tight',
      h('span.eyebrow', { text: 'Bids locked' }),
      h('h2.title', { text: `${round.handSize} ${round.handSize === 1 ? 'card' : 'cards'} — play them out` })
    ),
    h(
      'div.stack.stack--tight',
      state.players.map((player, index) =>
        h(
          'div.reveal-row',
          { style: { 'animation-delay': `${index * 70}ms` } },
          h('span.player__name', { text: player.name }),
          player.bidEnteredBy === 'master' ? h('span.tag.tag--master', { text: 'By Master' }) : null,
          player.bidEnteredBy === 'offline' ? h('span.tag.tag--offline', { text: 'No phone' }) : null,
          h('span.reveal-row__bid.tabular', { text: String(player.bid) })
        )
      )
    ),
    h(
      'div.total-line',
      h('span', { text: `${bidTotal} bid \u00b7 ${round.handSize} to win` }),
      h('span.muted', {
        style: { 'font-size': '14px' },
        text:
          bidTotal === round.handSize
            ? 'Perfectly balanced'
            : bidTotal > round.handSize
              ? 'Someone is going down'
              : 'Tricks going spare',
      })
    ),
    h('div.spacer'),
    isMaster
      ? action('Enter the results', () => {
          ctx.ui.entering = true;
          ctx.render();
        })
      : h(
          'div.stack.center',
          mascot('wow', { size: 'sm' }),
          h('p.lede', { text: `Play the round. ${state.masterName} will put the results in.` })
        )
  );
}

/**
 * The Master types in how many tricks each player actually won.
 *
 * Steppers rather than a keyboard: on a phone, tapping + twice beats summoning
 * a numeric keypad that covers half the list, and it cannot produce a value
 * outside 0..handSize in the first place.
 *
 * This screen patches the numbers in place rather than re-rendering. Steppers
 * get tapped fast, and rebuilding the screen under the player's thumb loses
 * whichever tap lands mid-render.
 */
function resultsEntry(ctx) {
  const state = ctx.state;
  const round = state.round;
  const draft = { ...(ctx.ui.tricks || {}) };
  state.players.forEach((p) => {
    if (typeof draft[p.id] !== 'number') draft[p.id] = 0;
  });
  ctx.ui.tricks = draft;

  /** @type {Record<string, {value:HTMLElement, minus:HTMLButtonElement, plus:HTMLButtonElement}>} */
  const refs = {};
  const tally = h('div.tally', { role: 'status', 'aria-live': 'polite' });
  const tallyLabel = h('span');
  const tallyCount = h('span.tabular');
  tally.append(tallyLabel, tallyCount);
  const footer = h('div.stack.stack--tight');

  const total = () => state.players.reduce((sum, p) => sum + draft[p.id], 0);

  const set = (playerId, value) => {
    if (value < 0 || value > round.handSize) return;
    draft[playerId] = value;
    ctx.ui.tricks = draft;
    refresh();
  };

  const submit = async (force) => {
    const sent = await ctx.send({ type: 'results/submit', tricks: { ...draft }, force: Boolean(force) });
    // Hold on to what the Master typed if it did not land - retyping a table
    // of tricks because of a dropped request would be miserable.
    if (!sent) return;
    ctx.ui.tricks = null;
    ctx.ui.entering = false;
  };

  function refresh() {
    state.players.forEach((player) => {
      const ref = refs[player.id];
      const value = draft[player.id];
      ref.value.textContent = String(value);
      ref.value.className = `stepper__value${value === player.bid ? ' stepper__value--match' : ''}`;
      ref.value.setAttribute('aria-label', `${player.name} won ${value}`);
      ref.minus.disabled = value <= 0;
      ref.plus.disabled = value >= round.handSize;
    });

    const sum = total();
    const balanced = sum === round.handSize;
    tally.className = `tally ${balanced ? 'tally--ok' : 'tally--off'}`;
    tallyLabel.textContent = balanced ? 'That all adds up' : "That doesn't add up yet";
    tallyCount.textContent = `${sum} of ${round.handSize}`;

    fill(
      footer,
      balanced
        ? action('Submit results', () => submit(false))
        : [
            h('p.muted.center', {
              style: { 'font-size': '14px' },
              text: `A ${round.handSize}-card round has ${round.handSize} tricks in it. Worth a recount?`,
            }),
            h('button.btn.btn--ghost', { text: 'Submit anyway', type: 'button', onClick: () => submit(true) }),
          ]
    );
  }

  const rows = state.players.map((player) => {
    const value = h('div.stepper__value');
    const minus = h('button.stepper__btn', {
      text: '\u2212',
      type: 'button',
      'aria-label': `One fewer trick for ${player.name}`,
      onClick: () => set(player.id, draft[player.id] - 1),
    });
    const plus = h('button.stepper__btn', {
      text: '+',
      type: 'button',
      'aria-label': `One more trick for ${player.name}`,
      onClick: () => set(player.id, draft[player.id] + 1),
    });
    refs[player.id] = { value, minus, plus };

    return h(
      'div.result-row',
      h(
        'div.result-row__who',
        h('div.result-row__name', { text: player.name }),
        h('div.result-row__bid', { text: `Bid ${player.bid}` })
      ),
      h('div.stepper', minus, value, plus)
    );
  });

  refresh();

  return h(
    'div.screen.screen--scroll',
    h(
      'div.topbar',
      h('button.btn.btn--link', {
        text: '\u2039 Back',
        type: 'button',
        style: { 'text-decoration': 'none' },
        onClick: () => {
          ctx.ui.entering = false;
          ctx.render();
        },
      }),
      h('div.topbar__right', h('span.topbar__title', { text: 'Tricks won' }))
    ),
    h('div.stack.stack--tight', rows),
    tally,
    h('div.spacer'),
    footer
  );
}
