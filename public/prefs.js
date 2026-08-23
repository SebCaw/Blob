/**
 * Small per-device preferences.
 *
 * The same shape as `sound.js` and `size.js`: remembered on this phone, never
 * part of the game state, never sent anywhere. A setting that changed the game
 * for everybody would have to be a command; these only change what YOU see.
 */

const ASK_KEY = 'blob.sh.askBeforeStart';

function read(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    return raw === null ? fallback : raw === '1';
  } catch {
    return fallback;
  }
}

function write(key, on) {
  try {
    localStorage.setItem(key, on ? '1' : '0');
  } catch {
    /* private browsing, and not worth a word to anybody */
  }
}

/**
 * Should Silly Head check your three face-up cards before it deals you in?
 *
 * On by default, because the answer decides the game half an hour later and
 * nobody meeting it for the first time knows that yet. Off for anybody who has
 * played enough hands to be irritated by it.
 */
export function askBeforeStart() {
  return read(ASK_KEY, true);
}

/** @param {boolean} on */
export function setAskBeforeStart(on) {
  write(ASK_KEY, Boolean(on));
}
