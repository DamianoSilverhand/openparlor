// Phone screens that every game can reuse. Import from '/sdk/play.js'.
import { h, avatar, byId, soundToggle } from '/shared/ui.js';

// A game message for the server: ctx.send(game('answer', { text })) sends { t: 'g', a: 'answer', text }.
export const game = (a, extra) => ({ t: 'g', a, ...extra });

// The player's name, animal, score and the sound button, shown at the top of most screens.
export function meBar(s) {
  const me = byId(s.players)(s.me);
  return h('div', { class: 'me' },
    h('span', { class: 'who' }, me && avatar(me), me && me.name),
    h('span', { class: 'me-r' }, h('span', { class: 'score' }, h('small', null, 'Score'), me ? me.score : 0), soundToggle()),
  );
}

// The host's Next (or a skip link) and Pause buttons. Returns null for everyone else.
export function hostButton(s, ctx, label, primary) {
  if (s.me !== s.hostId) return null;
  const g = s.game || {};
  // The server says whether this game can be paused right now (g.canPause).
  const pauseBtn = g.canPause && h('button', { class: 'link', onclick: () => ctx.send({ t: 'pause' }) }, g.paused ? '▶ Resume' : '⏸ Pause');
  const nextBtn = primary
    ? h('button', { class: 'btn block', onclick: () => ctx.send(game('next')) }, label)
    : h('button', { class: 'link', onclick: () => ctx.send(game('next')) }, label);
  return h('div', { class: primary ? 'host-bar push' : 'host-bar' }, nextBtn, pauseBtn);
}

// The standings, one row per player or team: s.game.standings = [{ id, score, gain }].
export function list(s) {
  const g = s.game;
  const get = byId(s.players);
  return h('div', { class: 'rank-list' },
    g.standings.map((x, i) => {
      const p = get(x.id);
      return h('div', { class: 'r' + (x.id === s.me ? ' me' : '') },
        h('span', { class: 'tag' }, h('b', null, i + 1), avatar(p), p.name),
        h('span', null, x.gain > 0 && h('span', { class: 'gain' }, `+${x.gain}`), x.score),
      );
    }),
  );
}

// The standard end-of-game screen with Play again and Back to the lobby.
export function final(s, ctx) {
  const g = s.game;
  const place = g.standings.findIndex((x) => x.id === s.me);
  const words = ['You won!', 'Second place', 'Third place'];
  const el = h('div', { class: 'screen' },
    meBar(s),
    h('h1', { class: 'title' }, place >= 0 && place < 3 ? words[place] : 'Game over'),
    list(s),
    h('button', { class: 'btn block push', onclick: () => ctx.send({ t: 'again' }) }, 'Play again'),
    h('button', { class: 'btn plain block', onclick: () => ctx.send({ t: 'lobby' }) }, 'Back to the lobby'),
  );
  return { el, update() {} };
}
