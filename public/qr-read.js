/**
 * Reading a QR code, written out by hand for the same reason the encoder next
 * door was: this app has no dependencies and is not about to grow one for a
 * feature the encoder already proves is in scope.
 *
 * There IS a browser API for this — `BarcodeDetector` — and `scan.js` uses it
 * when it is there, because a native decoder will always be faster than ours.
 * It is not there on iOS, which is most of the phones this app is played on, so
 * a scanner built only on it would not work for the person who asked for one.
 * Hence this.
 *
 * Two halves, and they fail differently:
 *
 * The back half — format info, unmasking, de-interleaving, Reed-Solomon, the
 * bitstream — is arithmetic. It is either right or it is obviously wrong, and
 * `test/qr-read.test.js` checks it against every code `qr.js` can produce,
 * including deliberately corrupted ones.
 *
 * The front half — turning a photograph into a grid of light and dark squares —
 * is a guess. Blur, glare, tilt and a camera still hunting for focus all make it
 * a worse guess. That is survivable here in a way it would not be in a
 * still-image decoder, because the scanner runs this on a live camera several
 * times a second: a frame that fails costs nothing, and one good frame is all
 * anybody needs. Nothing in here retries or accumulates. One frame in, one
 * answer or null out.
 *
 * Scope, deliberately: versions 1 to 10, every error-correction level, and the
 * numeric, alphanumeric and byte modes. That covers every code this app makes
 * with a lot of room over. Kanji, ECI and structured append are not handled and
 * return null rather than nonsense.
 */

// -- GF(256) ------------------------------------------------------------------
//
// The same field the encoder uses, and it needs division as well, which is why
// the tables are here rather than imported: an inverse wants the log table
// directly and there is no sense exporting half a field.

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
const inv = (a) => EXP[255 - LOG[a]];
const div = (a, b) => (a === 0 ? 0 : EXP[LOG[a] + 255 - LOG[b]]);

/** Polynomials are arrays, highest power first — the same order as the encoder. */
function polyAdd(a, b) {
  const out = new Array(Math.max(a.length, b.length)).fill(0);
  for (let i = 0; i < a.length; i++) out[i + out.length - a.length] = a[i];
  for (let i = 0; i < b.length; i++) out[i + out.length - b.length] ^= b[i];
  return out;
}

function polyMul(a, b) {
  const out = new Array(a.length + b.length - 1).fill(0);
  for (let i = 0; i < a.length; i++) {
    for (let j = 0; j < b.length; j++) out[i + j] ^= mul(a[i], b[j]);
  }
  return out;
}

/** p(x) at x. */
function polyEval(p, x) {
  let y = 0;
  for (const c of p) y = mul(y, x) ^ c;
  return y;
}

// -- The tables ---------------------------------------------------------------

/**
 * How each version splits into blocks, for each error-correction level:
 * [ec codewords per block, blocks in group 1, data per block, blocks in group 2,
 * data per block]. Level M is the same table `qr.js` encodes against, and the
 * other three are here because a scanner that could only read our own codes
 * would be a strange thing to build.
 */
const BLOCKS = {
  1: { L: [7, 1, 19, 0, 0], M: [10, 1, 16, 0, 0], Q: [13, 1, 13, 0, 0], H: [17, 1, 9, 0, 0] },
  2: { L: [10, 1, 34, 0, 0], M: [16, 1, 28, 0, 0], Q: [22, 1, 22, 0, 0], H: [28, 1, 16, 0, 0] },
  3: { L: [15, 1, 55, 0, 0], M: [26, 1, 44, 0, 0], Q: [18, 2, 17, 0, 0], H: [22, 2, 13, 0, 0] },
  4: { L: [20, 1, 80, 0, 0], M: [18, 2, 32, 0, 0], Q: [26, 2, 24, 0, 0], H: [16, 4, 9, 0, 0] },
  5: { L: [26, 1, 108, 0, 0], M: [24, 2, 43, 0, 0], Q: [18, 2, 15, 2, 16], H: [22, 2, 11, 2, 12] },
  6: { L: [18, 2, 68, 0, 0], M: [16, 4, 27, 0, 0], Q: [24, 4, 19, 0, 0], H: [28, 4, 15, 0, 0] },
  7: { L: [20, 2, 78, 0, 0], M: [18, 4, 31, 0, 0], Q: [18, 2, 14, 4, 15], H: [26, 4, 13, 1, 14] },
  8: { L: [24, 2, 97, 0, 0], M: [22, 2, 38, 2, 39], Q: [22, 4, 18, 2, 19], H: [26, 4, 14, 2, 15] },
  9: { L: [30, 2, 116, 0, 0], M: [22, 3, 36, 2, 37], Q: [20, 4, 16, 4, 17], H: [24, 4, 12, 4, 13] },
  10: { L: [18, 2, 68, 2, 69], M: [26, 4, 43, 1, 44], Q: [24, 6, 19, 2, 20], H: [28, 6, 15, 2, 16] },
};

/** Centres of the alignment patterns, per version — the encoder's table again. */
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

/** The two bits the format information uses for each level, and back again. */
const LEVEL_BY_BITS = { 0: 'M', 1: 'L', 2: 'H', 3: 'Q' };

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

const ALPHANUMERIC = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ $%*+-./:';

// -- Where the data is not ----------------------------------------------------

/**
 * The modules a version spends on finders, timing, alignment and the format
 * information — everything the data has to be read around.
 *
 * Built here rather than imported from `qr.js`, which builds the same map on its
 * way to somewhere else. Two copies of a lookup table is a real cost and it is
 * paid on purpose: exporting it would mean the encoder could not be rearranged
 * without breaking the decoder, and `test/qr-read.test.js` decodes what
 * `qr.js` encodes on every run, which catches the two drifting apart far more
 * directly than sharing the function would prevent it.
 */
function functionModules(version) {
  const size = version * 4 + 17;
  const reserved = Array.from({ length: size }, () => new Uint8Array(size));

  const finder = (row, col) => {
    for (let dy = -1; dy <= 7; dy++) {
      for (let dx = -1; dx <= 7; dx++) {
        const y = row + dy;
        const x = col + dx;
        if (y < 0 || y >= size || x < 0 || x >= size) continue;
        reserved[y][x] = 1;
      }
    }
  };
  finder(0, 0);
  finder(0, size - 7);
  finder(size - 7, 0);

  for (const row of ALIGNMENT[version]) {
    for (const col of ALIGNMENT[version]) {
      if (reserved[row][col]) continue; // the finder corners have none
      for (let dy = -2; dy <= 2; dy++) {
        for (let dx = -2; dx <= 2; dx++) reserved[row + dy][col + dx] = 1;
      }
    }
  }

  for (let i = 8; i < size - 8; i++) {
    reserved[6][i] = 1;
    reserved[i][6] = 1;
  }

  for (let i = 0; i < 9; i++) {
    reserved[8][i] = 1;
    reserved[i][8] = 1;
  }
  for (let i = 0; i < 8; i++) {
    reserved[8][size - 1 - i] = 1;
    reserved[size - 1 - i][8] = 1;
  }
  if (version >= 7) {
    for (let i = 0; i < 6; i++) {
      for (let j = 0; j < 3; j++) {
        reserved[i][size - 11 + j] = 1;
        reserved[size - 11 + j][i] = 1;
      }
    }
  }
  reserved[size - 8][8] = 1; // the module that is always dark
  return { reserved, size };
}

// -- Format information -------------------------------------------------------

/** BCH(15,5) format information, including the fixed mask — the encoder's. */
function formatBits(ecBits, mask) {
  const data = (ecBits << 3) | mask;
  let value = data << 10;
  for (let i = 14; i >= 10; i--) {
    if ((value >> i) & 1) value ^= 0b10100110111 << (i - 10);
  }
  return ((data << 10) | value) ^ 0b101010000010010;
}

/** All thirty-two valid format strings, so a read one can be snapped to the nearest. */
const FORMATS = (() => {
  const out = [];
  for (let ecBits = 0; ecBits < 4; ecBits++) {
    for (let mask = 0; mask < 8; mask++) out.push({ ecBits, mask, bits: formatBits(ecBits, mask) });
  }
  return out;
})();

const bitCount = (n) => {
  let count = 0;
  while (n) {
    n &= n - 1;
    count += 1;
  }
  return count;
};

/**
 * Which level and which mask, read from the two copies written into the code.
 *
 * Corrected rather than trusted. Fifteen bits carrying five means the nearest
 * valid string within three wrong bits is the right one, and format information
 * sits next to the finders where a thumb or a glare is most likely to be — so
 * "read it and hope" throws away codes that are perfectly readable.
 */
function readFormat(matrix, size) {
  const copies = [];

  let a = 0;
  for (let i = 0; i <= 5; i++) a = (a << 1) | matrix[8][i];
  a = (a << 1) | matrix[8][7];
  a = (a << 1) | matrix[8][8];
  a = (a << 1) | matrix[7][8];
  for (let i = 9; i <= 14; i++) a = (a << 1) | matrix[14 - i][8];
  copies.push(a);

  let b = 0;
  for (let i = 0; i <= 6; i++) b = (b << 1) | matrix[size - 1 - i][8];
  for (let i = 7; i <= 14; i++) b = (b << 1) | matrix[8][size - 8 + (i - 7)];
  copies.push(b);

  let best = null;
  for (const copy of copies) {
    for (const format of FORMATS) {
      const distance = bitCount(copy ^ format.bits);
      if (!best || distance < best.distance) best = { distance, format };
      if (distance === 0) return format;
    }
  }
  // Past three wrong bits the correction is a coin toss, and a wrong mask
  // produces confident rubbish rather than a failure — so it stops instead.
  return best && best.distance <= 3 ? best.format : null;
}

// -- Reed-Solomon, backwards --------------------------------------------------

/**
 * Correct a block in place, or say it cannot be.
 *
 * Textbook Berlekamp-Massey, Chien and Forney, over roots α^0 upward — which is
 * what the encoder's generator uses, and getting that wrong produces a decoder
 * that works perfectly on undamaged codes and silently mangles damaged ones. The
 * test suite corrupts codes on purpose for exactly that reason.
 *
 * @param {number[]} block data followed by its error-correction codewords
 * @param {number} ecCount how many of those are error correction
 * @returns {boolean} whether the block came out consistent
 */
function correctBlock(block, ecCount) {
  const syndromes = new Array(ecCount);
  let bad = false;
  for (let i = 0; i < ecCount; i++) {
    syndromes[i] = polyEval(block, EXP[i]);
    if (syndromes[i] !== 0) bad = true;
  }
  if (!bad) return true;

  // Berlekamp-Massey: the shortest register that produces those syndromes.
  let lambda = [1];
  let previous = [1];
  let scale = 1;
  let shift = 1;
  let length = 0;
  for (let n = 0; n < ecCount; n++) {
    let delta = syndromes[n];
    for (let i = 1; i <= length; i++) {
      const coefficient = lambda[lambda.length - 1 - i];
      if (coefficient) delta ^= mul(coefficient, syndromes[n - i]);
    }
    if (delta === 0) {
      shift += 1;
      continue;
    }
    const factor = div(delta, scale);
    const correction = previous.map((c) => mul(c, factor)).concat(new Array(shift).fill(0));
    if (2 * length <= n) {
      const was = lambda;
      lambda = polyAdd(lambda, correction);
      previous = was;
      scale = delta;
      length = n + 1 - length;
      shift = 1;
    } else {
      lambda = polyAdd(lambda, correction);
      shift += 1;
    }
  }

  // More errors than the code can carry. Better to fail than to invent bytes.
  if (length * 2 > ecCount || length === 0) return false;

  // Chien: which positions the locator points at.
  const positions = [];
  for (let i = 0; i < block.length; i++) {
    // Position i counts from the end, so it is the coefficient of x^i.
    if (polyEval(lambda, inv(EXP[i % 255])) === 0) positions.push(block.length - 1 - i);
  }
  if (positions.length !== length) return false;

  // Forney: and by how much each one is wrong.
  const syndromePoly = syndromes.slice().reverse(); // highest power first
  const omega = polyMul(syndromePoly, lambda).slice(-ecCount);
  // Λ'(x), which over GF(2) keeps only the odd powers.
  const derivative = [];
  const degree = lambda.length - 1;
  for (let i = 0; i < lambda.length; i++) {
    const power = degree - i;
    if (power % 2 === 1) derivative.push(lambda[i]);
    else if (power > 0) derivative.push(0);
  }

  for (const position of positions) {
    const i = block.length - 1 - position;
    const x = EXP[i % 255];
    const xInv = inv(x);
    const bottom = polyEval(derivative, xInv);
    if (bottom === 0) return false;
    block[position] ^= mul(x, div(polyEval(omega, xInv), bottom));
  }

  // Say so if it did not work, rather than handing back a plausible mess.
  for (let i = 0; i < ecCount; i++) {
    if (polyEval(block, EXP[i]) !== 0) return false;
  }
  return true;
}

// -- A matrix, into text ------------------------------------------------------

/**
 * Read a sampled grid of light and dark squares.
 *
 * @param {number[][]} sampled `sampled[y][x]`, 1 for dark
 * @returns {string|null}
 */
export function decodeMatrix(sampled) {
  const size = sampled.length;
  if (!size || sampled[0].length !== size) return null;
  if ((size - 17) % 4 !== 0) return null;
  const version = (size - 17) / 4;
  if (!BLOCKS[version]) return null;

  const format = readFormat(sampled, size);
  if (!format) return null;
  const level = LEVEL_BY_BITS[format.ecBits];
  const [ecCount, group1, data1, group2, data2] = BLOCKS[version][level];

  // Unmask, then walk the zigzag the encoder wrote along.
  const { reserved } = functionModules(version);
  const unmasked = sampled.map((row, y) =>
    Array.from(row, (bit, x) => (reserved[y][x] ? bit : bit ^ (MASKS[format.mask](y, x) ? 1 : 0)))
  );

  const total = group1 * (data1 + ecCount) + group2 * (data2 + ecCount);
  const bits = [];
  let upward = true;
  for (let right = size - 1; right > 0; right -= 2) {
    if (right === 6) right = 5; // the vertical timing column is skipped entirely
    for (let step = 0; step < size; step++) {
      const y = upward ? size - 1 - step : step;
      for (const x of [right, right - 1]) {
        if (reserved[y][x]) continue;
        bits.push(unmasked[y][x]);
      }
    }
    upward = !upward;
  }
  const codewords = [];
  for (let i = 0; i + 8 <= bits.length && codewords.length < total; i += 8) {
    codewords.push(bits.slice(i, i + 8).reduce((acc, bit) => (acc << 1) | bit, 0));
  }
  if (codewords.length < total) return null;

  const data = deinterleave(codewords, ecCount, group1, data1, group2, data2);
  if (!data) return null;
  return readBitstream(data, version);
}

/** Undo the block interleaving, correct each block, and hand back the data. */
function deinterleave(codewords, ecCount, group1, data1, group2, data2) {
  const sizes = [];
  for (let i = 0; i < group1; i++) sizes.push(data1);
  for (let i = 0; i < group2; i++) sizes.push(data2);
  const blocks = sizes.map(() => []);

  let at = 0;
  const longest = Math.max(...sizes);
  for (let i = 0; i < longest; i++) {
    for (let b = 0; b < blocks.length; b++) {
      if (i < sizes[b]) blocks[b].push(codewords[at++]);
    }
  }
  const ec = blocks.map(() => []);
  for (let i = 0; i < ecCount; i++) {
    for (let b = 0; b < blocks.length; b++) ec[b].push(codewords[at++]);
  }

  const out = [];
  for (let b = 0; b < blocks.length; b++) {
    const full = blocks[b].concat(ec[b]);
    if (!correctBlock(full, ecCount)) return null;
    out.push(...full.slice(0, sizes[b]));
  }
  return out;
}

/** How many bits the character count takes, per mode and version. */
function countBits(mode, version) {
  if (version < 10) return mode === 1 ? 10 : mode === 2 ? 9 : 8;
  if (version < 27) return mode === 1 ? 12 : mode === 2 ? 11 : mode === 4 ? 16 : 10;
  return mode === 1 ? 14 : mode === 2 ? 13 : mode === 4 ? 16 : 12;
}

/** Mode, count, payload — repeated until a terminator or the codewords run out. */
function readBitstream(data, version) {
  let at = 0;
  const total = data.length * 8;
  const read = (count) => {
    let value = 0;
    for (let i = 0; i < count; i++) {
      value = (value << 1) | ((data[at >> 3] >> (7 - (at & 7))) & 1);
      at += 1;
    }
    return value;
  };

  const bytes = [];
  let text = '';
  while (at + 4 <= total) {
    const mode = read(4);
    if (mode === 0) break; // terminator
    const length = countBits(mode, version);
    if (at + length > total) return null;
    const count = read(length);

    if (mode === 4) {
      if (at + count * 8 > total) return null;
      for (let i = 0; i < count; i++) bytes.push(read(8));
      continue;
    }
    // A run of anything else ends the bytes gathered so far, so they decode in
    // the order they were written rather than all at the end.
    if (bytes.length) {
      text += new TextDecoder().decode(Uint8Array.from(bytes));
      bytes.length = 0;
    }
    if (mode === 1) {
      let left = count;
      while (left >= 3) {
        const group = read(10);
        text += String(group).padStart(3, '0');
        left -= 3;
      }
      if (left === 2) text += String(read(7)).padStart(2, '0');
      else if (left === 1) text += String(read(4));
    } else if (mode === 2) {
      let left = count;
      while (left >= 2) {
        const pair = read(11);
        text += ALPHANUMERIC[Math.floor(pair / 45)] + ALPHANUMERIC[pair % 45];
        left -= 2;
      }
      if (left === 1) text += ALPHANUMERIC[read(6)];
    } else {
      // Kanji, ECI, structured append, FNC1. Reading past one of these would be
      // guesswork, so whatever has been read stands and the rest is dropped.
      break;
    }
  }
  if (bytes.length) text += new TextDecoder().decode(Uint8Array.from(bytes));
  return text;
}

// -- A photograph, into a matrix ----------------------------------------------

/**
 * Everything below turns a frame from a camera into the grid above, and every
 * line of it is a guess that can be wrong. See the note at the top of the file:
 * the scanner calls this many times a second, so a frame that comes out as
 * nonsense simply fails its checksum and the next one is along in 100ms.
 */

/** Luminance, the usual weighting. */
function toGrey(image) {
  const { data, width, height } = image;
  const grey = new Uint8ClampedArray(width * height);
  // A greyscale buffer is allowed in as well, which is what the tests hand over.
  if (data.length === width * height) {
    grey.set(data);
    return grey;
  }
  for (let i = 0, p = 0; i < grey.length; i++, p += 4) {
    grey[i] = (data[p] * 77 + data[p + 1] * 150 + data[p + 2] * 29) >> 8;
  }
  return grey;
}

/** The side of the squares the threshold is worked out over. */
const BLOCK = 8;

/**
 * Light or dark, decided locally.
 *
 * One threshold for the whole frame does not survive a photograph: a phone
 * screen held under a light is brighter at one corner than the other, and a
 * global cut turns half the code into a solid block. So the frame is divided
 * into eight-pixel squares and each one is cut at its own midpoint, with the
 * flat squares — the quiet zone, a white table — taking their cue from their
 * neighbours instead, since a square with no contrast in it has no midpoint
 * worth having.
 */
function binarize(grey, width, height) {
  const across = Math.max(1, Math.ceil(width / BLOCK));
  const down = Math.max(1, Math.ceil(height / BLOCK));
  const points = new Float32Array(across * down);

  for (let by = 0; by < down; by++) {
    for (let bx = 0; bx < across; bx++) {
      let min = 255;
      let max = 0;
      for (let y = by * BLOCK; y < Math.min((by + 1) * BLOCK, height); y++) {
        for (let x = bx * BLOCK; x < Math.min((bx + 1) * BLOCK, width); x++) {
          const value = grey[y * width + x];
          if (value < min) min = value;
          if (value > max) max = value;
        }
      }
      let point = (min + max) / 2;
      if (max - min <= 24) {
        // Nothing but quiet zone, or nothing but the inside of one module. A
        // square with no contrast has no midpoint worth having, so it takes the
        // one its neighbours already settled on — and if it is the first square
        // in the frame, it assumes it is light.
        point = min / 2;
        if (by > 0 && bx > 0) {
          const near =
            (points[(by - 1) * across + bx] +
              2 * points[by * across + bx - 1] +
              points[(by - 1) * across + bx - 1]) /
            4;
          if (min < near) point = near;
        }
      }
      points[by * across + bx] = point;
    }
  }

  /*
    And then the thresholds are smoothed across their neighbours, which is the
    part that is not obvious and the part the whole thing turns on.

    Cutting each square at its own midpoint sounds right and is badly wrong when
    the squares happen to line up with the code's modules, which at a lot of
    ordinary distances they do. A square sitting inside a dark module has its
    midpoint dragged down by the dark, so the blur at its edge comes out light;
    the light square next door has its midpoint dragged up, so the same blur
    comes out dark. Every module boundary grows a one-pixel stripe of the wrong
    colour, every run in the image is chopped into fragments, and the finder
    scan reads a code whose modules are one pixel across.

    It cost an afternoon and it looks, in the binary image, exactly like a code
    drawn as an outline.
  */
  const bits = new Uint8Array(width * height);
  for (let by = 0; by < down; by++) {
    const top = by * BLOCK;
    for (let bx = 0; bx < across; bx++) {
      let sum = 0;
      let seen = 0;
      for (let dy = -2; dy <= 2; dy++) {
        for (let dx = -2; dx <= 2; dx++) {
          const y = by + dy;
          const x = bx + dx;
          if (y < 0 || y >= down || x < 0 || x >= across) continue;
          sum += points[y * across + x];
          seen += 1;
        }
      }
      const cut = sum / seen;
      const left = bx * BLOCK;
      for (let y = top; y < Math.min(top + BLOCK, height); y++) {
        for (let x = left; x < Math.min(left + BLOCK, width); x++) {
          bits[y * width + x] = grey[y * width + x] < cut ? 1 : 0;
        }
      }
    }
  }
  return bits;
}

/** Is a five-run sequence the 1:1:3:1:1 of a finder pattern? */
function isFinderRun(counts) {
  const total = counts[0] + counts[1] + counts[2] + counts[3] + counts[4];
  if (total < 7) return false;
  const module = total / 7;
  const slack = module / 2;
  return (
    Math.abs(module - counts[0]) < slack &&
    Math.abs(module - counts[1]) < slack &&
    Math.abs(3 * module - counts[2]) < 3 * slack &&
    Math.abs(module - counts[3]) < slack &&
    Math.abs(module - counts[4]) < slack
  );
}

/** Where the middle of that sequence was, given where it ended. */
function runCentre(counts, end) {
  return end - counts[4] - counts[3] - counts[2] / 2;
}

/**
 * The same 1:1:3:1:1, read down a column through a candidate centre.
 *
 * A row on its own finds every horizontal band that happens to have the right
 * proportions — the edge of a card, a line of text. Insisting the column agrees
 * is what makes it a finder pattern rather than a coincidence.
 */
function crossVertical(bits, width, height, cx, cy, wanted) {
  const counts = [0, 0, 0, 0, 0];
  const at = (y) => bits[y * width + cx];
  let y = cy;
  while (y >= 0 && at(y)) {
    counts[2] += 1;
    y -= 1;
  }
  if (y < 0) return null;
  while (y >= 0 && !at(y) && counts[1] <= wanted) {
    counts[1] += 1;
    y -= 1;
  }
  if (y < 0 || counts[1] > wanted) return null;
  while (y >= 0 && at(y) && counts[0] <= wanted) {
    counts[0] += 1;
    y -= 1;
  }
  if (counts[0] > wanted) return null;

  y = cy + 1;
  while (y < height && at(y)) {
    counts[2] += 1;
    y += 1;
  }
  if (y === height) return null;
  while (y < height && !at(y) && counts[3] < wanted) {
    counts[3] += 1;
    y += 1;
  }
  if (y === height || counts[3] >= wanted) return null;
  while (y < height && at(y) && counts[4] < wanted) {
    counts[4] += 1;
    y += 1;
  }
  if (counts[4] >= wanted) return null;

  return isFinderRun(counts) ? runCentre(counts, y) : null;
}

/** And back across the row, now that the column has moved the centre. */
function crossHorizontal(bits, width, cx, cy, wanted) {
  const counts = [0, 0, 0, 0, 0];
  const at = (x) => bits[cy * width + x];
  let x = cx;
  while (x >= 0 && at(x)) {
    counts[2] += 1;
    x -= 1;
  }
  if (x < 0) return null;
  while (x >= 0 && !at(x) && counts[1] <= wanted) {
    counts[1] += 1;
    x -= 1;
  }
  if (x < 0 || counts[1] > wanted) return null;
  while (x >= 0 && at(x) && counts[0] <= wanted) {
    counts[0] += 1;
    x -= 1;
  }
  if (counts[0] > wanted) return null;

  x = cx + 1;
  while (x < width && at(x)) {
    counts[2] += 1;
    x += 1;
  }
  if (x === width) return null;
  while (x < width && !at(x) && counts[3] < wanted) {
    counts[3] += 1;
    x += 1;
  }
  if (x === width || counts[3] >= wanted) return null;
  while (x < width && at(x) && counts[4] < wanted) {
    counts[4] += 1;
    x += 1;
  }
  if (counts[4] >= wanted) return null;

  return isFinderRun(counts) ? runCentre(counts, x) : null;
}

/**
 * Every finder pattern in the frame, clustered.
 *
 * The same pattern is found once per row it crosses, so twenty hits on one
 * corner are one corner. They are merged as they arrive and the merge keeps a
 * count, which is the useful part: something seen on eight rows is a finder
 * pattern and something seen once is a smudge.
 */
function findFinders(bits, width, height) {
  const found = [];
  const step = Math.max(1, Math.floor(height / 256));

  for (let y = 0; y < height; y += step) {
    const counts = [0, 0, 0, 0, 0];
    let state = 0;
    for (let x = 0; x < width; x++) {
      const dark = bits[y * width + x] === 1;
      if (dark === (state % 2 === 0)) {
        counts[state] += 1;
        continue;
      }
      if (state !== 4) {
        state += 1;
        counts[state] += 1;
        continue;
      }
      if (isFinderRun(counts)) consider(bits, width, height, counts, y, x, found);
      counts[0] = counts[2];
      counts[1] = counts[3];
      counts[2] = counts[4];
      counts[3] = 1;
      counts[4] = 0;
      state = 3;
    }
    if (state === 4 && isFinderRun(counts)) consider(bits, width, height, counts, y, width, found);
  }
  return found;
}

/** Confirm a row's guess against the column and the row again, then file it. */
function consider(bits, width, height, counts, y, end, found) {
  const total = counts[0] + counts[1] + counts[2] + counts[3] + counts[4];
  const guessX = Math.floor(runCentre(counts, end));
  if (guessX < 0 || guessX >= width) return;

  const centreY = crossVertical(bits, width, height, guessX, y, counts[2]);
  if (centreY === null) return;
  const centreX = crossHorizontal(bits, width, guessX, Math.floor(centreY), counts[2]);
  if (centreX === null) return;

  const module = total / 7;
  for (const other of found) {
    if (Math.abs(other.x - centreX) < other.module && Math.abs(other.y - centreY) < other.module) {
      const seen = other.count + 1;
      other.x = (other.x * other.count + centreX) / seen;
      other.y = (other.y * other.count + centreY) / seen;
      other.module = (other.module * other.count + module) / seen;
      other.count = seen;
      return;
    }
  }
  found.push({ x: centreX, y: centreY, module, count: 1 });
}

/**
 * Which corner is which.
 *
 * The two furthest apart are the top-right and bottom-left, whatever way up the
 * phone is being held; the one left over is the top-left, the corner all three
 * of a QR code's alignment hangs off. Which of the far two is which comes from
 * the sign of the cross product, and that is what makes a code read upside down
 * or in a mirror still read.
 */
function orderCorners(a, b, c) {
  const distance = (p, q) => (p.x - q.x) ** 2 + (p.y - q.y) ** 2;
  const ab = distance(a, b);
  const bc = distance(b, c);
  const ac = distance(a, c);
  let topLeft;
  let one;
  let two;
  if (bc >= ab && bc >= ac) {
    topLeft = a;
    one = b;
    two = c;
  } else if (ac >= ab && ac >= bc) {
    topLeft = b;
    one = a;
    two = c;
  } else {
    topLeft = c;
    one = a;
    two = b;
  }
  // Screen coordinates run down the page, so from the top-left corner the
  // top-right is +x and the bottom-left is +y, and that pair turns one way
  // round. The other sign is the same code seen in a mirror.
  const cross = (one.x - topLeft.x) * (two.y - topLeft.y) - (one.y - topLeft.y) * (two.x - topLeft.x);
  return cross >= 0 ? { topLeft, topRight: one, bottomLeft: two } : { topLeft, topRight: two, bottomLeft: one };
}

/**
 * The alignment pattern near the fourth corner, if it can be found.
 *
 * Worth the trouble because it is the only thing that measures the perspective.
 * A code photographed square-on needs nothing more than its three finders, and
 * one photographed across a table at an angle — which is exactly how a person
 * scans somebody else's phone — is a trapezium that the three-corner guess reads
 * progressively more wrongly the further from the top-left it gets. The bottom
 * right is where that error is largest, so a real point there is worth a search.
 *
 * Returning null is fine and common. It just means the three-corner estimate
 * stands, which is right for a flat scan and only slightly wrong for a tilted
 * one.
 */
function findAlignment(bits, width, height, guessX, guessY, module, allowance) {
  const span = Math.ceil(module * allowance);
  const left = Math.max(0, Math.floor(guessX - span));
  const right = Math.min(width - 1, Math.ceil(guessX + span));
  const top = Math.max(0, Math.floor(guessY - span));
  const bottom = Math.min(height - 1, Math.ceil(guessY + span));
  if (right - left < 3 || bottom - top < 3) return null;

  /*
    Dark, light, DARK, light, dark — five runs, and the middle one is the single
    module at the very centre of the pattern.

    The obvious reading is three runs, dark-light-dark, and it is wrong twice
    over. An alignment pattern is a dark five-square with a light ring inside it
    and one dark module in the middle, so a scan across its centre reads five
    runs; looking for three finds that twice, once either side, and lands a
    module out both times. And three runs are not distinctive enough to survive
    the wide search above — any small dark square in the data matches, and one
    of them is usually nearer to the guessed position than the real pattern is.

    The outer two runs are only required to EXIST rather than to be one module
    wide, because whatever the pattern is sitting on may be dark too and would
    run straight into them.
  */
  let best = null;
  for (let y = top; y <= bottom; y++) {
    const counts = [0, 0, 0, 0, 0];
    let state = 0;
    for (let x = left; x <= right; x++) {
      const dark = bits[y * width + x] === 1;
      if (dark === (state % 2 === 0)) {
        counts[state] += 1;
        continue;
      }
      if (state !== 4) {
        state += 1;
        counts[state] += 1;
        continue;
      }
      const centre = checkAlignment(bits, width, height, counts, x, y, module);
      if (centre) {
        const away = (centre.x - guessX) ** 2 + (centre.y - guessY) ** 2;
        if (!best || away < best.away) best = { ...centre, away };
      }
      counts[0] = counts[2];
      counts[1] = counts[3];
      counts[2] = counts[4];
      counts[3] = 1;
      counts[4] = 0;
      state = 3;
    }
  }
  return best;
}

/** Are five runs the 1:1:1 of an alignment pattern, with dark either side? */
function isAlignmentRun(counts, module) {
  const slack = module / 2;
  return (
    counts[0] >= module * 0.5 &&
    counts[4] >= module * 0.5 &&
    Math.abs(module - counts[1]) < slack &&
    Math.abs(module - counts[2]) < slack &&
    Math.abs(module - counts[3]) < slack
  );
}

/** The pattern confirmed down the column as well as across the row. */
function checkAlignment(bits, width, height, counts, end, y, module) {
  if (!isAlignmentRun(counts, module)) return null;
  // The middle run ends where the light one after it begins, so its centre is
  // half its own length back from there.
  const centreX = end - counts[4] - counts[3] - counts[2] / 2 - 0.5;
  const x = Math.round(centreX);
  if (x < 0 || x >= width) return null;

  const at = (row) => bits[row * width + x] === 1;
  const down = [0, 0, 0, 0, 0];
  const limit = Math.ceil(module * 3);
  let row = y;
  // Up from here: the middle dark run, the light ring, then the dark edge.
  while (row >= 0 && at(row) && down[2] <= limit) {
    down[2] += 1;
    row -= 1;
  }
  if (row < 0) return null;
  while (row >= 0 && !at(row) && down[1] <= limit) {
    down[1] += 1;
    row -= 1;
  }
  if (row < 0) return null;
  while (row >= 0 && at(row) && down[0] <= limit) {
    down[0] += 1;
    row -= 1;
  }
  const top = y - down[2] + 1;
  // And down from here, the same three the other way.
  row = y + 1;
  while (row < height && at(row) && down[2] <= limit * 2) {
    down[2] += 1;
    row += 1;
  }
  if (row >= height) return null;
  while (row < height && !at(row) && down[3] <= limit) {
    down[3] += 1;
    row += 1;
  }
  if (row >= height) return null;
  while (row < height && at(row) && down[4] <= limit) {
    down[4] += 1;
    row += 1;
  }
  if (!isAlignmentRun(down, module)) return null;
  return { x: centreX, y: top + down[2] / 2 - 0.5 };
}

/**
 * The homography taking four points to four points.
 *
 * Solved rather than assembled from a remembered formula: eight equations, eight
 * unknowns, straightforward elimination. Slower than the closed form and
 * impossible to get subtly wrong, which on a page of geometry nobody will read
 * again is the better trade.
 */
function homography(from, to) {
  const rows = [];
  for (let i = 0; i < 4; i++) {
    const { x, y } = from[i];
    const { x: u, y: v } = to[i];
    rows.push([x, y, 1, 0, 0, 0, -x * u, -y * u, u]);
    rows.push([0, 0, 0, x, y, 1, -x * v, -y * v, v]);
  }
  for (let col = 0; col < 8; col++) {
    let pivot = col;
    for (let r = col + 1; r < 8; r++) {
      if (Math.abs(rows[r][col]) > Math.abs(rows[pivot][col])) pivot = r;
    }
    if (Math.abs(rows[pivot][col]) < 1e-9) return null;
    [rows[col], rows[pivot]] = [rows[pivot], rows[col]];
    const lead = rows[col][col];
    for (let c = col; c <= 8; c++) rows[col][c] /= lead;
    for (let r = 0; r < 8; r++) {
      if (r === col) continue;
      const factor = rows[r][col];
      if (!factor) continue;
      for (let c = col; c <= 8; c++) rows[r][c] -= factor * rows[col][c];
    }
  }
  const h = rows.map((row) => row[8]);
  return (x, y) => {
    const w = h[6] * x + h[7] * y + 1;
    return { x: (h[0] * x + h[1] * y + h[2]) / w, y: (h[3] * x + h[4] * y + h[5]) / w };
  };
}

/**
 * Read one frame.
 *
 * @param {{data:Uint8ClampedArray|Uint8Array, width:number, height:number}} image
 *   RGBA as `getImageData` hands it over, or a plain greyscale buffer.
 * @returns {string|null} what the code said, or null for "not this frame"
 */
export function decodeQr(image) {
  if (!image || !image.width || !image.height) return null;
  const grey = toGrey(image);
  const bits = binarize(grey, image.width, image.height);
  const straight = readFrom(bits, image.width, image.height);
  if (straight !== null) return straight;
  // A code drawn light-on-dark — a phone in dark mode showing one, say. One
  // pass with everything the other way round costs a frame we were going to
  // throw away anyway.
  const flipped = new Uint8Array(bits.length);
  for (let i = 0; i < bits.length; i++) flipped[i] = bits[i] ? 0 : 1;
  return readFrom(flipped, image.width, image.height);
}

function readFrom(bits, width, height) {
  const finders = findFinders(bits, width, height);
  if (finders.length < 3) return null;

  // Most seen first: a finder pattern is crossed by many rows and a coincidence
  // usually is not. Only the best three are tried — the next frame is 100ms
  // away, and trying every combination of nine candidates on a busy background
  // would cost more than it ever found.
  finders.sort((a, b) => b.count - a.count);
  const [a, b, c] = finders;
  const { topLeft, topRight, bottomLeft } = orderCorners(a, b, c);

  const module = (topLeft.module + topRight.module + bottomLeft.module) / 3;
  if (!(module > 0.7)) return null;

  /*
    How many modules across, which is a measurement rather than a fact.

    Each side is counted with the module size measured at ITS two ends, not with
    one average for the whole code: a code photographed at an angle has modules
    a third bigger at the near edge than the far one, and a single average
    charges the wide end's module size to the narrow end's side.

    Even then it is only close. So the nearest valid size is tried, and then the
    ones either side of it, rather than the estimate being rounded and trusted:
    at a steep angle the count comes out a module or two over, and every one of
    those guesses is a code that would simply have failed to scan. A wrong guess
    costs a few hundred microseconds and cannot produce a wrong answer — the
    format information and then the Reed-Solomon check both have to pass, and
    on a grid sampled at the wrong pitch neither does.
  */
  const span = (p, q) => Math.hypot(p.x - q.x, p.y - q.y);
  const acrossModule = (topLeft.module + topRight.module) / 2;
  const downModule = (topLeft.module + bottomLeft.module) / 2;
  const estimate =
    (span(topLeft, topRight) / acrossModule + span(topLeft, bottomLeft) / downModule) / 2 + 7;
  const nearest = Math.round((estimate - 21) / 4) * 4 + 21;

  for (const size of [nearest, nearest - 4, nearest + 4]) {
    const version = (size - 17) / 4;
    if (!BLOCKS[version]) continue;
    const out = readAt(bits, width, height, { topLeft, topRight, bottomLeft }, size, module);
    if (out !== null) return out;
  }
  return null;
}

/** Sample the code as though it were `size` modules across, and read it. */
function readAt(bits, width, height, corners, size, module) {
  const { topLeft, topRight, bottomLeft } = corners;
  const version = (size - 17) / 4;

  // Where the fourth corner would be if the code were a perfect parallelogram,
  // which is the starting guess and, for a flat scan, the answer.
  const cornerX = topRight.x - topLeft.x + bottomLeft.x;
  const cornerY = topRight.y - topLeft.y + bottomLeft.y;

  let to = [topLeft, topRight, { x: cornerX, y: cornerY }, bottomLeft];
  let bottomRight = size - 3.5;
  if (version >= 2) {
    const pull = 1 - 3 / (size - 7);
    /*
      Searched in widening circles, nearest first.

      Where the pattern OUGHT to be is worked out by pretending the code is a
      parallelogram, which is precisely the assumption the alignment pattern is
      being looked up to correct - so the steeper the angle, the further from
      the guess the real thing is, and at the angles that need it most the guess
      can be half a dozen modules out. A small search first, because the nearest
      match inside a small circle is almost certainly the right one; a wider one
      only if that found nothing, since a wide search over ordinary data will
      eventually find something that looks like a small dark square.
    */
    /*
      And searched for at the module size it will actually be drawn at down
      there, not the average across the whole code.

      Perspective is the entire reason this search exists, so assuming the
      modules are the same size at the far corner as at the near one is assuming
      away the problem: at a steep angle the centre module of the pattern came
      out half as big again as the average, the ratio check called it too fat to
      be one module, and the search returned nothing on precisely the codes that
      needed it. Extrapolated from the three corners that were measured, which
      is not exact - a homography does not scale linearly - but is much closer
      than one number for the whole picture.
    */
    const cornerModule = Math.max(1, topRight.module + bottomLeft.module - topLeft.module);
    let found = null;
    for (const allowance of [4, 8, 16]) {
      found = findAlignment(
        bits,
        width,
        height,
        topLeft.x + pull * (cornerX - topLeft.x),
        topLeft.y + pull * (cornerY - topLeft.y),
        cornerModule,
        allowance
      );
      if (found) break;
    }
    if (found) {
      to = [topLeft, topRight, found, bottomLeft];
      bottomRight = size - 6.5;
    }
  }

  const project = homography(
    [
      { x: 3.5, y: 3.5 },
      { x: size - 3.5, y: 3.5 },
      { x: bottomRight, y: bottomRight },
      { x: 3.5, y: size - 3.5 },
    ],
    to
  );
  if (!project) return null;

  const sampled = [];
  for (let y = 0; y < size; y++) {
    const row = new Array(size);
    for (let x = 0; x < size; x++) {
      const point = project(x + 0.5, y + 0.5);
      const px = Math.round(point.x);
      const py = Math.round(point.y);
      if (px < 0 || px >= width || py < 0 || py >= height) return null;
      row[x] = bits[py * width + px];
    }
    sampled.push(row);
  }
  return decodeMatrix(sampled);
}
