import { kingscornerLobby } from './lobby.js';
import { tableScreen } from './table.js';
import { overScreen } from './over.js';

export { kingscornerWelcome } from './home.js';

/**
 * Which Kings Corner screen a snapshot means.
 *
 * Three phases, three screens, and no game logic in any of them: the server says
 * what phase it is, what this phone may see and which moves are legal, and these
 * draw it.
 */
export function kingscornerScreen(ctx) {
  const phase = ctx.state.phase;
  if (phase === 'playing') return tableScreen(ctx);
  if (phase === 'complete') return overScreen(ctx);
  return kingscornerLobby(ctx);
}

/**
 * What makes this a different SCREEN, rather than the same screen repainted.
 *
 * The phase, and nothing else.
 *
 * Emphatically NOT the lifted card or the lifted pile. A turn here is a chain of
 * moves, so a selection changes several times inside one go — and `app.js` plays
 * the whole entry animation whenever this key moves. Chase the Ace put its
 * lifted card in the key on the stated grounds that it would stop the animation
 * firing, and guaranteed it instead; Cheat did the same with its open claim.
 * Both shipped with comments explaining the opposite, and Seb reported it as the
 * screen reloading.
 *
 * **A key names where you ARE, not what you are doing there.**
 */
export function kingscornerScreenKey(state) {
  return `kingscorner:${state.phase}`;
}
