import { gofishLobby } from './lobby.js';
import { tableScreen } from './table.js';
import { overScreen } from './over.js';

export { gofishWelcome } from './home.js';

/**
 * Which Go Fish screen a snapshot means.
 *
 * Three phases, three screens, and no game logic in any of them: the server says
 * what phase it is and what this phone may see, and these draw it.
 */
export function gofishScreen(ctx) {
  const phase = ctx.state.phase;
  if (phase === 'playing') return tableScreen(ctx);
  if (phase === 'complete') return overScreen(ctx);
  return gofishLobby(ctx);
}

/**
 * What makes this a different SCREEN, rather than the same screen repainted.
 *
 * The phase, and nothing else.
 *
 * Not the open question, and not the rank you have picked — both change several
 * times a turn and neither is arriving anywhere. `app.js` plays the whole entry
 * animation whenever this key moves, so putting a within-screen state in here
 * makes the screen re-enter on every tap. Chase the Ace and Cheat both shipped
 * that bug with comments confidently explaining the opposite, and Seb reported
 * it as the screen reloading.
 *
 * **The rule: a key names where you ARE, not what you are doing there.**
 */
export function gofishScreenKey(state) {
  return `gofish:${state.phase}`;
}
