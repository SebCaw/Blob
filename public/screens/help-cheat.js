import { h } from '../ui.js';
import { cardFace, cardBack } from '../cards.js';

/**
 * How to play Cheat, in pictures and in answers.
 *
 * The same two shapes as the other four, so `help.js` can show any of them
 * without knowing anything about any of them.
 *
 * The rules take twenty seconds. What takes longer to land is that the app is
 * not checking anything — that you may put down whatever you like and say
 * whatever you like, and the only thing standing between a lie and getting away
 * with it is somebody at the table deciding to doubt you. So the steps spend
 * their words on that rather than on the mechanics.
 */

const C = (face) => `${face}#1`;

export const STEPS = [
  {
    title: 'Get rid of all your cards',
    body: 'The whole deck goes out. First person to empty their hand wins, and the game stops when two people are still holding cards — whoever has more of them gets the spoon.',
    art: () =>
      h(
        'div.help-art.help-art--trick',
        cardBack({ size: 'md', className: 'help-card' }),
        cardBack({ size: 'md', className: 'help-card' }),
        cardBack({ size: 'md', className: 'help-card' }),
        h('span.help-note', { text: 'Face down, every one.' })
      ),
  },
  {
    title: 'Put cards down and name them',
    body: 'Tap the cards you are playing, then tap a rank. They go face down in the middle and everybody is told what you said they are. As many as you like at once.',
    art: () =>
      h(
        'div.help-art.help-art--trick',
        cardBack({ size: 'md', className: 'help-card' }),
        cardBack({ size: 'md', className: 'help-card' }),
        h('span.help-note', { text: '"Two nines."' })
      ),
  },
  {
    title: 'You do not have to be telling the truth',
    body: 'Nothing stops you calling a four a nine. Nobody can see what went down — not even later, once it is buried in the pile.',
    art: () =>
      h(
        'div.help-art.help-art--trick',
        cardFace(C('4C'), { size: 'md', className: 'help-card', index: 0 }),
        cardFace(C('7D'), { size: 'md', className: 'help-card', index: 1 }),
        h('span.help-note', { text: 'Still "two nines", if you fancy it.' })
      ),
  },
  {
    title: 'The rank moves one step, either way',
    body: 'Say the same as the last player, one above or one below. King joins back round to ace, so it is a loop with no ends. The first play of a round can be anything.',
    art: () =>
      h(
        'div.help-art.help-art--trick',
        cardFace(C('QH'), { size: 'sm', className: 'help-card', index: 0 }),
        cardFace(C('KS'), { size: 'md', className: 'help-card', index: 1, state: 'playable' }),
        cardFace(C('AD'), { size: 'sm', className: 'help-card', index: 2 }),
        h('span.help-note', { text: 'After kings: queens, kings or aces.' })
      ),
  },
  {
    title: 'Anybody can call it',
    body: 'For a few seconds after every play there is a bar running down and a Cheat button. Anybody still holding cards can press it. Say nothing and the claim stands.',
    art: () =>
      h(
        'div.help-art.help-art--trick',
        cardBack({ size: 'md', className: 'help-card' }),
        h('span.help-note', { text: 'Three seconds to decide.' })
      ),
  },
  {
    title: 'Whoever is wrong picks up the lot',
    body: 'Only the cards just played get turned over. If they lied, they take the whole pile. If they were honest, you do. Then whoever won the argument starts again on any rank.',
    art: () =>
      h(
        'div.help-art.help-art--trick',
        cardFace(C('9H'), { size: 'md', className: 'help-card', index: 0 }),
        cardFace(C('4C'), { size: 'md', className: 'help-card', index: 1 }),
        h('span.help-note', { text: 'Not nines. That is his pile now.' })
      ),
  },
];

export const ANSWERS = [
  {
    ask: 'How do I win?',
    words: ['win', 'winning', 'point', 'points', 'score', 'scoring', 'how do i win'],
    reply:
      'There is no score. Empty your hand and you are out and safe. The game stops when two people are still ' +
      'holding cards, and whichever of them has more gets the wooden spoon.',
  },
  {
    ask: 'Why does it stop with two people left?',
    words: ['two', 'stop', 'stops', 'end', 'ends', 'ending', 'why does', 'last two'],
    reply:
      'Because with two players it would never finish. You are always allowed to say the same rank again, so two ' +
      'people can pass one pile back and forth for ever without either being forced into a corner. Every real ' +
      'table stops before that, and so does this one.',
  },
  {
    ask: 'What can I say?',
    words: ['say', 'rank', 'ranks', 'claim', 'legal', 'allowed', 'which'],
    reply:
      'The same rank as the last player, one above, or one below — and the king joins back round to the ace, so ' +
      'it never runs out. The buttons only ever show you the ones you may say. The first play after somebody is ' +
      'called can be any rank at all.',
  },
  {
    ask: 'How many cards can I put down?',
    words: ['how many', 'cards', 'many', 'limit', 'maximum', 'most', 'at once'],
    reply:
      'As many as you like. Worth knowing that there are only four of each rank in a deck, so with one deck ' +
      'saying "five kings" is a lie anybody can prove without holding a card. With two decks there are eight of ' +
      'each, and with three there are twelve.',
  },
  {
    ask: 'Can I see what is in the pile?',
    words: ['pile', 'middle', 'see', 'look', 'what is', 'underneath', 'hidden'],
    reply:
      'No, and nor can anybody else — not even the person who put the top card there. Only the cards from the ' +
      'most recent play get turned over when somebody calls. Everything under them stays face down until ' +
      'somebody picks the pile up, and then only they see it.',
  },
  {
    ask: 'Why can other people see some of my cards?',
    words: ['see my', 'showing', 'known', 'public', 'why can', 'visible', 'my cards'],
    reply:
      'Those are cards that were turned over in front of everybody and then went into your hand. The whole table ' +
      'watched them, so the whole table remembers them. They stop being public the moment you play them again — ' +
      'nobody can see what goes face down.',
  },
  {
    ask: 'How many decks do we use?',
    words: ['deck', 'decks', 'players', 'people', 'how many can', 'three decks'],
    reply:
      'Enough that everybody gets at least seven cards. Up to seven players the Master picks one deck or two; ' +
      'from eight it is two or three. Three makes a longer, gentler game, because with twelve of each rank in ' +
      'the pack a big honest claim stops being unbelievable.',
  },
  {
    ask: 'What does x2 do?',
    words: ['x2', 'speed', 'fast', 'faster', 'slow', 'waiting'],
    reply:
      'Speeds the bots up. It only appears once everybody still holding cards is a bot — so you are watching ' +
      'rather than playing, and there is nobody left for the pauses to be fair to.',
  },
];

export const SUGGESTED = [0, 2, 4, 5];
