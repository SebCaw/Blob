'use strict';

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

/**
 * Draw the Blob app icon straight to PNG.
 *
 * There is no image library here and no build step, so the icon is rasterised
 * by hand: the shapes are simple maths, sampled 4x4 per pixel for smooth edges,
 * and PNG is a short enough format to write out with zlib and a CRC table.
 *
 * Run with: node scripts/make-icons.js
 */

const OUT_DIR = path.join(__dirname, '..', 'public', 'icons');
const SIZES = [180, 192, 512];
const SAMPLES = 4;

const NIGHT = [21, 8, 38];
const LIME = [200, 255, 61];
const LIME_DEEP = [159, 214, 20];
const INK = [27, 11, 51];
const WHITE = [255, 255, 255];

/** Is this point inside the blob body? A circle, nudged out of round. */
function inBody(x, y) {
  const dx = x - 0.5;
  const dy = y - 0.53;
  const wobble = 1 + 0.045 * Math.sin(Math.atan2(dy, dx) * 3 + 0.6);
  return Math.hypot(dx / 1.02, dy) < 0.335 * wobble;
}

const inCircle = (x, y, cx, cy, r) => Math.hypot(x - cx, y - cy) < r;

/** The colour at a point in the unit square, or null for the background. */
function sample(x, y) {
  // Eyes and their highlights sit on top of the body.
  if (inCircle(x, y, 0.385, 0.5, 0.072) || inCircle(x, y, 0.615, 0.5, 0.072)) {
    if (inCircle(x, y, 0.405, 0.478, 0.026) || inCircle(x, y, 0.635, 0.478, 0.026)) return WHITE;
    return INK;
  }
  // The smile: the gap between two circles, clipped to the lower half.
  if (y > 0.6 && inCircle(x, y, 0.5, 0.545, 0.135) && !inCircle(x, y, 0.5, 0.5, 0.115)) return INK;

  if (inBody(x, y)) {
    // A soft top-to-bottom shade so the shape reads at 16 pixels.
    const t = Math.min(1, Math.max(0, (y - 0.22) / 0.62));
    return LIME.map((channel, i) => Math.round(channel + (LIME_DEEP[i] - channel) * t * 0.75));
  }
  return null;
}

function render(size) {
  const pixels = Buffer.alloc(size * size * 4);
  const radius = size * 0.22; // the rounded square the platforms expect

  for (let py = 0; py < size; py++) {
    for (let px = 0; px < size; px++) {
      let r = 0;
      let g = 0;
      let b = 0;
      let a = 0;
      for (let sy = 0; sy < SAMPLES; sy++) {
        for (let sx = 0; sx < SAMPLES; sx++) {
          const x = (px + (sx + 0.5) / SAMPLES) / size;
          const y = (py + (sy + 0.5) / SAMPLES) / size;
          if (!insideRoundedSquare(x * size, y * size, size, radius)) continue;
          const colour = sample(x, y) || NIGHT;
          r += colour[0];
          g += colour[1];
          b += colour[2];
          a += 255;
        }
      }
      const total = SAMPLES * SAMPLES;
      const index = (py * size + px) * 4;
      const alpha = a / total;
      // Un-premultiply so the rounded corners stay clean against any backdrop.
      const scale = alpha > 0 ? 255 / a : 0;
      pixels[index] = Math.round(r * scale);
      pixels[index + 1] = Math.round(g * scale);
      pixels[index + 2] = Math.round(b * scale);
      pixels[index + 3] = Math.round(alpha);
    }
  }
  return pixels;
}

function insideRoundedSquare(x, y, size, radius) {
  const cx = Math.min(Math.max(x, radius), size - radius);
  const cy = Math.min(Math.max(y, radius), size - radius);
  return Math.hypot(x - cx, y - cy) <= radius;
}

// -- PNG ---------------------------------------------------------------------

const CRC_TABLE = (() => {
  const table = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c;
  }
  return table;
})();

function crc32(buffer) {
  let c = 0xffffffff;
  for (const byte of buffer) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([length, body, crc]);
}

function toPng(pixels, size) {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(size, 0);
  header.writeUInt32BE(size, 4);
  header[8] = 8; // bit depth
  header[9] = 6; // RGBA
  // Each scanline is prefixed with its filter type; 0 (none) is plenty here.
  const raw = Buffer.alloc((size * 4 + 1) * size);
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0;
    pixels.copy(raw, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4);
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', header),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  for (const size of SIZES) {
    const file = path.join(OUT_DIR, `blob-${size}.png`);
    fs.writeFileSync(file, toPng(render(size), size));
    console.log(`wrote ${path.relative(process.cwd(), file)} (${size}x${size})`);
  }
}

if (require.main === module) main();

module.exports = { render, toPng };
