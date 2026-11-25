import { h, avatar, timer, byId, serverNow, onTick, ordinal } from '/shared/ui.js';
import { play as sfx } from '/shared/sound.js';
import { t as tx } from '/shared/i18n.js';
import { meBar, hostButton, final } from '/sdk/play.js';
import * as memory from '/play/mg/memory.js';
import * as scramble from '/play/mg/scramble.js';
import * as reaction from '/play/mg/reaction.js';
import * as pattern from '/play/mg/pattern.js';
import * as clash from '/play/mg/clash.js';
import * as math from '/play/mg/math.js';
import * as logic from '/play/mg/logic.js';
import * as literacy from '/play/mg/literacy.js';

const MODS = { memory, scramble, reaction, pattern, clash, math, logic, literacy };
const game = (a, extra) => ({ t: 'g', a, ...extra });

export function screen(s, ctx) {
  const g = s.game;
  const key = g.phase === 'final' ? 'final' : `${g.phase}:${g.idx}`;
  const build = { intro, play, results: g.team ? resultsTogether : results, final: g.team ? finalTogether : final }[g.phase];
  return { key, build: (s) => build(s, ctx) };
}

// ---- intro ------------------------------------------------------------------
function intro(s, ctx) {
  const g = s.game;
  const t = timer();
  const el = h('div', { class: 'screen' },
    meBar(s),
    h('p', { class: 'lead' }, `Game ${g.idx} of ${g.total}`),
    h('div', { class: 'card pad prompt' }, h('h2', null, g.mg.name)),
    h('p', { class: 'lead' }, g.mg.howto),
    g.team && h('p', { class: 'lead', style: { fontWeight: 800 } }, tx('mini.together')),
    s.settings.handicap === 'on' && h('p', { class: 'lead', style: { fontSize: '0.9rem' } }, 'Handicaps are on, so each age gets a fair challenge.'),
    t.el,
    hostButton(s, ctx, 'Skip ahead', false),
  );
  t.update(g);
  return { el, update: (s) => t.update(s.game) };
}

// ---- play: hosts one mini-game for the length of the round ----------------------------
function play(s, ctx) {
  const g = s.game;
  const root = h('div', { class: 'mg-root' });
  const overlay = h('div', { class: 'mg-overlay' });
  const clock = h('span', { class: 'mg-clock' });
  const el = h('div', { class: 'screen mg' },
    h('div', { class: 'mg-head' }, h('b', null, g.mg.name), clock),
    root,
    overlay,
  );
  let api = null;
  let started = false;
  let finished = false;
  let stopId = null;
  let lastSent = 0;

  const showDone = (score) => {
    overlay.style.display = 'none';
    root.replaceChildren(
      h('div', { class: 'card pad big-result good' }, h('h2', null, 'Finished!'), h('p', null, `Score ${score}`)),
      h('p', { class: 'status' }, 'Waiting for the others...'),
    );
  };
  const finish = (score) => {
    if (finished) return;
    finished = true;
    if (api) api.destroy();
    clearTimeout(stopId);
    ctx.send(game('result', { score }));
    sfx('coin');
    showDone(Math.round(score));
  };
  const progress = (score) => {
    const now = Date.now();
    if (now - lastSent < 500) return;
    lastSent = now;
    ctx.send(game('progress', { score }));
  };
  const launch = () => {
    started = true;
    overlay.style.display = 'none';
    root.replaceChildren();
    api = MODS[g.mg.id].start({ root, seed: g.seed, level: g.level, durationMs: g.endAt - g.startAt, progress, finish });
    stopId = setTimeout(() => finish(api.score()), Math.max(0, g.endAt - serverNow()));
  };

  if (!g.inRound) {
    root.replaceChildren(h('h1', { class: 'title' }, 'Next round'), h('p', { class: 'lead' }, 'This round started before you joined. Watch the TV and you will be in for the next game.'));
    overlay.style.display = 'none';
  } else if (g.myResult != null) {
    finished = true;
    showDone(g.myResult);
  } else {
    root.replaceChildren(h('p', { class: 'lead' }, g.mg.howto));
    onTick(el, () => {
      const left = g.startAt - serverNow();
      if (!started && !finished) {
        if (left > 0) overlay.textContent = Math.ceil(left / 1000);
        else launch();
      }
      const remain = Math.max(0, Math.ceil((g.endAt - serverNow()) / 1000));
      clock.textContent = left > 0 ? `${g.mg.duration}s` : `${remain}s`;
      clock.classList.toggle('low', left <= 0 && remain <= 5);
    });
  }
  return {
    el,
    update() {},
    destroy() {
      clearTimeout(stopId);
      if (api) api.destroy();
    },
  };
}

// ---- results ------------------------------------------------------------------------------------
function results(s, ctx) {
  const g = s.game;
  const get = byId(s.players);
  const t = timer();
  const mine = g.rows.find((r) => r.id === s.me);
  const el = h('div', { class: 'screen' },
    meBar(s),
    h('h1', { class: 'title' }, mine ? (mine.rank === 0 ? 'You won this one!' : `You came ${ordinal(mine.rank)}`) : 'Round over'),
    (g.personalBests || []).includes(s.me) && h('div', { class: 'card pad big-result good' }, h('h2', null, 'New personal best!'), h('p', null, `Score: ${mine ? mine.score : ''}`)),
    h('div', { class: 'rank-list' },
      g.rows.map((r) =>
        h('div', { class: 'r' + (r.id === s.me ? ' me' : '') },
          h('span', { class: 'tag' }, h('b', null, r.rank + 1), avatar(get(r.id)), get(r.id) ? get(r.id).name : '?'),
          h('span', null, h('span', { class: 'gain' }, `+${r.pts}`), r.score),
        ),
      ),
    ),
    t.el,
    hostButton(s, ctx, g.idx >= g.total ? 'See the winners' : 'Next game', true),
  );
  t.update(g);
  return { el, update: (s) => t.update(s.game) };
}

// ---- play-together versions of results and final -------------------------------------
function resultsTogether(s, ctx) {
  const g = s.game;
  const get = byId(s.players);
  const t = timer();
  const tr = g.teamRound;
  const el = h('div', { class: 'screen' },
    meBar(s),
    h('h1', { class: 'title' }, tx('mini.groupTotalValue', { total: tr.total })),
    (g.personalBests || []).includes(s.me) && h('div', { class: 'card pad big-result good' }, h('h2', null, 'New personal best!')),
    tr.record
      ? h('div', { class: 'card pad big-result good' }, h('h2', null, tx('mini.newRecord')), h('p', null, tr.previous ? `For ${tr.scope}. The old record was ${tr.previous}.` : `For ${tr.scope}. Now you have one to beat.`))
      : tr.previous ? h('p', { class: 'lead' }, tx('mini.recordForPhone', { scope: tr.scope, previous: tr.previous })) : null,
    !tr.complete && h('p', { class: 'lead' }, 'Records need a score from everyone who started.'),
    h('div', { class: 'rank-list' },
      g.rows.map((r) =>
        h('div', { class: 'r' + (r.id === s.me ? ' me' : '') }, h('span', { class: 'tag' }, avatar(get(r.id)), get(r.id) ? get(r.id).name : '?'), h('span', null, r.score)),
      ),
    ),
    t.el,
    hostButton(s, ctx, g.idx >= g.total ? 'See your total' : 'Next game', true),
  );
  t.update(g);
  return { el, update: (s) => t.update(s.game) };
}

function finalTogether(s, ctx) {
  const g = s.game;
  const get = byId(s.players);
  const broken = g.setRecords.filter((r) => r.record);
  const el = h('div', { class: 'screen' },
    meBar(s),
    h('h1', { class: 'title' }, `Together you scored ${g.teamTotal}`),
    broken.length > 0 && h('div', { class: 'card pad big-result good' }, h('h2', null, tx('mini.newRecords')), broken.map((r) => h('p', null, `${r.name}: ${r.total} (${r.scope})`))),
    h('div', { class: 'rank-list' },
      g.standings.map((x) => h('div', { class: 'r' + (x.id === s.me ? ' me' : '') }, h('span', { class: 'tag' }, avatar(get(x.id)), get(x.id).name), h('span', null, x.score))),
    ),
    h('button', { class: 'btn block push', onclick: () => ctx.send({ t: 'again' }) }, 'Play again'),
    h('button', { class: 'btn plain block', onclick: () => ctx.send({ t: 'lobby' }) }, 'Back to the lobby'),
  );
  return { el, update() {} };
}

// ---- sounds on your own phone ---------------------------------------------------------------
export const cues = {
  onChange(s, ps, changed, sfx) {
    const g = s.game;
    if (changed && g.phase === 'results') {
      const mine = g.rows.find((r) => r.id === s.me);
      if (mine) sfx(mine.rank === 0 ? 'fanfare' : 'coin');
    }
  },
};
