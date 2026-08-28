import { h, friendlyDate, friendlyTime, plural } from '../ui.js';
import { mascot } from '../mascot.js';
import { myGames } from '../net.js';
import { skeletonList } from './common.js';

/**
 * Past games. Games this phone played in come first — that is almost always
 * what someone is looking for when they tap "Past games".
 */

export function historyScreen(ctx) {
  const record = ctx.ui.historyRecord;
  if (record) return detailView(ctx, record);
  if (ctx.ui.historyOpening) {
    return shell(ctx, skeletonList(3, { lines: [55, 95, 70], label: 'Opening that game' }));
  }

  const games = ctx.ui.historyList;
  const mine = new Set(myGames());

  if (games === undefined) {
    loadList(ctx);
    // The shape of the list that is coming, rather than a line of text about
    // it. This wait is a real one on the free hosting tier, where the first
    // request of the evening also has to wake a sleeping server.
    return shell(ctx, skeletonList(4, { lines: [45, 80, 60], label: 'Loading past games' }));
  }

  if (!games.length) {
    return shell(
      ctx,
      h(
        'div.stack.center',
        { style: { 'margin-top': '40px' } },
        mascot('idle', { size: 'lg' }),
        h('h2.title', { text: 'No games yet' }),
        h('p.lede', { text: 'Finish one and it will be waiting here.' })
      )
    );
  }

  const ordered = [...games].sort((a, b) => Number(mine.has(b.id)) - Number(mine.has(a.id)));

  return shell(
    ctx,
    h(
      'div.stack.stack--tight',
      ordered.map((game) =>
        h(
          'button.history-item',
          {
            type: 'button',
            onClick: () => loadOne(ctx, game.id),
          },
          h(
            'div.history-item__top',
            h('span', { style: { 'font-weight': '900', 'font-size': '17px' }, text: game.winners.join(' & ') }),
            h('span.chip', { text: mine.has(game.id) ? 'You played' : `#${game.code}` })
          ),
          h('span.muted', {
            style: { 'font-size': '14px' },
            // Rounds are a Blob concept. Four of the six games on the shelf have
            // none, and until now every one of their rows said "undefined
            // rounds" - the client half of the fix that `historySummary` began
            // on the server. See ADDING-A-GAME.md, which lists this file as the
            // one that needed both halves.
            text: [
              friendlyDate(game.completedAt),
              friendlyTime(game.completedAt),
              plural(game.players.length, 'player', 'players'),
              game.rounds ? `${game.rounds} rounds` : null,
              game.mode === 'online' ? 'online' : null,
            ]
              .filter(Boolean)
              .join(' · '),
          }),
          h('span.muted', {
            style: { 'font-size': '13px' },
            // A scored game lists its scores; a game with no score says whatever
            // its own engine thought was worth saying, which is what `detail`
            // is for. Sorting by `total` when there is none put the seats in
            // whatever order the comparator happened to leave them.
            text: game.players.some((p) => typeof p.total === 'number')
              ? game.players
                  .slice()
                  .sort((a, b) => b.total - a.total)
                  .map((p) => `${p.name} ${p.total}`)
                  .join('   ')
              : game.detail || game.players.map((p) => p.name).join('   '),
          })
        )
      )
    )
  );
}

function shell(ctx, ...children) {
  return h(
    'div.screen.screen--scroll',
    h(
      'div.topbar',
      h('button.btn.btn--link', {
        text: '‹ Back',
        type: 'button',
        style: { 'text-decoration': 'none' },
        onClick: () => {
          ctx.ui.historyRecord = null;
          ctx.go(ctx.state ? 'game' : 'home');
        },
      }),
      h('div.topbar__right', h('span.topbar__title', { text: 'Past games' }))
    ),
    ...children
  );
}

function detailView(ctx, record) {
  return h(
    'div.screen.screen--scroll',
    h(
      'div.topbar',
      h('button.btn.btn--link', {
        text: '‹ All games',
        type: 'button',
        style: { 'text-decoration': 'none' },
        onClick: () => {
          ctx.ui.historyRecord = null;
          ctx.render();
        },
      }),
      h('div.topbar__right', h('span.chip.chip--code', { text: record.code }))
    ),
    h(
      'div.stack.center.stack--tight',
      h('span.eyebrow', { text: `${friendlyDate(record.completedAt)} · ${record.startHandSize} to start` }),
      h('h2.title', { text: `${record.winners.join(' & ')} won` })
    ),
    h(
      'div.stack.stack--tight',
      record.finalRanking.map((entry) =>
        h(
          'div.board-row',
          { className: entry.rank <= 3 ? `board-row--${entry.rank}` : '' },
          h('div.board-row__rank', { text: String(entry.rank) }),
          h('div.board-row__name', { text: entry.name }),
          h('div.board-row__total.tabular', { text: String(entry.total) })
        )
      )
    ),
    h('span.eyebrow', { text: 'Every round' }),
    h('div.card.scorecard', scorecard(record))
  );
}

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

async function loadList(ctx) {
  try {
    const res = await fetch('/api/history');
    const data = await res.json();
    ctx.ui.historyList = data.games || [];
  } catch {
    ctx.ui.historyList = [];
    ctx.toast('Could not fetch past games just now.');
  }
  ctx.render();
}

async function loadOne(ctx, id) {
  // Opening one is a fetch too, and until now it was a completely silent one:
  // you tapped a row and nothing happened until the answer came back. On a slow
  // connection that reads as a dead button.
  ctx.ui.historyOpening = true;
  ctx.render();
  try {
    const res = await fetch(`/api/history/${encodeURIComponent(id)}`);
    if (!res.ok) throw new Error('missing');
    ctx.ui.historyRecord = await res.json();
  } catch {
    ctx.toast('Could not open that game.');
  }
  ctx.ui.historyOpening = false;
  ctx.render();
}
