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
 * What makes this a different SCREEN, rather than the same screen repainted.
 *
 * The phase, and nothing else.
 *
 * This had the lifted card in it, with a comment claiming that kept the entry
 * animation from firing on every tap. It did exactly the opposite. `app.js`
 * plays the animation when the key CHANGES, so putting a within-screen state in
 * here guarantees the whole screen re-enters every time that state moves - and
 * because binning clears the lifted card, throwing a pair away replayed the
 * animation every single time. Seb described it as the screen reloading, which
 * is precisely what it looked like.
 *
 * **The rule: a key names where you ARE, not what you are doing there.** It may
 * only change when one screen is genuinely replaced by another. Lifting a card,
 * selecting, opening a window, a countdown - none of those are arriving
 * anywhere, and none of them belong here.
 */
export function chaseScreenKey(state) {
  return `chase:${state.phase}`;
}
