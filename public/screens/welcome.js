import { h } from '../ui.js';
import { mascot } from '../mascot.js';
import { action } from './common.js';

/**
 * Everything before you are in a game: the front door, making a game, and
 * joining one.
 *
 * These three live together because they share one piece of local state — the
 * name you are typing — and none of them has any server state to react to.
 */

const MIN_HAND = 3;

export function welcomeScreen(ctx) {
  const route = ctx.ui.route || 'home';
  if (route === 'nudge') return nudgeView(ctx);
  if (route === 'create') return createView(ctx);
  if (route === 'join') return joinView(ctx);
  return homeView(ctx);
}

/**
 * A shared link or scanned QR for a game other than the one this phone is
 * already in. The code used to be dropped on the floor here, which put the
 * player back in their old game with nothing to explain it.
 */
export function switchGameScreen(ctx) {
  const code = ctx.ui.pendingCode;
  // A question rather than a page: it sits in the middle of the screen, not
  // stacked in the top corner with the rest of the glass left empty.
  return h(
    'div.screen.screen--scroll.screen--centre',
    h('div.stack.center', wordmark(), mascot('think', { size: 'lg' })),
    h('h2.lede', { text: `Join game ${code}?` }),
    h('p.muted', {
      text: 'You are still in another game on this phone. Joining this one will leave it.',
    }),
    h(
      'div.stack',
      action(`Join game ${code}`, () => ctx.switchToPendingGame()),
      h('button.btn.btn--link', {
        text: 'Stay in my game',
        type: 'button',
        onClick: () => ctx.keepCurrentGame(),
      })
    )
  );
}

function shell(...children) {
  return h('div.screen.screen--scroll', ...children);
}

function wordmark() {
  return h(
    'h1.wordmark',
    { 'aria-label': 'Blob' },
    h('span', { text: 'B', 'aria-hidden': 'true' }),
    h('span', { text: 'L', 'aria-hidden': 'true' }),
    h('span', { text: 'O', 'aria-hidden': 'true' }),
    h('span', { text: 'B', 'aria-hidden': 'true' })
  );
}

/**
 * The front door asks one question: how are you playing?
 *
 * Round a table is the game Blob is for, and it is the first and larger choice.
 * Online is offered as what it is — the fallback for when there genuinely are
 * no cards.
 */
function homeView(ctx) {
  return shell(
    h(
      'div.stack.center',
      mascot('idle', { size: 'lg', label: 'Blob, the mascot' }),
      wordmark(),
      h('p.lede.center', { text: 'The bidding, the scoring and the arguments — sorted.' })
    ),
    h('div.spacer'),
    h('span.eyebrow.center', { text: 'How are you playing?' }),
    h(
      'div.stack.stack--tight',
      modeCard({
        title: 'Round a table',
        blurb: 'You deal real cards. Blob runs the bidding and keeps the score.',
        onClick: () => {
          ctx.ui.mode = 'table';
          ctx.go('create');
        },
      }),
      modeCard({
        title: 'Online',
        blurb: 'No cards to hand? Blob deals for you.',
        kind: 'quiet',
        onClick: () => ctx.go('nudge'),
      })
    ),
    h('div.spacer'),
    // Joining is what most people arriving at this screen are here to do, so it
    // is a button of its own rather than a line of small print.
    action('Join a game', () => ctx.go('join'), { kind: 'ghost' })
  );
}

function modeCard({ title, blurb, onClick, kind }) {
  return h(
    'button',
    { className: `mode-card${kind === 'quiet' ? ' mode-card--quiet' : ''}`, type: 'button', onClick },
    h('span.mode-card__title', { text: title }),
    h('span.mode-card__blurb', { text: blurb })
  );
}

/**
 * Tapping Online gets one friendly check first.
 *
 * Blob is a better game with real cards in your hands, and the app should say
 * so before it deals for you. One tap either way — a check, not a wall.
 */
function nudgeView(ctx) {
  return shell(
    backBar(ctx, 'Online'),
    h('div.spacer'),
    h(
      'div.stack.center',
      mascot('think', { size: 'lg' }),
      h('h2.lede.center', { text: 'Are you sure you have no cards?' }),
      h('p.muted.center', {
        text:
          'Blob is a better game with real cards in your hands. Online play is here for when that genuinely is not possible.',
      })
    ),
    h('div.spacer'),
    h(
      'div.stack',
      action('We have no cards', () => {
        ctx.ui.mode = 'online';
        ctx.go('create');
      }),
      h('button.btn.btn--link', {
        text: 'Actually, we have cards →',
        type: 'button',
        onClick: () => {
          ctx.ui.mode = 'table';
          ctx.go('create');
        },
      })
    )
  );
}

function createView(ctx) {
  const handSize = ctx.ui.handSize || 7;
  ctx.ui.handSize = handSize;
  const nameInput = h('input.input', {
    type: 'text',
    value: ctx.ui.name || '',
    placeholder: 'Your name',
    maxlength: '16',
    autocomplete: 'nickname',
    enterkeyhint: 'go',
    'aria-label': 'Your name',
    'data-focus-key': 'create-name',
    onInput: (event) => {
      ctx.ui.name = event.target.value;
    },
  });

  // Patched in place rather than re-rendered, for the same reason the results
  // steppers are: this button gets tapped several times in a row, and
  // rebuilding the screen under a thumb drops whichever tap lands mid-render.
  // It also took the name field with it, which is halfway through being typed.
  const valueEl = h('div', { className: 'display', text: String(handSize), style: { color: 'var(--lime)' } });
  const hintEl = h('p.muted.center', {
    style: { 'margin-top': '10px', 'font-size': '14px' },
    text: sequenceHint(handSize),
  });
  const minusBtn = h('button.stepper__btn', {
    text: '−',
    type: 'button',
    'aria-label': 'Fewer cards',
    disabled: handSize <= MIN_HAND,
    onClick: () => setHand((ctx.ui.handSize || MIN_HAND) - 1),
  });

  const setHand = (value) => {
    const next = Math.max(MIN_HAND, value);
    if (next === ctx.ui.handSize) return;
    ctx.ui.handSize = next;
    valueEl.textContent = String(next);
    hintEl.textContent = sequenceHint(next);
    minusBtn.disabled = next <= MIN_HAND;
  };

  const submit = async () => {
    const name = (ctx.ui.name || '').trim();
    if (!name) {
      ctx.toast('Pop your name in first.');
      nameInput.focus();
      return;
    }
    // Read the live value, not the one captured when this screen was built.
    await ctx.createGame(name, ctx.ui.handSize || MIN_HAND, ctx.ui.mode || 'table');
  };

  const online = ctx.ui.mode === 'online';

  return shell(
    backBar(ctx, online ? 'New online game' : 'New game'),
    online
      ? h('p.muted.center', {
          style: { 'font-size': '14px' },
          text: 'Blob deals. Everyone needs their own phone, and the hand size settles once you know who is playing.',
        })
      : null,
    h(
      'div.stack',
      h('div.field', h('label.eyebrow', { text: 'Who are you?', for: 'blob-name' }), nameInput),
      h(
        'div.field',
        h('span.eyebrow', { text: 'Starting hand' }),
        h(
          'div.card',
          h(
            'div',
            { style: { display: 'flex', 'align-items': 'center', 'justify-content': 'space-between', gap: '12px' } },
            minusBtn,
            h('div.center', valueEl, h('div.eyebrow', { text: 'cards' })),
            h('button.stepper__btn', {
              text: '+',
              type: 'button',
              'aria-label': 'More cards',
              onClick: () => setHand((ctx.ui.handSize || MIN_HAND) + 1),
            })
          ),
          hintEl
        )
      ),
      h('p.muted', {
        style: { 'font-size': '14px' },
        text: online
          ? 'One deck between you, so the hand size may come down as people join.'
          : 'You can add anyone without a phone once the lobby is open.',
      })
    ),
    h('div.spacer'),
    action('Create game', submit)
  );
}

/** Show the round sequence so the Master can see what they are choosing. */
function sequenceHint(handSize) {
  const down = [];
  for (let n = handSize; n >= 1; n--) down.push(n);
  const up = [];
  for (let n = 2; n <= handSize; n++) up.push(n);
  const all = down.concat(up);
  const rounds = all.length;
  const shown = all.length > 11 ? `${all.slice(0, 5).join(' ')} … ${all.slice(-3).join(' ')}` : all.join(' ');
  return `${rounds} rounds: ${shown}`;
}

function joinView(ctx) {
  const codeInput = h('input.input.input--code', {
    type: 'text',
    inputmode: 'numeric',
    pattern: '[0-9]*',
    value: ctx.ui.code || '',
    placeholder: '0000',
    maxlength: '6',
    'aria-label': 'Game code',
    'data-focus-key': 'join-code',
    autocomplete: 'one-time-code',
    onInput: (event) => {
      const digits = event.target.value.replace(/\D/g, '').slice(0, 6);
      event.target.value = digits;
      ctx.ui.code = digits;
    },
  });

  const nameInput = h('input.input', {
    type: 'text',
    value: ctx.ui.name || '',
    placeholder: 'Your name',
    maxlength: '16',
    autocomplete: 'nickname',
    enterkeyhint: 'go',
    'aria-label': 'Your name',
    'data-focus-key': 'join-name',
    onInput: (event) => {
      ctx.ui.name = event.target.value;
    },
  });

  const submit = async () => {
    const code = (ctx.ui.code || '').trim();
    const name = (ctx.ui.name || '').trim();
    if (code.length < 4) {
      ctx.toast('A game code is four digits.');
      codeInput.focus();
      return;
    }
    if (!name) {
      ctx.toast('Pop your name in first.');
      nameInput.focus();
      return;
    }
    await ctx.joinGame(code, name);
  };

  return shell(
    backBar(ctx, 'Join a game'),
    h(
      'div.stack',
      h('div.field', h('span.eyebrow', { text: 'Game code' }), codeInput),
      h('div.field', h('span.eyebrow', { text: 'Your name' }), nameInput)
    ),
    h('div.spacer'),
    h('div.stack', mascot('think', { size: 'sm' }), action('Join game', submit))
  );
}

function backBar(ctx, title) {
  return h(
    'div.topbar',
    h('button.btn.btn--link', {
      text: '‹ Back',
      type: 'button',
      style: { 'text-decoration': 'none', 'min-height': '44px' },
      // A phone that still holds a seat got here on its way to another game.
      // Home would leave that game running with nothing pointing at it.
      onClick: () => (ctx.hasSession() ? ctx.returnToGame() : ctx.go('home')),
    }),
    h('div.topbar__right', h('span.topbar__title', { text: title }))
  );
}
