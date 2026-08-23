import { sillyheadLobby } from './lobby.js';
import { sortScreen } from './sort.js';
import { tableScreen } from './table.js';
import { overScreen } from './over.js';

export { sillyheadWelcome } from './home.js';

/**
 * Which Silly Head screen a snapshot means.
 *
 * Four phases, four screens, and no client-side game logic anywhere in them:
 * the server says what phase it is and what this phone is allowed to see, and
 * these draw it.
 */
export function sillyheadScreen(ctx) {
  const phase = ctx.state.phase;
  if (phase === 'sort') return sortScreen(ctx);
  if (phase === 'playing') return tableScreen(ctx);
  if (phase === 'complete') return overScreen(ctx);
  return sillyheadLobby(ctx);
}
