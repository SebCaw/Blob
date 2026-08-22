import { h, fill } from '../ui.js';
import { mascot } from '../mascot.js';
import { topbar, leaderboard, action } from './common.js';

/**
 * How the round went: your own verdict first and biggest, then everyone's, then
 * the table. The leaderboard animates anyone who has climbed.
 */

/** Who opens the next hand — the thing everybody asks between rounds. */
function nextLeadNote(state, last) {
  if (last || state.mode !== 'online') return null;
  const next = state.round && state.round.nextLead;
  if (!next) return null;
  const isYou = state.you && state.you.id === next.id;
  return h('p.next-lead', {
    role: 'status',
    text: isYou ? 'You lead the next hand' : `${next.name} leads the next hand`,
  });
}

/**
 * Between hands, the Master can let go of a phone that has gone for good.
 *
 * Deliberately quiet, and never a nudge: most people who drop out come back, and
 * this is only worth reaching for once it is clear somebody is not going to.
 * They keep the points they won, and they can rejoin whenever they like.
 */
function letGoOffer(ctx) {
  const targets = (ctx.state.you && ctx.state.you.canRemove) || [];
  if (!targets.length) return null;
  return h(
    'div.card.card--quiet',
    h('div.eyebrow', { text: 'Gone for good?' }),
    h('p.muted', {
      style: { 'font-size': '14px', margin: '6px 0 10px' },
      text: 'They keep the points they have won, and can join again from any later hand.',
    }),
    h(
      'div.btn-row',
      targets.map((target) =>
        h('button.btn.btn--ghost.btn--small', {
          text: `Let ${target.name} go`,
          type: 'button',
          onClick: () => ctx.send({ type: 'player/remove', playerId: target.id }),
        })
      )
    )
  );
}

export function summaryScreen(ctx) {
  const state = ctx.state;
  const you = state.you;
  const round = state.round;
  const isMaster = you && you.isMaster;
  const last = state.roundIndex === state.sequence.length - 1;

  if (isMaster && ctx.ui.correcting) return correctionEntry(ctx);

  return h(
    'div.screen.screen--scroll',
    topbar(state, { title: `Round ${round.number} done`, ctx }),
    verdict(you),
    h(
      'div.stack.stack--tight',
      h('span.eyebrow', { text: 'The round' }),
      // Somebody who joined part-way through was not in this hand, and somebody
      // who has left is not in any more — neither belongs in its scores.
      state.players.filter((p) => p.inRound !== false && !p.left).map((player, index) =>
        h(
          'div',
          {
            className: `score-row score-row--${player.madeBid ? 'made' : 'missed'}`,
            style: { 'animation-delay': `${index * 60}ms` },
          },
          h(
            'div',
            { style: { flex: '1', 'min-width': '0' } },
            h('div.player__name', { text: player.name }),
            h('div.score-row__detail', { text: `Bid ${player.bid} · won ${player.tricks}` })
          ),
          h('div.score-row__points.tabular', { text: player.roundScore ? `+${player.roundScore}` : '0' })
        )
      )
    ),
    round.trickTotalOverridden
      ? h('p.muted.center', {
          style: { 'font-size': '13px' },
          text: 'These tricks did not add up to the hand size — entered as-is by the Master.',
        })
      : null,
    h(
      'div.stack.stack--tight',
      h('span.eyebrow', { text: 'Leaderboard' }),
      leaderboard(state, ctx.previousOrder)
    ),
    isMaster ? letGoOffer(ctx) : null,
    nextLeadNote(state, last),
    h('div.spacer'),
    isMaster
      ? action(last ? 'Finish the game' : 'Next round', () => ctx.send({ type: 'round/next' }), {
          kind: last ? 'gold' : 'primary',
        })
      : h(
          'div.stack.center',
          mascot(you.madeBid ? 'cheer' : 'sad', { size: 'sm' }),
          h('p.lede', { text: `Waiting for ${state.masterName} to deal the next round.` })
        ),
    isMaster ? masterExtras(ctx) : null,
    // The one breathing point in a running game, so it is where leaving
    // belongs. Mid-bid there is no safe moment for a stray tap.
    leaveControl(ctx)
  );
}

/**
 * The Master's two get-out-of-jail controls: fix a number that went in wrong,
 * and stop a game that is not going to finish. Both are quiet links rather
 * than buttons — they matter, but not as much as dealing the next round.
 */
function masterExtras(ctx) {
  if (ctx.ui.confirmEnd) {
    return h(
      'div.stack.center',
      h('p.muted', { text: 'End the game here? The scores as they stand become the final result.' }),
      h('button.btn.btn--link', {
        text: 'Yes, end the game',
        type: 'button',
        onClick: () => {
          ctx.ui.confirmEnd = false;
          ctx.send({ type: 'game/end' });
        },
      }),
      h('button.btn.btn--link', { text: 'Keep playing', type: 'button', onClick: () => ctx.cancelEnd() })
    );
  }
  return h(
    'div.stack.stack--tight.center',
    // Nothing was typed in online, so there is nothing to have mistyped — the
    // tricks are the ones that were actually played.
    ctx.state.mode === 'online'
      ? null
      : h('button.btn.btn--link', {
          text: 'Fix the scores',
          type: 'button',
          onClick: () => ctx.startCorrection(),
        }),
    h('button.btn.btn--link', { text: 'End game here', type: 'button', onClick: () => ctx.askEnd() })
  );
}

/**
 * Correcting the round that has just been scored.
 *
 * Deliberately the same steppers as entering the results in the first place —
 * the Master is doing the same job twice, and a different control for it would
 * only invite a second mistake. Prefilled with what actually went in, so a
 * single wrong number is one tap to fix rather than a whole table to retype.
 */
function correctionEntry(ctx) {
  const state = ctx.state;
  const round = state.round;
  const draft = { ...(ctx.ui.correction || {}) };
  state.players.forEach((p) => {
    if (typeof draft[p.id] !== 'number') draft[p.id] = typeof p.tricks === 'number' ? p.tricks : 0;
  });
  ctx.ui.correction = draft;

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
    ctx.ui.correction = draft;
    refresh();
  };

  const submit = async (force) => {
    const sent = await ctx.send({
      type: 'results/amend',
      roundIndex: round.index,
      tricks: { ...draft },
      force: Boolean(force),
    });
    // Keep the draft if it did not land, exactly as entering results does.
    if (!sent) return;
    ctx.ui.correction = null;
    ctx.ui.correcting = false;
    // Entering results gets its repaint free, because the phase moves on and
    // the screen changes with it. A correction leaves the phase where it was,
    // and the pushed state lands before this line — so without an explicit
    // render the Master is left staring at the form they just submitted.
    ctx.render();
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
        ? action('Save the correction', () => submit(false))
        : [
            h('p.muted.center', {
              style: { 'font-size': '14px' },
              text: `A ${round.handSize}-card round has ${round.handSize} tricks in it. Worth a recount?`,
            }),
            h('button.btn.btn--ghost', { text: 'Save anyway', type: 'button', onClick: () => submit(true) }),
          ]
    );
  }

  const rows = state.players.map((player) => {
    const value = h('div.stepper__value');
    const minus = h('button.stepper__btn', {
      text: '−',
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
        h('div.result-row__bid', { text: `Bid ${player.bid} · went in as ${player.tricks}` })
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
        text: '‹ Back',
        type: 'button',
        style: { 'text-decoration': 'none' },
        onClick: () => ctx.cancelCorrection(),
      }),
      h('div.topbar__right', h('span.topbar__title', { text: `Fixing round ${round.number}` }))
    ),
    h('div.stack.stack--tight', rows),
    tally,
    h('div.spacer'),
    footer
  );
}

/**
 * Leaving a running game cannot be undone — the session goes, and a started
 * game refuses new joins — so the button asks first. Anyone who only wants a
 * break should close the tab instead, which keeps their seat.
 */
function leaveControl(ctx) {
  if (!ctx.ui.confirmLeave) {
    return h('button.btn.btn--link', { text: 'Leave game', type: 'button', onClick: () => ctx.askLeave() });
  }
  return h(
    'div.stack.center',
    h('p.muted', { text: 'Leave for good? You will not be able to rejoin this game.' }),
    h('button.btn.btn--link', { text: 'Yes, leave', type: 'button', onClick: () => ctx.leaveGame() }),
    h('button.btn.btn--link', { text: 'Stay', type: 'button', onClick: () => ctx.cancelLeave() })
  );
}

/** The one line the player actually reads. */
function verdict(you) {
  if (!you || you.madeBid === null) return null;
  const made = you.madeBid;
  return h(
    'div',
    { className: `verdict verdict--${made ? 'made' : 'missed'}` },
    mascot(made ? 'cheer' : 'sad', { size: '' }),
    h('div.verdict__headline', { text: made ? 'You made your bid!' : 'Bad luck!' }),
    h('div.verdict__points.tabular', { text: made ? `+${you.roundScore}` : '0 points' }),
    h('p.muted', {
      style: { 'margin-top': '6px' },
      text: made ? `Bid ${you.bid}, won ${you.tricks}. Exactly right.` : `Bid ${you.bid}, won ${you.tricks}.`,
    })
  );
}
