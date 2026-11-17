import { h } from '/shared/ui.js';
import { rng, int, pick, shuffled, timeouts } from './util.js';

function problem(r, level) {
  if (level === 'kid') {
    const k = r();
    if (k < 0.5) { const a = int(r, 1, 15), b = int(r, 1, 15); return { text: `${a} + ${b}`, answer: a + b }; }
    if (k < 0.85) { const a = int(r, 5, 20), b = int(r, 1, a - 1); return { text: `${a} − ${b}`, answer: a - b }; }
    const a = int(r, 2, 5), b = int(r, 1, 5);
    return { text: `${a} × ${b}`, answer: a * b };
  }
  if (level === 'teen') {
    const k = r();
    if (k < 0.35) { const a = int(r, 10, 60), b = int(r, 5, 39); return { text: `${a} + ${b}`, answer: a + b }; }
    if (k < 0.6) { const a = int(r, 30, 99), b = int(r, 5, 29); return { text: `${a} − ${b}`, answer: a - b }; }
    const a = int(r, 2, 10), b = int(r, 2, 10);
    return { text: `${a} × ${b}`, answer: a * b };
  }
  const k = r();
  if (k < 0.3) { const a = int(r, 6, 12), b = int(r, 3, 12); return { text: `${a} × ${b}`, answer: a * b }; }
  if (k < 0.5) { const a = int(r, 10, 60), b = int(r, 10, 60), c = int(r, 5, 40); return { text: `${a} + ${b} + ${c}`, answer: a + b + c }; }
  if (k < 0.7) { const a = int(r, 120, 480), b = int(r, 20, 99); return { text: `${a} − ${b}`, answer: a - b }; }
  if (k < 0.85) { const b = int(r, 3, 12), c = int(r, 3, 12); return { text: `${b * c} ÷ ${b}`, answer: c }; }
  const a = int(r, 3, 9), b = int(r, 2, 9), c = int(r, 2, 9);
  return { text: `${a} × ${b} + ${c}`, answer: a * b + c };
}

function options(r, answer) {
  const set = new Set([answer]);
  const spread = Math.max(3, Math.min(12, Math.round(answer * 0.15)));
  while (set.size < 4) {
    const d = int(r, 1, spread) * (r() < 0.5 ? -1 : 1);
    if (answer + d >= 0) set.add(answer + d);
  }
  return shuffled(r, [...set]);
}

export function start(ctx) {
  const r = rng(ctx.seed);
  const t = timeouts();
  let correct = 0;
  let wrong = 0;
  let cur = null;

  const info = h('div', { class: 'mg-info' });
  const prob = h('div', { class: 'nd-prob' });
  const grid = h('div', { class: 'nd-grid' });
  ctx.root.replaceChildren(info, h('div', { class: 'card nd-card' }, prob), grid);

  const score = () => Math.max(0, correct * 60 - wrong * 30);
  function next() {
    cur = problem(r, ctx.level);
    prob.textContent = cur.text;
    info.textContent = `Right ${correct}  ·  Wrong ${wrong}`;
    grid.replaceChildren(...options(r, cur.answer).map((v) => h('button', { class: 'nd-btn', onpointerdown: (e) => { e.preventDefault(); choose(v, e.currentTarget); } }, String(v))));
  }
  function choose(v, btn) {
    if (v === cur.answer) correct++;
    else wrong++;
    prob.classList.toggle('bad', v !== cur.answer);
    t.set(() => prob.classList.remove('bad'), 250);
    ctx.progress(score());
    next();
  }
  next();
  return { score, destroy: () => t.clearAll() };
}
