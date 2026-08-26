import { h } from '../../ui.js';
import { action } from '../common.js';
import { sizeControl } from '../../size.js';
import { gameById } from '../../games.js';

/**
 * Cheat's front page.
 *
 * The same shape as the other four, and one deliberate difference: it asks for
 * nothing but a name. Every other game with a setting asks for it here, because
 * the setting is a preference. Cheat's setting is the number of decks, and that
 * is not a preference — it depends on how many people actually turn up, and one
 * deck stops being legal at eight of them. Asking before anybody has arrived
 * would be asking a question nobody can answer yet, so it lives in the lobby.
 */

export function cheatWelcome(ctx) {
  return ctx.ui.route === 'create' ? createView(ctx) : homeView(ctx);
}

function shell(...children) {
  return h('div.screen.screen--scroll', ...children);
}

function homeView(ctx) {
  const game = gameById('cheat');
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
      h('h1.wordmark.wordmark--plain', { text: 'Cheat' }),
      h('p.lede.center', { text: game.tagline })
    ),
    h('p.muted.center', { style: { 'font-size': '14px' }, text: game.blurb }),
    h('div.spacer'),
    h(
      'div.stack.home-actions',
      action('Start a game', () => ctx.go('create')),
      action('Join a game', () => ctx.go('join'), { kind: 'ghost' }),
      action('On your own', () => ctx.playCheatSolo(), { kind: 'ghost' })
    ),
    h('div.spacer'),
    h('p.muted.center', {
      style: { 'font-size': '14px' },
      text:
        'Put cards face down and say what they are. You do not have to be telling the truth. ' +
        'Anybody can call it — and whoever is wrong picks up the lot.',
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
    'data-focus-key': 'ch-name',
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
    await ctx.createCheat(name);
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
      text: 'You can pick how many decks in the lobby, once you know how many of you there are.',
    }),
    h('div.spacer'),
    action('Create game', submit)
  );
}
