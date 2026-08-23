/**
 * The shelf: every card game this app knows how to run.
 *
 * One entry per game, and the entry is the whole definition — name, colour,
 * what it says on the tin, and whether it is ready to play. Adding a game means
 * adding a row here and a screen for it; nothing else on the front page has to
 * be touched.
 *
 * ── About the colours ────────────────────────────────────────────────────────
 *
 * Each game gets its OWN HUE, not its own palette. `--hue` rotates the dark
 * ground the whole app is built on, and the lightness and saturation of every
 * step stay exactly where they were — so a green game is as readable as the
 * purple one, in the same dim pub, without a single screen being redesigned.
 * A card needs a dark, low-saturation ground to read against; a bright green
 * background with playing cards on it would be worse than no theme at all.
 *
 * The accent moves with it, because an accent that sits close to its own
 * background stops being an accent.
 */

/** Blob's hue, and the one the stylesheet falls back to. */
export const DEFAULT_HUE = 265;

export const GAMES = [
  {
    id: 'blob',
    name: 'Blob',
    tagline: 'Bid, then win exactly that many.',
    blurb: 'The bidding, the scoring and the arguments — sorted.',
    players: '2 to 8',
    hue: 265,
    accent: '#c8ff3d',
    accentDeep: '#9fd614',
    // A hand held as a fan: cards you look at and decide from, which is the
    // half of Blob you spend the evening doing. Drawn rather than set in type,
    // for the same reason the crown and the spoon are.
    icon:
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" ' +
      'stroke-linejoin="round"><rect x="2.6" y="8" width="7.6" height="11.4" rx="1.6" ' +
      'transform="rotate(-20 6.4 13.7)"/><rect x="8.2" y="5.6" width="7.6" height="11.4" rx="1.6"/>' +
      '<rect x="13.8" y="8" width="7.6" height="11.4" rx="1.6" transform="rotate(20 17.6 13.7)"/></svg>',
    ready: true,
  },
  {
    id: 'sillyhead',
    name: 'Silly Head',
    tagline: 'Shed your cards. Last one holding them loses.',
    // The house name is the one on the tile, and the published ones go here —
    // so anybody who already knows the game recognises it, and nobody has to
    // hear what it is usually called at the dinner table.
    blurb: 'Also played as Palace, Karma or Shed. No score — the cards settle it.',
    players: '2 to 16',
    hue: 148,
    accent: '#ffd23d',
    accentDeep: '#e0a600',
    // A card going down onto the pile: the whole game is getting rid of them,
    // and everything lands in one place in the middle.
    icon:
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" ' +
      'stroke-linecap="round" stroke-linejoin="round"><path d="M12 2.6 V9.2"/>' +
      '<path d="M8.7 5.9 L12 9.4 L15.3 5.9"/><path d="M6.4 12.4 V11 H17.6 V12.4"/>' +
      '<rect x="3.8" y="12.6" width="16.4" height="7.8" rx="1.8"/></svg>',
    ready: true,
  },
];

/** @param {string} id */
export function gameById(id) {
  return GAMES.find((game) => game.id === id) || GAMES[0];
}

/**
 * Dress the app in a game's colours.
 *
 * Set on the root element rather than swapped in a stylesheet, so it applies to
 * everything at once — including anything living on `document.body`, like the
 * confetti and the toast, which `render()` never touches.
 *
 * @param {string} id
 */
export function applyGameTheme(id) {
  const game = gameById(id);
  const root = document.documentElement;
  root.setAttribute('data-game', game.id);
  root.style.setProperty('--hue', String(game.hue));
  root.style.setProperty('--lime', game.accent);
  root.style.setProperty('--lime-deep', game.accentDeep);
}
