import { h } from '/shared/ui.js';
import { play } from '/shared/sound.js';
import { rng, int, timeouts } from './util.js';

const COLORS = [
  { n: 'RED', c: '#e8472b' },
  { n: 'BLUE', c: '#3e5c99' },
  { n: 'GREEN', c: '#4f9a3a' },
  { n: 'YELLOW', c: '#c98a00' },
];
const SAME = { kid: 0.45, teen: 0.35, grownup: 0.15 }; // how often the word matches its own colour

export function start(ctx) {
  const r = rng(ctx.seed);
  const same = SAME[ctx.level] ?? 0.15;
  const t = timeouts();
  let correct = 0;
  let wrong = 0;
  let ink = 0;

  const info = h('div', { class: 'mg-info' });
  const word = h('div', { class: 'cl-word' });
  const flash = h('div', { class: 'cl-flash' });
  const btns = COLORS.map((col, i) => h('button', { class: 'cl-btn', 'data-quiet': '', style: { background: col.c }, onpointerdown: (e) => { e.preventDefault(); answer(i); } }, col.n));
  ctx.root.replaceChildren(info, h('div', { class: 'cl-card card' }, word, flash), h('div', { class: 'cl-grid' }, btns));

  const score = () => Math.max(0, correct * 60 - wrong * 40);
  function next() {
    const w = int(r, 0, 3);
    ink = r() < same ? w : (w + int(r, 1, 3)) % 4;
    word.textContent = COLORS[w].n;
    word.style.color = COLORS[ink].c;
    info.textContent = `Right ${correct}  ·  Wrong ${wrong}`;
  }
  function answer(i) {
    if (i === ink) {
      correct++;
      play('good');
      flash.textContent = 'Yes!';
      flash.className = 'cl-flash ok';
    } else {
      wrong++;
      play('bad');
      flash.textContent = 'No';
      flash.className = 'cl-flash bad';
    }
    t.set(() => (flash.textContent = ''), 350);
    ctx.progress(score());
    next();
  }
  next();
  return { score, destroy: () => t.clearAll() };
}
