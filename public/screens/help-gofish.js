import { h } from '../ui.js';
import { cardFace, cardBack } from '../cards.js';

/**
 * How to play Go Fish, in pictures and in answers.
 *
 * The same two shapes as the other five, so `help.js` can show any of them
 * without knowing anything about any of them.
 *
 * Everybody thinks they already know this game, which is the thing to write
 * against. Two of the rules here are not the ones people half-remember from
 * childhood — a hit lets you go again, and you may only ask for a rank you are
 * already holding — and the second one is what turns it from a children's game
 * into one worth an evening. So the steps spend their words on that rather than
 * on how to collect four of a kind.
 */

export const STEPS = [
  {
    title: 'Collect books of four',
    body: 'Four of a rank is a book. Put it down in front of you and that is a point. Most books when the game stops wins — there are thirteen in the pack.',
    art: () =>
      h(
        'div.help-art.help-art--trick',
        cardFace('7S', { size: 'sm', className: 'help-card', index: 0 }),
        cardFace('7H', { size: 'sm', className: 'help-card', index: 1 }),
        cardFace('7D', { size: 'sm', className: 'help-card', index: 2 }),
        cardFace('7C', { size: 'sm', className: 'help-card', index: 3 }),
        h('span.help-note', { text: 'That is one book.' })
      ),
  },
  {
    title: 'You can only ask for what you are holding',
    body: 'This is the whole game. Ask for sevens and you have just told everybody at the table that you are holding a seven. Every question you ask gives something away.',
    art: () =>
      h(
        'div.help-art.help-art--trick',
        cardFace('7S', { size: 'md', className: 'help-card', index: 0 }),
        h('span.help-note', { text: '"Ben, any sevens?" — and now they all know.' })
      ),
  },
  {
    title: 'A hit means you go again',
    body: 'They hand over every seven they have got, not one of them, and it is still your turn. A good run can go on for a while.',
    art: () =>
      h(
        'div.help-art.help-art--trick',
        cardFace('7H', { size: 'sm', className: 'help-card', index: 0 }),
        cardFace('7D', { size: 'sm', className: 'help-card', index: 1 }),
        h('span.help-note', { text: 'All of them, every time.' })
      ),
  },
  {
    title: 'A miss means go fish',
    body: 'Take one card from the pool and your turn is over. Nobody is told what you drew — not even if it is the very card you asked for.',
    art: () =>
      h(
        'div.help-art.help-art--trick',
        cardBack({ size: 'md', className: 'help-card' }),
        h('span.help-note', { text: 'Yours, and nobody else’s business.' })
      ),
  },
  {
    title: 'Listen to what everybody else asks for',
    body: 'Somebody asking for kings is holding a king. Somebody saying go fish to kings has none. The whole game is in the questions, and the app writes them down for you.',
    art: () =>
      h(
        'div.help-art.help-art--trick',
        h('span.help-note', { text: 'Ann → Ben: any kings?' }),
        h('span.help-note', { text: 'Ben: go fish' }),
        h('span.help-note', { text: 'So Ann has a king and Ben has not.' })
      ),
  },
  {
    title: 'Empty your hand and you are out',
    body: 'You keep every book you have already put down. The game stops when there is nobody left to ask, so a book or two usually never gets made.',
    art: () =>
      h(
        'div.help-art.help-art--trick',
        cardFace('KS', { size: 'sm', className: 'help-card', index: 0 }),
        cardFace('KH', { size: 'sm', className: 'help-card', index: 1 }),
        cardFace('KD', { size: 'sm', className: 'help-card', index: 2 }),
        cardFace('KC', { size: 'sm', className: 'help-card', index: 3 }),
        h('span.help-note', { text: 'Out with three books is a good afternoon.' })
      ),
  },
];

export const ANSWERS = [
  {
    ask: 'How do I ask somebody for a card?',
    words: ['ask', 'how do i', 'my turn', 'turn', 'what do i do', 'pick'],
    reply:
      'Tap any card in your hand — that picks the rank — then tap whoever you are asking. Two taps and the ' +
      'question is on the table for everybody to see.',
  },
  {
    ask: 'Why can I not ask for that rank?',
    words: ['cannot ask', 'not ask', 'grey', 'why can', 'refused', 'wont let'],
    reply:
      'You can only ask for a rank you are already holding. That is the rule the whole game hangs on: asking is ' +
      'how you tell everybody what is in your hand, and without it you could go fishing for information for free.',
  },
  {
    ask: 'They gave me cards and it is still my turn?',
    words: ['still my turn', 'go again', 'again', 'another go', 'keep going'],
    reply:
      'Yes. A hit buys you another question. Keep asking until somebody tells you to go fish, and then it moves on.',
  },
  {
    ask: 'I drew the exact card I asked for. Do I go again?',
    words: ['drew', 'drawn', 'lucky', 'fished', 'go fish', 'pool', 'show'],
    reply:
      'No, and nobody is told what you drew either. In this house you never show a card you fished — so going ' +
      'again would give it away, which is why fishing always ends your turn however lucky you got.',
  },
  {
    ask: 'Why do I have to press a button to say go fish?',
    words: ['button', 'press', 'why do i', 'hand over', 'answer', 'tap'],
    reply:
      'Because the second between the question and the answer is the game. If the app settled it the moment you ' +
      'were asked, nobody would ever look up. You have no choice about what the button says — you cannot lie in ' +
      'Go Fish — but the moment is yours.',
  },
  {
    ask: 'Somebody asked me for four cards I was about to book!',
    words: ['book', 'lay', 'put down', 'took my', 'too slow', 'four'],
    reply:
      'Then you were too slow, and that is the cost of laying books by hand. A book still in your hand can still ' +
      'be asked for. Put them down as soon as you have them.',
  },
  {
    ask: 'Why did the game stop before all thirteen books?',
    words: ['stopped', 'ended', 'thirteen', '13', 'books left', 'over', 'why did'],
    reply:
      'Because an empty hand puts you out and you do not draw back in. Once there is only one hand left at the ' +
      'table there is nobody to ask, so it stops — and whatever was still in the pool stays there.',
  },
  {
    ask: 'Can anybody see my cards?',
    words: ['see my', 'private', 'hidden', 'secret', 'cheat', 'peek'],
    reply:
      'No. Your hand and the pool are the only secrets in this game, and neither ever leaves the server. What ' +
      'everybody knows about you is what you said out loud, which is quite enough.',
  },
  {
    ask: 'What does x2 do?',
    words: ['x2', 'speed', 'fast', 'faster', 'slow', 'waiting'],
    reply:
      'Speeds the bots up. It only appears once everybody still holding cards is a bot — so you are watching ' +
      'rather than playing, and there is nobody left for the pauses to be fair to.',
  },
];

export const SUGGESTED = [0, 1, 3, 6];
