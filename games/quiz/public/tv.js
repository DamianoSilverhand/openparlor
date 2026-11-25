import { h, avatar, timer, byId, ordinal } from '/shared/ui.js';
import { confetti } from '/sdk/tv.js';
import { isMuted } from '/shared/sound.js';
import { tierLabel } from '/shared/config.js';
import { t } from '/shared/i18n.js';

const upper = (s) => (s.gameName || '').toUpperCase();
const target = (tier) => t('quiz.target', { label: tierLabel(tier) });

export const LETTERS = ['A', 'B', 'C', 'D'];

export function screen(s) {
  const g = s.game;
  const key =
    g.phase === 'question' || g.phase === 'reveal' ? (g.finale ? 'finalq' : `q:${g.round}:${g.qi}`)
    : g.phase === 'category' ? `cat:${g.round}`
    : g.phase;
  const builders = { intro, category, question, reveal: question, wager, scores, final };
  return { key, build: builders[g.phase] };
}

// spotId: the one player answering for the team on this question (shown instead of the whole team).
function teamChip(t, s, done, spotId) {
  const get = byId(s.players);
  return h('span', { class: 'tchip' + (done ? ' done' : ''), style: { '--tc': t.color } },
    h('span', { class: 'swatch' }),
    t.name,
    h('span', { class: 'mem' + (spotId ? ' spot' : '') }, (spotId ? [spotId] : t.members).map((id) => get(id)).filter(Boolean).slice(0, 5).map((p) => avatar(p))),
    done && h('span', { class: 'mark' }, '✓'),
  );
}

// ---- intro: meet the teams -------------------------------------------------------------
function intro(s) {
  const g = s.game;
  const get = byId(s.players);
  const t = timer();
  const el = h('div', { class: 'stage' },
    h('div', { class: 'bar' }, h('span', { class: 'pill' }, g.solo ? 'Everyone for themselves' : 'Meet the teams'), h('span', { class: 'code' }, upper(s))),
    h('div', { class: g.solo ? 'teams solo' : 'teams' },
      g.teams.map((tm, i) =>
        h('div', { class: 'card team-card', style: { '--tc': tm.color, animationDelay: `${i * 120}ms` } },
          h('div', { class: 'band' }, tm.name),
          h('div', { class: 'roster-col' },
            tm.members.map((id) => get(id)).filter(Boolean).map((p) => h('div', { class: 'who-row' }, avatar(p), p.name)),
          ),
        ),
      ),
    ),
    h('p', { class: 'sub', style: { textAlign: 'center', marginTop: '1.4rem' } }, g.solo
      ? 'Each question is aimed at one group. It is worth full points to that group and half points to everyone else.'
      : 'Each question is aimed at one group. The player in your team at that level answers, and the rest of the team helps.'),
    h('div', { class: 'big-timer' }, t.el),
  );
  t.update(g);
  return { el, update: (s) => t.update(s.game) };
}

// ---- category -----------------------------------------------------------------------------
function category(s) {
  const g = s.game;
  const t = timer();
  const el = h('div', { class: 'stage' },
    h('div', { class: 'bar' }, h('span', { class: 'pill' }, `Round ${g.round} of ${g.totalRounds}`), h('span', { class: 'code' }, upper(s))),
    h('div', { class: 'center-msg cat-msg' },
      h('p', null, 'The topic is'),
      h('div', { class: 'card cat-card' }, h('h1', null, g.category)),
      h('p', { style: { marginTop: '1.6rem' } }, `${g.qTotal} questions. One of them is worth double.`),
    ),
    h('div', { class: 'big-timer' }, t.el),
  );
  t.update(g);
  return { el, update: (s) => t.update(s.game) };
}

// ---- question + reveal share one screen so the answers do not flicker ---------------------------
function question(s) {
  const g = s.game;
  const get = byId(s.players);
  const t = timer();
  const chips = h('div', { class: 'chips' });
  const head = h('div', { class: 'bar' });
  const opts = h('div', { class: 'opts' },
    g.options.map((text, i) => h('div', { class: `opt-tv o${i}` }, h('span', { class: 'let' }, LETTERS[i]), h('span', { class: 'txt' }, text), h('span', { class: 'tick' }))),
  );
  const results = h('div', { class: 'results' });
  // Optional: speak the question and answers with the browser's built-in voice.
  if (g.readAloud && g.phase === 'question' && 'speechSynthesis' in window && !isMuted()) {
    speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(`${g.q} ${g.options.map((o, i) => `${LETTERS[i]}. ${o}.`).join(' ')}`);
    u.rate = 0.9;
    speechSynthesis.speak(u);
  }
  const fact = h('p', { class: 'fact' });
  const el = h('div', { class: 'stage' },
    head,
    h('div', { class: 'card q-card' }, h('h2', null, g.q)),
    opts,
    h('div', { class: 'under' }, results, fact),
    h('div', { class: 'big-timer' }, t.el),
  );

  function update(s) {
    const g = s.game;
    t.update(g);
    head.replaceChildren(
      h('span', { class: 'pill' }, g.finale ? 'Final question' : `Round ${g.round} of ${g.totalRounds}  ·  Question ${g.qi} of ${g.qTotal}`),
      h('span', { class: 'badges' },
        g.target && h('span', { class: 'badge tgt' }, target(g.target)),
        g.double && h('span', { class: 'badge dbl' }, 'Double points'),
        h('span', { class: 'code' }, g.category),
      ),
    );
    const reveal = g.phase === 'reveal';
    el.classList.toggle('revealed', reveal);
    [...opts.children].forEach((o, i) => {
      o.classList.toggle('right', reveal && i === g.correct);
      o.classList.toggle('wrong', reveal && i !== g.correct);
    });
    t.el.parentElement.style.visibility = reveal ? 'hidden' : 'visible';
    if (!reveal) {
      const teams = g.teams.filter((tm) => g.active.includes(tm.id));
      const spotOf = (id) => (g.spots.find((x) => x.team === id) || {}).pid;
      chips.replaceChildren(...teams.map((tm) => teamChip(tm, s, g.answered.includes(tm.id), spotOf(tm.id))));
      results.replaceChildren(chips);
      fact.textContent = g.target ? (g.solo ? 'Full points if this is your group, half points if it is not.' : 'The player in each team at this group answers. Everyone else helps.') : '';
    } else {
      results.replaceChildren(
        ...g.results.map((r) => {
          const tm = g.teams.find((x) => x.id === r.team);
          const by = r.by && get(r.by);
          return h('div', { class: 'res ' + (r.correct ? 'ok' : 'no'), style: { '--tc': tm.color } },
            h('span', { class: 'swatch' }),
            h('b', null, tm.name),
            h('span', { class: 'ans' }, r.choice == null ? 'No answer' : `${LETTERS[r.choice]}${by && !g.solo ? ` (${by.name})` : ''}${r.half ? ', half points' : ''}`),
            h('span', { class: 'pts' }, r.pts ? `${r.pts > 0 ? '+' : ''}${r.pts}` : '0'),
          );
        }),
      );
      fact.textContent = g.fact || '';
    }
  }
  update(s);
  return { el, update, destroy: () => 'speechSynthesis' in window && speechSynthesis.cancel() };
}

// ---- wager ------------------------------------------------------------------------------------------------
function wager(s) {
  const g = s.game;
  const t = timer();
  const chips = h('div', { class: 'chips' });
  const board = h('div', { class: 'wager-scores' });
  const el = h('div', { class: 'stage' },
    h('div', { class: 'bar' }, h('span', { class: 'pill' }, 'Final question'), h('span', { class: 'code' }, upper(s))),
    h('div', { class: 'center-msg cat-msg' },
      h('p', null, 'One last question about'),
      h('div', { class: 'card cat-card' }, h('h1', null, g.category)),
      h('p', { style: { margin: '1.4rem 0 1rem' } }, 'Get it right to win your wager. Get it wrong and you lose it. Choose on your phone.'),
      board,
    ),
    chips,
    h('div', { class: 'big-timer' }, t.el),
  );
  function update(s) {
    const g = s.game;
    t.update(g);
    const teams = g.teams.filter((tm) => g.active.includes(tm.id));
    chips.replaceChildren(...teams.map((tm) => teamChip(tm, s, g.wagered.includes(tm.id))));
    board.replaceChildren(...g.teams.map((tm) => h('span', { class: 'ws', style: { '--tc': tm.color } }, h('span', { class: 'swatch' }), `${tm.name}: ${tm.score}`)));
  }
  update(s);
  return { el, update };
}

// ---- scores ---------------------------------------------------------------------------------------------------
function board(s) {
  const g = s.game;
  const get = byId(s.players);
  const max = Math.max(1, ...g.standings.map((x) => x.score));
  return h('div', { class: 'board' },
    g.standings.map((x, i) =>
      h('div', { class: 'row', style: { animationDelay: `${i * 70}ms` } },
        h('span', { class: 'rank' }, i + 1),
        h('div', { class: 'meter' },
          h('div', { class: 'fill', style: { width: `${Math.max(6, (x.score / max) * 100)}%`, background: x.color } }),
          h('div', { class: 'in' },
            h('span', { class: 'tag' }, x.name, h('span', { class: 'mem' }, x.members.map((id) => get(id)).filter(Boolean).slice(0, 5).map((p) => avatar(p)))),
            h('span', { class: 'score' }, x.gain !== 0 && h('span', { class: 'gain' }, `${x.gain > 0 ? '+' : ''}${x.gain}`), x.score),
          ),
        ),
      ),
    ),
  );
}

function scores(s) {
  const g = s.game;
  const t = timer();
  const el = h('div', { class: 'stage' },
    h('div', { class: 'bar' }, h('span', { class: 'pill' }, `After round ${g.round} of ${g.totalRounds}`), h('span', { class: 'code' }, g.round >= g.totalRounds ? 'FINAL QUESTION NEXT' : 'NEXT ROUND SOON')),
    board(s),
    h('div', { class: 'big-timer' }, t.el),
  );
  t.update(g);
  return { el, update: (s) => t.update(s.game) };
}

// ---- final ---------------------------------------------------------------------------------------------------
function final(s) {
  const g = s.game;
  const get = byId(s.players);
  const top = g.standings.slice(0, 3);
  const order = [1, 0, 2].filter((i) => top[i]);
  const pods = order.map((i) =>
    h('div', { class: `pod p${i + 1}`, style: { animationDelay: `${(2 - i) * 350}ms` } },
      h('span', { class: 'mem big' }, top[i].members.map((id) => get(id)).filter(Boolean).slice(0, 4).map((p) => avatar(p))),
      h('span', { class: 'nm' }, top[i].name),
      h('span', { class: 'pts' }, `${top[i].score} pts`),
      h('div', { class: 'blk', style: { background: top[i].color } }, i + 1),
    ),
  );
  const rest = g.standings.slice(3).map((x, i) => h('span', { class: 'tag' }, ordinal(i + 3), ' ', x.name, ` · ${x.score}`));
  const award = (title, text, a) => {
    if (!a) return null;
    const tm = g.teams.find((t) => t.id === a.id);
    return h('div', { class: 'card award' }, h('span', { class: 'swatch big', style: { '--tc': tm.color } }), h('div', null, h('div', { class: 't' }, title), h('div', { class: 'd' }, `${tm.name}: ${text(a.value)}`)));
  };
  const a = g.awards;
  const el = h('div', { class: 'stage' },
    h('div', { class: 'final' },
      h('div', null, h('h1', null, g.solo ? 'And the winner is...' : 'And the winning team is...'), h('div', { class: 'podium' }, pods), h('div', { class: 'rest' }, rest)),
      h('div', { class: 'awards' },
        award('Brainiest', (n) => `${n} right ${n === 1 ? 'answer' : 'answers'}`, a.brainy),
        award('Fastest fingers', (n) => `${n} bonus points for speed`, a.fast),
        award('Boldest gambler', (n) => `won ${n} on the final wager`, a.gambler),
        h('p', { class: 'hint' }, 'Anyone can tap ', h('b', null, 'Play again'), ' or ', h('b', null, 'Back to the lobby'), ' on their phone.'),
      ),
    ),
    confetti(),
  );
  return { el, update() {} };
}

// ---- sounds ---------------------------------------------------------------------------------
const len = (a) => (Array.isArray(a) ? a.length : 0);
export const cues = {
  timedPhases: ['question', 'wager'],
  onPhase: (g, sfx) => {
    if (g.phase === 'reveal') sfx(g.results.some((r) => r.correct) ? 'correct' : 'wrong');
    else if (g.phase === 'wager') sfx('drum');
    else sfx(g.phase === 'question' ? (g.finale ? 'drum' : 'go') : 'whoosh');
  },
  onChange: (g, pg, sfx) => { if (len(g.answered) > len(pg.answered) || len(g.wagered) > len(pg.wagered)) sfx('lock'); },
};
