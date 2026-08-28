import { h, plural } from '../ui.js';
import { mascot } from '../mascot.js';
import { qrSvg } from '../qr.js';
import { topbar, playerRow, action } from './common.js';
import { sizeControl } from '../size.js';

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
  const online = state.mode === 'online';

  return h(
    'div.screen.screen--scroll',
    topbar(state, { title: 'Lobby', ctx }),
    h('div.mode-strip', { className: online ? 'mode-strip--online' : '' },
      h('span.mode-strip__label', { text: online ? 'Blob is dealing' : 'You are dealing' }),
      h('span.mode-strip__note', {
        text: online ? 'Everyone plays from their own phone.' : 'Real cards, round a table.',
      })
    ),
    codeCard(state),
    online ? null : deckWarning(ctx),
    h(
      'div.stack.stack--tight',
      h(
        'div',
        { style: { display: 'flex', 'align-items': 'baseline', 'justify-content': 'space-between' } },
        h('span.eyebrow', { text: plural(state.players.length, 'player', 'players') }),
        h('span.eyebrow', { text: `${state.startHandSize} cards to start` })
      ),
      h(
        'ul.players',
        state.players.map((player) =>
          playerRow(player, state, {
            status: lobbyStatus(player),
            trailing: isMaster && player.isBot ? dropBot(ctx, player) : null,
          })
        )
      )
    ),
    isMaster && !online ? offlineAdder(ctx) : null,
    isMaster && online ? botAdder(ctx) : null,
    isMaster ? handSizeControl(ctx) : null,
    h('div.spacer'),
    isMaster ? masterActions(ctx) : waitingNote(state),
    // The last quiet moment before cards start moving, so it is the right place
    // to find this if the lobby is already hard to read.
    sizeControl(ctx),
    h('button.btn.btn--link', { text: 'Leave game', type: 'button', onClick: () => ctx.leaveGame() })
  );
}

function lobbyStatus(player) {
  if (player.isBot) return { text: BOT_LEVELS[player.botLevel] ? BOT_LEVELS[player.botLevel].name : 'Bot', kind: 'bot' };
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
    h('p.muted', { style: { 'font-size': '13px', 'margin-top': '8px' }, text: 'Scan, or type the code in.' }),
    shareButton(state, joinUrl)
  );
}

/**
 * Sending the join link to somebody who is not in the room.
 *
 * The code and the QR between them already cover everybody at the table, and
 * that was the whole of it for a long time — which quietly meant the only way
 * to play was to be in the same room as somebody holding a phone up. This is
 * the other half: a friend two streets away, or the cousin who is coming to the
 * next one.
 *
 * `navigator.share` is the good path — it opens the phone's own share sheet, so
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
      // Said aloud, since the button is about to be the only thing reporting
      // back. A restore on a timer rather than on the next render: the lobby
      // redraws whenever somebody joins, which would otherwise wipe the reply
      // the instant it was given.
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
            text: `Join my game of Blob. The code is ${state.code}.`,
            url: joinUrl,
          });
          return;
        }
        await navigator.clipboard.writeText(joinUrl);
        say('Link copied');
      } catch (err) {
        // Closing the share sheet without picking anything rejects, and is not
        // a failure — telling somebody their tap went wrong when they simply
        // changed their mind is worse than saying nothing.
        if (err && err.name === 'AbortError') return;
        say('Could not copy');
      }
    },
  });
  return button;
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
  // Online there is one deck between everybody and a card has to be left over to
  // turn for trumps, so the stepper stops where the deck does. Round a table it
  // never stops — a group can shuffle in a second deck.
  const ceiling = typeof ctx.state.maxHandSize === 'number' ? ctx.state.maxHandSize : Infinity;

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
  const plusBtn = h('button.stepper__btn', {
    text: '+',
    type: 'button',
    'aria-label': 'More cards',
    disabled: shown >= ceiling,
    onClick: () => change(1),
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
    const next = Math.min(ceiling, Math.max(MIN_HAND, current() + delta));
    if (next === current()) return;
    ctx.ui.lobbyHandSize = next;
    valueEl.textContent = String(next);
    roundsEl.textContent = `${rounds(next)} rounds`;
    minusBtn.disabled = next <= MIN_HAND;
    plusBtn.disabled = next >= ceiling;

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
      plusBtn
    ),
    ceiling !== Infinity && shown >= ceiling
      ? h('p.muted', {
          style: { 'font-size': '13px', 'margin-top': '10px' },
          text: `${ceiling} each is all one deck stretches to with ${plural(
            ctx.state.players.length,
            'player',
            'players'
          )} — a card has to be left over to turn for trumps.`,
        })
      : null
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

/**
 * The four settings, and what the lobby says about each.
 *
 * Deliberately vague about HOW any of them plays. A blurb that gave the game
 * away — "always leads trumps" — would hand you the way to beat it, and the
 * whole point of the personas in `lib/bot.js` is that you cannot read one off.
 */
const BOT_LEVELS = {
  easy: { name: 'Easy', blurb: 'Still learning. Kind to a beginner.' },
  medium: { name: 'Medium', blurb: 'Plays a sensible hand.' },
  hard: { name: 'Hard', blurb: 'Pays attention. Hard to shake off.' },
  impossible: { name: 'Impossible', blurb: 'You have been warned.' },
};
const BOT_ORDER = ['easy', 'medium', 'hard', 'impossible'];

/** Filling the empty seats. Online only — a bot has to be dealt a hand. */
function botAdder(ctx) {
  const full = typeof ctx.state.maxPlayers === 'number' && ctx.state.players.length >= ctx.state.maxPlayers;

  if (!ctx.ui.addingBot) {
    return h('button.btn.btn--ghost', {
      text: '+ Add a bot',
      type: 'button',
      disabled: full,
      onClick: () => {
        ctx.ui.addingBot = true;
        ctx.render();
      },
    });
  }

  const add = async (level) => {
    const sent = await ctx.send({ type: 'player/addBot', level });
    if (!sent) return;
    // Left open on purpose: two bots is the common ask, and closing after each
    // one would mean finding this button again.
    ctx.render();
  };

  return h(
    'div.card',
    h('div.eyebrow', { text: 'Add a bot' }),
    h('p.muted', {
      style: { 'font-size': '14px', margin: '6px 0 10px' },
      text: 'It gets dealt a hand like everybody else, and it only sees what you see.',
    }),
    h(
      'div.levels',
      BOT_ORDER.map((level) =>
        h(
          'button.level',
          { type: 'button', disabled: full, onClick: () => add(level) },
          h('span.level__name', { text: BOT_LEVELS[level].name }),
          h('span.level__blurb', { text: BOT_LEVELS[level].blurb })
        )
      )
    ),
    full
      ? h('p.muted', { style: { 'font-size': '13px', 'margin-top': '10px' }, text: 'This table is full.' })
      : null,
    h(
      'div.btn-row',
      { style: { 'margin-top': '12px' } },
      h('button.btn.btn--ghost.btn--small', {
        text: 'Done',
        type: 'button',
        onClick: () => {
          ctx.ui.addingBot = false;
          ctx.render();
        },
      })
    )
  );
}

/** Changed your mind about one of them. */
function dropBot(ctx, player) {
  return h('button.btn--tiny', {
    text: 'Remove',
    type: 'button',
    'aria-label': `Remove ${player.name}`,
    onClick: () => ctx.send({ type: 'player/remove', playerId: player.id }),
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
