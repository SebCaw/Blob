import { h } from '../ui.js';
import { mascot } from '../mascot.js';
import { progress } from './common.js';

/**
 * Choosing a new Master, when the old one's phone has gone for good.
 *
 * An overlay rather than a screen: the round underneath carries on existing,
 * which matters most in the awkward case where the Master vanishes after the
 * results are in but before the game moves on.
 *
 * Votes are private while the ballot is open — you can see who has voted, never
 * what for.
 */

export function electionOverlay(ctx) {
  const election = ctx.state.election;
  if (!election) return null;
  if (election.resolved && ctx.ui.electionSeen === election.id) return null;

  return election.resolved ? resultView(ctx, election) : ballotView(ctx, election);
}

function ballotView(ctx, election) {
  const canVote = election.youCanVote;
  const voted = election.yourVote;

  return h(
    'div.overlay',
    h(
      'div.overlay__inner',
      h(
        'div.center.stack.stack--tight',
        mascot('wow', { size: '' }),
        h('span.eyebrow', { text: election.ballot > 1 ? `Ballot ${election.ballot}` : 'The Master has gone' }),
        h('h2.title', {
          text: election.ballot > 1 ? 'It was a tie — vote again' : `${election.forPlayerName} has gone`,
        }),
        h('p.lede', {
          text: election.ballot > 1
            ? 'Two players tied, so it is between them now.'
            : 'Pick who runs the rest of the game.',
        })
      ),
      progress(election.votesIn, election.votesNeeded, `${election.votesIn} of ${election.votesNeeded} voted`),
      canVote
        ? h(
            'div.stack.stack--tight',
            election.candidates.map((candidate) =>
              h('button', {
                className: `vote-btn${voted === candidate.id ? ' vote-btn--on' : ''}`,
                text: candidate.id === ctx.state.you.id ? `${candidate.name} (you)` : candidate.name,
                type: 'button',
                disabled: Boolean(voted) || candidate.id === ctx.state.you.id,
                onClick: () => ctx.send({ type: 'election/vote', candidateId: candidate.id }),
              })
            )
          )
        : h('p.lede.center', { text: 'The players still connected are voting.' }),
      canVote && !voted
        ? h('p.muted.center', { style: { 'font-size': '14px' }, text: "You can't vote for yourself." })
        : null,
      voted ? h('p.muted.center', { text: 'Your vote is in. Nobody can see it.' }) : null
    )
  );
}

function resultView(ctx, election) {
  const youWon = election.winnerId === (ctx.state.you && ctx.state.you.id);
  return h(
    'div.overlay',
    h(
      'div.overlay__inner',
      h(
        'div.center.stack.stack--tight',
        mascot(youWon ? 'cheer' : 'idle', { size: 'lg', crown: true }),
        h('span.eyebrow', { text: 'New Master' }),
        h('h2.display', { text: election.winnerName }),
        h('p.lede', {
          text: youWon
            ? "That's you. You run the rounds and enter the results from here."
            : `${election.winnerName} runs the rest of the game.`,
        })
      ),
      election.counts && election.counts.length
        ? h(
            'div.stack.stack--tight',
            h('span.eyebrow', { text: 'The vote' }),
            election.counts
              .slice()
              .sort((a, b) => b.votes - a.votes)
              .map((entry) =>
                h(
                  'div.reveal-row',
                  h('span.player__name', { text: entry.name }),
                  h('span.reveal-row__bid.tabular', { text: String(entry.votes) })
                )
              )
          )
        : null,
      election.reason === 'tiebreak'
        ? h('p.muted.center', {
            style: { 'font-size': '14px' },
            text: 'The vote tied twice over, so it went to whoever has been in the game longest.',
          })
        : null,
      election.reason === 'only-candidate'
        ? h('p.muted.center', { style: { 'font-size': '14px' }, text: 'Nobody else was left to choose from.' })
        : null,
      h('button.btn.btn--primary', {
        text: 'Carry on',
        type: 'button',
        onClick: () => {
          ctx.ui.electionSeen = election.id;
          ctx.render();
        },
      })
    )
  );
}
