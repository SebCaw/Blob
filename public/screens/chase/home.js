import { h } from '../../ui.js';
import { action } from '../common.js';
import { sizeControl } from '../../size.js';
import { gameById } from '../../games.js';

/**
 * Chase the Ace's front page.
 *
 * The same shape as Silly Head's and Sevens': the game deals, so there is
 * nothing to ask before it starts. Joining is the shared screen in
 * `screens/welcome.js` — a code and a name is the same job whatever is played.
 */

export function chaseWelcome(ctx) {
  return ctx.ui.route === 'create' ? createView(ctx) : homeView(ctx);
}

function shell(...children) {
  return h('div.screen.screen--scroll', ...children);
}

function homeView(ctx) {
  const game = gameById('chase');
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
      h('h1.wordmark.wordmark--plain', { text: 'Chase the Ace' }),
      h('p.lede.center', { text: game.tagline })
    ),
    h('p.muted.center', { style: { 'font-size': '14px' }, text: game.blurb }),
    h('div.spacer'),
    h(
      'div.stack.stack--tight',
      action('Start a game', () => ctx.go('create')),
      action('Join a game', () => ctx.go('join'), { kind: 'ghost' }),
      action('On your own', () => ctx.playChaseSolo(), { kind: 'ghost' })
    ),
    h('div.spacer'),
    h('p.muted.center', {
      style: { 'font-size': '14px' },
      text:
        'Every ace but one is taken out, so one card cannot pair. Bin your pairs, ' +
        'take a card from the player on your right, and do not be the one left holding it.',
    }),
    sizeControl(ctx)
  );
}

/** Name, and how big a game. */
function createView(ctx) {
  const two = Boolean(ctx.ui.chaseTwoDecks);
  const nameInput = h('input.input', {
    type: 'text',
    value: ctx.ui.name || '',
    placeholder: 'Your name',
    maxlength: '16',
    autocomplete: 'nickname',
    enterkeyhint: 'go',
    'aria-label': 'Your name',
    'data-focus-key': 'ca-name',
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
    await ctx.createChase(name, Boolean(ctx.ui.chaseTwoDecks));
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
    h(
      'div.stack',
      h('div.field', h('span.eyebrow', { text: 'Who are you?' }), nameInput),
      h(
        'div.field',
        h('span.eyebrow', { text: 'How many of you?' }),
        h(
          'div.stack.stack--tight',
          deckCard(ctx, {
            title: 'One deck',
            blurb: 'Forty-nine cards, four to eight players.',
            on: !two,
            onClick: () => {
              ctx.ui.chaseTwoDecks = false;
              ctx.render();
            },
          }),
          deckCard(ctx, {
            title: 'Two decks',
            blurb: 'Ninety-seven cards, up to twelve. A longer game.',
            on: two,
            onClick: () => {
              ctx.ui.chaseTwoDecks = true;
              ctx.render();
            },
          })
        )
      )
    ),
    h('div.spacer'),
    action('Create game', submit)
  );
}

function deckCard(ctx, { title, blurb, on, onClick }) {
  return h(
    'button',
    {
      className: `mode-card${on ? '' : ' mode-card--quiet'}`,
      type: 'button',
      'aria-pressed': on ? 'true' : 'false',
      onClick,
    },
    h('span.mode-card__title', { text: title }),
    h('span.mode-card__blurb', { text: blurb })
  );
}
