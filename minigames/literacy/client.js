import { h } from '/shared/ui.js';
import { play } from '/shared/sound.js';
import { rng, shuffled, timeouts } from '/sdk/minigame.js';

const FALLBACK = {
  easy: [
    { q: 'Pick the correct spelling:', a: 'because', w: ['becuase', 'becos', 'becaus'] },
    { q: 'Pick the correct spelling:', a: 'friend', w: ['freind', 'frend', 'friand'] },
    { q: "Fill the blank: ___ going to the park.", a: "They're", w: ['Their', 'There', 'Thier'] },
  ],
  medium: [
    { q: 'Pick the correct spelling:', a: 'definitely', w: ['definately', 'definitly', 'definetely'] },
    { q: 'Fill the blank: The weather will ___ our plans.', a: 'affect', w: ['effect', 'afflict', 'infect'] },
  ],
  hard: [
    { q: 'Pick the correct spelling:', a: 'accommodate', w: ['accomodate', 'acommodate', 'accommadate'] },
    { q: "Which word means 'present everywhere at once'?", a: 'ubiquitous', w: ['ambiguous', 'obscure', 'tenuous'] },
  ],
};

let PACK = FALLBACK;
fetch('/api/content/literacy').then((r) => r.json()).then((d) => { if (d && d.easy) PACK = d; }).catch(() => {});

export function start(ctx) {
  const r = rng(ctx.seed);
  const level = PACK[ctx.level] ? ctx.level : 'hard';
  const list = shuffled(r, PACK[level] || FALLBACK.easy);
  const t = timeouts();
  let i = 0;
  let correct = 0;
  let wrong = 0;
  let streak = 0;
  let totalScore = 0;
  let locked = false;

  const info = h('div', { class: 'mg-info' });
  const qEl = h('div', { class: 'lg-q' });
  const grid = h('div', { class: 'lit-grid' });
  ctx.root.replaceChildren(info, h('div', { class: 'card nd-card' }, qEl), grid);

  const score = () => Math.max(0, totalScore);

  function show() {
    const cur = list[i % list.length];
    const opts = shuffled(r, [cur.a, ...cur.w]);
    qEl.textContent = cur.q;
    info.textContent = `Right ${correct}  ·  Wrong ${wrong}${streak >= 2 ? `  ·  🔥 ${streak}` : ''}`;
    grid.replaceChildren(
      ...opts.map((opt) =>
        h('button', {
          class: 'nd-btn lit-btn',
          'data-quiet': '',
          onpointerdown: (e) => {
            e.preventDefault();
            choose(opt, cur.a);
          },
        }, opt),
      ),
    );
  }

  function choose(opt, ans) {
    if (locked) return;
    if (opt === ans) {
      correct++;
      streak++;
      totalScore += 100 + Math.min(4, streak - 1) * 20;
      play('good');
      ctx.progress(score());
      i++;
      show();
    } else {
      wrong++;
      streak = 0;
      totalScore = Math.max(0, totalScore - 35);
      locked = true;
      play('bad');
      qEl.classList.add('bad');
      ctx.progress(score());
      t.set(() => {
        qEl.classList.remove('bad');
        locked = false;
        i++;
        show();
      }, 450);
    }
  }

  show();
  return { score, destroy: () => t.clearAll() };
}
