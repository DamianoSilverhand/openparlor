#!/usr/bin/env node
// Draws the OpenParlor logo files in brand/ as plain SVG, with no fonts or tools needed: the wordmark is built from strokes.
// The mark is an open arched doorway (the parlor), with a "p" in it and a dot (you, in the room). Run `node scripts/make-brand.js`
// after changing the design, then `node scripts/make-icons.js` for the app icons, and commit the results.
const fs = require('fs');
const path = require('path');

const OUT = path.join(__dirname, '..', 'brand');
const C = { ink: '#1d1a17', teal: '#238080', mustard: '#f2b632', paper: '#fffbf2', tealLight: '#5bbcbc' };

// ---- the mark, in a 100 x 100 box ----------------------------------------------------------------------------------------
const ARCH = (grow = 0, dx = 0, dy = 0) => {
  const l = 24 - grow + dx, r = 76 + grow + dx, rad = 26 + grow, cy = 40 + dy, b = 80 + grow + dy;
  return `M${l},${b} V${cy} A${rad},${rad} 0 0 1 ${r},${cy} V${b} Z`;
};
const GLYPH = { stem: [39.5, 29, 65], bowl: [52, 41, 12], w: 7, dot: 4 };
const FLOOR = (dx = 0, dy = 0) => `<rect x="${17 + dx}" y="${79 + dy}" width="66" height="8" rx="4"`;
function markBody(edge = C.ink) {
  const { stem, bowl, w, dot } = GLYPH;
  return `${FLOOR(3.5, 3.5)} fill="${edge}"/>
  <path d="${ARCH(1.6, 3.5, 3.5)}" fill="${edge}"/>
  ${FLOOR()} fill="${edge}"/>
  <path d="${ARCH(1.6)}" fill="${edge}"/>
  <path d="${ARCH()}" fill="${C.teal}"/>
  <path d="M${stem[0]},${stem[1]} V${stem[2]}" stroke="${C.paper}" stroke-width="${w}" stroke-linecap="round" fill="none"/>
  <circle cx="${bowl[0]}" cy="${bowl[1]}" r="${bowl[2]}" stroke="${C.paper}" stroke-width="${w}" fill="none"/>
  <circle cx="${bowl[0]}" cy="${bowl[1]}" r="${GLYPH.dot}" fill="${C.mustard}"/>`;
}

// ---- the wordmark: monoline letters, x-height 36, stroke 9 -----------------------------------------------------------------
const SW = 9, R = 18, XH = 36;
const f = (n) => +n.toFixed(2);
const LETTERS = {
  o: (x) => ({ w: 36, d: `M${x},${-R} a${R},${R} 0 1 0 ${2 * R},0 a${R},${R} 0 1 0 ${-2 * R},0` }),
  p: (x) => ({ w: 36, d: `M${x},${-XH} V${R} M${x + R},${-2 * R} a${R},${R} 0 1 0 0.01,0` }),
  e: (x) => ({ w: 36, d: `M${x},${-R} H${x + 2 * R} M${x + 2 * R},${-R} A${R},${R} 0 1 0 ${f(x + R + R * Math.cos(Math.PI / 4))},${f(-R + R * Math.sin(Math.PI / 4))}` }),
  n: (x) => ({ w: 36, d: `M${x},0 V${-XH} M${x},${-R} A${R},${R} 0 0 1 ${x + 2 * R},${-R} V0` }),
  a: (x) => ({ w: 36, d: `M${x + R},${-2 * R} a${R},${R} 0 1 0 0.01,0 M${x + 2 * R},${-XH} V0` }),
  r: (x) => ({ w: 22, d: `M${x},0 V${-XH} M${x},${-R} A${R},${R} 0 0 1 ${x + R},${-XH} H${x + 22}` }),
  l: (x) => ({ w: 0, d: `M${x},-62 V0` }),
};
function word(text, x0, gap = 17) {
  let x = x0, d = '';
  for (const ch of text) {
    const g = LETTERS[ch](x);
    d += g.d + ' ';
    x += g.w + gap;
  }
  return { d: d.trim(), end: x - gap };
}

function lockup() {
  const S = 1.15, mx = -22.4 * S, my = -66 - 12.4 * S; // the mark spans the full height of the word
  const open = word('open', 94), parlor = word('parlor', open.end + 17);
  const W = parlor.end + SW / 2 + 12, top = -80, H = 120;
  const style = `<style>
    :root { --ink: ${C.ink}; --edge: ${C.ink}; --teal: ${C.teal}; }
    @media (prefers-color-scheme: dark) { :root { --ink: ${C.paper}; --edge: ${C.paper}; --teal: ${C.tealLight}; } }
  </style>`;
  const body = markBody('var(--edge)').replace(new RegExp(C.teal, 'g'), C.teal);
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="-12 ${top} ${f(W + 12)} ${H}" role="img" aria-label="OpenParlor">
  ${style}
  <g transform="translate(${f(mx)} ${f(my)}) scale(${S})">
  ${body}
  </g>
  <g fill="none" stroke-width="${SW}" stroke-linecap="round" stroke-linejoin="round">
    <path d="${open.d}" stroke="var(--ink)"/>
    <path d="${parlor.d}" stroke="var(--teal)"/>
  </g>
</svg>
`;
}

fs.mkdirSync(OUT, { recursive: true });
const standalone = (inner, viewBox) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${viewBox}" role="img" aria-label="OpenParlor">\n  ${inner}\n</svg>\n`;
fs.writeFileSync(path.join(OUT, 'logo.svg'), lockup());
fs.writeFileSync(path.join(OUT, 'mark.svg'), standalone(markBody(), '16 10 72 86'));
fs.writeFileSync(path.join(OUT, 'icon.svg'), standalone(`<rect width="100" height="100" fill="${C.mustard}"/>\n  ${markBody()}`, '0 0 100 100'));
console.log('Logo files written to', OUT);
module.exports = { C, GLYPH };
