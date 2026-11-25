import { h, avatar, tag, timer, byId } from '/shared/ui.js';
import { finalScreen } from '/sdk/tv.js';


const chipFor = (p, done) =>
  h('span', { class: 'chip ' + (done ? 'done' : 'wait') }, avatar(p), p.name, done && h('span', { class: 'mark' }, '✓'));

export function screen(s) {
  const g = s.game;
  const key = g.phase + (g.phase === 'vote' || g.phase === 'reveal' ? `:${g.round}:${g.itemId}` : g.phase === 'answer' ? `:${g.round}` : '');
  const builders = { answer, vote, reveal, scores, final };
  return { key, build: builders[g.phase] };
}

function header(g) {
  return h('div', { class: 'bar' }, h('span', { class: 'pill' }, `Round ${g.round} of ${g.totalRounds}`), h('span', { class: 'code' }, 'WHO SAID THAT?'));
}

// ---- answer ------------------------------------------------------------------
function answer(s) {
  const g = s.game;
  const t = timer();
  const chips = h('div', { class: 'chips' });
  const el = h('div', { class: 'stage' },
    header(g),
    h('div', { class: 'card prompt-card' }, h('h2', null, g.prompt)),
    h('p', { class: 'sub' }, 'Write your answer on your phone. Nobody will know it was you. Yet.'),
    chips,
    h('div', { class: 'big-timer' }, t.el),
  );
  function update(s) {
    const g = s.game;
    t.update(g);
    chips.replaceChildren(...s.players.filter((p) => p.connected).map((p) => chipFor(p, g.answered.includes(p.id))));
  }
  update(s);
  return { el, update };
}

// ---- vote --------------------------------------------------------------------
function vote(s) {
  const g = s.game;
  const t = timer();
  const chips = h('div', { class: 'chips' });
  const laughs = h('span', { class: 'laughs' });
  const el = h('div', { class: 'stage' },
    h('div', { class: 'bar' },
      h('span', { class: 'pill' }, `Round ${g.round} of ${g.totalRounds}  ·  Answer ${g.idx + 1} of ${g.total}`),
      laughs,
    ),
    h('div', { class: 'quote card' }, h('h2', null, `“${g.text}”`)),
    h('p', { class: 'sub' }, 'Who wrote this? Pick a name on your phone.'),
    chips,
    h('div', { class: 'big-timer' }, t.el),
  );
  function update(s) {
    const g = s.game;
    t.update(g);
    laughs.textContent = g.laughs ? `😂 ${g.laughs}` : '';
    chips.replaceChildren(...s.players.filter((p) => g.connected.includes(p.id)).map((p) => chipFor(p, g.voted.includes(p.id))));
  }
  update(s);
  return { el, update };
}

// ---- reveal ------------------------------------------------------------------
function reveal(s) {
  const g = s.game;
  const get = byId(s.players);
  const author = get(g.author);
  const names = (ids) => ids.map((id) => get(id)).filter(Boolean).map((p) => h('span', { class: 'chip' }, avatar(p), p.name));
  const laughs = h('span', { class: 'laughs' });
  const listOf = (title, pts, ids, none) =>
    h('div', { class: 'card' },
      h('h3', null, title, ' ', h('span', { class: 'pts' }, pts)),
      ids.length ? h('div', { class: 'chips' }, names(ids)) : h('p', { class: 'empty' }, none),
    );
  const t = timer();
  const el = h('div', { class: 'stage' },
    h('div', { class: 'bar' }, h('span', { class: 'pill' }, `Answer ${g.idx + 1} of ${g.total}`), laughs),
    h('div', { class: 'quote small card' }, h('h2', null, `“${g.text}”`)),
    h('div', { class: 'reveal-who' },
      author && avatar(author),
      h('div', null, h('p', { class: 'was' }, 'Written by'), h('h2', null, author ? author.name : 'Someone')),
    ),
    h('div', { class: 'tally' },
      listOf('Spotted it', `+${g.pointsCorrect} each`, g.correct, 'Nobody guessed right.'),
      listOf('Fooled', `+${g.pointsFooled} each to ${author ? author.name : 'the author'}`, g.fooled, 'Nobody was fooled.'),
    ),
    h('div', { class: 'big-timer' }, t.el),
  );
  function update(s) {
    t.update(s.game);
    laughs.textContent = s.game.laughs ? `😂 ${s.game.laughs}  (+${s.game.laughs * g.pointsLaugh})` : '';
  }
  update(s);
  return { el, update };
}

// ---- scores ------------------------------------------------------------------
export function board(s) {
  const g = s.game;
  const get = byId(s.players);
  const max = Math.max(1, ...g.standings.map((x) => x.score));
  return h('div', { class: 'board' },
    g.standings.map((x, i) => {
      const p = get(x.id);
      return h('div', { class: 'row', style: { animationDelay: `${i * 70}ms` } },
        h('span', { class: 'rank' }, i + 1),
        h('div', { class: 'meter' },
          h('div', { class: 'fill', style: { width: `${Math.max(6, (x.score / max) * 100)}%` } }),
          h('div', { class: 'in' }, tag(p), h('span', { class: 'score' }, x.gain > 0 && h('span', { class: 'gain' }, `+${x.gain}`), x.score)),
        ),
      );
    }),
  );
}

function scores(s) {
  const g = s.game;
  const t = timer();
  const last = g.round >= g.totalRounds;
  const el = h('div', { class: 'stage' },
    h('div', { class: 'bar' }, h('span', { class: 'pill' }, `After round ${g.round} of ${g.totalRounds}`), h('span', { class: 'code' }, last ? 'LAST ROUND DONE' : 'NEXT ROUND SOON')),
    g.note && h('p', { class: 'note' }, g.note),
    board(s),
    h('div', { class: 'big-timer' }, t.el),
  );
  function update(s) {
    t.update(s.game);
  }
  update(s);
  return { el, update };
}

// ---- final -------------------------------------------------------------------
function final(s) {
  const a = s.game.awards;
  return {
    el: finalScreen(s, [
      a.detective && { id: a.detective.id, title: 'Best detective', text: `${a.detective.value} correct ${a.detective.value === 1 ? 'guess' : 'guesses'}` },
      a.trickster && { id: a.trickster.id, title: 'Master of disguise', text: `fooled people ${a.trickster.value} ${a.trickster.value === 1 ? 'time' : 'times'}` },
      a.funniest && { id: a.funniest.id, title: 'Funniest answers', text: `${a.funniest.value} 😂 in total` },
    ]),
    update() {},
  };
}

// ---- sounds (the TV plays the shared cues) -------------------------------------------------
const len = (a) => (Array.isArray(a) ? a.length : 0);
export const cues = {
  timedPhases: ['answer', 'vote'], // the last three seconds tick in these phases
  onPhase: (g, sfx) => sfx(g.phase === 'reveal' ? 'drum' : 'whoosh'), // a new screen
  onChange: (g, pg, sfx) => { // something changed within the same screen
    if (len(g.answered) > len(pg.answered) || len(g.voted) > len(pg.voted)) sfx('lock');
    if ((g.laughs || 0) > (pg.laughs || 0)) sfx('pop');
  },
};
