#!/usr/bin/env node
// Draws the app icons (public/icons/*.png and icon.svg) with no image library: the OpenParlor mark (a lit doorway with a p in it) on a mustard tile in
// the printed-box-game style. Run `node scripts/make-icons.js` after changing the design, and commit the result.
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const OUT = path.join(__dirname, '..', 'public', 'icons');
const MUSTARD = [242, 182, 50];
const TEAL = [35, 128, 128];
const INK = [29, 26, 23];
const PAPER = [255, 251, 242];

// The OpenParlor mark (see scripts/make-brand.js, which draws the same shapes as SVG), in a 100 x 100 box.
const inArch = (x, y, grow = 0, dx = 0, dy = 0) => {
  const l = 24 - grow + dx, r = 76 + grow + dx, cy = 40 + dy, b = 80 + grow + dy, rad = 26 + grow;
  if (y > b || x < l || x > r) return false;
  return y >= cy || Math.hypot(x - (50 + dx), y - cy) <= rad;
};
const inFloor = (x, y, dx = 0, dy = 0) => {
  const cx = Math.min(Math.max(x, 21 + dx), 79 + dx), cy = 83 + dy;
  return Math.hypot(x - cx, y - cy) <= 4;
};
const segDist = (x, y, x1, y1, y2) => Math.hypot(x - x1, y - Math.min(Math.max(y, y1), y2));
function color(u, v, scale) {
  const x = 50 + (u * 100 - 50) / scale; // scale < 1 shrinks the artwork towards the middle (used for the maskable icon)
  const y = 50 + (v * 100 - 50) / scale;
  const d = Math.hypot(x - 52, y - 41);
  if (inArch(x, y) && Math.abs(d - 12) <= 3.5) return PAPER; // the bowl of the p
  if (inArch(x, y) && d < 4) return MUSTARD; // the dot: you, in the room
  if (inArch(x, y) && segDist(x, y, 39.5, 29, 65) <= 3.5) return PAPER; // the stem of the p
  if (inArch(x, y)) return TEAL;
  if (inArch(x, y, 1.6) || inFloor(x, y)) return INK;
  if (inArch(x, y, 1.6, 3.5, 3.5) || inFloor(x, y, 3.5, 3.5)) return INK; // the hard offset shadow
  return MUSTARD;
}

function render(size, scale) {
  const px = Buffer.alloc(size * size * 4);
  const n = 3; // 3 x 3 samples per pixel for smooth edges
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let r = 0, g = 0, b = 0;
      for (let j = 0; j < n; j++) {
        for (let i = 0; i < n; i++) {
          const c = color((x + (i + 0.5) / n) / size, (y + (j + 0.5) / n) / size, scale);
          r += c[0]; g += c[1]; b += c[2];
        }
      }
      const o = (y * size + x) * 4;
      px[o] = Math.round(r / (n * n));
      px[o + 1] = Math.round(g / (n * n));
      px[o + 2] = Math.round(b / (n * n));
      px[o + 3] = 255;
    }
  }
  return px;
}

const CRC = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();
const crc32 = (buf) => {
  let c = 0xffffffff;
  for (const b of buf) c = CRC[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};
function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}
function png(size, scale = 1) {
  const rgba = render(size, scale);
  const raw = Buffer.alloc((size * 4 + 1) * size);
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0; // filter: none
    rgba.copy(raw, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0))]);
}

fs.mkdirSync(OUT, { recursive: true });
// "Maskable" icons are cropped to a circle by some phones, so their artwork is drawn smaller to stay inside the safe zone.
for (const [name, size, scale] of [['icon-192.png', 192, 1], ['icon-512.png', 512, 1], ['maskable-512.png', 512, 0.74], ['apple-touch-icon.png', 180, 1], ['favicon-32.png', 32, 1]]) {
  fs.writeFileSync(path.join(OUT, name), png(size, scale));
}
fs.copyFileSync(path.join(__dirname, '..', 'brand', 'icon.svg'), path.join(OUT, 'icon.svg')); // run make-brand.js first
console.log('Icons written to', OUT);
