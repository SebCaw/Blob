import { fragment } from './ui.js';

/**
 * Blob — the character.
 *
 * One squishy shape with a face that changes. Deliberately simple: it has to
 * read at 60px next to a player's name and at 200px filling a celebration
 * screen, and it has to be drawable in code so it can react to what just
 * happened without shipping a sprite sheet.
 */

const BODY =
  'M60 5 C88 3 111 23 113 51 C115 81 92 105 60 105 C28 105 5 83 7 53 C9 25 32 7 60 5 Z';

/** The face for each mood, drawn over the body. */
const FACES = {
  /** Waiting, breathing, nothing happening yet. */
  idle: `
    <circle cx="44" cy="47" r="11" fill="#1b0b33"/>
    <circle cx="76" cy="47" r="11" fill="#1b0b33"/>
    <circle cx="47" cy="44" r="3.6" fill="#fff"/>
    <circle cx="79" cy="44" r="3.6" fill="#fff"/>
    <path d="M46 71 Q60 82 74 71" stroke="#1b0b33" stroke-width="5" fill="none" stroke-linecap="round"/>`,

  /** Deciding what to bid. */
  think: `
    <circle cx="44" cy="46" r="11" fill="#1b0b33"/>
    <circle cx="76" cy="46" r="11" fill="#1b0b33"/>
    <circle cx="41" cy="42" r="3.6" fill="#fff"/>
    <circle cx="73" cy="42" r="3.6" fill="#fff"/>
    <path d="M48 74 L72 71" stroke="#1b0b33" stroke-width="5" fill="none" stroke-linecap="round"/>`,

  /** Made the bid. */
  cheer: `
    <path d="M35 48 Q44 36 53 48" stroke="#1b0b33" stroke-width="6" fill="none" stroke-linecap="round"/>
    <path d="M67 48 Q76 36 85 48" stroke="#1b0b33" stroke-width="6" fill="none" stroke-linecap="round"/>
    <path d="M42 66 Q60 90 78 66 Z" fill="#1b0b33"/>
    <path d="M50 76 Q60 84 70 76 Z" fill="#ff3e8a"/>`,

  /** Missed it. */
  sad: `
    <circle cx="44" cy="52" r="10" fill="#1b0b33"/>
    <circle cx="76" cy="52" r="10" fill="#1b0b33"/>
    <circle cx="44" cy="55" r="3.2" fill="#fff"/>
    <circle cx="76" cy="55" r="3.2" fill="#fff"/>
    <path d="M33 44 Q44 39 54 43" stroke="#1b0b33" stroke-width="4.5" fill="none" stroke-linecap="round"/>
    <path d="M87 44 Q76 39 66 43" stroke="#1b0b33" stroke-width="4.5" fill="none" stroke-linecap="round"/>
    <path d="M48 80 Q60 71 72 80" stroke="#1b0b33" stroke-width="5" fill="none" stroke-linecap="round"/>`,

  /** Something big just happened. */
  wow: `
    <circle cx="44" cy="45" r="13" fill="#1b0b33"/>
    <circle cx="76" cy="45" r="13" fill="#1b0b33"/>
    <circle cx="47" cy="41" r="4.4" fill="#fff"/>
    <circle cx="79" cy="41" r="4.4" fill="#fff"/>
    <ellipse cx="60" cy="76" rx="10" ry="12" fill="#1b0b33"/>`,

  /** Nobody is home. */
  sleep: `
    <path d="M34 47 Q44 55 54 47" stroke="#1b0b33" stroke-width="5" fill="none" stroke-linecap="round"/>
    <path d="M66 47 Q76 55 86 47" stroke="#1b0b33" stroke-width="5" fill="none" stroke-linecap="round"/>
    <path d="M50 73 Q60 79 70 73" stroke="#1b0b33" stroke-width="5" fill="none" stroke-linecap="round"/>`,
};

const CROWN = `
  <path d="M36 12 L44 26 L60 8 L76 26 L84 12 L80 34 L40 34 Z"
        fill="#ffc93c" stroke="#e0a600" stroke-width="2.5" stroke-linejoin="round"/>
  <circle cx="60" cy="6" r="4" fill="#ff3e8a"/>`;

/** Body fill per mood, so the colour carries the feeling too. */
const COLOURS = {
  idle: ['#c8ff3d', '#9fd614'],
  think: ['#37e0ff', '#12a8c8'],
  cheer: ['#c8ff3d', '#9fd614'],
  sad: ['#8f79b8', '#6a539a'],
  wow: ['#ffc93c', '#e0a600'],
  sleep: ['#6a539a', '#4c3a72'],
};

/**
 * Build the Blob.
 *
 * @param {'idle'|'think'|'cheer'|'sad'|'wow'|'sleep'} [mood]
 * @param {{crown?:boolean, size?:''|'sm'|'lg', label?:string}} [options]
 * @returns {HTMLElement} a wrapper div holding the SVG
 */
export function mascot(mood = 'idle', options = {}) {
  const face = FACES[mood] || FACES.idle;
  const [fillTop, fillBottom] = COLOURS[mood] || COLOURS.idle;
  const gradientId = `blob-grad-${mood}`;

  const wrap = document.createElement('div');
  wrap.className = `mascot-wrap${options.size ? ` mascot-wrap--${options.size}` : ''} mascot--${mood}`;
  if (options.label) {
    wrap.setAttribute('role', 'img');
    wrap.setAttribute('aria-label', options.label);
  } else {
    wrap.setAttribute('aria-hidden', 'true');
  }

  wrap.appendChild(
    fragment(`
      <svg class="mascot" viewBox="0 0 120 112" xmlns="http://www.w3.org/2000/svg">
        <defs>
          <linearGradient id="${gradientId}" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stop-color="${fillTop}"/>
            <stop offset="100%" stop-color="${fillBottom}"/>
          </linearGradient>
        </defs>
        <g class="mascot__body">
          <path d="${BODY}" fill="url(#${gradientId})"/>
          <ellipse cx="38" cy="26" rx="13" ry="8" fill="#fff" opacity="0.35"/>
          ${face}
          ${options.crown ? CROWN : ''}
        </g>
      </svg>`)
  );
  return wrap;
}

/**
 * Which mood suits this moment? Kept in one place so the character stays
 * consistent across screens rather than each screen inventing its own.
 * @param {object} state
 * @returns {'idle'|'think'|'cheer'|'sad'|'wow'|'sleep'}
 */
export function moodFor(state) {
  if (!state) return 'idle';
  if (state.phase === 'complete') return (state.winners || []).includes(state.you?.id) ? 'cheer' : 'wow';
  if (state.phase === 'summary') {
    if (state.you?.madeBid === true) return 'cheer';
    if (state.you?.madeBid === false) return 'sad';
    return 'idle';
  }
  if (state.phase === 'reveal') return 'wow';
  if (state.phase === 'bidding') return state.you?.hasSubmitted ? 'idle' : 'think';
  return 'idle';
}
