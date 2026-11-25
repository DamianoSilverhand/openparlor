#!/usr/bin/env node
// Draws the app icons (public/icons/*.png and icon.svg) with no image library: a teal disc with a white star on a mustard tile in
// the printed-box-game style. Run `node scripts/make-icons.js` after changing the design, and commit the result.
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const OUT = path.join(__dirname, '..', 'public', 'icons');
const MUSTARD = [242, 182, 50];
const TEAL = [35, 128, 128];
const INK = [29, 26, 23];
const PAPER = [255, 251, 242];

// Point-in-polygon (even-odd), used for the star.
function inPolygon(x, y, pts) {
  let inside = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const [xi, yi] = pts[i];
    const [xj, yj] = pts[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}
const STAR = Array.from({ length: 10 }, (_, k) => {
  const a = -Math.PI / 2 + (k * Math.PI) / 5;
  const r = k % 2 ? 0.07 : 0.155;
  return [0.5 + r * Math.cos(a), 0.51 + r * Math.sin(a)];
});

function color(x, y) {
  const dx = x - 0.5;
  const dy = y - 0.5;
  const r = 0.27;
  const ring = 0.028;
  if (inPolygon(x, y, STAR)) return PAPER;
  if (Math.hypot(dx, dy) < r - ring) return TEAL;
  if (Math.hypot(dx, dy) < r) return INK;
  if (Math.hypot(dx - 0.035, dy - 0.035) < r) return INK; // the hard offset shadow
  return MUSTARD;
}

function render(size) {
  const px = Buffer.alloc(size * size * 4);
  const n = 3; // 3 x 3 samples per pixel for smooth edges
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let r = 0, g = 0, b = 0;
      for (let j = 0; j < n; j++) {
        for (let i = 0; i < n; i++) {
          const c = color((x + (i + 0.5) / n) / size, (y + (j + 0.5) / n) / size);
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
function png(size) {
  const rgba = render(size);
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
// The same artwork serves every purpose: its content stays inside the central 60%, so it is safe as a "maskable" icon.
for (const [name, size] of [['icon-192.png', 192], ['icon-512.png', 512], ['maskable-512.png', 512], ['apple-touch-icon.png', 180], ['favicon-32.png', 32]]) {
  fs.writeFileSync(path.join(OUT, name), png(size));
}
fs.writeFileSync(path.join(OUT, 'icon.svg'), `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">
  <rect width="100" height="100" fill="#f2b632"/>
  <circle cx="53.5" cy="53.5" r="27" fill="#1d1a17"/>
  <circle cx="50" cy="50" r="27" fill="#1d1a17"/>
  <circle cx="50" cy="50" r="24.2" fill="#238080"/>
  <polygon points="50,35.5 54.1,45.1 64.7,46.1 56.7,52.8 59.1,63 50,57.7 40.9,63 43.3,52.8 35.3,46.1 45.9,45.1" fill="#fffbf2"/>
</svg>
`);
console.log('Icons written to', OUT);
