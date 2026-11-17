import { h, avatar, tag, timer, byId, serverNow, onTick } from '/shared/ui.js';
import { finalScreen, confetti } from '/tv/common.js';

export function screen(s) {
  const g = s.game;
  const key = g.phase === 'final' ? 'final' : `${g.phase}:${g.idx}`;
  return { key, build: { intro, play, results, final }[g.phase] };
}

const head = (g, right) => h('div', { class: 'bar' }, h('span', { class: 'pill' }, `Game ${g.idx} of ${g.total}`), right);

// ---- intro --------------------------------------------------------------------------
function intro(s) {
  const g = s.game;
  const t = timer();
  const el = h('div', { class: 'stage' },
    head(g, h('span', { class: 'code' }, 'FAMILY MINI-GAMES')),
    h('div', { class: 'center-msg cat-msg' },
      h('p', null, 'Up next'),
      h('div', { class: 'card cat-card' }, h('h1', null, g.mg.name)),
      h('p', { style: { marginTop: '1.6rem', color: 'var(--ink)' } }, g.mg.howto),
      g.team && h('p', { style: { marginTop: '0.6rem' } }, 'Playing together: everyone\'s scores add up to a family total.'),
    ),
    h('div', { class: 'lineup' }, g.lineup.map((n, i) => h('span', { class: 'lu' + (i + 1 === g.idx ? ' now' : i + 1 < g.idx ? ' past' : '') }, n))),
    h('div', { class: 'big-timer' }, t.el),
  );
  t.update(g);
  return { el, update: (s) => t.update(s.game) };
}

// ---- play: a live race -------------------------------------------------------------------
function play(s) {
  const g = s.game;
  const get = byId(s.players);
  const clock = h('span', { class: 'clock' });
  const count = h('div', { class: 'countdown' });
  const rows = h('div', { class: 'race' });
  const bars = new Map();
  const el = h('div', { class: 'stage' },
    head(g, h('span', { class: 'badges' }, h('span', { class: 'code' }, g.mg.name), clock)),
    rows,
    count,
  );
  for (const id of g.roster) {
    const p = get(id);
    if (!p) continue;
    const fill = h('div', { class: 'rfill' });
    const num = h('span', { class: 'rnum' }, '0');
    const done = h('span', { class: 'rdone' });
    rows.append(h('div', { class: 'rrow' }, h('div', { class: 'rwho' }, avatar(p), h('span', null, p.name)), h('div', { class: 'rtrack' }, fill), num, done));
    bars.set(id, { fill, num, done });
  }
  onTick(el, () => {
    const left = g.startAt - serverNow();
    if (left > 0) {
      count.textContent = Math.ceil(left / 1000);
      count.style.display = 'grid';
      clock.textContent = '';
    } else {
      count.textContent = left > -900 ? 'GO!' : '';
      count.style.display = left > -900 ? 'grid' : 'none';
      clock.textContent = `${Math.max(0, Math.ceil((g.endAt - serverNow()) / 1000))}s`;
    }
  });
  function update(s) {
    const g2 = s.game;
    for (const l of g2.live) {
      const b = bars.get(l.id);
      if (!b) continue;
      b.fill.style.width = `${Math.max(1.5, (l.score / g2.mg.max) * 100)}%`;
      b.num.textContent = l.score;
      b.done.textContent = g2.done.includes(l.id) ? '✓' : '';
    }
  }
  update(s);
  return { el, update };
}

// ---- results --------------------------------------------------------------------------------
function results(s) {
  const g = s.game;
  const get = byId(s.players);
  const t = timer();
  const totals = new Map(g.standings.map((x) => [x.id, x.score]));
  const max = Math.max(1, ...g.rows.map((r) => r.score));
  const missing = s.players.filter((p) => !g.rows.some((r) => r.id === p.id) && p.connected);
  const tr = g.teamRound;
  const banner = g.team
    ? h('div', { class: 'card family-total' },
        h('span', { class: 'ft-label' }, 'Family total'),
        h('span', { class: 'ft-num' }, tr.total),
        tr.record
          ? h('span', { class: 'ft-note rec' }, tr.previous ? `New family record! The old one was ${tr.previous}.` : 'A first family record to beat!')
          : tr.previous
            ? h('span', { class: 'ft-note' }, `Family record for ${tr.count} players${tr.handicap === 'on' ? ', handicaps on' : ', handicaps off'}${tr.local === 'only' ? ', Zambian content' : tr.local === 'mixed' ? ', mixed content' : ''}: ${tr.previous}`)
            : null,
        !tr.complete && h('span', { class: 'ft-note' }, 'Records need a score from everyone who started.'),
      )
    : null;
  const el = h('div', { class: 'stage' },
    head(g, h('span', { class: 'code' }, `${g.mg.name.toUpperCase()}: RESULTS`)),
    banner,
    h('div', { class: 'board' },
      g.rows.map((r, i) =>
        h('div', { class: 'row', style: { animationDelay: `${i * 70}ms` } },
          h('span', { class: 'rank' }, g.team ? '' : r.rank + 1),
          h('div', { class: 'meter' },
            h('div', { class: 'fill', style: { width: `${Math.max(6, (r.score / max) * 100)}%` } }),
            h('div', { class: 'in' },
              tag(get(r.id)),
              g.team
                ? h('span', { class: 'score' }, `${r.score}`)
                : h('span', { class: 'score' }, h('span', { class: 'gain' }, `+${r.pts}`), `${r.score}`, h('span', { class: 'total' }, `${totals.get(r.id)} total`)),
            ),
          ),
        ),
      ),
      missing.length > 0 && h('p', { class: 'sub' }, `No score: ${missing.map((p) => p.name).join(', ')}`),
    ),
    h('div', { class: 'big-timer' }, t.el),
  );
  t.update(g);
  return { el, update: (s) => t.update(s.game) };
}

// ---- final ---------------------------------------------------------------------------------------
function teamFinal(s) {
  const g = s.game;
  const get = byId(s.players);
  const max = Math.max(1, ...g.standings.map((x) => x.score));
  const broken = g.setRecords.filter((r) => r.record);
  return h('div', { class: 'stage' },
    h('div', { class: 'bar' }, h('span', { class: 'pill' }, 'You did it together'), h('span', { class: 'code' }, 'FAMILY MINI-GAMES')),
    h('div', { class: 'final' },
      h('div', null,
        h('h1', null, 'Family total'),
        h('div', { class: 'big-total' }, g.teamTotal),
        broken.length > 0
          ? h('div', { class: 'card pad rec-list' }, h('b', null, 'New family records'), broken.map((r) => h('div', null, `${r.name}: ${r.total}`)))
          : h('p', { class: 'hint' }, 'Play again to try to beat your family records.'),
      ),
      h('div', { class: 'board' },
        g.standings.map((x, i) =>
          h('div', { class: 'row', style: { animationDelay: `${i * 70}ms` } },
            h('span', { class: 'rank' }, ''),
            h('div', { class: 'meter' },
              h('div', { class: 'fill', style: { width: `${Math.max(6, (x.score / max) * 100)}%` } }),
              h('div', { class: 'in' }, tag(get(x.id)), h('span', { class: 'score' }, `${x.score}`)),
            ),
          ),
        ),
        h('p', { class: 'hint' }, 'Anyone can tap ', h('b', null, 'Play again'), ' or ', h('b', null, 'Back to the lobby'), ' on their phone.'),
      ),
    ),
    confetti(),
  );
}

function final(s) {
  if (s.game.team) return { el: teamFinal(s), update() {} };
  const a = s.game.awards;
  return {
    el: finalScreen(s, [
      a.wins && { id: a.wins.id, title: 'Most round wins', text: `${a.wins.value} ${a.wins.value === 1 ? 'win' : 'wins'}` },
      a.best && { id: a.best.id, title: 'Best single round', text: `${a.best.value}% of the top possible score` },
    ]),
    update() {},
  };
}
