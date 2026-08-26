import { h } from '../../ui.js';
import { action } from '../common.js';
import { sizeControl } from '../../size.js';
import { gameById } from '../../games.js';

/**
 * Go Fish's front page.
 *
 * The same shape as the other five, and it asks for nothing but a name. There
 * is nothing to choose: one deck, and how many cards you start with follows from
 * how many people turn up. A game with no settings should not grow a settings
 * screen out of politeness.
 */

export function gofishWelcome(ctx) {
  return ctx.ui.route === 'create' ? createView(ctx) : homeView(ctx);
}

function shell(...children) {
  return h('div.screen.screen--scroll', ...children);
}

function homeView(ctx) {
  const game = gameById('gofish');
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
      h('h1.wordmark.wordmark--plain', { text: 'Go Fish' }),
      h('p.lede.center', { text: game.tagline })
    ),
    h('p.muted.center', { style: { 'font-size': '14px' }, text: game.blurb }),
    h('div.spacer'),
    h(
      'div.stack.stack--tight',
      action('Start a game', () => ctx.go('create')),
      action('Join a game', () => ctx.go('join'), { kind: 'ghost' }),
      action('On your own', () => ctx.playGoFishSolo(), { kind: 'ghost' })
    ),
    h('div.spacer'),
    h('p.muted.center', {
      style: { 'font-size': '14px' },
      text:
        'Ask somebody for a rank you are already holding. Hit, and you go again. ' +
        'Miss, and you go fish. Collect four of a kind and put them down.',
    }),
    sizeControl(ctx)
  );
}

function createView(ctx) {
  const nameInput = h('input.input', {
    type: 'text',
    value: ctx.ui.name || '',
    placeholder: 'Your name',
    maxlength: '16',
    autocomplete: 'nickname',
    enterkeyhint: 'go',
    'aria-label': 'Your name',
    'data-focus-key': 'gf-name',
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
    await ctx.createGoFish(name);
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
    h('p.muted.center', {
      style: { 'font-size': '14px' },
      text: 'Three to six of you. Seven cards each at three, five at four or more.',
    }),
    h('div.spacer'),
    action('Create game', submit)
  );
}
