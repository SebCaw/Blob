import { h } from '../ui.js';
import { mascot } from '../mascot.js';
import { cardFace, cardBack } from '../cards.js';
import { fragment } from '../ui.js';
import {
  STEPS as SILLYHEAD_STEPS,
  ANSWERS as SILLYHEAD_ANSWERS,
  SUGGESTED as SILLYHEAD_SUGGESTED,
} from './help-sillyhead.js';

/**
 * How to play — shown, and asked about.
 *
 * Two ways in, because people learn differently: step through the pictures, or
 * ask Blob a question and get an answer back.
 *
 * The words are deliberately small. Somebody being taught this game is often a
 * child at a kitchen table, so a sentence is short, a word is common, and the
 * jargon is introduced rather than assumed: a trick is explained before it is
 * used, and trumps is called the boss shape first.
 *
 * An overlay rather than a screen, for the same reason settings is: the moment
 * somebody needs the rules is usually the middle of a hand, and coming back to
 * exactly where you were matters more than the URL being tidy.
 *
 * Each step draws its own picture with the real card components, so the cards
 * shown here are the cards you will be dealt. The pictures animate on arrival
 * because every step is built fresh — there is no animation state to keep in
 * step with anything, forwards or backwards.
 */

const BLOB_STEPS = [
  {
    title: 'Everyone puts down one card',
    body: 'The best card wins all of them. That is called a trick. Winning tricks is the whole game.',
    art: () =>
      h(
        'div.help-art.help-art--trick',
        cardFace('7S', { size: 'md', className: 'help-card', index: 0 }),
        cardFace('KS', { size: 'md', className: 'help-card help-card--winner', index: 1, ring: 'win', crown: true }),
        cardFace('4S', { size: 'md', className: 'help-card', index: 2 }),
        h('span.help-note', { text: 'The king is biggest. It wins this trick.' })
      ),
  },
  {
    title: 'Guess how many you will win',
    body: 'Before you play, say how many tricks you think you will win. Guess right and you get points.',
    art: () =>
      h(
        'div.help-art.help-art--say',
        h('span.help-bubble', { text: 'I will win 2' }),
        mascot('think', { size: 'lg' })
      ),
  },
  {
    title: 'One shape is the boss',
    body: 'Blob turns over a card. That shape is called trumps. A trump beats every other shape, even a big one.',
    art: () =>
      h(
        'div.help-art.help-art--trumps',
        h('div.help-deck', { 'aria-hidden': 'true' }, h('span'), h('span')),
        cardFace('9H', { size: 'lg', className: 'help-turned' }),
        h('span.trump.trump--red', h('span.trump__pip', { text: '♥' }), h('span', { text: 'TRUMPS' }))
      ),
  },
  {
    title: 'Everyone guesses at once',
    body: 'You pick your number in secret. Nobody sees it until everybody has picked. No peeking.',
    art: () =>
      h(
        'div.help-art.help-art--bids',
        ['1', '0', '2'].map((value, index) =>
          h('span.help-bid', { style: { '--i': String(index) } }, h('span.help-bid__face', { text: value }))
        )
      ),
  },
  {
    title: 'Play the same shape',
    body: 'If a spade is played first, you must play a spade too. Only if you have none can you play anything else.',
    art: () =>
      h(
        'div.help-art.help-art--follow',
        h('span.help-led', { text: '♠ played first' }),
        h(
          'div.help-hand',
          cardFace('4S', { size: 'md', state: 'playable', className: 'help-card' }),
          cardFace('KS', { size: 'md', state: 'playable', className: 'help-card' }),
          cardFace('AH', { size: 'md', state: 'blocked', className: 'help-card' })
        ),
        h('span.help-note', { text: 'Blob lifts up the cards you are allowed to play.' })
      ),
  },
  {
    title: 'Get it right, get points',
    body: 'Said 2 and won 2? Lots of points. Said 2 and won 3? No points at all. That is a blob.',
    art: () =>
      h(
        'div.help-art.help-art--score',
        h('div.help-score.help-score--made', h('span', { text: 'Said 2 · won 2' }), h('span.help-score__points', { text: '+12' })),
        h('div.help-score.help-score--missed', h('span', { text: 'Said 2 · won 3' }), h('span.help-score__points', { text: '0' }))
      ),
  },
  {
    title: 'The cards go down, then up',
    body: 'You get 7 cards, then 6, then 5, all the way down to 1. Then it climbs back up again.',
    art: () => {
      const sizes = [7, 6, 5, 4, 3, 2, 1, 2, 3, 4, 5, 6, 7];
      return h(
        'div.help-art.help-art--rounds',
        sizes.map((size, index) =>
          h('span.help-pip', { style: { height: `${(size / 7) * 100}%`, '--i': String(index) }, 'aria-hidden': 'true' })
        )
      );
    },
  },
  {
    title: 'The silly one',
    body: 'When you get one card, you hold it on your head. Everybody can see it except you!',
    art: () =>
      h(
        'div.help-art.help-art--forehead',
        h('div.help-seat', cardFace('9S', { size: 'md' }), h('span.help-note', { text: 'Them' })),
        h('div.help-seat', cardBack({ size: 'md', label: 'your card' }), h('span.help-note', { text: 'You' }))
      ),
  },
];

/**
 * What Blob knows how to answer.
 *
 * Matched on words rather than parsed: somebody typing "whats trumps" and
 * somebody typing "what is the boss shape again" want the same answer, and a
 * list of words gets both without pretending to understand English.
 *
 * There is no cleverness behind this and it is not meant to look like there is —
 * it answers the questions people actually ask at a kitchen table, and says so
 * plainly when it does not know.
 */
const BLOB_ANSWERS = [
  {
    ask: 'What is a trick?',
    words: ['trick', 'tricks', 'what do i win'],
    reply: 'Everyone puts down one card. The best card wins all of them — that is a trick. The winner starts the next one.',
  },
  {
    ask: 'What are trumps?',
    words: ['trump', 'trumps', 'boss', 'suit'],
    reply:
      'Blob turns over one card at the start. That shape is trumps, and it sits in the top left corner all hand. ' +
      'Any trump beats any other shape, even an ace. Your own trumps have a gold edge on them.',
  },
  {
    ask: 'Can I play against the computer?',
    words: ['bot', 'bots', 'computer', 'robot', 'ai', 'on my own', 'alone', 'by myself'],
    reply:
      'Yes. Whoever made the game can add bots before it starts, from Easy up to Impossible. They get dealt a hand ' +
      'like everybody else and they only see what you see — no peeking at your cards.',
  },
  {
    ask: 'How do points work?',
    words: ['point', 'points', 'score', 'scoring', 'win the game'],
    reply: 'You only score if you win exactly the number you said. Then you get 10 plus the tricks you won. So saying 2 and winning 2 is 12 points.',
  },
  {
    ask: 'What is a blob?',
    words: ['blob', 'zero', 'nothing', 'missed'],
    reply: 'A blob is when you get your number wrong — too many or too few. You score nothing at all for that hand. That is where the name comes from.',
  },
  {
    ask: 'Why can I not play that card?',
    words: [
      'cannot play', 'can not play', 'cant play', "can't play", 'let me play', 'wont let', "won't let",
      'will not let', 'not let me', 'play my card', 'play that', 'grey', 'greyed', 'dark', 'stuck', 'follow',
    ],
    reply: 'You have to play the same shape that was played first, if you have one. Blob lifts up the cards you are allowed to play, and the rest go dark.',
  },
  {
    ask: 'Can I change my bid?',
    words: [
      'change my bid', 'change bid', 'change my number', 'change number', 'change it', 'undo',
      'wrong number', 'said the wrong', 'mistake', 'take it back',
    ],
    reply: 'No — once your number is in it is locked. That is what makes it fair, because nobody can wait and see what everyone else said.',
  },
  {
    ask: 'Who goes first?',
    words: ['who goes first', 'first', 'start', 'lead', 'my turn'],
    reply: 'It moves round one seat every hand, so it is not always the same person. Whoever wins a trick starts the next one.',
  },
  {
    ask: 'How many hands are there?',
    words: ['how many', 'how long', 'rounds', 'hands', 'finish'],
    reply: 'The cards count down and back up. Starting at 7 that is 13 hands: 7, 6, 5, 4, 3, 2, 1, then 2, 3, 4, 5, 6, 7.',
  },
  {
    ask: 'What is the Master?',
    words: ['master', 'crown', 'host', 'in charge'],
    reply: 'The Master is whoever started the game. They deal the next hand and sort things out if somebody drops off. The crown shows who it is.',
  },
  {
    ask: 'What if someone leaves?',
    words: ['leave', 'left', 'quit', 'disconnect', 'phone died', 'gone', 'away'],
    reply: 'Blob waits a moment, then the Master can play that hand for them, and let them go at the end of it. They can come back any time — they just start again on nothing.',
  },
  {
    ask: 'What is the one card hand?',
    words: ['one card', 'forehead', 'head', 'silly', 'last hand'],
    reply: 'You hold your one card on your forehead. Everybody can see it except you, so you are guessing from their faces. It is the best one.',
  },
  {
    ask: 'Do we need real cards?',
    words: ['real cards', 'no cards', 'deck', 'online', 'need cards'],
    reply: 'Real cards are better, and Blob will just keep the score. If you have none, pick Online on the front page and Blob deals for you.',
  },
];

/** The questions offered as taps, so nobody has to think of one. */
const BLOB_SUGGESTED = [0, 1, 2, 4];

/**
 * Which game's rules to teach.
 *
 * Read from the game in progress first and the shelf choice second, so somebody
 * who scanned a code straight into a game is taught the game they are actually
 * sat in rather than the one this phone last looked at.
 */
function lessonFor(ctx) {
  const id = (ctx.state && ctx.state.game) || (ctx.ui && ctx.ui.game) || 'blob';
  if (id === 'sillyhead') {
    return {
      name: 'Silly Head',
      steps: SILLYHEAD_STEPS,
      answers: SILLYHEAD_ANSWERS,
      suggested: SILLYHEAD_SUGGESTED,
      greeting: 'Ask me anything about Silly Head. Tap one below if you like.',
      shrug:
        'I do not know that one, sorry. Try asking about the special cards, the sorting bit, or your face-down ' +
        'cards — or have a look at Show me.',
    };
  }
  return {
    name: 'Blob',
    steps: BLOB_STEPS,
    answers: BLOB_ANSWERS,
    suggested: BLOB_SUGGESTED,
    greeting: 'Ask me anything about the game. Tap one below if you like.',
    shrug:
      'I do not know that one, sorry. Try asking about trumps, points, whose turn it is, or what a blob is — or ' +
      'have a look at Show me.',
  };
}

export function helpOverlay(ctx) {
  if (!ctx.ui.helpOpen) return null;
  const asking = ctx.ui.helpTab === 'ask';

  const close = () => {
    ctx.ui.helpOpen = false;
    ctx.ui.helpStep = 0;
    ctx.render();
  };
  const switchTo = (tab) => {
    ctx.ui.helpTab = tab;
    ctx.render();
  };

  return h(
    'div.help',
    { role: 'dialog', 'aria-modal': 'true', 'aria-label': 'How to play' },
    h(
      'div',
      { className: `help__panel${asking ? ' help__panel--ask' : ''}` },
      h(
        'div.help__head',
        h(
          'div.help__tabs',
          { role: 'tablist' },
          tab('Show me', !asking, () => switchTo('steps')),
          tab('Ask Blob', asking, () => switchTo('ask'))
        ),
        h('button.icon-btn', { type: 'button', 'aria-label': 'Close', onClick: close }, h('span.icon-btn__glyph', { text: '✕' }))
      ),
      asking ? askView(ctx) : stepsView(ctx, close)
    )
  );
}

function tab(label, on, onClick) {
  return h('button', {
    className: `help__tab${on ? ' help__tab--on' : ''}`,
    type: 'button',
    role: 'tab',
    'aria-selected': on ? 'true' : 'false',
    text: label,
    onClick,
  });
}

// ── Show me ──────────────────────────────────────────────────────────────────

function stepsView(ctx, close) {
  const STEPS = lessonFor(ctx).steps;
  const index = Math.min(Math.max(ctx.ui.helpStep || 0, 0), STEPS.length - 1);
  const step = STEPS[index];
  const last = index === STEPS.length - 1;

  const goTo = (next) => {
    ctx.ui.helpStep = next;
    ctx.render();
  };

  return h(
    'div.help__body-wrap',
    h('div.help__stage', { 'data-step': String(index) }, step.art()),
    h('div.help__words', h('h2.help__title', { text: step.title }), h('p.help__body', { text: step.body })),
    h(
      'div.help__dots',
      { 'aria-hidden': 'true' },
      STEPS.map((_, i) => h('span', { className: `help__dot${i === index ? ' help__dot--on' : ''}` }))
    ),
    h(
      'div.help__nav',
      h('button.btn.btn--ghost', { text: 'Back', type: 'button', disabled: index === 0, onClick: () => goTo(index - 1) }),
      h('button.btn.btn--primary', {
        text: last ? 'Got it' : 'Next',
        type: 'button',
        onClick: () => (last ? close() : goTo(index + 1)),
      })
    ),
    h('p.help__step-count', { text: `${index + 1} of ${STEPS.length}` })
  );
}

// ── Ask Blob ─────────────────────────────────────────────────────────────────

function askView(ctx) {
  const lesson = lessonFor(ctx);
  const greeting = { from: 'blob', text: lesson.greeting };
  const thread = ctx.ui.helpChat && ctx.ui.helpChat.length ? ctx.ui.helpChat : [greeting];

  const say = (question) => {
    const asked = String(question || '').trim();
    if (!asked) return;
    ctx.ui.helpChat = [...thread, { from: 'you', text: asked }];
    ctx.ui.helpDraft = '';
    ctx.ui.helpThinking = true;
    ctx.render();

    // A beat before the reply. An instant answer reads as a lookup table, which
    // is what it is — but the pause is what makes it feel like being answered.
    clearTimeout(thinkTimer);
    thinkTimer = setTimeout(() => {
      ctx.ui.helpThinking = false;
      ctx.ui.helpChat = [...(ctx.ui.helpChat || []), { from: 'blob', text: answerFor(asked, lesson) }];
      ctx.render();
    }, 520);
  };

  const input = h('input.input.chat__input', {
    type: 'text',
    value: ctx.ui.helpDraft || '',
    placeholder: 'Ask a question…',
    maxlength: '120',
    'aria-label': 'Ask a question about the game',
    'data-focus-key': 'help-ask',
    enterkeyhint: 'send',
    onInput: (event) => {
      ctx.ui.helpDraft = event.target.value;
    },
    onKeyDown: (event) => {
      if (event.key === 'Enter') say(ctx.ui.helpDraft);
    },
  });

  return h(
    'div.help__body-wrap.chat',
    h(
      'div.chat__thread',
      thread.map((message) =>
        h('div', { className: `chat__row chat__row--${message.from}` }, h('span.chat__bubble', { text: message.text }))
      ),
      ctx.ui.helpThinking
        ? h('div.chat__row.chat__row--blob', h('span.chat__bubble.chat__bubble--typing', { 'aria-label': 'Blob is typing' }, h('i'), h('i'), h('i')))
        : null
    ),
    h(
      'div.chat__chips',
      lesson.suggested.map((i) =>
        h('button.chat__chip', {
          type: 'button',
          text: lesson.answers[i].ask,
          onClick: () => say(lesson.answers[i].ask),
        })
      )
    ),
    h(
      'div.chat__compose',
      input,
      h('button.chat__send', { type: 'button', 'aria-label': 'Send', onClick: () => say(ctx.ui.helpDraft) }, sendArrow())
    )
  );
}

let thinkTimer = null;

/** Drawn, not typed — an arrow character is a different weight on every phone. */
function sendArrow() {
  const wrap = h('span.icon', { 'aria-hidden': 'true' });
  wrap.appendChild(
    fragment(
      '<svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">' +
        '<path d="M3 20 L21 12 L3 4 L5.4 12 Z" fill="currentColor"/>' +
        '</svg>'
    )
  );
  return wrap;
}

/**
 * Find the best answer for what was typed.
 *
 * Scored on how many of an answer's words turn up, so a long question still
 * lands on the right one. No match is a plain "I do not know that one" rather
 * than a guess — a wrong answer about the rules is worse than no answer.
 */
function answerFor(question, lesson) {
  const asked = question.toLowerCase();
  let best = null;
  let bestScore = 0;
  for (const entry of lesson.answers) {
    let score = 0;
    for (const word of entry.words) if (asked.includes(word)) score += word.length;
    if (score > bestScore) {
      bestScore = score;
      best = entry;
    }
  }
  if (best) return best.reply;
  return lesson.shrug;
}

/** The way in, from the front page and from settings. */
export function helpButton(ctx, options = {}) {
  return h('button', {
    className: options.kind === 'link' ? 'btn btn--link' : 'btn btn--ghost',
    text: 'How to play',
    type: 'button',
    onClick: () => openHelp(ctx),
  });
}

/** Open the rules at the first step. Anything that teaches goes through here. */
export function openHelp(ctx) {
  ctx.ui.helpOpen = true;
  ctx.ui.helpStep = 0;
  ctx.ui.helpTab = 'steps';
  ctx.render();
}
