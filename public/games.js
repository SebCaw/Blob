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
