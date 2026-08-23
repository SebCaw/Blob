import { h } from '../ui.js';
import { cardFace, cardBack } from '../cards.js';

/**
 * How to play Silly Head, in pictures and in answers.
 *
 * Same two shapes as Blob's — a set of steps and a lookup table of questions —
 * so `help.js` can show either without knowing anything about either game. Only
 * the words are here.
 *
 * Longer than Blob's on purpose. Blob is one idea (say a number, win exactly
 * that many) and everything else follows from it. Silly Head is a handful of
 * separate rules that do not follow from each other at all — three sets of
 * cards, a sort before you start, three cards that break the ordering, and a
 * run of four that clears the lot — and somebody meeting it for the first time
 * has to be told each one. Ten short steps beat five that try to carry two
 * rules each.
 *
 * The words are deliberately small, for the same reason Blob's are: whoever is
 * being taught this is often a child at a kitchen table. And the house name is
 * the one used throughout — nobody learning the game needs to hear the other.
 */

const C = (face) => `${face}#1`;

export const STEPS = [
  {
    title: 'Get rid of all your cards',
    body: 'There is no score to keep. Shed everything and you are out. The last person still holding cards is the Silly Head.',
    art: () =>
      h(
        'div.help-art.help-art--trick',
        cardFace(C('7S'), { size: 'md', className: 'help-card', index: 0 }),
        cardFace(C('QH'), { size: 'md', className: 'help-card', index: 1 }),
        cardFace(C('AD'), { size: 'md', className: 'help-card', index: 2 }),
        h('span.help-note', { text: 'First one out wins.' })
      ),
  },
  {
    title: 'Nine cards each',
    body: 'Three face down, three face up on top of them, and three in your hand. You never see the bottom three until you turn them over.',
    art: () =>
      h(
        'div.help-art.help-art--follow',
        h(
          'div.help-hand',
          cardBack({ size: 'md', className: 'help-card' }),
          cardFace(C('KS'), { size: 'md', className: 'help-card' }),
          cardFace(C('4H'), { size: 'md', className: 'help-card' })
        ),
        h('span.help-note', { text: 'The hidden one sits underneath.' })
      ),
  },
  {
    title: 'Sort them out before you start',
    body: 'Everybody does this at the same time, so nobody is waiting. Tap a card, then tap a pile to move it.',
    art: () =>
      h(
        'div.help-art.help-art--say',
        h('span.help-bubble', { text: 'Tap, then tap' }),
        cardFace(C('9H'), { size: 'lg', className: 'help-turned' })
      ),
  },
  {
    title: 'Bin your 3s, stack your pairs',
    body: 'A 3 is the worst card there is, so get rid of it now. Two the same? Stack them, and you get another card out of the deck.',
    art: () =>
      h(
        'div.help-art.help-art--follow',
        h(
          'div.help-hand',
          cardFace(C('5S'), { size: 'md', state: 'playable', className: 'help-card' }),
          cardFace(C('5H'), { size: 'md', state: 'playable', className: 'help-card' }),
          cardFace(C('3D'), { size: 'md', state: 'blocked', className: 'help-card' })
        ),
        h('span.help-note', { text: 'Keep your best three showing.' })
      ),
  },
  {
    title: 'Equal or higher',
    body: 'Play a card the same as the one on the pile, or bigger. Ace is the biggest. You do not have to go one up — jump as high as you like.',
    art: () =>
      h(
        'div.help-art.help-art--follow',
        h('span.help-led', { text: '7 on the pile' }),
        h(
          'div.help-hand',
          cardFace(C('7C'), { size: 'md', state: 'playable', className: 'help-card' }),
          cardFace(C('KD'), { size: 'md', state: 'playable', className: 'help-card' }),
          cardFace(C('4S'), { size: 'md', state: 'blocked', className: 'help-card' })
        ),
        h('span.help-note', { text: 'The 4 is too small. It stays put.' })
      ),
  },
  {
    title: 'Same number? Put them all down',
    body: 'Two 6s, three 6s — they can go together as one go. While the deck is still dealing you cards, that is free.',
    art: () =>
      h(
        'div.help-art.help-art--trick',
        cardFace(C('6S'), { size: 'md', className: 'help-card', index: 0 }),
        cardFace(C('6H'), { size: 'md', className: 'help-card', index: 1 }),
        cardFace(C('6D'), { size: 'md', className: 'help-card', index: 2 }),
        h('span.help-note', { text: 'Blob asks how many when you have a choice.' })
      ),
  },
  {
    title: 'Three cards break the rules',
    body: 'A 2 goes on anything and starts the pile again. A 10 goes on anything and sacks it — gone for good — and you go again. After a 9, the next card must be a 9 or lower.',
    art: () =>
      h(
        'div.help-art.help-art--trick',
        cardFace(C('2H'), { size: 'md', className: 'help-card', index: 0 }),
        cardFace(C('10S'), { size: 'md', className: 'help-card', index: 1, ring: 'win' }),
        cardFace(C('9D'), { size: 'md', className: 'help-card', index: 2 }),
        h('span.help-note', { text: 'Save the 2s and 10s. You will want them.' })
      ),
  },
  {
    title: 'Four in a row sacks it too',
    body: 'Four of the same number on top of each other, however they got there — one person or four — and the whole pile leaves the game. Whoever put the fourth one down goes again.',
    art: () =>
      h(
        'div.help-art.help-art--trick',
        cardFace(C('4S'), { size: 'md', className: 'help-card', index: 0 }),
        cardFace(C('4H'), { size: 'md', className: 'help-card', index: 1 }),
        cardFace(C('4D'), { size: 'md', className: 'help-card', index: 2 }),
        cardFace(C('4C'), { size: 'md', className: 'help-card', index: 3, ring: 'win' }),
        h('span.help-note', { text: 'Never more than four of a number.' })
      ),
  },
  {
    title: 'Cannot go? Take the pile',
    body: 'Nothing you can play means the whole pile comes into your hand. It is not losing, it is just a bigger hand. You can take it on purpose too, if it is worth having.',
    art: () =>
      h(
        'div.help-art.help-art--say',
        h('span.help-bubble', { text: 'All of it?' }),
        cardFace(C('KH'), { size: 'lg', className: 'help-turned' })
      ),
  },
  {
    title: 'Then the table, then the dark',
    body: 'Once the deck has run out and your hand is empty, play your three face-up cards. After those, turn the bottom three over one at a time and hope.',
    art: () =>
      h(
        'div.help-art.help-art--follow',
        h(
          'div.help-hand',
          cardBack({ size: 'md', className: 'help-card' }),
          cardBack({ size: 'md', className: 'help-card' }),
          cardBack({ size: 'md', className: 'help-card' })
        ),
        h('span.help-note', { text: 'If it does not beat the pile, you take the lot.' })
      ),
  },
];

export const ANSWERS = [
  {
    ask: 'How do I win?',
    words: ['win', 'winning', 'point', 'points', 'score', 'scoring', 'how do i win'],
    reply:
      'There is no score. The first person to get rid of every card wins, and the last one still holding cards is ' +
      'the Silly Head. That is the whole game.',
  },
  {
    ask: 'What do the special cards do?',
    words: ['special', 'two', 'ten', 'nine', 'magic', 'wild', 'what do the'],
    reply:
      'A 2 goes on anything and resets the pile, so the next player can play anything. A 10 goes on anything and ' +
      'sacks the pile — gone for good — and you go again. After a 9, the next card has to be a 9 or lower, though a ' +
      '2 or a 10 still goes.',
  },
  {
    ask: 'What sacks the pile?',
    words: ['sack', 'sacked', 'burn', 'burnt', 'gets rid', 'clear', 'disappear'],
    reply:
      'A 10, or four of the same number in a row — whether one person lays all four or four people lay one each. ' +
      'The pile leaves the game and whoever finished it goes again on a clean slate.',
  },
  {
    ask: 'Can I play more than one card?',
    words: ['more than one', 'two cards', 'multiple', 'several', 'at once', 'how many'],
    reply:
      'Yes, as long as they are the same number. Tap the card and Blob asks how many you want to put down. Never ' +
      'more than four of a number, because the fourth one sacks the pile anyway.',
  },
  {
    ask: 'Why can I not play anything?',
    words: ['cannot play', 'can not play', 'nothing', 'stuck', 'blocked', 'greyed', 'refused', 'why can'],
    reply:
      'Your card has to match or beat the one on the pile, and after a 9 it has to be a 9 or lower. If nothing ' +
      'works, take the pile — tap it in the middle. Blob lifts up the cards you are allowed to play, so if none of ' +
      'them lift, there are none.',
  },
  {
    ask: 'What happens when I take the pile?',
    words: ['take the pile', 'pick up', 'picked up', 'pick it up', 'happens when'],
    reply:
      'Every card in the middle goes into your hand and your turn ends. The player on your left then starts a fresh ' +
      'pile with anything they like. Taking it is normal — a big hand early on is much less trouble than being ' +
      'stuck at the end.',
  },
  {
    ask: 'What is the sorting bit at the start?',
    words: ['sort', 'sorting', 'start', 'stack', 'pair', 'swap', 'bin', 'beginning'],
    reply:
      'Before anyone plays, everybody tidies their own table at the same time. Bin any 3s — they start the pile in ' +
      'the middle — and stack pairs to pull more cards out of the deck, so you can leave better cards face up. Tap ' +
      'a card, then tap a pile. Any pairs still stacked come back to your hand when you say you are ready.',
  },
  {
    ask: 'Which cards should I leave face up?',
    words: ['leave face up', 'best cards', 'which cards', 'strategy', 'tips', 'tactics', 'good cards'],
    reply:
      'High ones. Your face-up three are played last, against a pile that could be anything, so a king does more ' +
      'good there than a 4. Most people keep their 2s and 10s in their hand instead, where they can reach for one ' +
      'the moment they are stuck.',
  },
  {
    ask: 'When do I use my face-up cards?',
    words: ['when do i use', 'face up', 'face-up', 'table', 'my three', 'after my hand'],
    reply:
      'Only once the deck has run out AND your hand is empty. If you get stuck on them you take the pile plus one ' +
      'of your face-up cards, and play from your hand again until it empties.',
  },
  {
    ask: 'What about the face-down ones?',
    words: ['face down', 'face-down', 'bottom', 'hidden', 'flip', 'turn over', 'last three', 'dark'],
    reply:
      'They are last, and nobody knows what they are — not even you. On your turn you turn one over. If it beats ' +
      'the pile it is played. If it does not, you pick it up along with the pile.',
  },
  {
    ask: 'Who goes first?',
    words: ['who goes first', 'first', 'who starts', 'start the game', 'lead'],
    reply:
      'Blob picks somebody at random once everybody has finished sorting. After that it goes round the table, and ' +
      'whoever took the pile last hands the lead to the player on their left.',
  },
  {
    ask: 'Can I play against the computer?',
    words: ['bot', 'bots', 'computer', 'robot', 'ai', 'on my own', 'alone', 'by myself', 'against the'],
    reply:
      'Yes. Whoever made the game can add bots in the lobby, from Easy up to Impossible, or you can tap "On your ' +
      'own" on the front page for a game against three of them. They get nine cards like everybody else, sort ' +
      'their own table, and only see what you see — no peeking at your hand, and none at their own face-down cards ' +
      'either.',
  },
  {
    ask: 'How many decks are we playing with?',
    words: ['deck', 'decks', 'how many cards', 'quick', 'standard', 'duplicate', 'same card twice'],
    reply:
      'Two decks normally, and another for every four extra players — so up to sixteen can play. A quick game is ' +
      'one deck and seats four. Two decks means the same card turns up twice, and that is fine.',
  },
  {
    ask: 'When do I pick a card up from the deck?',
    words: ['pick up from the deck', 'draw', 'drawing', 'replace', 'top up', 'refill'],
    reply:
      'Automatically, after your turn, until you are back to three — but only while there are cards left in the ' +
      'deck. More than three in your hand is fine; you just will not draw again until you are under three.',
  },
];

/** The questions offered as taps, so nobody has to think of one. */
export const SUGGESTED = [0, 1, 4, 6];
