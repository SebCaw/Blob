import { h } from '../ui.js';
import { mascot } from '../mascot.js';
import { leaderboard, confetti, action } from './common.js';
import { scorecard } from './history.js';

/** The end of the game: who won, by how much, and the whole card if you want it. */

export function completeScreen(ctx) {
  const state = ctx.state;
  const youWon = (state.winners || []).includes(state.you && state.you.id);
  const champions = state.leaderboard.filter((p) => state.winners.includes(p.id));
  const shared = champions.length > 1;
  const isMaster = state.you && state.you.isMaster;
  // Once per win, not once per render. Opening the scorecard re-renders this
  // screen, and the celebration was landing again on top of the round you had
  // just asked to read.
  if (youWon && ctx.ui.confettiShownFor !== state.id) {
    ctx.ui.confettiShownFor = state.id;
    confetti(32);
  }

  return h(
    'div.screen.screen--scroll',
    h('div.spacer'),
    h(
      'div.stack.center',
      h('div.trophy', { text: '\u{1F3C6}', 'aria-hidden': 'true' }),
      h('span.eyebrow', { text: shared ? 'It is a dead heat' : 'Blob champion' }),
      h('h1.display', { text: champions.map((c) => c.name).join(' & ') }),
      h('div', {
        style: { 'font-size': '22px', 'font-weight': '900', color: 'var(--lime)' },
        text: `${champions[0].total} points`,
      }),
      mascot(youWon ? 'cheer' : 'wow', { size: 'lg' }),
      youWon ? h('p.lede', { text: 'That is you. Well bid.' }) : null
    ),
    h('div.spacer'),
    h(
      'div.stack.stack--tight',
      h('span.eyebrow', { text: 'Final table' }),
      leaderboard(state, ctx.previousOrder, { hideDelta: true })
    ),
    ctx.ui.showCard
      ? h('div.card.scorecard', scorecard(toRecord(state)))
      : h('button.btn.btn--ghost', {
          text: 'See every round',
          type: 'button',
          onClick: () => {
            ctx.ui.showCard = true;
            ctx.render();
          },
        }),
    rematchPrompt(ctx, state, isMaster),
    h('div.spacer'),
    h(
      'div.stack.stack--tight',
      isMaster
        ? action(
            ctx.ui.rematchPending ? 'Starting…' : 'Play again',
            async () => {
              ctx.ui.rematchPending = true;
              ctx.render();
              await ctx.rematch();
              ctx.ui.rematchPending = false;
            },
            { disabled: ctx.ui.rematchPending }
          )
        : null,
      isMaster
        ? h('button.btn.btn--link', { text: 'Start a different game', type: 'button', onClick: () => ctx.leaveGame() })
        : action('New game', () => ctx.leaveGame()),
      h('button.btn.btn--link', { text: 'Past games', type: 'button', onClick: () => ctx.go('history') })
    )
  );
}

/**
 * The fallback for anyone the automatic hand-off could not reach: a player
 * who was not connected (and not a no-phone player the Master carries) when
 * "Play again" was tapped. Everyone who WAS reachable is redirected before
 * this has much chance to show — see `claimRematchSeat` in app.js.
 */
function rematchPrompt(ctx, state, isMaster) {
  if (isMaster || !state.rematchGameId) return null;
  return h(
    'div.card',
    { style: { 'border-color': 'rgba(200, 255, 61, 0.5)', background: 'rgba(200, 255, 61, 0.08)' } },
    h('div.eyebrow', { text: 'New game started' }),
    h('p', {
      style: { 'margin-top': '6px' },
      text: `${state.masterName || 'The Master'} started a new game. Join with the code below.`,
    }),
    h(
      'div',
      { style: { display: 'flex', 'align-items': 'center', gap: '12px', 'margin-top': '10px' } },
      h('span.code.tabular', { style: { 'font-size': '32px' }, text: state.rematchCode }),
      h('button.btn.btn--primary.btn--small', {
        text: 'Join',
        type: 'button',
        onClick: () => ctx.joinDifferentGame(state.rematchCode),
      })
    )
  );
}

/** Reshape live state into the same form the history scorecard reads. */
function toRecord(state) {
  return {
    players: state.players.map((p) => ({ id: p.id, name: p.name })),
    rounds: state.history.map((round) => ({
      number: round.index + 1,
      handSize: round.handSize,
      players: state.players.map((p) => ({
        id: p.id,
        name: p.name,
        bid: round.bids[p.id],
        tricks: round.tricks ? round.tricks[p.id] : null,
        score: round.scores ? round.scores[p.id] : null,
        runningTotal: round.totalsAfter ? round.totalsAfter[p.id] : null,
      })),
    })),
  };
}
