import { h } from '/shared/ui.js';
import { play } from '/shared/sound.js';
import { rng, timeouts } from './util.js';

const FACTOR = { kid: 0.7, teen: 0.9, grownup: 1 }; // bigger window for younger players
const TRIALS = 5;

export function start(ctx) {
  const r = rng(ctx.seed);
  const f = FACTOR[ctx.level] || 1;
  const t = timeouts();
  const times = [];
  let penalty = 0;
  let state = 'idle';
  let t0 = 0;

  const msg = h('div', { class: 'rx-msg' });
  const sub = h('div', { class: 'rx-sub' });
  const pad = h('div', { class: 'rx-pad wait', role: 'button', tabindex: '0' }, msg, sub);
  const info = h('div', { class: 'mg-info' });
  ctx.root.replaceChildren(info, pad);

  const score = () => {
    const sum = times.reduce((a, b) => a + b, 0) + penalty + (TRIALS - times.length) * 1000;
    return Math.max(0, Math.min(2500, Math.round(2600 - (sum / TRIALS) * 3)));
  };
  const paint = (cls, m, s = '') => {
    pad.className = `rx-pad ${cls}`;
    msg.textContent = m;
    sub.textContent = s;
  };
  function wait() {
    state = 'wait';
    info.textContent = `Try ${times.length + 1} of ${TRIALS}`;
    paint('wait', 'Wait for green...');
    t.set(go, 1200 + r() * 2800);
  }
  function go() {
    state = 'go';
    t0 = performance.now();
    paint('go', 'TAP!');
    play('go');
  }
  function tap(e) {
    e.preventDefault();
    if (state === 'wait') {
      t.clearAll();
      state = 'pause';
      penalty += 400;
      play('buzz');
      paint('early', 'Too early!', '+0.4 seconds');
      t.set(wait, 1000);
    } else if (state === 'go') {
      const ms = (performance.now() - t0) * f;
      times.push(ms);
      play('good');
      state = 'pause';
      ctx.progress(score());
      paint('hit', `${Math.round(ms)} ms`, f < 1 ? 'Counting your bonus' : '');
      if (times.length >= TRIALS) t.set(() => ctx.finish(score()), 1000);
      else t.set(wait, 1000);
    }
  }
  pad.addEventListener('pointerdown', tap);
  t.set(wait, 600);
  return { score, destroy: () => t.clearAll() };
}
