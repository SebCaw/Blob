import { h } from '../../ui.js';
import { action } from '../common.js';
import { sizeControl } from '../../size.js';
import { gameById } from '../../games.js';

/**
 * Sevens' front page, and the one form in front of it.
 *
 * Deliberately the same shape as Silly Head's. Blob's front door asks "how are
 * you playing?" because Blob has three honest answers; Sevens has one, because
 * the whole game is cards nobody else can see. So this page asks nothing and
 * offers three doors, which is as few screens as the game can be built with.
 *
 * Joining is the shared one in `screens/welcome.js`: a code and a name is the
 * same job whatever is being played.
 */

export function sevensWelcome(ctx) {
  return ctx.ui.route === 'create' ? createView(ctx) : homeView(ctx);
}

function shell(...children) {
  return h('div.screen.screen--scroll', ...children);
}

function homeView(ctx) {
  const game = gameById('sevens');
  return shell(
    h(
      'div.topbar',
      h('button.btn.btn--link', {
        text: '‹ All games',
        type: 'button',
        style: { 'text-decoration': 'none', 'min-height': '44px' },
        onClick: () => ctx.go('shelf'),
      })
    ),
    h(
      'div.stack.center.home-hero',
      h('h1.wordmark.wordmark--plain', { text: 'Sevens' }),
      h('p.lede.center', { text: game.tagline })
    ),
    // The house name is what the tile says, so this is the one place the game's
    // other names appear — enough for somebody who already knows it to
    // recognise it.
    h('p.muted.center', { style: { 'font-size': '14px' }, text: game.blurb }),
    h('div.spacer'),
    h(
      'div.stack.stack--tight',
      action('Start a game', () => ctx.go('create')),
      action('Join a game', () => ctx.go('join'), { kind: 'ghost' }),
      // The third honest answer to "who are you playing with?", so it sits with
      // the other two rather than below the fold as a footnote. It asks nothing:
      // three bots are already sat down by the time the lobby appears.
      action('On your own', () => ctx.playSevensSolo(), { kind: 'ghost' })
    ),
    h('div.spacer'),
    h('p.muted.center', {
      style: { 'font-size': '14px' },
      text:
        'The whole deck goes out. Whoever has the seven of diamonds starts, ' +
        'and every suit builds out from its seven — up to the king, down to the ace.',
    }),
    sizeControl(ctx)
  );
}

/** Name, and nothing else. Sevens has no settings worth a screen. */
function createView(ctx) {
  const nameInput = h('input.input', {
    type: 'text',
    value: ctx.ui.name || '',
    placeholder: 'Your name',
    maxlength: '16',
    autocomplete: 'nickname',
    enterkeyhint: 'go',
    'aria-label': 'Your name',
    'data-focus-key': 'sv-name',
    onInput: (event) => {
      ctx.ui.name = event.target.value;
    },
  });

  const submit = async () => {
    const name = (ctx.ui.name || '').trim();
    if (!name) {
      ctx.toast('Pop your name in first.');
      nameInput.focus();
      return;
    }
    await ctx.createSevens(name);
  };

  return shell(
    h(
      'div.topbar',
      h('button.btn.btn--link', {
        text: '‹ Back',
        type: 'button',
        style: { 'text-decoration': 'none', 'min-height': '44px' },
        onClick: () => ctx.go('home'),
      }),
      h('div.topbar__title', { text: 'New game' })
    ),
    h('div.stack', h('div.field', h('span.eyebrow', { text: 'Who are you?' }), nameInput)),
    h('div.spacer'),
    h('p.muted.center', {
      style: { 'font-size': '14px' },
      text: 'Three to eight players. One deck, dealt out to the last card.',
    }),
    h('div.spacer'),
    action('Create game', submit)
  );
}
