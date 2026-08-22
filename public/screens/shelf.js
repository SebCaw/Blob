import { h } from '../ui.js';
import { GAMES } from '../games.js';
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
 * A scanned QR, a shared link, or a game already in progress all skip straight
 * past this. Nobody being handed a code should have to pick a game first.
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
    h('div.shelf__list', GAMES.map((game) => tile(ctx, game))),
    h('div.spacer'),
    helpButton(ctx, { kind: 'link' }),
    sizeControl(ctx)
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
    h('span.tile__name', { text: game.name }),
    h('span.tile__tagline', { text: game.tagline }),
    game.players ? h('span.tile__players', { text: `${game.players} players` }) : null
  );
}
