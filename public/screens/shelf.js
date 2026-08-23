import { h, fragment } from '../ui.js';
import { GAMES, gameById } from '../games.js';
import { sizeControl } from '../size.js';
import { helpButton } from './help.js';

/**
 * The shelf: pick a game.
 *
 * The front door once there is more than one thing behind it. Every game is a
 * tile in its own colour, because "the purple one" and "the green one" is how
 * people will actually ask for them — long before they remember which is
 * called what.
 *
 * It costs a tap, which is a real cost on a screen somebody opens in a pub. It
 * is worth it only because the alternative — a menu buried behind a settings
 * cog — makes a second game feel like a hidden feature rather than a game.
 *
 * A scanned QR or a shared link skips straight past this — nobody being handed
 * a code should have to pick a game first. A game already in progress does not
 * skip it so much as pass through it: it sits at the top as the first thing on
 * the shelf and opens itself as soon as the server answers, so the wait for
 * that answer is spent on the front door rather than on a screen belonging to
 * one game.
 */
export function shelfScreen(ctx) {
  return h(
    'div.screen.screen--scroll.shelf',
    h(
      'div.stack.center',
      h('h1.shelf__title', { text: 'Card games' }),
      h('p.lede.center', { text: 'Pick one. Blob keeps the score, or deals as well.' })
    ),
    h('div.spacer'),
    resumeRow(ctx),
    h('div.shelf__list', GAMES.map((game) => tile(ctx, game))),
    h('div.spacer'),
    helpButton(ctx, { kind: 'link' }),
    sizeControl(ctx)
  );
}

/**
 * The game you are already in, at the top of the shelf.
 *
 * It is the first thing here because it is the likeliest thing you came for: a
 * phone opened mid-hand wants the table, not a menu. Before the server has
 * answered it says so and cannot be pressed — a phone with no signal offering
 * "back into your game" and then doing nothing is worse than one that says it
 * is looking.
 *
 * It disappears of its own accord: a game the server no longer has clears the
 * session, and the shelf is then simply the shelf.
 */
function resumeRow(ctx) {
  const state = ctx.state;
  const waiting = ctx.ui.resuming;
  if (!state && !waiting) return null;

  const game = gameById(state ? state.game || 'blob' : waiting.game);
  const code = state ? state.code : waiting.code;
  const live = Boolean(state);

  return h(
    'button',
    {
      className: `shelf__resume${live ? '' : ' shelf__resume--waiting'}`,
      style: { '--tile-hue': String(game.hue), '--tile-accent': game.accent },
      type: 'button',
      disabled: !live,
      onClick: () => ctx.go('game'),
    },
    h('span.shelf__resume__label', { text: live ? 'Back into your game' : 'Finding your game…' }),
    h('span.shelf__resume__meta', { text: code ? `${game.name} · ${code}` : game.name })
  );
}

/**
 * One game on the shelf.
 *
 * The tile carries the game's own hue rather than the one the app is currently
 * wearing, so the shelf shows the games as they are — you can see what you are
 * choosing between before you choose.
 */
function tile(ctx, game) {
  const style = {
    '--tile-hue': String(game.hue),
    '--tile-accent': game.accent,
  };

  if (!game.ready) {
    return h(
      'div.tile.tile--soon',
      { style, 'aria-label': `${game.name}, not built yet` },
      h('span.tile__name', { text: game.name }),
      h('span.tile__tagline', { text: game.tagline }),
      h('span.tile__soon', { text: 'Coming soon' })
    );
  }

  return h(
    'button.tile',
    { style, type: 'button', onClick: () => ctx.openGame(game.id) },
    h('div.tile__head', h('span.tile__name', { text: game.name }), icon(game)),
    h('span.tile__tagline', { text: game.tagline }),
    game.players ? h('span.tile__players', { text: `${game.players} players` }) : null
  );
}

/**
 * What the game is like, in the space going spare beside its name.
 *
 * A name and a line of prose tell you what a game is called and what it does;
 * the picture tells you what it FEELS like before you have read either — a fan
 * of cards you decide from, or a card going down onto a pile. It sits in the
 * room to the right of the name because that room is there and empty, and a
 * long name simply takes it back.
 *
 * Drawn from the game's own row, so a new game arrives with its picture the way
 * it arrives with its colour: one row, one game, nothing else to remember.
 */
function icon(game) {
  if (!game.icon) return null;
  const wrap = h('span.tile__icon', { 'aria-hidden': 'true' });
  wrap.appendChild(fragment(game.icon));
  return wrap;
}
