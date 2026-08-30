'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

/**
 * The QR reader, checked against the QR encoder sitting next to it.
 *
 * The two were written from the same specification and share no code on
 * purpose — see the note on `functionModules` — so a round trip is a real test
 * rather than a tautology: an encoder that lays its data out wrongly and a
 * decoder that reads it back the same wrong way would have to make the same
 * mistake twice, independently, in opposite directions.
 *
 * What is deliberately NOT tested here is a photograph. Every test below builds
 * a perfect picture of a code and reads it, which proves the arithmetic and the
 * geometry and says nothing at all about glare, focus or a shaking hand. That
 * part is honest guesswork and the scanner treats it as such, throwing frames
 * away until one works.
 */

/** @type {(text:string, options?:object)=>any} */
let qrMatrix;
/** @type {(matrix:number[][])=>string|null} */
let decodeMatrix;
/** @type {(image:object)=>string|null} */
let decodeQr;

test.before(async () => {
  ({ qrMatrix } = await import('../public/qr.js'));
  ({ decodeMatrix, decodeQr } = await import('../public/qr-read.js'));
});

/** A join link of the shape the app actually makes. */
const JOIN = 'https://blob-nm9h.onrender.com/?c=4827&g=gofish';

const SAMPLES = [
  'A',
  '0000',
  JOIN,
  'http://localhost:4100/?c=0001&g=blob',
  'HELLO WORLD',
  '8675309',
  'https://blob-nm9h.onrender.com/?c=931744&g=sillyhead',
  'x'.repeat(60),
  'x'.repeat(150),
  'y'.repeat(200),
];

// -- The matrix, back into text ----------------------------------------------

test('reads back every code the encoder makes', () => {
  for (const text of SAMPLES) {
    const encoded = qrMatrix(text);
    assert.equal(decodeMatrix(encoded.modules), text, `round trip failed for ${text.slice(0, 30)}`);
  }
});

test('reads back every mask the encoder could choose', () => {
  for (let mask = 0; mask < 8; mask++) {
    const encoded = qrMatrix(JOIN, { forceMask: mask });
    assert.equal(encoded.mask, mask);
    assert.equal(decodeMatrix(encoded.modules), JOIN, `mask ${mask}`);
  }
});

test('reads back a code of every version the encoder supports', () => {
  const seen = new Set();
  for (let length = 1; length <= 210; length += 1) {
    const text = 'z'.repeat(length);
    const encoded = qrMatrix(text);
    if (seen.has(encoded.version)) continue;
    seen.add(encoded.version);
    assert.equal(decodeMatrix(encoded.modules), text, `version ${encoded.version}`);
  }
  assert.deepEqual([...seen].sort((a, b) => a - b), [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
});

// -- Damage -------------------------------------------------------------------

/**
 * Error correction is the whole reason a photograph of a code works at all, and
 * it is also the part that fails silently: a decoder with the wrong convention
 * for its Reed-Solomon roots reads undamaged codes perfectly and quietly invents
 * bytes for damaged ones. So the codes here are damaged on purpose.
 */

/** Flip `count` data modules, spread out, avoiding the finders and format bits. */
function damage(modules, count) {
  const size = modules.length;
  const copy = modules.map((row) => row.slice());
  let done = 0;
  // Walk a stride that is coprime with the area so the flips land all over the
  // code rather than in one corner, which any error correction would survive.
  for (let step = 0; done < count && step < size * size; step++) {
    const at = (step * 37) % (size * size);
    const y = Math.floor(at / size);
    const x = at % size;
    if (y < 9 && x < 9) continue; // top-left finder and format
    if (y < 9 && x >= size - 9) continue;
    if (y >= size - 9 && x < 9) continue;
    copy[y][x] ^= 1;
    done += 1;
  }
  return copy;
}

test('corrects a code with modules knocked out of it', () => {
  // Level M carries ten error-correction codewords on a version 1 code, so five
  // wrong bytes is the most it can fix. Three is comfortably inside that, and
  // the flips are spread so they land in different codewords.
  const encoded = qrMatrix(JOIN);
  for (const count of [1, 2, 3, 5, 8]) {
    assert.equal(decodeMatrix(damage(encoded.modules, count)), JOIN, `${count} modules flipped`);
  }
});

test('gives up rather than inventing text when a code is past saving', () => {
  const encoded = qrMatrix(JOIN);
  // Far more damage than the level can carry. The only acceptable answers are
  // null and the original string — never a different string, which is what a
  // decoder that trusts its own correction hands back.
  for (let count = 40; count <= 120; count += 20) {
    const out = decodeMatrix(damage(encoded.modules, count));
    assert.ok(out === null || out === JOIN, `heavy damage produced ${JSON.stringify(out)}`);
  }
});

test('refuses a grid that is not a QR code at all', () => {
  assert.equal(decodeMatrix([]), null);
  assert.equal(decodeMatrix([[1, 0], [0, 1]]), null);
  const noisy = Array.from({ length: 21 }, (_, y) => Array.from({ length: 21 }, (_, x) => (x * 7 + y * 3) % 2));
  const out = decodeMatrix(noisy);
  assert.ok(out === null || typeof out === 'string');
});

// -- The picture --------------------------------------------------------------

/**
 * Paint a matrix into a greyscale buffer, the way a camera would see it if the
 * camera were perfect: square on, in focus, evenly lit.
 *
 * @param {number[][]} modules
 * @param {{scale?:number, quiet?:number, dark?:number, light?:number, pad?:number}} [options]
 */
function paint(modules, options = {}) {
  const { scale = 6, quiet = 4, dark = 30, light = 230, pad = 0 } = options;
  const size = modules.length;
  const side = (size + quiet * 2) * scale;
  const width = side + pad * 2;
  const height = side + pad * 2;
  const data = new Uint8ClampedArray(width * height).fill(light);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      if (!modules[y][x]) continue;
      const left = pad + (x + quiet) * scale;
      const top = pad + (y + quiet) * scale;
      for (let dy = 0; dy < scale; dy++) {
        for (let dx = 0; dx < scale; dx++) data[(top + dy) * width + left + dx] = dark;
      }
    }
  }
  return { data, width, height };
}

/** The same buffer as RGBA, which is what a canvas actually hands over. */
function toRgba(image) {
  const data = new Uint8ClampedArray(image.width * image.height * 4);
  for (let i = 0; i < image.width * image.height; i++) {
    data[i * 4] = image.data[i];
    data[i * 4 + 1] = image.data[i];
    data[i * 4 + 2] = image.data[i];
    data[i * 4 + 3] = 255;
  }
  return { data, width: image.width, height: image.height };
}

function rotate(image) {
  const { width, height, data } = image;
  const out = new Uint8ClampedArray(data.length);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) out[x * height + (height - 1 - y)] = data[y * width + x];
  }
  return { data: out, width: height, height: width };
}

test('reads a clean picture of a code', () => {
  for (const text of SAMPLES) {
    const image = paint(qrMatrix(text).modules);
    assert.equal(decodeQr(image), text, `picture of ${text.slice(0, 30)}`);
  }
});

test('reads it as RGBA, which is what a canvas gives you', () => {
  assert.equal(decodeQr(toRgba(paint(qrMatrix(JOIN).modules))), JOIN);
});

test('reads it at the sizes a camera would see', () => {
  for (const scale of [3, 4, 6, 9, 14]) {
    assert.equal(decodeQr(paint(qrMatrix(JOIN).modules, { scale })), JOIN, `scale ${scale}`);
  }
});

test('reads it off centre, with room around it', () => {
  for (const pad of [0, 17, 60]) {
    assert.equal(decodeQr(paint(qrMatrix(JOIN).modules, { pad })), JOIN, `padded by ${pad}`);
  }
});

test('reads it whichever way up the phone is', () => {
  let image = paint(qrMatrix(JOIN).modules);
  for (let turn = 1; turn <= 3; turn++) {
    image = rotate(image);
    assert.equal(decodeQr(image), JOIN, `turned ${turn * 90} degrees`);
  }
});

test('reads it light on dark', () => {
  const image = paint(qrMatrix(JOIN).modules, { dark: 235, light: 25 });
  assert.equal(decodeQr(image), JOIN);
});

test('reads it in poor light, and across a gradient', () => {
  // Low contrast all over, which a single threshold for the whole frame copes
  // with, and then a bright corner, which is the case it does not.
  assert.equal(decodeQr(paint(qrMatrix(JOIN).modules, { dark: 96, light: 168 })), JOIN);

  const lit = paint(qrMatrix(JOIN).modules, { dark: 40, light: 200, pad: 20 });
  for (let y = 0; y < lit.height; y++) {
    for (let x = 0; x < lit.width; x++) {
      const at = y * lit.width + x;
      lit.data[at] = Math.min(255, lit.data[at] * (0.55 + (0.9 * x) / lit.width));
    }
  }
  assert.equal(decodeQr(lit), JOIN, 'across a lighting gradient');
});

/**
 * Draw the code as though the camera were looking at it from an angle.
 *
 * This is the case the alignment pattern exists for, and the one a person
 * actually creates: you do not hold your phone square-on to somebody else's
 * across a table, you lean over and point it. Rendered by mapping every output
 * pixel back through the same kind of homography the reader has to work out,
 * which means a reader that ignored the alignment pattern would sail through
 * every other test in this file and fail these.
 *
 * @param {number[][]} modules
 * @param {number} lean how much narrower the far edge is, as a fraction
 */
function paintTilted(modules, lean, { scale = 8, quiet = 4 } = {}) {
  const size = modules.length;
  const side = (size + quiet * 2) * scale;
  const width = side;
  const height = side;
  const data = new Uint8ClampedArray(width * height).fill(230);

  // A genuine projective map, not a linear squeeze. The difference matters: a
  // squeeze that narrows evenly down the page is not something any camera can
  // produce, and testing the reader against one would be asking it to model a
  // distortion that is not perspective and then failing it for not managing.
  const inset = (side * lean) / 2;
  const solve = perspective(
    [
      { x: inset, y: 0 },
      { x: side - inset, y: 0 },
      { x: side, y: side },
      { x: 0, y: side },
    ],
    [
      { x: 0, y: 0 },
      { x: 1, y: 0 },
      { x: 1, y: 1 },
      { x: 0, y: 1 },
    ]
  );
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const { x: u, y: v } = solve(x + 0.5, y + 0.5);
      const mx = Math.floor(u * (size + quiet * 2)) - quiet;
      const my = Math.floor(v * (size + quiet * 2)) - quiet;
      if (mx < 0 || my < 0 || mx >= size || my >= size) continue;
      if (modules[my][mx]) data[y * width + x] = 30;
    }
  }
  return { data, width, height };
}

/** The homography taking four points to four points — the test's own copy. */
function perspective(from, to) {
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
    [rows[col], rows[pivot]] = [rows[pivot], rows[col]];
    const lead = rows[col][col];
    for (let c = col; c <= 8; c++) rows[col][c] /= lead;
    for (let r = 0; r < 8; r++) {
      if (r === col) continue;
      const factor = rows[r][col];
      for (let c = col; c <= 8; c++) rows[r][c] -= factor * rows[col][c];
    }
  }
  const h = rows.map((row) => row[8]);
  return (x, y) => {
    const w = h[6] * x + h[7] * y + 1;
    return { x: (h[0] * x + h[1] * y + h[2]) / w, y: (h[3] * x + h[4] * y + h[5]) / w };
  };
}

test('reads a code photographed at an angle', () => {
  const modules = qrMatrix(JOIN).modules;
  for (const lean of [0.1, 0.2, 0.3]) {
    assert.equal(decodeQr(paintTilted(modules, lean)), JOIN, `leaning ${lean}`);
  }
});

/** A cheap box blur — a camera that has not finished focusing. */
function blur(image, radius) {
  const { width, height, data } = image;
  const out = new Uint8ClampedArray(data.length);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let sum = 0;
      let seen = 0;
      for (let dy = -radius; dy <= radius; dy++) {
        for (let dx = -radius; dx <= radius; dx++) {
          const ny = y + dy;
          const nx = x + dx;
          if (ny < 0 || ny >= height || nx < 0 || nx >= width) continue;
          sum += data[ny * width + nx];
          seen += 1;
        }
      }
      out[y * width + x] = sum / seen;
    }
  }
  return { data: out, width, height };
}

test('reads a code the camera has not quite focused on', () => {
  const image = paint(qrMatrix(JOIN).modules, { scale: 8 });
  for (const radius of [1, 2]) {
    assert.equal(decodeQr(blur(image, radius)), JOIN, `blurred by ${radius}`);
  }
});

test('reads a code through sensor noise', () => {
  // A fixed sequence rather than Math.random, so a failure here is a failure
  // that can be run again.
  let seed = 12345;
  const next = () => {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    return seed / 0x7fffffff;
  };
  const image = paint(qrMatrix(JOIN).modules, { scale: 6, dark: 60, light: 190 });
  for (let i = 0; i < image.data.length; i++) {
    image.data[i] = Math.max(0, Math.min(255, image.data[i] + (next() - 0.5) * 60));
  }
  assert.equal(decodeQr(image), JOIN);
});

test('reads a code that is tilted AND out of focus', () => {
  // Neither on its own is what a camera hands over. Both at once is.
  assert.equal(decodeQr(blur(paintTilted(qrMatrix(JOIN).modules, 0.2), 1)), JOIN);
});

test('finds a small code in a big busy frame', () => {
  // What a viewfinder actually contains: a code taking up a fraction of the
  // picture, with a table, a hand and the rest of the room around it.
  const code = paint(qrMatrix(JOIN).modules, { scale: 4, quiet: 3 });
  const width = 640;
  const height = 480;
  const data = new Uint8ClampedArray(width * height);
  let seed = 99;
  const next = () => {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    return seed / 0x7fffffff;
  };
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      // Stripes and blobs — something with edges in it, not a flat backdrop.
      const busy = 120 + 60 * Math.sin(x / 9) + 40 * Math.sin(y / 5) + next() * 30;
      data[y * width + x] = Math.max(0, Math.min(255, busy));
    }
  }
  const left = 210;
  const top = 96;
  for (let y = 0; y < code.height; y++) {
    for (let x = 0; x < code.width; x++) {
      data[(top + y) * width + left + x] = code.data[y * code.width + x];
    }
  }
  assert.equal(decodeQr({ data, width, height }), JOIN);
});

test('reads a frame fast enough to run on a live camera', () => {
  // Not a benchmark, a floor. The scanner asks for about ten frames a second,
  // so a read that took a tenth of a second would eat the whole budget and the
  // preview would stutter. Generous enough not to fail on a busy machine.
  const code = paint(qrMatrix(JOIN).modules, { scale: 5, quiet: 3 });
  const width = 640;
  const height = 480;
  const data = new Uint8ClampedArray(width * height).fill(200);
  for (let y = 0; y < code.height; y++) {
    for (let x = 0; x < code.width; x++) {
      data[(y + 60) * width + x + 180] = code.data[y * code.width + x];
    }
  }
  const frame = { data, width, height };
  assert.equal(decodeQr(frame), JOIN);

  const started = process.hrtime.bigint();
  for (let i = 0; i < 10; i++) decodeQr(frame);
  const each = Number(process.hrtime.bigint() - started) / 1e6 / 10;
  assert.ok(each < 60, `a frame took ${each.toFixed(1)}ms`);
});

test('says nothing rather than something wrong when there is no code there', () => {
  const width = 200;
  const height = 150;
  const data = new Uint8ClampedArray(width * height);
  for (let i = 0; i < data.length; i++) data[i] = (i * 97) % 256;
  assert.equal(decodeQr({ data, width, height }), null);
  assert.equal(decodeQr({ data: new Uint8ClampedArray(width * height).fill(255), width, height }), null);
  assert.equal(decodeQr(null), null);
  assert.equal(decodeQr({ width: 0, height: 0, data: new Uint8ClampedArray(0) }), null);
});
