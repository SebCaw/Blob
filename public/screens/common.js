import { h, initials, fragment } from '../ui.js';

/**
 * A drawn crown rather than the U+265B glyph. A font that lacks it renders
 * nothing at all and the Master loses their badge silently — the same reason
 * the mascot is drawn instead of set in type.
 */
function crown() {
  const wrap = h('span.crown', { 'aria-hidden': 'true' });
  wrap.appendChild(
    fragment(
      '<svg viewBox="0 0 24 20" xmlns="http://www.w3.org/2000/svg">' +
        '<path d="M2 6 L7 11 L12 3 L17 11 L22 6 L20 17 L4 17 Z" fill="currentColor"/>' +
        '<circle cx="12" cy="2" r="2" fill="currentColor"/>' +
        '</svg>'
    )
  );
  return wrap;
}

/**
 * Settings, drawn rather than set in type.
 *
 * The ⚙ character arrives as a system emoji — a different weight, a different
 * colour, sometimes a different century — and sits in the topbar looking like it
 * wandered in from another app. Same reasoning as the crown above.
 */
function cog() {
  const wrap = h('span.icon', { 'aria-hidden': 'true' });
  wrap.appendChild(
    fragment(
      '<svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg" fill="none" stroke="currentColor" ' +
        'stroke-width="2.4" stroke-linecap="round">' +
        '<line x1="4" y1="8" x2="20" y2="8"/><line x1="4" y1="16" x2="20" y2="16"/>' +
        '<circle cx="10" cy="8" r="2.6" fill="currentColor" stroke="none"/>' +
        '<circle cx="15" cy="16" r="2.6" fill="currentColor" stroke="none"/>' +
        '</svg>'
    )
  );
  return wrap;
}

/**
 * The wooden spoon: last place, once there are enough of you for it to be funny.
 *
 * Drawn for the same reason as the crown, and because no emoji spoon is wooden.
 */
export function woodenSpoon() {
  const wrap = h('span.spoon', { 'aria-hidden': 'true' });
  wrap.appendChild(
    fragment(
      '<svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">' +
        '<ellipse cx="12" cy="6.6" rx="4.6" ry="5.4" fill="#b8813f"/>' +
        '<ellipse cx="12" cy="6.2" rx="2.9" ry="3.6" fill="#8f5f26"/>' +
        '<rect x="10.4" y="10.4" width="3.2" height="11.4" rx="1.6" fill="#b8813f"/>' +
        '</svg>'
    )
  );
  return wrap;
}

/**
 * Your own name, marked as yours.
 *
 * Somebody who has never typed a name in gets the default "You", and
 * "You (you)" reads like a bug — so the marker is dropped when the name is
 * already saying it.
 */
export function ownName(name, isYou) {
  if (!isYou) return name;
  return String(name).trim().toLowerCase() === 'you' ? name : `${name} (you)`;
}

/** Pieces that turn up on more than one screen. */

/**
 * The slim bar at the top of every in-game screen.
 *
 * `left` replaces the title outright, for a screen with something more useful
 * to put in the corner your eye goes to first. The playing screen uses it for
 * the trump card: which suit is trumps decides every card you play, and a round
 * number does not.
 *
 * @param {object} state
 * @param {{title?:string, left?:Node, right?:Node|Node[]}} [options]
 */
export function topbar(state, options = {}) {
  const title =
    options.title ||
    (state.round ? `Round ${state.round.number} of ${state.round.totalRounds}` : 'Lobby');
  return h(
    'div.topbar',
    options.ctx ? backButton(options.ctx) : null,
    options.left || h('div.topbar__title', { text: title }),
    h(
      'div.topbar__right',
      options.right || null,
      state.code ? h('span.chip.chip--code', { text: state.code }) : null,
      // Reachable from every screen in a game, because the moment you discover
      // the cards are too small to read is the middle of a hand, not the lobby.
      options.ctx ? settingsButton(options.ctx) : null
    )
  );
}

/**
 * Out of this game, top left, where a back button belongs.
 *
 * It used to be reachable only through Settings, which is a strange place to
 * look for "I am in the wrong game". In a lobby it just goes — nothing has been
 * dealt, so there is nothing to lose. Once a game is running it opens Settings
 * with the question already asked, because leaving is one-way and a back arrow
 * that quietly ends somebody's game would be the worst button in the app.
 */
function backButton(ctx) {
  const running = Boolean(ctx.state) && ctx.state.phase !== 'lobby' && ctx.state.phase !== 'complete';
  return h(
    'button.btn.btn--link.topbar__back',
    {
      type: 'button',
      'aria-label': running ? 'Leave this game' : 'Back to all games',
      onClick: () => {
        if (!running) {
          ctx.backToShelf();
          return;
        }
        ctx.ui.settingsOpen = true;
        ctx.ui.confirmShelf = true;
        ctx.render();
      },
    },
    h('span', { text: '‹', 'aria-hidden': 'true' })
  );
}

/** The way in to settings, mid-game. */
function settingsButton(ctx) {
  return h(
    'button.icon-btn',
    {
      type: 'button',
      'aria-label': 'Settings',
      onClick: () => {
        ctx.ui.settingsOpen = true;
        ctx.render();
      },
    },
    cog()
  );
}

/** One dot per round, with the current one lit. */
export function roundPips(state) {
  if (!state.sequence || !state.sequence.length) return null;
  const max = Math.max(...state.sequence);
  return h(
    'div.pips',
    { 'aria-hidden': 'true' },
    state.sequence.map((handSize, index) => {
      const which = index < state.roundIndex ? 'done' : index === state.roundIndex ? 'now' : '';
      return h('div.pip', {
        className: which ? `pip--${which}` : '',
        style: { height: `${Math.round((handSize / max) * 100)}%` },
      });
    })
  );
}

/** A labelled progress bar, e.g. "3 / 4 in". */
export function progress(done, total, label) {
  const percent = total ? Math.round((done / total) * 100) : 0;
  return h(
    'div.progress',
    h('div.progress__bar', h('div.progress__fill', { style: { width: `${percent}%` } })),
    h('span.progress__count', { text: label || `${done} / ${total}` })
  );
}

/**
 * A player in a list, with whatever status chip suits the moment.
 * @param {object} player
 * @param {object} state
 * @param {{status?:{text:string, kind:string}, trailing?:Node}} [options]
 */
export function playerRow(player, state, options = {}) {
  const you = state.you && state.you.id === player.id;
  const classes = [
    'player',
    player.isMaster ? 'player--master' : '',
    you ? 'player--you' : '',
    (!player.connected && !player.isOffline) || player.left ? 'player--gone' : '',
  ]
    .filter(Boolean)
    .join(' ');

  const status = options.status || defaultStatus(player);

  return h(
    'li',
    { className: classes },
    h('div.player__badge', { text: initials(player.name) }),
    h(
      'div',
      { style: { flex: '1', 'min-width': '0' } },
      h('div.player__name', { text: ownName(player.name, you) }),
      h(
        'div.player__meta',
        player.isMaster ? h('span.player__crown', crown(), h('span', { text: 'Master' })) : null,
        player.isMaster && player.isOffline ? h('span', { text: '\u00b7' }) : null,
        player.isOffline ? h('span', { text: 'No phone' }) : null
      )
    ),
    options.trailing || null,
    status ? h('span', { className: `player__state state--${status.kind}`, text: status.text }) : null
  );
}

function defaultStatus(player) {
  if (player.left) return { text: 'Left', kind: 'gone' };
  if (player.isBot) return { text: 'Bot', kind: 'bot' };
  if (player.inRound === false) return { text: `In from round ${player.joinsAtRound || '?'}`, kind: 'offline' };
  if (player.skipped) return { text: 'Being played for', kind: 'gone' };
  if (player.isOffline) return { text: 'On Master phone', kind: 'offline' };
  if (!player.connected) return { text: 'Reconnecting', kind: 'gone' };
  return { text: 'Ready', kind: 'in' };
}

/**
 * The leaderboard. `previous` is last render's order, which is what lets a
 * player who has climbed get an animation rather than silently swapping places.
 *
 * @param {object} state
 * @param {string[]} [previousOrder] player ids in their previous positions
 */
export function leaderboard(state, previousOrder = [], options = {}) {
  const medals = ['\u{1F947}', '\u{1F948}', '\u{1F949}'];
  // Before anyone has scored, everyone shares first place. Handing out three
  // gold medals for a 0-0-0 table reads as a bug, so plain numbers until the
  // scores actually separate.
  const allLevel = state.leaderboard.every((entry) => entry.total === state.leaderboard[0].total);

  /*
   * The wooden spoon goes to whoever is bottom — but only at a table of four or
   * more, where being last is a running joke rather than simply losing, and only
   * once the scores have separated. Ties share it: if two of you are bottom, two
   * of you are bottom.
   */
  const bigEnough = state.leaderboard.length >= 4;
  const lowest = state.leaderboard.length ? state.leaderboard[state.leaderboard.length - 1].total : 0;
  const spoonFor = (entry) => bigEnough && !allLevel && entry.total === lowest;

  return h(
    'div.board',
    state.leaderboard.map((entry, index) => {
      const was = previousOrder.indexOf(entry.id);
      const climbed = was > index && was !== -1;
      const you = state.you && state.you.id === entry.id;
      const gained = options.hideDelta ? null : entry.roundScore;
      const spooned = spoonFor(entry);

      return h(
        'div',
        {
          className: [
            'board-row',
            entry.rank <= 3 && !allLevel ? `board-row--${entry.rank}` : '',
            spooned ? 'board-row--spoon' : '',
            you ? 'board-row--you' : '',
            climbed ? 'board-row--climbed' : '',
          ]
            .filter(Boolean)
            .join(' '),
        },
        spooned
          ? h(
              'div.board-row__rank',
              { 'aria-label': `${entry.name}, last with the wooden spoon` },
              woodenSpoon()
            )
          : h('div.board-row__rank', {
              text: entry.rank <= 3 && !allLevel ? medals[entry.rank - 1] : String(entry.rank),
            }),
        h('div.board-row__name', { text: ownName(entry.name, you) }),
        gained !== null && gained !== undefined
          ? h('div', {
              className: `board-row__delta${gained ? '' : ' board-row__delta--zero'}`,
              text: gained ? `+${gained}` : '+0',
            })
          : null,
        h('div.board-row__total.tabular', { text: String(entry.total) })
      );
    })
  );
}

/** A full-width primary action. */
export function action(label, onClick, options = {}) {
  return h('button', {
    className: `btn btn--${options.kind || 'primary'}`,
    text: label,
    onClick,
    disabled: options.disabled,
    type: 'button',
  });
}

/** Confetti, for the moments that deserve it. */
export function confetti(count = 40) {
  const colours = ['#c8ff3d', '#ff3e8a', '#37e0ff', '#ffc93c', '#ffffff'];
  const wrap = h('div.confetti', { 'aria-hidden': 'true' });
  for (let i = 0; i < count; i++) {
    wrap.appendChild(
      h('i', {
        style: {
          left: `${Math.random() * 100}%`,
          background: colours[i % colours.length],
          'animation-duration': `${2.4 + Math.random() * 2}s`,
          'animation-delay': `${Math.random() * 1.6}s`,
          transform: `rotate(${Math.random() * 360}deg)`,
        },
      })
    );
  }
  // Lives on the body rather than inside the screen, and takes itself away
  // when it has fallen.
  //
  // As a child of the screen it was at the mercy of re-rendering: returned
  // fresh every render it piled up over the scorecard, and returned once it
  // was wiped out by the very next repaint. It belongs to the moment, not to
  // any particular screen.
  document.body.appendChild(wrap);
  setTimeout(() => wrap.remove(), 1600 + 4400 + 400);
}
