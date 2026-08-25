import { chaseLobby } from './lobby.js';
import { tableScreen } from './table.js';
import { overScreen } from './over.js';

export { chaseWelcome } from './home.js';

/**
 * Which Chase the Ace screen a snapshot means.
 *
 * Three phases, three screens, and no game logic in any of them: the server says
 * what phase it is and what this phone may see, and these draw it.
 */
export function chaseScreen(ctx) {
  const phase = ctx.state.phase;
  if (phase === 'playing') return tableScreen(ctx);
  if (phase === 'complete') return overScreen(ctx);
  return chaseLobby(ctx);
}

/**
 * What makes this a different screen rather than the same one repainted.
 *
 * The lifted card counts. Picking a card up is a different screen from having
 * nothing selected, and without it here the entry animation would fire every
 * time somebody tapped one of their own cards.
 */
export function chaseScreenKey(state, ui) {
  return `chase:${state.phase}:${ui && ui.chasePick != null ? 'pick' : ''}`;
}
