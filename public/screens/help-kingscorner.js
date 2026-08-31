import { h } from '../ui.js';
import { cardFace, cardBack } from '../cards.js';

/**
 * How to play Kings Corner, in pictures and in answers.
 *
 * The same two shapes as the other six, so `help.js` can show any of them
 * without knowing anything about any of them.
 *
 * Two things to write against. Most people meeting this game have played some
 * patience, so they arrive already knowing "down in alternating colours" and do
 * NOT need it explained slowly — what they need is the three things that are
 * peculiar to it: only a king opens a corner, whole piles move, and you pick up
 * only when you played nothing. The last of those is the house rule and it is
 * the one that changes how the game feels, so it gets a step of its own.
 */

export const STEPS = [
  {
    title: 'Build down, and change colour',
    body:
      'Every pile in the middle runs downward a rank at a time, and each card has to be the opposite colour to ' +
      'the one it lands on. A red three goes on a black four. Aces are low, so a pile that reaches an ace is ' +
      'finished — nothing goes under it.',
    art: () =>
      h(
        'div.help-art.help-art--trick',
        cardFace('6S', { size: 'sm', className: 'help-card', index: 0 }),
        cardFace('5H', { size: 'sm', className: 'help-card', index: 1 }),
        cardFace('4C', { size: 'sm', className: 'help-card', index: 2 }),
        h('span.help-note', { text: 'Black, red, black. Down all the way.' })
      ),
  },
  {
    title: 'Only a king opens a corner',
    body:
      'The four corners start empty and stay empty until somebody has a king to put in one. Nothing else will ' +
      'go there, ever. Once a king is down the corner builds like any other pile, so a red queen goes under it ' +
      'and away it goes.',
    art: () =>
      h(
        'div.help-art.help-art--trick',
        cardFace('KS', { size: 'md', className: 'help-card', index: 0 }),
        cardFace('QH', { size: 'md', className: 'help-card', index: 1 }),
        h('span.help-note', { text: 'A king, then anything that follows it.' })
      ),
  },
  {
    title: 'You can move a whole pile',
    body:
      'If the card a pile STARTS with would fit on the bottom of another pile, the whole thing moves across in ' +
      'one go. You cannot split a pile or take a card back off one. This is the only way a slot ever empties — ' +
      'and an empty slot in the cross will take absolutely any card in your hand.',
    art: () =>
      h(
        'div.help-art.help-art--trick',
        cardFace('9H', { size: 'sm', className: 'help-card', index: 0 }),
        cardFace('8S', { size: 'sm', className: 'help-card', index: 1 }),
        cardFace('7H', { size: 'sm', className: 'help-card', index: 2 }),
        h('span.help-note', { text: 'The eight and everything under it, onto the nine.' })
      ),
  },
  {
    title: 'Play nothing and you pick one up',
    body:
      'Here is the one that catches people. You only take a card from the stock if nothing left your hand that ' +
      'turn — and the moment you take it, your turn is over. You do not get to play it, however well it fits. ' +
      'Put a card down and you draw nothing at all.',
    art: () =>
      h(
        'div.help-art.help-art--trick',
        cardBack({ size: 'md', className: 'help-card' }),
        h('span.help-note', { text: 'A penalty for a wasted turn, not a free card.' })
      ),
  },
  {
    title: 'First hand empty wins',
    body:
      'No score, no rounds. The moment somebody puts their last card down the game is over. Everybody else turns ' +
      'over what they were left holding, which is the only bragging rights on offer.',
    art: () =>
      h(
        'div.help-art.help-art--trick',
        cardFace('2D', { size: 'sm', className: 'help-card', index: 0 }),
        h('span.help-note', { text: 'That was the last one.' })
      ),
  },
];

export const ANSWERS = [
  {
    ask: 'How do I put a card down?',
    words: ['how do i', 'play', 'put down', 'my turn', 'turn', 'what do i do', 'tap'],
    reply:
      'Tap a card in your hand and the places it can go light up. Tap one of them and it lands. You can keep ' +
      'going as long as you have got moves — a turn is as many as you like, not just one.',
  },
  {
    ask: 'Why will that card not go anywhere?',
    words: ['cannot', 'not go', 'wont', 'refused', 'nothing lights', 'stuck', 'grey', 'blocked'],
    reply:
      'It needs the rank just above it, in the other colour, showing at the bottom of some pile. Press the card ' +
      'and it will tell you exactly what it is waiting for. A king is the awkward one — nothing is above a king, ' +
      'so it can only go in an empty corner or an empty slot in the cross.',
  },
  {
    ask: 'How do I move a whole pile?',
    words: ['move', 'pile', 'whole', 'shift', 'drag', 'slot', 'empty'],
    reply:
      'Tap the pile itself rather than a card in your hand. If it can go anywhere the piles it fits on will ' +
      'light up. Only piles with a small mark on them can be moved, and a pile can only land on another pile — ' +
      'never on an empty space.',
  },
  {
    ask: 'Why did I pick up a card?',
    words: ['pick up', 'picked', 'drew', 'draw', 'stock', 'deck', 'why did i'],
    reply:
      'Because you ended your turn without playing anything. That is the rule in this house: play a card and you ' +
      'draw nothing, play nothing and you take one. And the card you take cannot be played until your next go.',
  },
  {
    ask: 'The button says draw and pass. Can I just pass?',
    words: ['button', 'pass', 'draw and pass', 'end turn', 'skip'],
    reply:
      'It is the same button and it tells you what will happen. If you have played something it says end turn ' +
      'and nothing is drawn. If you have not, it draws you one first. Once the stock is empty it simply passes.',
  },
  {
    ask: 'Do I have to play if I can?',
    words: ['have to', 'must', 'forced', 'optional', 'hold', 'keep'],
    reply:
      'No. You can sit on a card that fits and nobody can make you put it down. It will cost you a pick-up, ' +
      'though, since you played nothing.',
  },
  {
    ask: 'What is the empty slot in the middle of the cross?',
    words: ['empty slot', 'any card', 'gap', 'space', 'hole', 'plus'],
    reply:
      'A slot somebody has emptied by moving a pile off it. It is the best thing on the board: it will take any ' +
      'card at all, so it is the only home a card with nowhere to go has got. Whoever gets there first has it.',
  },
  {
    ask: 'Why is that pile finished?',
    words: ['finished', 'ace', 'dead', 'nothing goes', 'stuck pile'],
    reply:
      'It has run down to an ace, and an ace is the lowest card in the pack — so nothing can go under it. The ' +
      'pile can still be moved somewhere else, which is often worth doing to free the slot.',
  },
  {
    ask: 'Can everybody see the middle?',
    words: ['see', 'hidden', 'secret', 'private', 'cheat', 'know'],
    reply:
      'Yes, all of it. Every card in every pile went down face up and stays face up. The only things nobody can ' +
      'see are what is in each hand and what is left face down in the stock.',
  },
  {
    ask: 'How does it end?',
    words: ['end', 'win', 'over', 'finish', 'wins', 'score', 'points'],
    reply:
      'The first person to get rid of every card wins, and that is that — no score and no rounds. If the stock ' +
      'runs out and the board locks up so nobody can move at all, it stops there and fewest cards left wins.',
  },
];

/** The four worth offering unprompted: the odd rules, not the obvious ones. */
export const SUGGESTED = [1, 2, 3, 6];
