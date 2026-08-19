import { h } from '../ui.js';
import { mascot } from '../mascot.js';
import { topbar, leaderboard, action } from './common.js';

/**
 * How the round went: your own verdict first and biggest, then everyone's, then
 * the table. The leaderboard animates anyone who has climbed.
 */

export function summaryScreen(ctx) {
  const state = ctx.state;
  const you = state.you;
  const round = state.round;
  const isMaster = you && you.isMaster;
  const last = state.roundIndex === state.sequence.length - 1;

  return h(
    'div.screen.screen--scroll',
    topbar(state, { title: `Round ${round.number} done` }),
    verdict(you),
    h(
      'div.stack.stack--tight',
      h('span.eyebrow', { text: 'The round' }),
      state.players.map((player, index) =>
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
    // The one breathing point in a running game, so it is where leaving
    // belongs. Mid-bid there is no safe moment for a stray tap.
    h('button.btn.btn--link', { text: 'Leave game', type: 'button', onClick: () => ctx.leaveGame() })
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
