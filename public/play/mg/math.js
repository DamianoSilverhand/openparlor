import { h } from '/shared/ui.js';
import { play } from '/shared/sound.js';
import { rng, int, pick, shuffled, timeouts } from './util.js';

function problem(r, level) {
  if (level === 'easy') {
    const k = r();
    if (k < 0.28) {
      const a = int(r, 14, 68), b = int(r, 12, 49);
      return { text: `${a} + ${b}`, answer: a + b };
    }
    if (k < 0.5) {
      const a = int(r, 35, 95), b = int(r, 12, a - 8);
      return { text: `${a} − ${b}`, answer: a - b };
    }
    if (k < 0.7) {
      const a = int(r, 2, 10), b = int(r, 2, 10);
      return { text: `${a} × ${b}`, answer: a * b };
    }
    if (k < 0.84) {
      const b = int(r, 2, 9), c = int(r, 2, 10);
      return { text: `${b * c} ÷ ${b}`, answer: c };
    }
    if (k < 0.94) {
      const x = int(r, 4, 18), b = int(r, 5, 19);
      return { text: `□ + ${b} = ${x + b}`, answer: x };
    }
    const hVal = int(r, 4, 20) * 2;
    return { text: `Half of ${hVal}`, answer: hVal / 2 };
  }

  if (level === 'medium') {
    const k = r();
    if (k < 0.25) {
      const a = int(r, 2, 12), b = int(r, 2, 9), c = int(r, 2, 9);
      return { text: `${a} + ${b} × ${c}`, answer: a + b * c };
    }
    if (k < 0.45) {
      const pct = pick(r, [10, 20, 25, 50]);
      const base = pct === 25 ? int(r, 2, 12) * 4 : int(r, 2, 15) * 10;
      return { text: `${pct}% of ${base}`, answer: (pct * base) / 100 };
    }
    if (k < 0.65) {
      const a = int(r, -15, -2), b = int(r, 5, 22);
      return { text: `${a} + ${b}`, answer: a + b };
    }
    if (k < 0.85) {
      const x = int(r, 2, 12), m = int(r, 2, 6), b = int(r, 1, 12);
      return { text: `${m}x + ${b} = ${m * x + b}  (x = ?)`, answer: x };
    }
    const n = int(r, 4, 12);
    return r() < 0.5 ? { text: `${n}²`, answer: n * n } : { text: `√${n * n}`, answer: n };
  }

  // hard
  const k = r();
  if (k < 0.25) {
    const a = int(r, 6, 15), b = int(r, 3, 12), c = int(r, 4, 25);
    return { text: `${a} × ${b} − ${c}`, answer: a * b - c };
  }
  if (k < 0.45) {
    const pct = pick(r, [10, 15, 20, 25]);
    const base = int(r, 2, 12) * 20;
    return { text: `Increase ${base} by ${pct}%`, answer: base + (base * pct) / 100 };
  }
  if (k < 0.65) {
    const b = int(r, 2, 6), p = int(r, 3, b === 2 ? 6 : 4), c = int(r, 2, 15);
    return { text: `${b}^${p} + ${c}`, answer: Math.pow(b, p) + c };
  }
  if (k < 0.85) {
    const x = int(r, 3, 15), m = int(r, 3, 8), b = int(r, 2, 14);
    return { text: `${m}x − ${b} = ${m * x - b}  (x = ?)`, answer: x };
  }
  const a = int(r, 8, 15), b = int(r, 3, a - 2);
  return { text: `${a}² − ${b}²`, answer: a * a - b * b };
}

function options(r, answer) {
  const set = new Set([answer]);
  const candidates = [answer + 10, answer - 10, answer + 2, answer - 2, answer + 1, answer - 1, answer + 5, answer - 5];
  for (const c of shuffled(r, candidates)) {
    if (set.size >= 4) break;
    if (c >= -30 && c !== answer) set.add(c);
  }
  while (set.size < 4) {
    const d = int(r, 1, 12) * (r() < 0.5 ? -1 : 1);
    set.add(answer + d);
  }
  return shuffled(r, [...set]);
}

export function start(ctx) {
  const r = rng(ctx.seed);
  const t = timeouts();
  let correct = 0;
  let wrong = 0;
  let streak = 0;
  let bestStreak = 0;
  let totalScore = 0;
  let locked = false;
  let cur = null;

  const info = h('div', { class: 'mg-info' });
  const prob = h('div', { class: 'nd-prob' });
  const grid = h('div', { class: 'nd-grid' });
  ctx.root.replaceChildren(info, h('div', { class: 'card nd-card' }, prob), grid);

  const score = () => Math.max(0, totalScore);

  function next() {
    cur = problem(r, ctx.level);
    prob.textContent = cur.text;
    info.textContent = `Right ${correct}  ·  Wrong ${wrong}${streak >= 2 ? `  ·  🔥 ${streak}` : ''}`;
    grid.replaceChildren(
      ...options(r, cur.answer).map((v) =>
        h('button', {
          class: 'nd-btn',
          'data-quiet': '',
          onpointerdown: (e) => {
            e.preventDefault();
            choose(v);
          },
        }, String(v)),
      ),
    );
  }

  function choose(v) {
    if (locked) return;
    if (v === cur.answer) {
      correct++;
      streak++;
      bestStreak = Math.max(bestStreak, streak);
      totalScore += 60 + Math.min(4, streak - 1) * 15;
      play('good');
      ctx.progress(score());
      next();
    } else {
      wrong++;
      streak = 0;
      totalScore = Math.max(0, totalScore - 30);
      locked = true;
      play('bad');
      prob.classList.add('bad');
      ctx.progress(score());
      t.set(() => {
        prob.classList.remove('bad');
        locked = false;
        next();
      }, 450);
    }
  }

  next();
  return { score, destroy: () => t.clearAll() };
}
