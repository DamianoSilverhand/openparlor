// TV screens that every game can reuse.
import { h, avatar, byId, ordinal } from '/shared/ui.js';

// awards: [{ title, text, id }] already formatted by the game.
export function finalScreen(s, awards) {
  const g = s.game;
  const get = byId(s.players);
  const top = g.standings.slice(0, 3);
  const order = [1, 0, 2].filter((i) => top[i]);
  const pods = order.map((i) => {
    const p = get(top[i].id);
    return h('div', { class: `pod p${i + 1}`, style: { animationDelay: `${(2 - i) * 350}ms` } },
      avatar(p),
      h('span', { class: 'nm' }, p.name),
      h('span', { class: 'pts' }, `${top[i].score} pts`),
      h('div', { class: 'blk' }, i + 1),
    );
  });
  const rest = g.standings.slice(3).map((x, i) => h('span', { class: 'tag' }, ordinal(i + 3), ' ', get(x.id).name, ` · ${x.score}`));
  const cards = awards.filter(Boolean).map((a) => {
    const p = get(a.id);
    return h('div', { class: 'card award' }, avatar(p), h('div', null, h('div', { class: 't' }, a.title), h('div', { class: 'd' }, `${p.name}: ${a.text}`)));
  });
  const conf = confetti();
  return h('div', { class: 'stage' },
    h('div', { class: 'final' },
      h('div', null, h('h1', null, 'And the winner is...'), h('div', { class: 'podium' }, pods), h('div', { class: 'rest' }, rest)),
      h('div', { class: 'awards' }, cards,
        h('p', { class: 'hint' }, 'Anyone can tap ', h('b', null, 'Play again'), ' or ', h('b', null, 'Back to the lobby'), ' on their phone.'),
      ),
    ),
    conf,
  );
}

export function confetti() {
  const colours = ['#E8472B', '#F2B632', '#2E9C9C', '#F29BB5', '#6FB3E0', '#6BAA4F'];
  return h('div', { class: 'confetti' },
    Array.from({ length: 44 }, (_, i) =>
      h('i', { style: { left: `${(i * 37) % 100}%`, background: colours[i % colours.length], animationDuration: `${5 + (i % 5)}s`, animationDelay: `${-(i % 9)}s` } }),
    ),
  );
}
