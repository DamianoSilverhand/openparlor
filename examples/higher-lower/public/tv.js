// The big-screen side of the example game. `screen(s)` returns { key, build }: when the key changes the TV builds a new
// screen with build(s); while it stays the same the TV calls the existing screen's update(s).
import { h, avatar, byId, timer } from '/shared/ui.js';
import { finalScreen } from '/sdk/tv.js';

export function screen(s) {
  const g = s.game;
  if (g.phase === 'final') return { key: 'final', build: (s) => ({ el: finalScreen(s, []), update() {} }) };
  return { key: `${g.phase}:${g.round}`, build: play };
}

function play(s) {
  const g = s.game;
  const get = byId(s.players);
  const t = timer(); // the countdown bar: t.update(g) reads g.deadline and g.timerTotal
  const number = h('div', { class: 'hl-number' });
  const note = h('p', { class: 'hl-note' });
  const who = h('div', { class: 'hl-who' });
  const el = h('div', { class: 'stage' },
    h('div', { class: 'bar' }, h('span', { class: 'pill' }, `Round ${g.round} of ${g.totalRounds}`), h('span', { class: 'code' }, s.gameName.toUpperCase())),
    h('div', { class: 'center-msg' }, number, note, who),
    h('div', { class: 'big-timer' }, t.el),
  );
  function update(s) {
    const g = s.game;
    t.update(g);
    number.textContent = g.phase === 'reveal' ? `${g.number} → ${g.next}` : String(g.number);
    note.textContent = g.phase === 'reveal' ? `It was ${g.right}!` : 'Will the next number be higher or lower?';
    who.replaceChildren(...g.answered.map((id) => get(id)).filter(Boolean).map((p) => avatar(p)));
  }
  update(s);
  return { el, update };
}

// Optional: sounds. A new screen calls onPhase, a change within a screen calls onChange; sfx(name) plays a shared sound.
export const cues = {
  timedPhases: ['guess'], // tick in the last three seconds
  onPhase: (g, sfx) => sfx(g.phase === 'reveal' ? 'drum' : 'whoosh'),
  onChange: (g, pg, sfx) => { if (g.answered.length > pg.answered.length) sfx('lock'); },
};
