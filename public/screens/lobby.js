import { h, plural } from '../ui.js';
import { mascot } from '../mascot.js';
import { qrSvg } from '../qr.js';
import { topbar, playerRow, action } from './common.js';

/**
 * The lobby — the first thing the group sees together, so it is built to be
 * held up and looked at: a code big enough to read across a table, a QR code
 * for the people who would rather point a camera, and everyone appearing as
 * they arrive.
 */

export function lobbyScreen(ctx) {
  const state = ctx.state;
  const you = state.you;
  const isMaster = you && you.isMaster;

  return h(
    'div.screen.screen--scroll',
    topbar(state, { title: 'Lobby' }),
    codeCard(state),
    deckWarning(ctx),
    h(
      'div.stack.stack--tight',
      h(
        'div',
        { style: { display: 'flex', 'align-items': 'baseline', 'justify-content': 'space-between' } },
        h('span.eyebrow', { text: plural(state.players.length, 'player', 'players') }),
        h('span.eyebrow', { text: `${state.startHandSize} cards to start` })
      ),
      h('ul.players', state.players.map((player) => playerRow(player, state, { status: lobbyStatus(player) })))
    ),
    isMaster ? offlineAdder(ctx) : null,
    isMaster ? handSizeControl(ctx) : null,
    h('div.spacer'),
    isMaster ? masterActions(ctx) : waitingNote(state),
    h('button.btn.btn--link', { text: 'Leave game', type: 'button', onClick: () => ctx.leaveGame() })
  );
}

function lobbyStatus(player) {
  if (player.isOffline) return { text: 'No phone', kind: 'offline' };
  if (!player.connected) return { text: 'Away', kind: 'gone' };
  return { text: 'Here', kind: 'in' };
}

function codeCard(state) {
  const joinUrl = `${location.origin}/?c=${state.code}`;
  return h(
    'div.code-card',
    h('div.eyebrow', { text: 'Game code' }),
    h('div.code.tabular', { text: state.code, 'aria-label': `Game code ${state.code.split('').join(' ')}` }),
    qrSvg(joinUrl, { className: 'qr', label: `QR code to join game ${state.code}` }),
    h('p.muted', { style: { 'font-size': '13px', 'margin-top': '8px' }, text: 'Scan, or type the code in.' })
  );
}

/**
 * The more-than-one-deck warning. It never blocks the game — plenty of groups
 * play with two decks — so it is a note with an acknowledgement, not a gate.
 */
function deckWarning(ctx) {
  const { deck, you } = ctx.state;
  if (!deck.exceeds || deck.acknowledged) return null;

  const isMaster = you && you.isMaster;
  return h(
    'div.card',
    {
      style: {
        'border-color': 'rgba(255, 201, 60, 0.6)',
        background: 'rgba(255, 201, 60, 0.12)',
      },
      role: 'status',
    },
    h('div.eyebrow', { style: { color: 'var(--gold)' }, text: 'Bring another deck' }),
    h('p', { style: { 'margin-top': '6px' }, text: deck.message }),
    isMaster
      ? h(
          'div.btn-row',
          { style: { 'margin-top': '12px' } },
          h('button.btn.btn--ghost.btn--small', {
            text: 'Got it, carry on',
            type: 'button',
            onClick: () => ctx.send({ type: 'game/acknowledgeDeck' }),
          })
        )
      : null
  );
}

function handSizeControl(ctx) {
  const server = ctx.state.startHandSize;
  // A pending change the server has caught up with is no longer pending.
  if (ctx.ui.lobbyHandSize === server) ctx.ui.lobbyHandSize = null;
  const shown = typeof ctx.ui.lobbyHandSize === 'number' ? ctx.ui.lobbyHandSize : server;

  const valueEl = h('div.stepper__value', { text: String(shown) });
  const roundsEl = h('div', {
    style: { 'font-weight': '800', 'font-size': '15px', 'margin-top': '2px' },
    text: `${rounds(shown)} rounds`,
  });
  const minusBtn = h('button.stepper__btn', {
    text: '−',
    type: 'button',
    'aria-label': 'Fewer cards',
    disabled: shown <= MIN_HAND,
    onClick: () => change(-1),
  });

  const current = () =>
    typeof ctx.ui.lobbyHandSize === 'number' ? ctx.ui.lobbyHandSize : ctx.state.startHandSize;

  /**
   * The number moves under the thumb; the server hears about it once.
   *
   * A command per tap meant four quick taps sent four commands all computed
   * from the same not-yet-updated state — so they all asked for the same
   * number, and three of them did nothing. Every reply then re-rendered the
   * card, rebuilding the button being tapped.
   *
   * This is the one place the screen shows something the server has not
   * confirmed. It is a lobby setting rather than anything scored, the Master
   * is the only one who can touch it, and a refusal puts it straight back.
   */
  function change(delta) {
    const next = Math.max(MIN_HAND, current() + delta);
    if (next === current()) return;
    ctx.ui.lobbyHandSize = next;
    valueEl.textContent = String(next);
    roundsEl.textContent = `${rounds(next)} rounds`;
    minusBtn.disabled = next <= MIN_HAND;

    if (sendTimer) clearTimeout(sendTimer);
    sendTimer = setTimeout(async () => {
      sendTimer = null;
      const wanted = ctx.ui.lobbyHandSize;
      if (typeof wanted !== 'number') return;
      // The game may have started while the thumb was still going. The hand
      // size is locked by then, and a refusal here is not worth a toast.
      if (!ctx.state || ctx.state.phase !== 'lobby') {
        ctx.ui.lobbyHandSize = null;
        return;
      }
      const sent = await ctx.send({ type: 'game/setHandSize', handSize: wanted });
      if (!sent) {
        ctx.ui.lobbyHandSize = null;
        ctx.render();
      }
    }, SETTLE_MS);
  }

  return h(
    'div.card',
    h(
      'div',
      { style: { display: 'flex', 'align-items': 'center', gap: '12px' } },
      h('div', { style: { flex: '1' } }, h('div.eyebrow', { text: 'Starting hand' }), roundsEl),
      minusBtn,
      valueEl,
      h('button.stepper__btn', { text: '+', type: 'button', 'aria-label': 'More cards', onClick: () => change(1) })
    )
  );
}

const rounds = (handSize) => handSize * 2 - 1;
const MIN_HAND = 3;
/** How long the thumb has to stop before the server is told. */
const SETTLE_MS = 400;
/** Shared across re-renders, so a rebuild of the card cannot orphan the timer. */
let sendTimer = null;

/** Adding a player who has no phone of their own. */
function offlineAdder(ctx) {
  if (ctx.ui.addingOffline) {
    const input = h('input.input', {
      type: 'text',
      placeholder: 'Their name',
      maxlength: '16',
      value: ctx.ui.offlineName || '',
      'aria-label': 'Name of the player without a phone',
      'data-focus-key': 'offline-name',
      onInput: (event) => {
        ctx.ui.offlineName = event.target.value;
      },
    });

    const add = async () => {
      const name = (ctx.ui.offlineName || '').trim();
      if (!name) {
        ctx.toast('They need a name.');
        return;
      }
      const sent = await ctx.send({ type: 'player/addOffline', name });
      if (!sent) return; // leave the name in the box to try again
      ctx.ui.offlineName = '';
      ctx.ui.addingOffline = false;
      ctx.render();
    };

    return h(
      'div.card',
      h('div.eyebrow', { text: 'Playing without a phone' }),
      h('p.muted', {
        style: { 'font-size': '14px', margin: '6px 0 10px' },
        text: 'They bid on your phone each round — you pass it over, they choose in private.',
      }),
      input,
      h(
        'div.btn-row',
        { style: { 'margin-top': '10px' } },
        h('button.btn.btn--ghost.btn--small', {
          text: 'Cancel',
          type: 'button',
          onClick: () => {
            ctx.ui.addingOffline = false;
            ctx.ui.offlineName = '';
            ctx.render();
          },
        }),
        h('button.btn.btn--primary.btn--small', { text: 'Add player', type: 'button', onClick: add })
      )
    );
  }

  return h('button.btn.btn--ghost', {
    text: '+ Add a player with no phone',
    type: 'button',
    onClick: () => {
      ctx.ui.addingOffline = true;
      ctx.render();
    },
  });
}

function masterActions(ctx) {
  const state = ctx.state;
  const ready = state.canStart;
  return h(
    'div.stack.stack--tight',
    !ready
      ? h('p.muted.center', { style: { 'font-size': '15px' }, text: 'Blob needs one more player before you can start.' })
      : null,
    action('Start game', () => ctx.send({ type: 'game/start' }), { disabled: !ready })
  );
}

function waitingNote(state) {
  return h(
    'div.stack.center',
    mascot('idle', { size: 'sm' }),
    h('p.lede', { text: `Waiting for ${state.masterName || 'the Master'} to start the game.` })
  );
}
