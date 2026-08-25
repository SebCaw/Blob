import { h } from '../ui.js';
import { cardFace } from '../cards.js';

/**
 * How to play Sevens, in pictures and in answers.
 *
 * Same two shapes as Blob's and Silly Head's — a set of steps and a lookup table
 * of questions — so `help.js` can show any of them without knowing anything
 * about any of them. Only the words are here.
 *
 * Short, because Sevens is short. There are three rules and the third is a
 * consequence of the first two, so anybody padding this out to ten steps would
 * be inventing difficulty that is not in the game. The one thing genuinely
 * worth saying twice is that the ace is LOW here, because everywhere else in
 * this app it is not.
 */

const C = (face) => `${face}#1`;

export const STEPS = [
  {
    title: 'Get rid of all your cards',
    body: 'No score, no tricks. The whole deck goes out, and the first person to play their last card wins. The one still holding cards at the end gets the spoon.',
    art: () =>
      h(
        'div.help-art.help-art--trick',
        cardFace(C('7D'), { size: 'md', className: 'help-card', index: 0 }),
        cardFace(C('8D'), { size: 'md', className: 'help-card', index: 1 }),
        cardFace(C('6D'), { size: 'md', className: 'help-card', index: 2 }),
        h('span.help-note', { text: 'First one out wins.' })
      ),
  },
  {
    title: 'The sevens open the suits',
    body: 'Nothing can be played in a suit until its seven is down. Four sevens, four suits — and the seven of diamonds always goes first, so whoever is dealt it starts the game.',
    art: () =>
      h(
        'div.help-art.help-art--trick',
        cardFace(C('7D'), { size: 'lg', className: 'help-card', index: 0 }),
        h('span.help-note', { text: 'Whoever has this one leads.' })
      ),
  },
  {
    title: 'Then build outwards, both ways',
    body: 'Once a seven is down, that suit grows in both directions at once — eight, nine, ten up towards the king, and six, five, four down towards the ace. You can play at either end.',
    art: () =>
      h(
        'div.help-art.help-art--trick',
        cardFace(C('5S'), { size: 'sm', className: 'help-card', index: 0 }),
        cardFace(C('6S'), { size: 'sm', className: 'help-card', index: 1 }),
        cardFace(C('7S'), { size: 'md', className: 'help-card', index: 2 }),
        cardFace(C('8S'), { size: 'sm', className: 'help-card', index: 3 }),
        h('span.help-note', { text: 'The seven sits in the middle.' })
      ),
  },
  {
    title: 'The ace is low',
    body: 'In this game an ace is worth one, not eleven — so a suit runs from the ace at the bottom to the king at the top. It is the only game here that counts it that way.',
    art: () =>
      h(
        'div.help-art.help-art--trick',
        cardFace(C('AH'), { size: 'md', className: 'help-card', index: 0 }),
        cardFace(C('2H'), { size: 'md', className: 'help-card', index: 1 }),
        h('span.help-note', { text: 'Ace, then two. Not above the king.' })
      ),
  },
  {
    title: 'You must play if you can',
    body: 'If any of your cards fits, you have to put one down — you cannot sit on a card to block somebody. Only when nothing fits do you pass, and the app tells you when that is.',
    art: () =>
      h(
        'div.help-art.help-art--trick',
        cardFace(C('4C'), { size: 'md', className: 'help-card', index: 0, state: 'playable' }),
        cardFace(C('KH'), { size: 'md', className: 'help-card', index: 1 }),
        h('span.help-note', { text: 'The lit one is the one you can play.' })
      ),
  },
];

export const ANSWERS = [
  {
    ask: 'How do I win?',
    words: ['win', 'winning', 'point', 'points', 'score', 'scoring', 'how do i win'],
    reply:
      'There is no score. The first person to play their last card wins, and the last one still holding cards gets ' +
      'the wooden spoon. That is the whole game.',
  },
  {
    ask: 'Why can I not play anything?',
    words: ['cannot', 'stuck', 'nothing', 'pass', 'passing', 'blocked', 'why can'],
    reply:
      'Either the suit has not been opened yet — its seven is still in somebody hand — or your card is not next in ' +
      'line at either end. Tap any card and it will tell you what its suit is waiting for. If truly nothing fits, ' +
      'a Pass button appears.',
  },
  {
    ask: 'Which card starts the game?',
    words: ['start', 'starts', 'first', 'begin', 'lead', 'who goes first', 'seven of diamonds'],
    reply:
      'The seven of diamonds. Whoever is dealt it plays it, and then it goes round to the left. That is why nobody ' +
      'has to decide who starts.',
  },
  {
    ask: 'Is the ace high or low?',
    words: ['ace', 'aces', 'high', 'low', 'king'],
    reply:
      'Low. An ace is worth one here, so a suit runs ace, two, three all the way up to the king. It is the only ' +
      'game on this app that counts it that way, so it catches people out.',
  },
  {
    ask: 'Do I have to play?',
    words: ['have to', 'must', 'block', 'blocking', 'hold', 'save', 'keep'],
    reply:
      'Yes. If you have a card that fits you must put it down — you cannot hold one back to stop somebody else. ' +
      'You only pass when nothing at all will go.',
  },
  {
    ask: 'How many can play?',
    words: ['how many', 'players', 'people', 'minimum', 'maximum'],
    reply:
      'Three to eight. The whole deck is dealt out however many of you there are, so with an odd number some people ' +
      'get one more card than others. That is normal.',
  },
];

export const SUGGESTED = [0, 1, 3, 4];
