/**
 * Keep the screen on while a game is running.
 *
 * A round of Blob is several minutes of looking at cards, not at the phone, so
 * without this everyone's screen locks between bidding and the results and the
 * table spends the evening re-unlocking phones.
 *
 * The lock is dropped by the browser whenever the tab is hidden — switching
 * apps, locking the phone by hand — and is NOT restored on the way back, so
 * visibilitychange has to re-take it. Everything here is best-effort: Safari
 * only shipped this recently and a refusal is not worth a word to the player.
 */

let sentinel = null;
let wanted = false;

async function take() {
  if (!wanted || sentinel || !('wakeLock' in navigator)) return;
  if (document.visibilityState !== 'visible') return;
  try {
    sentinel = await navigator.wakeLock.request('screen');
    sentinel.addEventListener('release', () => {
      sentinel = null;
    });
  } catch {
    // Refused (battery saver, no permission, unsupported). The game is fine.
    sentinel = null;
  }
}

/** Hold the screen awake until release() is called. Safe to call repeatedly. */
export function keepAwake() {
  wanted = true;
  take();
}

/** Let the screen sleep again. */
export function releaseWake() {
  wanted = false;
  if (sentinel) {
    sentinel.release().catch(() => {});
    sentinel = null;
  }
}

document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') take();
});
