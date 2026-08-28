import { h, initials, fragment } from '../ui.js';
import { uiZoom, pinViewport } from '../size.js';
import { qrSvg } from '../qr.js';

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
/**
 * The game code, the QR, and a way to send the link to somebody who is not here.
 *
 * Shared by all six lobbies, and it did not start that way: every game had its
 * own copy of these few lines, identical down to the punctuation. That is fine
 * right up until one of them gains something the others do not - which is
 * exactly what happened the day a share button was added to Blob's lobby and to
 * no other, so five games out of six quietly did not have it. One copy now.
 *
 * `g` in the link is what lets the join screen wear the right game's colours
 * before anybody has joined anything - see the note in `boot()`. It is a hint
 * rather than a promise: the real game arrives with the state, and a link with a
 * missing or unrecognised `g` is simply ignored.
 */
export function codeCard(state) {
  const joinUrl = `${location.origin}/?c=${state.code}&g=${state.game || 'blob'}`;
  return h(
    'div.code-card',
    h('div.eyebrow', { text: 'Game code' }),
    h('div.code.tabular', { text: state.code, 'aria-label': `Game code ${state.code.split('').join(' ')}` }),
    qrSvg(joinUrl, { className: 'qr', label: `QR code to join game ${state.code}` }),
    h('p.muted', { style: { 'font-size': '13px', 'margin-top': '8px' }, text: 'Scan, or type the code in.' }),
    shareButton(state, joinUrl)
  );
}

/**
 * Sending the join link to somebody who is not in the room.
 *
 * The code and the QR between them already cover everybody at the table, and
 * that was the whole of it for a long time - which quietly meant the only way to
 * play was to be in the same room as somebody holding a phone up. This is the
 * other half: a friend two streets away, or the cousin coming to the next one.
 *
 * `navigator.share` is the good path - it opens the phone's own share sheet, so
 * the link goes straight into WhatsApp with none of the copy-then-find-the-app
 * shuffle. It does not exist on most desktop browsers, so the clipboard is the
 * fallback and the button says which one happened.
 */
function shareButton(state, joinUrl) {
  const label = 'Send a link';
  const button = h('button.btn.btn--ghost.code-card__share', {
    text: label,
    type: 'button',
    onClick: async () => {
      // Said on the button itself, since it is the only thing here that can
      // report back. Restored on a timer rather than on the next render: the
      // lobby redraws whenever somebody joins, which would otherwise wipe the
      // reply the instant it was given.
      const say = (text) => {
        button.textContent = text;
        setTimeout(() => {
          button.textContent = label;
        }, 2200);
      };

      try {
        if (navigator.share) {
          await navigator.share({
            title: 'Blob',
            text: `Join my game. The code is ${state.code}.`,
            url: joinUrl,
          });
          return;
        }
        await navigator.clipboard.writeText(joinUrl);
        say('Link copied');
      } catch (err) {
        // Opening the share sheet and then backing out of it rejects, and is not
        // a failure - telling somebody their tap went wrong when they simply
        // changed their mind is worse than saying nothing at all.
        if (err && err.name === 'AbortError') return;
        say('Could not copy');
      }
    },
  });
  return button;
}

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

/**
 * Tighten a fan of cards until it fits the screen it is on.
 *
 * Silly Head draws its cards large on purpose — you read them from across a
 * table — which means a hand of fourteen will not fit a phone at its resting
 * spacing. It fans tighter rather than shrinking, for the same reason Blob's
 * bidding hand does: a smaller card is harder to read, and a tighter fan is
 * not, right up until the overlap starts covering the corner you read.
 *
 * Measured rather than calculated, because how wide a card ends up depends on
 * the stylesheet and the size setting, and laying them out and looking is the
 * only honest way to know.
 *
 * Two traps, both of which have bitten in this codebase: the fit must clear its
 * own last answer before measuring or it creeps tighter on every render, and
 * measuring happens in screen pixels while the value is set in the zoomed
 * subtree's own, so it divides back out.
 *
 * @param {HTMLElement} screen
 * @param {string} [selector]
 */
export function fitFan(screen, selector = '.hand') {
  // Every fan on the screen, not the first one: a big hand is dealt out over
  // more than one row, and a second row left at its resting spacing runs off
  // the phone exactly as one row of fourteen used to.
  for (const hand of screen.querySelectorAll(selector)) fitOneFan(hand);
}

/**
 * How much of a card behind another one still has to show.
 *
 * The corner you read a card by, and a little more. Tighter than this and a fan
 * is a row of white slivers: you cannot tell a 4 from a 9 without pulling it
 * out, which you cannot do on a screen. Past this point the cards themselves
 * have to get smaller, which is `fitCards`' job, not this one's.
 */
const FAN_MIN_SHOW = 0.34;

/** How much clear space is kept either side of a fan, in the app's pixels. */
const HAND_GUTTER = 14;

function fitOneFan(hand) {
  const cards = [...hand.querySelectorAll('.hand__card')];
  if (cards.length < 2) return;

  hand.style.removeProperty('--fan-overlap');
  const zoom = uiZoom();
  // A gutter either side, so the outermost card of a fan stops short of the
  // phone rather than running to the edge of it. Cards flush with the edge of
  // the glass read as cut off, and on a phone with a curved edge they are.
  const available = hand.clientWidth * zoom - HAND_GUTTER * 2 * zoom;
  const cardWidth = cards[0].getBoundingClientRect().width;
  const spread = cards[cards.length - 1].getBoundingClientRect().right - cards[0].getBoundingClientRect().left;
  if (spread <= available) return;

  const gaps = cards.length - 1;
  const wanted = (available - cards.length * cardWidth) / gaps / zoom;
  // Never tighter than a card you can still read, and never looser than the
  // resting spacing. Floored rather than rounded: a fan a pixel too tight is
  // invisible, and a pixel too wide runs off the phone.
  const tightest = -(cardWidth / zoom) * (1 - FAN_MIN_SHOW);
  hand.style.setProperty('--fan-overlap', `${Math.floor(Math.min(Math.max(wanted, tightest), -14))}px`);
}

/**
 * A hand, cut into as many rows as it needs.
 *
 * Past about eleven cards one row cannot be fanned tightly enough to fit a
 * phone and still show the corner you read a card by — the cards end up as
 * slivers, and a hand you cannot read is a hand you cannot play. So it becomes
 * two rows, or three, each one fanned to fit on its own.
 *
 * Split evenly rather than filling the first row and leaving four on the
 * second: a lopsided hand looks like a mistake, and the rows are the same
 * length whichever way you count them.
 *
 * @param {string[]} cards
 * @param {number} [max] the most that may share a row
 * @returns {string[][]}
 */
export function splitHand(cards, max = 11) {
  if (cards.length <= max) return [cards];
  const rows = Math.ceil(cards.length / max);
  const per = Math.ceil(cards.length / rows);
  const out = [];
  for (let at = 0; at < cards.length; at += per) out.push(cards.slice(at, at + per));
  return out;
}

/** How big a Silly Head card is drawn before anything has to give. */
const SH_CARD = 84;

/** And the smallest it may be squeezed to before the screen has to give instead. */
const SH_CARD_MIN = 52;

/**
 * Shrink the cards until the screen fits the phone it is on.
 *
 * Silly Head's screens are told to fit rather than left hoping to: a ring, a
 * middle, a status line, a hand and sometimes a row of table cards all want
 * height at once, and at the larger size settings they want more of it than
 * there is. Something has to give, and the cards are the piece with room to
 * spare — a card at 80% is still bigger than Blob has ever drawn one.
 *
 * The alternative was letting the screen scroll, which is what it did at Large
 * and Largest and only at Large and Largest: a table you have to scroll is not
 * a table, and a screen that silently changes kind when you turn the text up is
 * worse than either size on its own.
 *
 * It grows as well as shrinks, up to whatever `max` the screen thinks it can
 * use. Space is no good to anybody if the cards do not take it: the sort screen
 * on a laptop was three small cards at the top and a hand at the bottom with
 * half the window empty between them, and the cards are the whole point of the
 * screen. Same reasoning as Blob's peek, which fans tighter rather than
 * shrinking so a hand is never smaller on the screen you study it on.
 *
 * Measured rather than calculated, for the usual reason — how tall this ends up
 * depends on the size setting, the number of seats, and whether the status line
 * has one thing to say or three.
 *
 * @param {HTMLElement} screen
 * @param {{max?:number}} [options]
 */
export function fitCards(screen, options = {}) {
  if (!screen.clientHeight) return;
  // How tall the app may be, measured again now that this screen is laid out.
  //
  // It is measured at boot and on every resize as well, and neither is enough
  // on its own: the automatic scale for a bigger screen is a media query, so a
  // window that settles into its final size after the first paint — which is
  // every phone browser with a bar that slides away — leaves the boot
  // measurement describing a screen that no longer exists.
  pinViewport();
  const max = Math.max(SH_CARD_MIN, options.max || SH_CARD);
  const key = fitKey(screen, max);
  // Does the stack fit — the pieces laid out one under another, ending with
  // whatever is last?
  //
  // Asked of the flow rather than of `scrollHeight`, which counts anything
  // hanging out of the box as well: the seats are positioned inside the ring
  // and the top and bottom ones lean out of it by design, so scrollHeight
  // reported a screen that did not fit and every card on it was shrunk to the
  // floor to make room for an overhang that was never in anybody's way. Seats
  // leaning out of the ring is `fitRing` and `fitSeats`' business, not this
  // pass's.
  const fits = (size) => {
    screen.style.setProperty('--sh-card', `${size}px`);
    const last = screen.lastElementChild;
    if (!last) return true;
    const bottom = last.getBoundingClientRect().bottom;
    return bottom <= screen.getBoundingClientRect().bottom && !tooWide(screen);
  };

  // Settled already on this screen, at this size, in this window: keep it.
  //
  // Every state the server pushes re-runs this, and the screen it measures is
  // not the same height each time — the status line grows a line when a 9 is
  // showing or a run is building, and shrinks again when it is not. Fitting
  // from scratch each time, the cards grew and shrank all game, which reads as
  // the app being unable to make its mind up. So it only ever gives ground:
  // it shrinks when what is on screen genuinely stops fitting, and takes the
  // room back when the window or the text size changes, which is when the
  // player has actually asked for something different.
  // Clamped on the way down rather than counted down to: six at a time from 84
  // steps straight over 52 to 48, and the floor is only a floor if it is landed
  // on.
  const smaller = (size) => Math.max(SH_CARD_MIN, size - 6);

  if (lastFit.key === key && lastFit.size) {
    let size = lastFit.size;
    while (size > SH_CARD_MIN && !fits(size)) size = smaller(size);
    lastFit = { key, size };
    allowSpill(screen);
    return;
  }

  // Down from the biggest allowed until it fits, and no further.
  //
  // There is deliberately no headroom in that test, and it cost an afternoon to
  // learn why: the table is a flex item that takes whatever is going, so the
  // stack always ends exactly at the bottom of the screen whatever size the
  // cards are. Asking for twenty spare pixels asks for something that can never
  // be true, and the loop walked every screen to the smallest card it had. What
  // keeps the size steady is the reserved line in the status and the memory
  // below, not slack that does not exist.
  let size = max;
  while (size > SH_CARD_MIN && !fits(size)) size = smaller(size);
  if (!fits(size)) {
    size = SH_CARD_MIN;
    screen.style.setProperty('--sh-card', `${size}px`);
  }
  lastFit = { key, size };
  allowSpill(screen);
}

/**
 * If it still does not fit, let it scroll.
 *
 * The promise this screen makes is that it fits, and everything above is spent
 * keeping it — but there is a point past which it cannot be kept: the largest
 * text setting, on a small phone, at a full table. Before this, that came out
 * as the bottom of the screen simply missing, because a screen that must not
 * scroll and does not fit has nowhere to put what is left over. Losing your own
 * hand is far worse than a screen that moves, so when the cards have given
 * everything they have and it is STILL too tall, it scrolls.
 */
function allowSpill(screen) {
  const last = screen.lastElementChild;
  if (!last) return;
  const spills = last.getBoundingClientRect().bottom > screen.getBoundingClientRect().bottom + 1;
  screen.classList.toggle('screen--spill', spills);
}


/** What this screen settled on last time, and what it was settling for. */
let lastFit = { key: null, size: 0 };

/** The same screen, in the same window, at the same text size — or not. */
function fitKey(screen, max) {
  return [
    screen.className.replace(/\s*screen--enter\s*/, ''),
    window.innerWidth,
    window.innerHeight,
    document.documentElement.dataset.size || 'normal',
    max,
  ].join('|');
}

/**
 * Is a row of whole cards wider than the screen it is on?
 *
 * Height is not the only way a bigger card runs out of room — three piles side
 * by side stop fitting long before they stop fitting downwards. The hand is not
 * asked, because a hand answers this itself by fanning tighter (`fitFan`), and
 * asking it here would shrink every card on the screen to solve something the
 * next pass along was about to solve on its own.
 */
function tooWide(screen) {
  for (const row of screen.querySelectorAll('.sh-piles, .sh-table-row')) {
    if (row.scrollWidth > row.clientWidth + 1) return true;
  }
  // A hand answers this by fanning tighter — but only down to the corner you
  // read a card by. Seventeen cards will not fit a phone at any size worth
  // drawing, so past that point the cards give and the hand is asked here
  // rather than left to overflow silently.
  for (const hand of screen.querySelectorAll('.hand')) {
    const count = hand.querySelectorAll('.hand__card').length;
    const card = hand.querySelector('.card-face');
    if (count < 2 || !card) continue;
    const width = card.getBoundingClientRect().width;
    if (!width) continue;
    if (width + (count - 1) * width * FAN_MIN_SHOW > hand.clientWidth - HAND_GUTTER * 2) return true;
  }
  return false;
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
