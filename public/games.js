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
  {
    id: 'sevens',
    name: 'Sevens',
    tagline: 'Build every suit out from its seven.',
    blurb: 'Also played as Fan Tan, Domino or Parliament. No score — first to shed everything wins.',
    players: '3 to 8',
    hue: 205,
    // Warm against a cold ground, and clear of the other two: Blob's accent is a
    // lime and Silly Head's an amber, so a third yellow would have been a third
    // of the same thing. Still hand-picked, which CLAUDE.md says it should not
    // be — see the open decision in ADDING-A-GAME.md.
    accent: '#ff8e3d',
    accentDeep: '#d76514',
    // Three suits stood on end on one line: the whole game is a seven going down
    // and its suit growing away from it in both directions at once.
    icon:
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" ' +
      'stroke-linecap="round" stroke-linejoin="round"><path d="M2.6 12 H21.4"/>' +
      '<rect x="3.6" y="6" width="4.6" height="12" rx="1.4"/>' +
      '<rect x="9.7" y="3" width="4.6" height="18" rx="1.4"/>' +
      '<rect x="15.8" y="8" width="4.6" height="8" rx="1.4"/></svg>',
    ready: true,
  },
  {
    id: 'chase',
    name: 'Chase the Ace',
    tagline: 'Bin your pairs. Do not be left with the ace.',
    // The house name is on the tile; the published ones go here, so anybody who
    // already knows the game recognises it. Worth saying plainly, because the
    // game usually SOLD as Chase the Ace is a different one - see
    // CHASE-THE-ACE.md.
    blurb: 'Old Maid, played with an odd ace. Also Pass the Lady or Black Peter.',
    players: '4 to 12',
    hue: 345,
    // The complement of the hue at S100 L62, and its deep at S83 L46 - the rule
    // the other three were already following without anybody writing it down.
    accent: '#3dffcf',
    accentDeep: '#14d7a6',
    // A card lifted out of a fan, which is the only gesture in the game. Silly
    // Head's arrow points down into a pile; this one points up out of a hand,
    // which is the two games in a line each.
    icon:
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" ' +
      'stroke-linecap="round" stroke-linejoin="round"><path d="M11.8 11.4 V3.2"/>' +
      '<path d="M9.2 5.8 L11.8 3.2 L14.4 5.8"/>' +
      '<rect x="2.6" y="13" width="6" height="8.4" rx="1.4"/>' +
      '<rect x="8.8" y="13" width="6" height="8.4" rx="1.4"/>' +
      '<rect x="15" y="13" width="6" height="8.4" rx="1.4"/></svg>',
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
