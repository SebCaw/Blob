import { h } from '../ui.js';
import { mascot } from '../mascot.js';
import { cardFace, cardBack } from '../cards.js';

/**
 * How to play, one idea at a time.
 *
 * An overlay rather than a screen, for the same reason settings is: the moment
 * somebody needs the rules is usually the middle of a hand, and coming back to
 * exactly where you were matters more than the URL being tidy.
 *
 * Each step draws its own little picture with the real card components, so the
 * ace of spades you are shown here is the ace of spades you will be dealt. The
 * pictures animate on arrival because every step is built fresh — there is no
 * animation state to keep in step with anything.
 */

const STEPS = [
  {
    title: 'Say what you will win',
    body:
      'Every hand you say how many tricks you think you will take. Get it exactly right and you score. Take one too many and you get nothing — that is the blob.',
    art: () =>
      h(
        'div.help-art.help-art--say',
        h('span.help-bubble', { text: 'I will win 2' }),
        mascot('think', { size: 'lg' })
      ),
  },
  {
    title: 'The hands count down, then back up',
    body:
      'Start with seven cards each, then six, then five, all the way to one — and back up again. Thirteen hands in all, and the short ones are the hardest.',
    art: () => {
      const sizes = [7, 6, 5, 4, 3, 2, 1, 2, 3, 4, 5, 6, 7];
      return h(
        'div.help-art.help-art--rounds',
        sizes.map((size, index) =>
          h('span.help-pip', {
            style: { height: `${(size / 7) * 100}%`, '--i': String(index) },
            'aria-hidden': 'true',
          })
        )
      );
    },
  },
  {
    title: 'One suit is trumps',
    body:
      'After the deal, the next card off the deck is turned over. Whatever suit it is, that suit beats everything else for the whole hand.',
    art: (round) =>
      h(
        'div.help-art.help-art--trumps',
        h('div.help-deck', { 'aria-hidden': 'true' }, h('span'), h('span')),
        cardFace('9H', { size: 'lg', className: 'help-turned' }),
        h('span.trump.trump--red', h('span.trump__pip', { text: '♥' }), h('span', { text: 'TRUMPS' }))
      ),
  },
  {
    title: 'Everyone bids at once',
    body:
      'You choose your number in private and it is locked in. Nobody sees anybody else’s bid until all of them are in — so nobody can wait and see.',
    art: () =>
      h(
        'div.help-art.help-art--bids',
        ['?', '?', '?'].map((_, index) =>
          h('span.help-bid', { style: { '--i': String(index) } }, h('span.help-bid__face', { text: ['1', '0', '2'][index] }))
        )
      ),
  },
  {
    title: 'Follow the suit that was led',
    body:
      'If you have a card of the suit that was led, you must play one. Only when you have none of it can you play anything — including a trump.',
    art: () =>
      h(
        'div.help-art.help-art--follow',
        h('span.help-led', { text: '♠ led' }),
        h(
          'div.help-hand',
          cardFace('4S', { size: 'md', state: 'playable', className: 'help-card' }),
          cardFace('KS', { size: 'md', state: 'playable', className: 'help-card' }),
          cardFace('AH', { size: 'md', state: 'blocked', className: 'help-card' })
        ),
        h('span.help-note', { text: 'Blob lifts the cards you are allowed to play.' })
      ),
  },
  {
    title: 'Highest card takes the trick',
    body:
      'Highest of the suit led wins it — unless somebody played a trump, and then the highest trump wins. The winner leads the next one.',
    art: () =>
      h(
        'div.help-art.help-art--trick',
        cardFace('7S', { size: 'md', className: 'help-card', index: 0 }),
        cardFace('KS', { size: 'md', className: 'help-card', index: 1 }),
        cardFace('2H', { size: 'md', className: 'help-card help-card--winner', index: 2, ring: 'win', crown: true }),
        h('span.help-note', { text: 'The two of hearts wins it — hearts are trumps.' })
      ),
  },
  {
    title: 'Exactly right, or nothing',
    body:
      'Hit your bid and you score ten plus the tricks you won. Miss it by any amount, over or under, and you score nothing at all.',
    art: () =>
      h(
        'div.help-art.help-art--score',
        h(
          'div.help-score.help-score--made',
          h('span', { text: 'Bid 2 · won 2' }),
          h('span.help-score__points', { text: '+12' })
        ),
        h(
          'div.help-score.help-score--missed',
          h('span', { text: 'Bid 2 · won 3' }),
          h('span.help-score__points', { text: '0' })
        )
      ),
  },
  {
    title: 'And then there is one card each',
    body:
      'In the one-card hand you hold your card against your forehead: everybody can see it except you. Bid nought or one, and good luck.',
    art: () =>
      h(
        'div.help-art.help-art--forehead',
        h('div.help-seat', cardFace('9S', { size: 'md' }), h('span.help-note', { text: 'Them' })),
        h('div.help-seat', cardBack({ size: 'md', label: 'your card' }), h('span.help-note', { text: 'You' }))
      ),
  },
];

export function helpOverlay(ctx) {
  if (!ctx.ui.helpOpen) return null;

  const index = Math.min(Math.max(ctx.ui.helpStep || 0, 0), STEPS.length - 1);
  const step = STEPS[index];
  const first = index === 0;
  const last = index === STEPS.length - 1;

  const goTo = (next) => {
    ctx.ui.helpStep = next;
    ctx.render();
  };
  const close = () => {
    ctx.ui.helpOpen = false;
    ctx.ui.helpStep = 0;
    ctx.render();
  };

  return h(
    'div.help',
    { role: 'dialog', 'aria-modal': 'true', 'aria-label': 'How to play' },
    h(
      'div.help__panel',
      h(
        'div.help__head',
        h('span.help__eyebrow', { text: `How to play · ${index + 1} of ${STEPS.length}` }),
        h('button.icon-btn', { type: 'button', 'aria-label': 'Close', onClick: close }, h('span.icon-btn__glyph', { text: '✕' }))
      ),
      // Keyed on the step so the browser builds a new subtree each time and the
      // arrival animations run again, forwards or backwards.
      h('div.help__stage', { 'data-step': String(index) }, step.art()),
      h(
        'div.help__words',
        h('h2.help__title', { text: step.title }),
        h('p.help__body', { text: step.body })
      ),
      h(
        'div.help__dots',
        { 'aria-hidden': 'true' },
        STEPS.map((_, i) => h('span', { className: `help__dot${i === index ? ' help__dot--on' : ''}` }))
      ),
      h(
        'div.help__nav',
        h('button.btn.btn--ghost', {
          text: 'Back',
          type: 'button',
          disabled: first,
          onClick: () => goTo(index - 1),
        }),
        h('button.btn.btn--primary', {
          text: last ? 'Got it' : 'Next',
          type: 'button',
          onClick: () => (last ? close() : goTo(index + 1)),
        })
      )
    )
  );
}

/** The way in, from the front page and from settings. */
export function helpButton(ctx, options = {}) {
  return h('button', {
    className: options.kind === 'link' ? 'btn btn--link' : 'btn btn--ghost',
    text: 'How to play',
    type: 'button',
    onClick: () => {
      ctx.ui.helpOpen = true;
      ctx.ui.helpStep = 0;
      ctx.render();
    },
  });
}
