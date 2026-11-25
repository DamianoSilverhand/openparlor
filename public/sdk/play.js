// Phone screens that every game can reuse. Import from '/sdk/play.js'.
import { h, avatar, byId, soundToggle, timer } from '/shared/ui.js';
import { t as t0 } from '/shared/i18n.js';

// A game message for the server: ctx.send(game('answer', { text })) sends { t: 'g', a: 'answer', text }.
export const game = (a, extra) => ({ t: 'g', a, ...extra });

// The player's name, animal, score and the sound button, shown at the top of most screens.
export function meBar(s) {
  const me = byId(s.players)(s.me) || s.you; // someone in the audience is not in the player list
  return h('div', { class: 'me' },
    h('span', { class: 'who' }, me && avatar(me), me && me.name),
    h('span', { class: 'me-r' }, !s.audience && h('span', { class: 'score' }, h('small', null, 'Score'), me ? me.score : 0), soundToggle()),
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

// The first few rows of a long ranking, plus the viewer's own row when they are further down. In a room of a hundred, nobody
// wants a hundred rows: they want the top and their own place. Returns [{ x, i }] (the item and its place), and
// the number left out.
export function topAndMe(items, isMe, n = 8) {
  const rows = items.slice(0, n).map((x, i) => ({ x, i }));
  const mine = items.findIndex(isMe);
  if (mine >= n) rows.push({ x: items[mine], i: mine, gap: mine > n });
  return { rows, hidden: items.length - rows.length };
}

// The standings, one row per player or team: s.game.standings = [{ id, score, gain }]. A long list shows the top 8 and you.
export function list(s) {
  const g = s.game;
  const get = byId(s.players);
  const { rows, hidden } = topAndMe(g.standings, (x) => x.id === s.me);
  return h('div', { class: 'rank-list' },
    rows.map(({ x, i, gap }) => {
      const p = get(x.id);
      return h('div', { class: 'r' + (x.id === s.me ? ' me' : '') + (gap ? ' gap' : '') },
        h('span', { class: 'tag' }, h('b', null, i + 1), avatar(p), p.name),
        h('span', null, x.gain > 0 && h('span', { class: 'gain' }, `+${x.gain}`), x.score),
      );
    }),
    hidden > 0 && h('p', { class: 'more-note' }, `+${hidden} more`),
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

// ---- the audience ---------------------------------------------------------------------------------------------------
// People who are only watching (they chose to, arrived while a game was on, or there were no seats left) see this instead
// of a game's phone screen. They can send emoji reactions to the big screen and take part in a crowd poll when a game opens
// one. None of it affects the score.
export const REACTIONS = ['👏', '😂', '😮', '❤️', '🔥', '👍', '🎉', '😱'];

export function reactionBar(ctx) {
  return h('div', { class: 'react-bar' },
    REACTIONS.map((e) => h('button', { class: 'react-btn', 'aria-label': `React ${e}`, 'data-quiet': '', onclick: () => ctx.send({ t: 'react', e }) }, e)),
  );
}

// s.game is what the big screen shows (the audience never sees a player's private state).
export function audienceScreen(s, ctx) {
  const status = h('p', { class: 'lead' });
  const pollBox = h('div', { class: 'aud-poll' });
  const t = timer();
  const el = h('div', { class: 'screen' },
    meBar(s),
    h('div', { class: 'aud-pill' }, t0('audience.watching')),
    h('h1', { class: 'title' }, s.gameName),
    status,
    t.el,
    pollBox,
    reactionBar(ctx),
  );
  function update(s) {
    const g = s.game || {};
    t.el.style.display = g.deadline ? '' : 'none';
    if (g.deadline) t.update(g);
    const poll = g.poll;
    status.textContent = poll && poll.open ? t0('audience.pollOpen') : t0('audience.watchTv');
    pollBox.replaceChildren(
      ...(poll && poll.open
        ? poll.labels.map((label, i) => h('button', { class: 'btn block aud-vote' + (g.myVote === i ? '' : ' plain'), onclick: () => ctx.send({ t: 'aud', idx: i }) }, label))
        : []),
    );
  }
  update(s);
  return { el, update };
}

