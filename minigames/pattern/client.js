import { h } from '/shared/ui.js';
import { play } from '/shared/sound.js';
import { rng, timeouts } from '/sdk/minigame.js';

const PADS = ['#e8472b', '#6fb3e0', '#6baa4f', '#f2b632'];
const SPEED = { easy: 750, medium: 600, hard: 450 };
const LIVES = { easy: 3, medium: 2, hard: 1 };

export function start(ctx) {
  const r = rng(ctx.seed);
  const seq = Array.from({ length: 45 }, () => Math.floor(r() * 4));
  const speed = SPEED[ctx.level] || 450;
  let lives = LIVES[ctx.level] || 1;
  const t = timeouts();
  let round = 1;
  let completed = 0;
  let pos = 0;
  let state = 'showing';

  const info = h('div', { class: 'mg-info' });
  const status = h('div', { class: 'cc-status' });
  const pads = PADS.map((c, i) => h('button', { class: 'cc-pad', 'data-quiet': '', style: { '--c': c }, 'aria-label': `Pad ${i + 1}`, onpointerdown: (e) => { e.preventDefault(); tap(i); } }));
  ctx.root.replaceChildren(info, status, h('div', { class: 'cc-grid' }, pads));

  const paintInfo = () => (info.textContent = `Round ${round}  ·  ${'♥'.repeat(lives)}`);
  const light = (i, ms) => {
    pads[i].classList.add('lit');
    play(`pad${i}`);
    t.set(() => pads[i].classList.remove('lit'), ms);
  };
  function show() {
    state = 'showing';
    pos = 0;
    paintInfo();
    status.textContent = 'Watch...';
    seq.slice(0, round).forEach((p, n) => t.set(() => light(p, speed * 0.7), 600 + n * speed));
    t.set(() => {
      state = 'input';
      status.textContent = 'Your turn';
    }, 600 + round * speed);
  }
  function tap(i) {
    if (state !== 'input') return;
    light(i, 200);
    if (i === seq[pos]) {
      pos++;
      if (pos === round) {
        completed++;
        ctx.progress(completed * 100);
        round++;
        state = 'wait';
        status.textContent = 'Nice!';
        t.set(() => play('correct'), 250);
        t.set(show, 800);
      }
    } else {
      lives--;
      state = 'wait';
      t.set(() => play('buzz'), 150);
      if (lives <= 0) {
        status.textContent = 'Out of lives';
        paintInfo();
        t.set(() => ctx.finish(completed * 100), 900);
      } else {
        status.textContent = 'Oops! Watch again';
        t.set(show, 1100);
      }
    }
  }
  t.set(show, 400);
  return { score: () => completed * 100, destroy: () => t.clearAll() };
}
