import { h } from '../ui.js';

/**
 * Blob's score table, on its own.
 *
 * It used to live in `screens/history.js` because that is where it was first
 * needed, and it was always doing two jobs: the browsing screen drew a finished
 * game with it, and Blob's own end-of-game screen draws the LIVE one with it.
 * When "Past games" was taken off the shelf the browsing half went and this did
 * not, because it is still on screen at the end of every game of Blob.
 *
 * Nothing here knows where its record came from - a completed game off the
 * server or the one on the table right now. `complete.js` reshapes the live
 * state into the same form before handing it over.
 */

/**
 * The full card: a row per round, a column per player, bid and tricks together
 * with the running total underneath. Scrolls sideways rather than shrinking to
 * illegibility on a phone.
 */
export function scorecard(record) {
  const players = record.players;

  const header = h(
    'thead',
    h(
      'tr',
      h('th', { text: 'Round' }),
      players.map((p) => h('th', { text: p.name }))
    )
  );

  const body = h(
    'tbody',
    record.rounds.map((round) =>
      h(
        'tr',
        h('th', { scope: 'row', text: `${round.number}  (${round.handSize})` }),
        round.players.map((entry) =>
          h(
            'td',
            { className: entry.score ? 'hit' : 'miss' },
            h('span', { text: `${entry.bid ?? '–'}/${entry.tricks ?? '–'}` }),
            h('span', { style: { opacity: '0.55' }, text: `  ${entry.runningTotal ?? ''}` })
          )
        )
      )
    )
  );

  return h(
    'div',
    h('table', header, body),
    h('p.muted', { style: { 'font-size': '12px', 'margin-top': '8px' }, text: 'bid / won, then the running total.' })
  );
}
