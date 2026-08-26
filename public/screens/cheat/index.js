import { cheatLobby } from './lobby.js';
import { tableScreen } from './table.js';
import { overScreen } from './over.js';

export { cheatWelcome } from './home.js';

/**
 * Which Cheat screen a snapshot means.
 *
 * Three phases, three screens, and no game logic in any of them: the server says
 * what phase it is and what this phone may see, and these draw it.
 */
export function cheatScreen(ctx) {
  const phase = ctx.state.phase;
  if (phase === 'playing') return tableScreen(ctx);
  if (phase === 'complete') return overScreen(ctx);
  return cheatLobby(ctx);
}

/**
 * What makes this a different SCREEN, rather than the same screen repainted.
 *
 * The phase, and nothing else.
 *
 * The claim used to be in here, on the grounds that the bottom of the screen
 * changes when one is open. It does - but changing the buttons is not arriving
 * somewhere, and `app.js` plays the whole entry animation whenever this key
 * moves. That meant the screen re-entered twice a turn, once when a claim opened
 * and again when it closed. Chase the Ace had the identical bug with its lifted
 * card and Seb reported it as the screen reloading.
 *
 * **The rule: a key names where you ARE, not what you are doing there.**
 */
export function cheatScreenKey(state) {
  return `cheat:${state.phase}`;
}
