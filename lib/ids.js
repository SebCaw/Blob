'use strict';

const crypto = require('crypto');

/**
 * Identifiers: game codes people read aloud, and opaque ids/tokens they never see.
 */

/** Game codes are digits only, so phones show a numeric keypad for joining. */
const CODE_LENGTH = 4;

/**
 * A random game code. Collisions are the caller's problem to retry — only codes
 * of games still in progress matter, so the 10,000-code space is ample.
 * @returns {string}
 */
function makeGameCode() {
  const max = 10 ** CODE_LENGTH;
  return String(crypto.randomInt(0, max)).padStart(CODE_LENGTH, '0');
}

/**
 * An opaque id with a readable prefix, e.g. `p_9f3c2a...`.
 * @param {string} prefix
 * @returns {string}
 */
function makeId(prefix) {
  return `${prefix}_${crypto.randomBytes(9).toString('hex')}`;
}

/**
 * A session token. This is the only thing standing between a phone and the
 * player it claims to be, so it is long and compared in constant time.
 * @returns {string}
 */
function makeToken() {
  return crypto.randomBytes(24).toString('base64url');
}

/**
 * Constant-time token comparison, so a wrong token can't be discovered by timing.
 * @param {string} a
 * @param {string} b
 * @returns {boolean}
 */
function tokensMatch(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

/**
 * Make a display name unique within a game without rejecting the join — two
 * friends called Alex is a normal Tuesday, not an error.
 *
 * @param {string} wanted
 * @param {string[]} taken existing names in the game
 * @returns {string}
 */
function uniqueName(wanted, taken) {
  const base = wanted.trim().slice(0, 16) || 'Player';
  const lower = new Set(taken.map((n) => n.toLowerCase()));
  if (!lower.has(base.toLowerCase())) return base;
  for (let n = 2; n < 100; n++) {
    const candidate = `${base} ${n}`;
    if (!lower.has(candidate.toLowerCase())) return candidate;
  }
  return `${base} ${crypto.randomInt(100, 999)}`;
}

module.exports = { CODE_LENGTH, makeGameCode, makeId, makeToken, tokensMatch, uniqueName };
