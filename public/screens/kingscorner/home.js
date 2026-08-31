import { h } from '../../ui.js';
import { action } from '../common.js';
import { sizeControl } from '../../size.js';
import { gameById } from '../../games.js';

/**
 * Kings Corner's front page.
 *
 * The same shape as the other six, and it asks for nothing but a name. There is
 * one deck, seven cards each and no variant — a game with no settings should not
 * grow a settings screen out of politeness.
 */

export function kingscornerWelcome(ctx) {
  return ctx.ui.route === 'create' ? createView(ctx) : homeView(ctx);
}

function shell(...children) {
  return h('div.screen.screen--scroll', ...children);
}

function homeView(ctx) {
  const game = gameById('kingscorner');
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
      h('h1.wordmark.wordmark--plain', { text: 'Kings Corner' }),
      h('p.lede.center', { text: game.tagline })
    ),
    h('p.muted.center', { style: { 'font-size': '14px' }, text: game.blurb }),
    h('div.spacer'),
    h(
      'div.stack.home-actions',
      action('Start a game', () => ctx.go('create')),
      action('Join a game', () => ctx.go('join'), { kind: 'ghost' }),
      action('On your own', () => ctx.playKingsCornerSolo(), { kind: 'ghost' })
    ),
    h('div.spacer'),
    h('p.muted.center', {
      style: { 'font-size': '14px' },
      text:
        'Put cards down in the middle, each one a rank lower and the other colour. ' +
        'Only a king opens a corner. Play nothing on your turn and you pick one up.',
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
    'data-focus-key': 'kc-name',
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
    await ctx.createKingsCorner(name);
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
      // Six is allowed and four is the game. Saying so here rather than in the
      // lobby, because the number of people is decided before anybody opens
      // the app.
      text: 'Two to six of you, seven cards each. Four is the one to aim for.',
    }),
    h('div.spacer'),
    action('Create game', submit)
  );
}
