import { sevensLobby } from './lobby.js';
import { tableScreen } from './table.js';
import { overScreen } from './over.js';

export { sevensWelcome } from './home.js';

/**
 * Which Sevens screen a snapshot means.
 *
 * Three phases, three screens, and no game logic in any of them: the server says
 * what phase it is and what this phone is allowed to see, and these draw it.
 */
export function sevensScreen(ctx) {
  const phase = ctx.state.phase;
  if (phase === 'playing') return tableScreen(ctx);
  if (phase === 'complete') return overScreen(ctx);
  return sevensLobby(ctx);
}

/**
 * What makes this a different screen rather than the same one repainted.
 *
 * Kept beside the phase map because it is the same question asked for a
 * different purpose, and the two drifting apart is how an entry animation ends
 * up replaying on a repaint.
 */
export function sevensScreenKey(state) {
  return `sevens:${state.phase}`;
}
