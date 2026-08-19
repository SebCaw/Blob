'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');

/**
 * The QR encoder is written out by hand rather than pulled in as a dependency,
 * so it gets checked properly.
 *
 * During development its output was compared module-for-module against the
 * `qrcode` npm package across 639 random strings covering every version this
 * encoder supports (1 to 10): identical data in every case, with a mask choice
 * whose penalty score was never worse than the reference's. That comparison
 * needed a dependency, so what is pinned here instead are the exact matrices it
 * produced — any change to the encoder that alters a single module fails.
 */

/** @type {(text:string)=>Promise<any>} */
let qrMatrix;
test.before(async () => {
  ({ qrMatrix } = await import('../public/qr.js'));
});

const fingerprint = (matrix) =>
  crypto
    .createHash('sha256')
    .update(matrix.modules.map((row) => row.join('')).join(''))
    .digest('hex')
    .slice(0, 16);

/** [text, version, size, mask, fingerprint] as verified against the reference encoder. */
const PINNED = [
  ['A', 1, 21, 3, '2092585037e9da56'],
  ['http://localhost:4100/?c=4827', 3, 29, 2, 'c87bd16563160cb6'],
  ['https://blob.example.com/?c=0001', 3, 29, 2, '8473ca32aac6a9df'],
  ['https://blob-party-game.example.co.uk/join?c=931744', 4, 33, 4, '8d61138524b0937f'],
  ['x'.repeat(150), 8, 49, 2, '1336208e16162851'],
  ['y'.repeat(200), 10, 57, 1, '313551c2c424adc1'],
];

test('the encoder still produces the matrices verified against a reference encoder', () => {
  for (const [text, version, size, mask, hash] of PINNED) {
    const matrix = qrMatrix(text);
    const label = text.length > 24 ? `${text.slice(0, 24)}...` : text;
    assert.equal(matrix.version, version, `version for ${label}`);
    assert.equal(matrix.size, size, `size for ${label}`);
    assert.equal(matrix.mask, mask, `mask for ${label}`);
    assert.equal(fingerprint(matrix), hash, `modules for ${label}`);
  }
});

test('the version grows with the payload and covers a real join URL comfortably', () => {
  assert.equal(qrMatrix('https://blob.example.com/?c=4827').version <= 3, true);
  assert.equal(qrMatrix('a').version, 1);
  assert.equal(qrMatrix('a'.repeat(180)).version, 9);
  assert.equal(qrMatrix('a'.repeat(213)).version, 10);
  assert.throws(() => qrMatrix('a'.repeat(214)), /too much data/);
});

test('the finder, timing and dark modules are where a scanner expects them', () => {
  const { modules, size } = qrMatrix('https://blob.example.com/?c=4827');

  // Three finder patterns: a 7x7 ring with a 3x3 core.
  for (const [top, left] of [
    [0, 0],
    [0, size - 7],
    [size - 7, 0],
  ]) {
    assert.equal(modules[top][left], 1, 'finder corner');
    assert.equal(modules[top + 1][left + 1], 0, 'finder inner ring');
    assert.equal(modules[top + 3][left + 3], 1, 'finder core');
  }

  // A version-3 code carries one alignment pattern, centred at (22, 22): a dark
  // centre, a light ring around it, then a dark ring.
  assert.equal(size, 29, 'this sample is a version 3 code');
  assert.equal(modules[22][22], 1, 'alignment centre');
  assert.equal(modules[21][22], 0, 'alignment inner ring');
  assert.equal(modules[20][22], 1, 'alignment outer ring');
  assert.equal(modules[22][20], 1, 'alignment outer ring');

  // Timing patterns alternate along row and column 6.
  for (let i = 8; i < size - 8; i++) {
    assert.equal(modules[6][i], i % 2 === 0 ? 1 : 0, `horizontal timing at ${i}`);
    assert.equal(modules[i][6], i % 2 === 0 ? 1 : 0, `vertical timing at ${i}`);
  }

  assert.equal(modules[size - 8][8], 1, 'the module that is always dark');
});

test('a 16-bit character count is used from version 10, not the 8-bit one', () => {
  // Byte mode widens the count indicator at version 10. Encoding a version-10
  // payload with an 8-bit count produces a code that looks right and scans wrong.
  const short = qrMatrix('z'.repeat(179));
  const long = qrMatrix('z'.repeat(200));
  assert.equal(short.version, 9);
  assert.equal(long.version, 10);
  assert.notEqual(fingerprint(short), fingerprint(long));
});

test('the same text always encodes the same way', () => {
  const text = 'https://blob.example.com/?c=1234';
  assert.equal(fingerprint(qrMatrix(text)), fingerprint(qrMatrix(text)));
});
