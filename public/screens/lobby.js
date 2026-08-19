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
  const state = ctx.state;
  const change = (delta) => {
    const next = state.startHandSize + delta;
    if (next < 3) return;
    ctx.send({ type: 'game/setHandSize', handSize: next });
  };

  return h(
    'div.card',
    h(
      'div',
      { style: { display: 'flex', 'align-items': 'center', gap: '12px' } },
      h(
        'div',
        { style: { flex: '1' } },
        h('div.eyebrow', { text: 'Starting hand' }),
        h('div', {
          style: { 'font-weight': '800', 'font-size': '15px', 'margin-top': '2px' },
          text: `${rounds(state.startHandSize)} rounds`,
        })
      ),
      h('button.stepper__btn', {
        text: '−',
        type: 'button',
        'aria-label': 'Fewer cards',
        disabled: state.startHandSize <= 3,
        onClick: () => change(-1),
      }),
      h('div.stepper__value', { text: String(state.startHandSize) }),
      h('button.stepper__btn', { text: '+', type: 'button', 'aria-label': 'More cards', onClick: () => change(1) })
    )
  );
}

const rounds = (handSize) => handSize * 2 - 1;

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
