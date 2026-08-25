import { h } from '../ui.js';
import { cardFace, cardBack } from '../cards.js';

/**
 * How to play Chase the Ace, in pictures and in answers.
 *
 * Same two shapes as the other three, so `help.js` can show any of them without
 * knowing anything about any of them.
 *
 * The rules take about thirty seconds to explain and the app cannot help with
 * the hard part, which is reading a face. So the steps say what the buttons do
 * and then get out of the way — the two worth dwelling on are that you throw
 * your own pairs away rather than the app doing it, and that arranging your
 * hand is something everybody can see.
 */

const C = (face) => `${face}#1`;

export const STEPS = [
  {
    title: 'One card cannot pair',
    body: 'Every ace but one is taken out of the deck before it is dealt. So everything pairs up except that single ace — and whoever is left holding it at the end has chased it.',
    art: () =>
      h(
        'div.help-art.help-art--trick',
        cardFace(C('AS'), { size: 'lg', className: 'help-card', index: 0 }),
        h('span.help-note', { text: 'Nothing matches this one.' })
      ),
  },
  {
    title: 'Throw your pairs away',
    body: 'Tap two cards of the same number and they go in the middle. Do it as soon as you spot one — you cannot take a card from anybody while you are still holding a pair.',
    art: () =>
      h(
        'div.help-art.help-art--trick',
        cardFace(C('9H'), { size: 'md', className: 'help-card', index: 0 }),
        cardFace(C('9C'), { size: 'md', className: 'help-card', index: 1 }),
        h('span.help-note', { text: 'Same number. Suits do not matter.' })
      ),
  },
  {
    title: 'Take one from your right',
    body: 'On your turn you take a card from the player on your right. They are face down — you are choosing a position, not a card. If it pairs with something you hold, throw them both away.',
    art: () =>
      h(
        'div.help-art.help-art--trick',
        cardBack({ size: 'md', className: 'help-card' }),
        cardBack({ size: 'md', className: 'help-card' }),
        cardBack({ size: 'md', className: 'help-card' }),
        h('span.help-note', { text: 'You pick a slot and hope.' })
      ),
  },
  {
    title: 'Move your cards about',
    body: 'Tap one of your own cards to lift it, then tap where it should go. Everybody watches you do it — that is the point. Move the ace and they may avoid it, or they may think you are bluffing.',
    art: () =>
      h(
        'div.help-art.help-art--trick',
        cardFace(C('AS'), { size: 'md', className: 'help-card', index: 0, state: 'playable' }),
        cardFace(C('4D'), { size: 'md', className: 'help-card', index: 1 }),
        cardFace(C('JC'), { size: 'md', className: 'help-card', index: 2 }),
        h('span.help-note', { text: 'They saw that.' })
      ),
  },
  {
    title: 'Or shuffle, and give nothing away',
    body: 'The Shuffle button scrambles your hand so nobody can follow anything. It is the safe move — but a shuffle can never talk anybody into picking wrong, and sometimes that is what you want.',
    art: () =>
      h(
        'div.help-art.help-art--trick',
        cardBack({ size: 'sm', className: 'help-card' }),
        cardBack({ size: 'sm', className: 'help-card' }),
        cardBack({ size: 'sm', className: 'help-card' }),
        cardBack({ size: 'sm', className: 'help-card' }),
        h('span.help-note', { text: 'Now nobody knows, including them.' })
      ),
  },
  {
    title: 'Empty your hand and you are safe',
    body: 'The moment your last card goes you are out and cannot lose. Play carries on without you until one person is left, holding the ace.',
    art: () =>
      h(
        'div.help-art.help-art--trick',
        cardFace(C('AS'), { size: 'lg', className: 'help-card', index: 0 }),
        h('span.help-note', { text: 'Last one holding it.' })
      ),
  },
];

export const ANSWERS = [
  {
    ask: 'How do I win?',
    words: ['win', 'winning', 'point', 'points', 'score', 'scoring', 'how do i win'],
    reply:
      'There is no score. Get rid of all your cards and you are out and safe. The last person still holding cards ' +
      'has the odd ace, and they are the one who chased it.',
  },
  {
    ask: 'Why can I not take a card?',
    words: ['cannot', 'stuck', 'take', 'draw', 'blocked', 'why can', 'refused'],
    reply:
      'Almost always because you are still holding a pair. Throw it away first — tap the two matching cards and ' +
      'they go in the middle. Otherwise it is simply not your turn yet.',
  },
  {
    ask: 'What counts as a pair?',
    words: ['pair', 'pairs', 'match', 'matching', 'same', 'suit', 'colour', 'color'],
    reply:
      'Two cards of the same number. Suits and colours do not come into it — a nine of hearts and a nine of clubs ' +
      'are a pair. If you hold three of a number, two go and one stays.',
  },
  {
    ask: 'Can people see me moving my cards?',
    words: ['see', 'watch', 'move', 'moving', 'rearrange', 'arrange', 'hide', 'hidden'],
    reply:
      'Yes, and that is deliberate. They see which slot moved where, but never what the card was. That is the whole ' +
      'game: move the ace and they might avoid it, or they might decide you want them to think that.',
  },
  {
    ask: 'What does Shuffle do?',
    words: ['shuffle', 'scramble', 'random', 'button'],
    reply:
      'It puts your hand in a random order, so anything anybody had worked out about it is gone. It is the safe ' +
      'move. The cost is that a shuffle cannot fool anybody either — moving one card on purpose can.',
  },
  {
    ask: 'Where does the card I took go?',
    words: ['where', 'went', 'goes', 'took', 'slot', 'position', 'landed'],
    reply:
      'Somewhere random in your hand, chosen by the server. That is on purpose — if it always landed on the end, ' +
      'everybody would know exactly where your newest card was.',
  },
  {
    ask: 'How many can play?',
    words: ['how many', 'players', 'people', 'minimum', 'maximum', 'decks', 'deck'],
    reply:
      'Four to eight with one deck, or four to twelve with two. The Master picks in the lobby. Either way there is ' +
      'exactly one ace in the pack.',
  },
];

export const SUGGESTED = [0, 1, 3, 4];
