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
  {
    id: 'cheat',
    name: 'Cheat',
    tagline: 'Say what you like. Somebody has to believe you.',
    blurb: 'Also played as Bullshit, I Doubt It or Bluff. Lie well, and call better.',
    players: '3 to 12',
    // A warm tobacco ground, and the only one in the app that is not a colour
    // anybody would call bright. It started at 305, a purple-pink, and moved
    // because that sat too close to Blob's 265 to tell apart on a phone in a
    // dim room - which is the whole point of giving each game its own hue.
    hue: 30,
    // The complement at S100 L62 and its deep at S83 L46, straight off the rule.
    // The first COOL accent in the app: Blob is lime, Silly Head amber, Sevens
    // orange and Chase the Ace mint, so a blue is the one thing on the shelf
    // nothing else can be mistaken for.
    accent: '#3d9eff',
    accentDeep: '#1475d7',
    // Something said over a card nobody can see, which is the entire game. The
    // other four icons are all cards doing something; this one is a card and a
    // claim about it.
    icon:
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" ' +
      'stroke-linecap="round" stroke-linejoin="round"><path d="M5.2 2.6 H18.8 ' +
      'a2.2 2.2 0 0 1 2.2 2.2 V8 a2.2 2.2 0 0 1 -2.2 2.2 H9.6 L6 13 V10.2 H5.2 ' +
      'A2.2 2.2 0 0 1 3 8 V4.8 A2.2 2.2 0 0 1 5.2 2.6 Z"/>' +
      '<rect x="11" y="13.6" width="9" height="7.8" rx="1.5"/></svg>',
    ready: true,
  },
  {
    id: 'gofish',
    name: 'Go Fish',
    tagline: 'Ask for what you want. Everybody hears you.',
    blurb: 'Collect books of four. Also played as Authors or Happy Families.',
    players: '3 to 6',
    // A deep ocean, and it had to be deep: Sevens is already a blue at 205, and
    // two blues a few degrees apart are one blue to anybody looking at a phone
    // in a dim room.
    hue: 228,
    // A DELIBERATE DEPARTURE from the accent rule, and the second one after
    // Chase the Ace's. The rule says the complement of the hue at S100 L62 -
    // but every blue ground has a warm complement, and the warm end of the
    // shelf is full: Blob lime, Silly Head amber, Sevens orange. A rule-derived
    // accent here would have landed on top of one of the three. This is a surf
    // cyan instead, near enough the ground's own family to belong to it and far
    // enough off to be an accent. See GO-FISH.md.
    accent: '#3dd8ff',
    accentDeep: '#149fd7',
    // A hook over a pile: the pool in the middle and the one thing you do to it.
    // Every other icon on the shelf is a card doing something; this is the only
    // one where the card is not the subject.
    icon:
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" ' +
      'stroke-linecap="round" stroke-linejoin="round"><path d="M14.4 2.8 V8.6 ' +
      'a2.8 2.8 0 0 1 -5.6 0"/><path d="M8.8 8.6 L10.9 6.8"/>' +
      '<path d="M6 13.6 V12.4 H18 V13.6"/>' +
      '<rect x="3.6" y="13.8" width="16.8" height="7.4" rx="1.7"/></svg>',
    // Flipped last, once the two browser checkpoints in ADDING-A-GAME.md pass.
    ready: true,
  },
  {
    id: 'kingscorner',
    name: 'Kings Corner',
    tagline: 'Build down, alternate colours, kings in the corners.',
    blurb: 'Published as Kings in the Corner. Best at four. First to empty their hand wins.',
    players: '2 to 6',
    // A teal, and the seventh hue is where the budget finally got tight. The
    // warm end of the shelf is full and both blues are taken, so this sits at
    // 178 - between Silly Head's 148 and Sevens' 205, which ADDING-A-GAME.md
    // predicted by name as the cluster most likely to need separating. The test
    // is whether you can tell the three TILES apart on a phone in a dim room,
    // not whether the numbers differ.
    hue: 178,
    // Straight off the house rule for once: the complement at S100 L62, deep at
    // S83 L46. It lands on the one thing the shelf did not have - Blob is lime,
    // Silly Head amber, Sevens orange, Chase mint, Go Fish cyan, Cheat blue, and
    // nothing was red.
    accent: '#ff3d47',
    accentDeep: '#d71420',
    // A crown sitting in the corner of the board: the name of the game and its
    // only special rule, in one mark. Every other icon on the shelf is about a
    // card; this one is about the place a card goes.
    icon:
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" ' +
      'stroke-linecap="round" stroke-linejoin="round"><path d="M3 9.4 V4.6 L6 6.6 ' +
      'L8.4 3.4 L10.8 6.6 L13.8 4.6 V9.4 Z"/><path d="M3 12.2 H13.8"/>' +
      '<rect x="10.6" y="13.4" width="10.4" height="7.8" rx="1.7"/></svg>',
    // Flipped once both browser checkpoints pass.
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

/**
 * How much of the draw each game gets when the shelf picks a colour for itself.
 *
 * Blob is deliberately weighted down rather than excluded. It is the app's own
 * name and the colour everything else was designed against, so it should still
 * come up - just not as the thing you see almost every time you open the app,
 * which is what a straight `GAMES[0]` gave it.
 */
const SHELF_WEIGHT = { blob: 1 };
const SHELF_WEIGHT_DEFAULT = 4;

/**
 * A colour for the shelf, chosen fresh each time the app is opened cold.
 *
 * The shelf belongs to no game, and it wore Blob's purple only because Blob is
 * first in the list. Six games with six hues is a nicer thing to open than the
 * same purple every morning.
 *
 * Not remembered anywhere on purpose - it is meant to be different next time.
 * What IS remembered is a game you actually went into: `leaveGame` keeps that
 * game's colours on the shelf rather than resetting, so where you have just been
 * still shows.
 */
export function randomShelfGame() {
  const weighted = [];
  for (const game of GAMES) {
    const n = SHELF_WEIGHT[game.id] || SHELF_WEIGHT_DEFAULT;
    for (let i = 0; i < n; i += 1) weighted.push(game.id);
  }
  return weighted[Math.floor(Math.random() * weighted.length)] || GAMES[0].id;
}
