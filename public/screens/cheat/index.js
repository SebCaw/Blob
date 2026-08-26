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
 * What makes this a different screen rather than the same one repainted.
 *
 * A claim being on the table counts, because the whole bottom of the screen
 * changes when one is: the rank buttons go and the call button arrives. Without
 * it here the entry animation would either fire on every window or on none of
 * them.
 *
 * The picked cards deliberately do NOT count. Selecting a card is not arriving
 * somewhere new, and keying on it would replay the entry animation on every tap.
 */
export function cheatScreenKey(state) {
  return `cheat:${state.phase}:${state.claim ? 'claim' : ''}`;
}
