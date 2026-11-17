import { h } from '/shared/ui.js';
import { rng, shuffled, timeouts } from './util.js';

const FACES = ['🐶', '🐱', '🐸', '🦊', '🐼', '🐵', '🦁', '🐷', '🐮', '🐔', '🐢', '🐙', '🦄', '🐝'];
const GRID = { kid: [3, 4], teen: [4, 4], grownup: [4, 5] }; // columns x rows

export function start(ctx) {
  const r = rng(ctx.seed);
  const [cols, rows] = GRID[ctx.level] || GRID.grownup;
  const pairs = (cols * rows) / 2;
  const faces = shuffled(r, FACES).slice(0, pairs);
  const deck = shuffled(r, [...faces, ...faces]);
  const t = timeouts();
  const matched = new Set();
  let open = [];
  let moves = 0;
  let locked = false;
  const t0 = performance.now();

  const info = h('div', { class: 'mg-info' });
  const cards = deck.map((f, i) => h('button', { class: 'mem-card', 'aria-label': 'Card', onclick: () => flip(i) }, h('span', { class: 'face' }, f)));
  const grid = h('div', { class: 'mem-grid', style: { '--cols': cols } }, cards);
  ctx.root.replaceChildren(info, grid);

  const score = () => {
    const done = matched.size / 2;
    const misses = Math.max(0, moves - done);
    const complete = done === pairs;
    const ms = performance.now() - t0;
    const bonus = complete ? 300 * Math.max(0, 1 - ms / ctx.durationMs) : 0;
    return Math.max(0, Math.round((done / pairs) * 1000 - (misses / pairs) * 150 + bonus));
  };
  const paintInfo = () => (info.textContent = `Pairs ${matched.size / 2} of ${pairs}  ·  Moves ${moves}`);
  paintInfo();

  function flip(i) {
    if (locked || matched.has(i) || open.includes(i)) return;
    cards[i].classList.add('up');
    open.push(i);
    if (open.length < 2) return;
    moves++;
    const [a, b] = open;
    if (deck[a] === deck[b]) {
      matched.add(a);
      matched.add(b);
      cards[a].classList.add('done');
      cards[b].classList.add('done');
      open = [];
      paintInfo();
      ctx.progress(score());
      if (matched.size === deck.length) ctx.finish(score());
    } else {
      locked = true;
      paintInfo();
      t.set(() => {
        cards[a].classList.remove('up');
        cards[b].classList.remove('up');
        open = [];
        locked = false;
      }, 700);
    }
  }
  return { score, destroy: () => t.clearAll() };
}
