/**
 * A small QR encoder — byte mode, error-correction level M, versions 1 to 10.
 *
 * Written out rather than pulled in as a dependency: the app has none, and a
 * join code on a screen is exactly the case QR was invented for. Level M
 * (about 15% recovery) because this gets photographed off a phone screen at an
 * angle across a table.
 *
 * The output is checked against a reference encoder in test/qr.test.js, so
 * "it looks like a QR code" is not the standard being applied here.
 */

/** [ec codewords per block, blocks in group 1, data per block, blocks in group 2, data per block] */
const VERSIONS_M = {
  1: [10, 1, 16, 0, 0],
  2: [16, 1, 28, 0, 0],
  3: [26, 1, 44, 0, 0],
  4: [18, 2, 32, 0, 0],
  5: [24, 2, 43, 0, 0],
  6: [16, 4, 27, 0, 0],
  7: [18, 4, 31, 0, 0],
  8: [22, 2, 38, 2, 39],
  9: [22, 3, 36, 2, 37],
  10: [26, 4, 43, 1, 44],
};

/** Centres of the alignment patterns, per version. */
const ALIGNMENT = {
  1: [],
  2: [6, 18],
  3: [6, 22],
  4: [6, 26],
  5: [6, 30],
  6: [6, 34],
  7: [6, 22, 38],
  8: [6, 24, 42],
  9: [6, 26, 46],
  10: [6, 28, 50],
};

/** The 18-bit version block, needed from version 7 up. */
const VERSION_INFO = { 7: 0x07c94, 8: 0x085bc, 9: 0x09a99, 10: 0x0a4d3 };

const EC_LEVEL_M = 0b00;

// -- GF(256) ------------------------------------------------------------------

const EXP = new Uint8Array(512);
const LOG = new Uint8Array(256);
(() => {
  let x = 1;
  for (let i = 0; i < 255; i++) {
    EXP[i] = x;
    LOG[x] = i;
    x <<= 1;
    if (x & 0x100) x ^= 0x11d; // the QR primitive polynomial
  }
  for (let i = 255; i < 512; i++) EXP[i] = EXP[i - 255];
})();

const mul = (a, b) => (a === 0 || b === 0 ? 0 : EXP[LOG[a] + LOG[b]]);

/** The generator polynomial for `degree` error-correction codewords. */
function generator(degree) {
  let poly = [1];
  for (let i = 0; i < degree; i++) {
    const next = new Array(poly.length + 1).fill(0);
    for (let j = 0; j < poly.length; j++) {
      next[j] ^= poly[j];
      next[j + 1] ^= mul(poly[j], EXP[i]);
    }
    poly = next;
  }
  return poly;
}

/** Reed-Solomon remainder: the error-correction codewords for one block. */
function ecCodewords(data, count) {
  const gen = generator(count);
  const buffer = [...data, ...new Array(count).fill(0)];
  for (let i = 0; i < data.length; i++) {
    const factor = buffer[i];
    if (factor === 0) continue;
    for (let j = 0; j < gen.length; j++) buffer[i + j] ^= mul(gen[j], factor);
  }
  return buffer.slice(data.length);
}

// -- Encoding -----------------------------------------------------------------

/** UTF-8 bytes, since a game URL is plain ASCII but names could travel later. */
function toBytes(text) {
  return Array.from(new TextEncoder().encode(text));
}

/**
 * How many bits the character-count indicator takes in byte mode. Versions 10
 * and up widen it to 16, which silently corrupts anything encoded as though it
 * were still 8.
 */
function countBits(version) {
  return version < 10 ? 8 : 16;
}

/** How many bytes of payload a version holds at level M. */
function capacityOf(version) {
  const [, g1, d1, g2, d2] = VERSIONS_M[version];
  const dataCodewords = g1 * d1 + g2 * d2;
  return Math.floor((dataCodewords * 8 - 4 - countBits(version)) / 8);
}

/** The smallest version that will hold this much data at level M. */
function pickVersion(byteLength) {
  for (const version of Object.keys(VERSIONS_M).map(Number)) {
    if (byteLength <= capacityOf(version)) return version;
  }
  throw new Error('That is too much data for this encoder');
}

/** Mode + length + payload + padding, as a byte array of exactly the data size. */
function buildDataCodewords(bytes, version) {
  const [, g1, d1, g2, d2] = VERSIONS_M[version];
  const totalData = g1 * d1 + g2 * d2;

  const bits = [];
  const push = (value, length) => {
    for (let i = length - 1; i >= 0; i--) bits.push((value >> i) & 1);
  };

  push(0b0100, 4); // byte mode
  push(bytes.length, countBits(version));
  bytes.forEach((b) => push(b, 8));

  // Terminator, then pad to a whole byte.
  const spare = totalData * 8 - bits.length;
  push(0, Math.min(4, spare));
  while (bits.length % 8 !== 0) bits.push(0);

  const codewords = [];
  for (let i = 0; i < bits.length; i += 8) {
    codewords.push(bits.slice(i, i + 8).reduce((acc, bit) => (acc << 1) | bit, 0));
  }
  // The standard pad bytes, alternating.
  const PAD = [0xec, 0x11];
  let padIndex = 0;
  while (codewords.length < totalData) codewords.push(PAD[padIndex++ % 2]);
  return codewords;
}

/** Split into blocks, add error correction, and interleave as the spec requires. */
function interleave(dataCodewords, version) {
  const [ecCount, g1, d1, g2, d2] = VERSIONS_M[version];
  const blocks = [];
  let offset = 0;
  for (let i = 0; i < g1; i++) {
    blocks.push(dataCodewords.slice(offset, offset + d1));
    offset += d1;
  }
  for (let i = 0; i < g2; i++) {
    blocks.push(dataCodewords.slice(offset, offset + d2));
    offset += d2;
  }
  const ecBlocks = blocks.map((block) => ecCodewords(block, ecCount));

  const out = [];
  const longest = Math.max(...blocks.map((b) => b.length));
  for (let i = 0; i < longest; i++) {
    for (const block of blocks) if (i < block.length) out.push(block[i]);
  }
  for (let i = 0; i < ecCount; i++) {
    for (const block of ecBlocks) out.push(block[i]);
  }
  return out;
}

// -- Matrix -------------------------------------------------------------------

/** @returns {{modules:Int8Array[], reserved:Uint8Array[], size:number}} */
function blankMatrix(version) {
  const size = version * 4 + 17;
  const modules = Array.from({ length: size }, () => new Int8Array(size));
  const reserved = Array.from({ length: size }, () => new Uint8Array(size));
  return { modules, reserved, size };
}

function placeFinder(m, r, size, row, col) {
  for (let dy = -1; dy <= 7; dy++) {
    for (let dx = -1; dx <= 7; dx++) {
      const y = row + dy;
      const x = col + dx;
      if (y < 0 || y >= size || x < 0 || x >= size) continue;
      const onRing = (dy === 0 || dy === 6) && dx >= 0 && dx <= 6;
      const onSide = (dx === 0 || dx === 6) && dy >= 0 && dy <= 6;
      const inCore = dy >= 2 && dy <= 4 && dx >= 2 && dx <= 4;
      m[y][x] = onRing || onSide || inCore ? 1 : 0;
      r[y][x] = 1;
    }
  }
}

function placeAlignment(m, r, version) {
  const centres = ALIGNMENT[version];
  for (const row of centres) {
    for (const col of centres) {
      // The three finder corners have no alignment pattern.
      if (r[row][col]) continue;
      for (let dy = -2; dy <= 2; dy++) {
        for (let dx = -2; dx <= 2; dx++) {
          const ring = Math.max(Math.abs(dy), Math.abs(dx));
          m[row + dy][col + dx] = ring === 1 ? 0 : 1;
          r[row + dy][col + dx] = 1;
        }
      }
    }
  }
}

function placeTiming(m, r, size) {
  for (let i = 8; i < size - 8; i++) {
    const bit = i % 2 === 0 ? 1 : 0;
    if (!r[6][i]) {
      m[6][i] = bit;
      r[6][i] = 1;
    }
    if (!r[i][6]) {
      m[i][6] = bit;
      r[i][6] = 1;
    }
  }
}

/** Mark the format and version areas as off-limits to data. */
function reserveInfo(r, size, version) {
  for (let i = 0; i < 9; i++) {
    r[8][i] = 1;
    r[i][8] = 1;
  }
  for (let i = 0; i < 8; i++) {
    r[8][size - 1 - i] = 1;
    r[size - 1 - i][8] = 1;
  }
  if (version >= 7) {
    for (let i = 0; i < 6; i++) {
      for (let j = 0; j < 3; j++) {
        r[i][size - 11 + j] = 1;
        r[size - 11 + j][i] = 1;
      }
    }
  }
}

/** Walk the zigzag from bottom-right, skipping the function patterns. */
function placeData(m, r, size, codewords) {
  let bitIndex = 0;
  const totalBits = codewords.length * 8;
  const bitAt = (i) => (i < totalBits ? (codewords[i >> 3] >> (7 - (i & 7))) & 1 : 0);

  let upward = true;
  for (let right = size - 1; right > 0; right -= 2) {
    if (right === 6) right = 5; // the vertical timing column is skipped entirely
    for (let step = 0; step < size; step++) {
      const y = upward ? size - 1 - step : step;
      for (const x of [right, right - 1]) {
        if (r[y][x]) continue;
        m[y][x] = bitAt(bitIndex);
        bitIndex += 1;
      }
    }
    upward = !upward;
  }
}

const MASKS = [
  (y, x) => (y + x) % 2 === 0,
  (y) => y % 2 === 0,
  (y, x) => x % 3 === 0,
  (y, x) => (y + x) % 3 === 0,
  (y, x) => (Math.floor(y / 2) + Math.floor(x / 3)) % 2 === 0,
  (y, x) => ((y * x) % 2) + ((y * x) % 3) === 0,
  (y, x) => (((y * x) % 2) + ((y * x) % 3)) % 2 === 0,
  (y, x) => (((y + x) % 2) + ((y * x) % 3)) % 2 === 0,
];

/** The four penalty rules, used to choose the least ugly (most scannable) mask. */
function penalty(m, size) {
  let score = 0;

  // Rule 1: runs of five or more of the same colour.
  for (let i = 0; i < size; i++) {
    for (const read of [(k) => m[i][k], (k) => m[k][i]]) {
      let run = 1;
      for (let k = 1; k < size; k++) {
        if (read(k) === read(k - 1)) {
          run += 1;
        } else {
          if (run >= 5) score += run - 2;
          run = 1;
        }
      }
      if (run >= 5) score += run - 2;
    }
  }

  // Rule 2: 2x2 blocks of one colour.
  for (let y = 0; y < size - 1; y++) {
    for (let x = 0; x < size - 1; x++) {
      const v = m[y][x];
      if (v === m[y][x + 1] && v === m[y + 1][x] && v === m[y + 1][x + 1]) score += 3;
    }
  }

  // Rule 3: the finder-like 1:1:3:1:1 pattern with four light modules beside it.
  const A = [1, 0, 1, 1, 1, 0, 1, 0, 0, 0, 0];
  const B = [0, 0, 0, 0, 1, 0, 1, 1, 1, 0, 1];
  const matches = (read, start) => {
    let a = true;
    let b = true;
    for (let i = 0; i < 11; i++) {
      const v = read(start + i);
      if (v !== A[i]) a = false;
      if (v !== B[i]) b = false;
    }
    return a || b;
  };
  for (let i = 0; i < size; i++) {
    for (let start = 0; start <= size - 11; start++) {
      if (matches((k) => m[i][k], start)) score += 40;
      if (matches((k) => m[k][i], start)) score += 40;
    }
  }

  // Rule 4: how far the dark/light balance is from even.
  let dark = 0;
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) dark += m[y][x];
  const percent = (dark * 100) / (size * size);
  score += Math.floor(Math.abs(percent - 50) / 5) * 10;
  return score;
}

/** BCH(15,5) format information, including the fixed mask the spec applies. */
function formatBits(ecLevel, mask) {
  const data = (ecLevel << 3) | mask;
  let value = data << 10;
  for (let i = 14; i >= 10; i--) {
    if ((value >> i) & 1) value ^= 0b10100110111 << (i - 10);
  }
  return ((data << 10) | value) ^ 0b101010000010010;
}

function writeFormat(m, size, mask) {
  const bits = formatBits(EC_LEVEL_M, mask);
  // The spec numbers the format bits most-significant first, and that order is
  // what lands at (8,0) onwards. Getting this backwards still produces a
  // plausible-looking code that no scanner will read.
  const bit = (i) => (bits >> (14 - i)) & 1;

  for (let i = 0; i <= 5; i++) m[8][i] = bit(i);
  m[8][7] = bit(6);
  m[8][8] = bit(7);
  m[7][8] = bit(8);
  for (let i = 9; i <= 14; i++) m[14 - i][8] = bit(i);

  // The second copy is split 7 / 8, not 8 / 7: the module at (size-8, 8) is the
  // one that is always dark, so the column only carries bits 0-6 and the row
  // picks the rest up from column size-8.
  for (let i = 0; i <= 6; i++) m[size - 1 - i][8] = bit(i);
  for (let i = 7; i <= 14; i++) m[8][size - 8 + (i - 7)] = bit(i);

  m[size - 8][8] = 1; // the module that is always dark
}

function writeVersion(m, size, version) {
  if (version < 7) return;
  const bits = VERSION_INFO[version];
  for (let i = 0; i < 18; i++) {
    const bit = (bits >> i) & 1;
    const row = Math.floor(i / 3);
    const col = i % 3;
    m[row][size - 11 + col] = bit;
    m[size - 11 + col][row] = bit;
  }
}

/**
 * Encode text as a QR matrix.
 * @param {string} text
 * @returns {{size:number, modules:number[][], version:number}}
 */
export function qrMatrix(text, options = {}) {
  const bytes = toBytes(text);
  const version = pickVersion(bytes.length);
  const codewords = interleave(buildDataCodewords(bytes, version), version);

  const { modules, reserved, size } = blankMatrix(version);
  placeFinder(modules, reserved, size, 0, 0);
  placeFinder(modules, reserved, size, 0, size - 7);
  placeFinder(modules, reserved, size, size - 7, 0);
  placeAlignment(modules, reserved, version);
  placeTiming(modules, reserved, size);
  reserveInfo(reserved, size, version);
  reserved[size - 8][8] = 1; // the always-dark module
  placeData(modules, reserved, size, codewords);

  // Try every mask and keep the one the penalty rules like best.
  const tryMasks =
    options.forceMask === undefined ? [0, 1, 2, 3, 4, 5, 6, 7] : [options.forceMask];
  let best = null;
  for (const mask of tryMasks) {
    const candidate = modules.map((row) => Int8Array.from(row));
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        if (!reserved[y][x] && MASKS[mask](y, x)) candidate[y][x] ^= 1;
      }
    }
    writeFormat(candidate, size, mask);
    writeVersion(candidate, size, version);
    const score = penalty(candidate, size);
    if (!best || score < best.score) best = { score, mask, matrix: candidate };
  }

  return {
    size,
    version,
    mask: best.mask,
    score: best.score,
    modules: best.matrix.map((row) => Array.from(row)),
  };
}

/**
 * Render the code as an SVG element — one path for every dark module, which
 * keeps it to a single node however dense the code is.
 *
 * @param {string} text
 * @param {{quiet?:number, className?:string, label?:string}} [options]
 * @returns {SVGElement}
 */
export function qrSvg(text, options = {}) {
  const { size, modules } = qrMatrix(text);
  const quiet = options.quiet ?? 2; // the standard asks for 4; 2 is enough on a bright screen
  const total = size + quiet * 2;

  let path = '';
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      if (modules[y][x]) path += `M${x + quiet} ${y + quiet}h1v1h-1z`;
    }
  }

  const ns = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(ns, 'svg');
  svg.setAttribute('viewBox', `0 0 ${total} ${total}`);
  svg.setAttribute('shape-rendering', 'crispEdges');
  if (options.className) svg.setAttribute('class', options.className);
  svg.setAttribute('role', 'img');
  svg.setAttribute('aria-label', options.label || 'QR code to join the game');

  const background = document.createElementNS(ns, 'rect');
  background.setAttribute('width', String(total));
  background.setAttribute('height', String(total));
  background.setAttribute('fill', '#ffffff');
  svg.appendChild(background);

  const dark = document.createElementNS(ns, 'path');
  dark.setAttribute('d', path);
  dark.setAttribute('fill', '#150826');
  svg.appendChild(dark);
  return svg;
}
