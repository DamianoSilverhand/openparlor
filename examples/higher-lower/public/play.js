// The phone side of the example game.
import { h, timer } from '/shared/ui.js';
import { game, meBar, hostButton, final } from '/sdk/play.js';

export function screen(s, ctx) {
  const g = s.game;
  if (g.phase === 'final') return { key: 'final', build: (s) => final(s, ctx) };
  return { key: `${g.phase}:${g.round}`, build: (s) => play(s, ctx) };
}

function play(s, ctx) {
  const t = timer();
  const number = h('div', { class: 'hl-number' });
  const status = h('p', { class: 'status' });
  const buttons = ['higher', 'lower'].map((choice) =>
    h('button', { class: 'btn block hl-btn', onclick: () => ctx.send(game('guess', { choice })) }, choice === 'higher' ? '⬆ Higher' : '⬇ Lower'),
  );
  const el = h('div', { class: 'screen' }, meBar(s), t.el, number, status, ...buttons, hostButton(s, ctx, 'Skip ahead', false));
  function update(s) {
    const g = s.game;
    t.update(g);
    number.textContent = g.phase === 'reveal' ? `${g.number} → ${g.next}` : String(g.number);
    buttons.forEach((b, i) => {
      const choice = i === 0 ? 'higher' : 'lower';
      b.disabled = g.phase !== 'guess' || !!g.myGuess;
      b.classList.toggle('plain', g.myGuess !== choice);
    });
    status.textContent = g.phase === 'reveal' ? (g.myGuess === g.right ? 'Right!' : g.myGuess ? 'Not this time.' : 'You did not guess.') : g.myGuess ? `You said ${g.myGuess}. Waiting for the others...` : 'Higher or lower?';
  }
  update(s);
  return { el, update };
}

export const cues = {
  onChange(s, ps, changed, sfx) {
    const g = s.game;
    if (changed && g.phase === 'reveal') sfx(g.myGuess === g.right ? 'correct' : 'wrong');
  },
};
