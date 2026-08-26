import { h } from '../../ui.js';
import { action } from '../common.js';
import { sizeControl } from '../../size.js';
import { gameById } from '../../games.js';

/**
 * Silly Head's front page, and the one form in front of it.
 *
 * Blob's front door asks "how are you playing?" because Blob has three honest
 * answers. Silly Head has one — it deals, because it has to: the whole game is
 * cards nobody else can see, and there is no score for a table version to keep.
 * So this page asks nothing and offers two doors, which is as few screens as
 * the game can be built with.
 *
 * Joining is the shared one in `screens/welcome.js`: a code and a name is the
 * same job whatever is being played.
 */

export function sillyheadWelcome(ctx) {
  return ctx.ui.route === 'create' ? createView(ctx) : homeView(ctx);
}

function shell(...children) {
  return h('div.screen.screen--scroll', ...children);
}

function homeView(ctx) {
  const game = gameById('sillyhead');
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
      h('h1.wordmark.wordmark--plain', { text: 'Silly Head' }),
      h('p.lede.center', { text: game.tagline })
    ),
    // The house name is what the tile says, so this is the one place the game's
    // other names appear — enough for somebody who already knows it to
    // recognise it, and nobody has to hear the original at the dinner table.
    h('p.muted.center', { style: { 'font-size': '14px' }, text: game.blurb }),
    h('div.spacer'),
    h(
      'div.stack.home-actions',
      action('Start a game', () => ctx.go('create')),
      action('Join a game', () => ctx.go('join'), { kind: 'ghost' }),
      // The third honest answer to "who are you playing with?", so it sits with
      // the other two rather than below the fold as a footnote. It asks
      // nothing: three bots are already sat down by the time the lobby appears.
      action('On your own', () => ctx.playSillyHeadSolo(), { kind: 'ghost' })
    ),
    h('div.spacer'),
    h('p.muted.center', {
      style: { 'font-size': '14px' },
      text: 'Everyone plays from their own phone. Nine cards each: three down, three up, three in your hand.',
    }),
    sizeControl(ctx)
  );
}

/**
 * Name, and one choice: how long a game you want.
 *
 * Standard is what the house plays. Quick is one deck, which seats four and
 * runs out sooner — that is the whole difference, so it is described as time
 * rather than as a number of decks, which is not what anybody is choosing.
 */
function createView(ctx) {
  const quick = Boolean(ctx.ui.shQuick);
  const nameInput = h('input.input', {
    type: 'text',
    value: ctx.ui.name || '',
    placeholder: 'Your name',
    maxlength: '16',
    autocomplete: 'nickname',
    enterkeyhint: 'go',
    'aria-label': 'Your name',
    'data-focus-key': 'sh-name',
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
    await ctx.createSillyHead(name, Boolean(ctx.ui.shQuick));
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
        h('span.eyebrow', { text: 'How long have you got?' }),
        h(
          'div.stack.stack--tight',
          lengthCard(ctx, {
            title: 'Standard',
            blurb: 'A deck for every four players, up to sixteen. The proper game.',
            on: !quick,
            onClick: () => {
              ctx.ui.shQuick = false;
              ctx.render();
            },
          }),
          lengthCard(ctx, {
            title: 'Quick',
            blurb: 'One deck, four players at most. Over sooner.',
            on: quick,
            onClick: () => {
              ctx.ui.shQuick = true;
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

function lengthCard(ctx, { title, blurb, on, onClick }) {
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
