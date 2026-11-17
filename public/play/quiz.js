import { h, avatar, timer, byId, ordinal } from '/shared/ui.js';
import { hostButton } from '/play/whosaidthat.js';

const LETTERS = ['A', 'B', 'C', 'D'];
const game = (a, extra) => ({ t: 'g', a, ...extra });

export function screen(s, ctx) {
  const g = s.game;
  const spectator = !g.myTeam && g.phase !== 'final';
  const key = spectator ? 'spectator'
    : g.phase === 'question' ? `q:${g.round}:${g.qi}:${g.finale ? 'f' : ''}`
    : g.phase === 'reveal' ? `r:${g.round}:${g.qi}:${g.finale ? 'f' : ''}`
    : g.phase === 'category' ? `cat:${g.round}`
    : g.phase;
  const build = spectator ? watching : { intro, category, question, reveal, wager, scores, final }[g.phase];
  return { key, build: (s) => build(s, ctx) };
}

const myTeam = (g) => g.teams.find((t) => t.id === g.myTeam);

function teamBar(s) {
  const g = s.game;
  const t = myTeam(g);
  if (!t) return null;
  return h('div', { class: 'team-bar', style: { '--tc': t.color } },
    h('span', { class: 'swatch' }),
    h('b', null, t.name),
    h('span', { class: 'ts' }, `${t.score} pts`),
  );
}

function watching(s) {
  return {
    el: h('div', { class: 'screen' },
      h('h1', { class: 'title' }, 'Watch the TV'),
      h('p', { class: 'lead' }, 'This quiz started before you joined. You can join the next game from the lobby.'),
    ),
    update() {},
  };
}

// ---- intro -----------------------------------------------------------------------------
function intro(s, ctx) {
  const g = s.game;
  const get = byId(s.players);
  const t = myTeam(g);
  const t2 = timer();
  const mates = t.members.filter((id) => id !== s.me).map((id) => get(id)).filter(Boolean);
  const el = h('div', { class: 'screen' },
    h('p', { class: 'lead' }, g.solo ? "You're playing on your own." : "You're on team"),
    h('div', { class: 'card pad team-hero', style: { '--tc': t.color } }, h('h1', null, t.name)),
    mates.length > 0 && h('p', { class: 'lead' }, 'With ', mates.map((p, i) => [i ? ', ' : '', h('b', { style: { color: 'var(--ink)' } }, p.name)])),
    h('p', { class: 'lead' }, 'Talk the answers over with your team. Kids see fewer choices to make it fair.'),
    t2.el,
    hostButton(s, ctx, 'Skip ahead', false),
  );
  t2.update(g);
  return { el, update: (s) => t2.update(s.game) };
}

function category(s, ctx) {
  const g = s.game;
  const t = timer();
  const el = h('div', { class: 'screen' },
    teamBar(s),
    t.el,
    h('p', { class: 'lead' }, `Round ${g.round} of ${g.totalRounds}`),
    h('div', { class: 'card pad prompt' }, h('h2', null, g.category)),
    h('p', { class: 'lead' }, `${g.qTotal} questions, and one is worth double.`),
  );
  t.update(g);
  return { el, update: (s) => t.update(s.game) };
}

// ---- question ------------------------------------------------------------------------------
function question(s, ctx) {
  const g = s.game;
  const get = byId(s.players);
  const t = timer();
  let chosen = g.teamChoice;
  const btns = new Map();
  const info = h('p', { class: 'status' });
  const opts = h('div', { class: 'qopts' },
    g.mine.map((i) => {
      const b = h('button', { class: `qopt o${i}`, onclick: () => { chosen = i; paint(); ctx.send(game('answer', { idx: i })); } },
        h('span', { class: 'let' }, LETTERS[i]), h('span', { class: 'txt' }, g.options[i]),
      );
      btns.set(i, b);
      return b;
    }),
  );
  const paint = () => btns.forEach((b, i) => b.classList.toggle('on', i === chosen));
  paint();
  const el = h('div', { class: 'screen' },
    teamBar(s),
    t.el,
    h('div', { class: 'qhead' }, g.double && h('span', { class: 'badge dbl' }, 'Double points'), h('span', { class: 'cat' }, g.finale ? 'Final question' : g.category)),
    h('div', { class: 'card quote' }, h('h2', null, g.q)),
    opts,
    info,
    hostButton(s, ctx, 'Skip ahead', false),
  );
  function update(s) {
    const g = s.game;
    t.update(g);
    if (g.teamChoice != null) chosen = g.teamChoice;
    paint();
    const by = g.teamBy && get(g.teamBy);
    info.textContent = chosen == null ? 'Talk it over, then tap an answer.' : by && by.id !== s.me ? `${by.name} picked ${LETTERS[chosen]}. Tap another to change it.` : `You picked ${LETTERS[chosen]}. Teammates can still change it.`;
  }
  t.update(g);
  update(s);
  return { el, update };
}

// ---- reveal -------------------------------------------------------------------------------------
function reveal(s, ctx) {
  const g = s.game;
  const r = g.results.find((x) => x.team === g.myTeam);
  const right = g.options[g.correct];
  let card;
  if (r && r.correct) card = h('div', { class: 'card pad big-result good' }, h('h2', null, 'Correct!'), h('p', null, `+${r.pts} points${g.double ? ' (double!)' : ''}`));
  else if (r && r.choice != null) card = h('div', { class: 'card pad big-result' }, h('h2', null, 'Not quite'), h('p', null, r.pts < 0 ? `${r.pts} points` : 'No points this time'));
  else card = h('div', { class: 'card pad big-result' }, h('h2', null, 'Out of time'), h('p', null, r && r.pts < 0 ? `${r.pts} points` : 'No answer from your team'));
  const el = h('div', { class: 'screen' },
    teamBar(s),
    card,
    h('p', { class: 'lead' }, 'The answer was'),
    h('div', { class: 'card pad prompt' }, h('h2', null, `${LETTERS[g.correct]}: ${right}`)),
    g.fact && h('p', { class: 'lead' }, g.fact),
    hostButton(s, ctx, 'Next', true),
  );
  return { el, update() {} };
}

// ---- wager ---------------------------------------------------------------------------------------------------
function wager(s, ctx) {
  const g = s.game;
  const t = timer();
  let mine = g.myWager;
  const btns = new Map();
  const paint = () => btns.forEach((b, amt) => b.classList.toggle('on', amt === mine));
  const choices = h('div', { class: 'words' },
    g.wagerChoices.map((amt) => {
      const b = h('button', { class: 'word', onclick: () => { mine = amt; paint(); ctx.send(game('wager', { amount: amt })); } },
        h('span', { class: 'w', style: { textTransform: 'none' } }, amt === 0 ? 'Play it safe' : `Wager ${amt}`),
        h('span', { class: 'n' }, amt === 0 ? 'Risk nothing' : amt === myTeam(g).score ? 'All in' : 'Win it or lose it'),
      );
      btns.set(amt, b);
      return b;
    }),
  );
  paint();
  const el = h('div', { class: 'screen' },
    teamBar(s),
    t.el,
    h('h1', { class: 'title' }, 'Final wager'),
    h('p', { class: 'lead' }, `The topic is ${g.category}. Right answer wins your wager. Wrong answer loses it.`),
    choices,
    h('p', { class: 'status' }, 'Teammates can change the wager until time is up.'),
    hostButton(s, ctx, 'Skip ahead', false),
  );
  t.update(g);
  return { el, update: (s) => { t.update(s.game); if (s.game.myWager != null) { mine = s.game.myWager; paint(); } } };
}

// ---- scores / final ---------------------------------------------------------------------------------------
function list(s) {
  const g = s.game;
  return h('div', { class: 'rank-list' },
    g.standings.map((x, i) =>
      h('div', { class: 'r' + (x.id === g.myTeam ? ' me' : '') },
        h('span', { class: 'tag' }, h('b', null, i + 1), h('span', { class: 'swatch', style: { '--tc': x.color } }), x.name),
        h('span', null, x.gain !== 0 && h('span', { class: 'gain' }, `${x.gain > 0 ? '+' : ''}${x.gain}`), x.score),
      ),
    ),
  );
}

function scores(s, ctx) {
  const g = s.game;
  const t = timer();
  const el = h('div', { class: 'screen' },
    teamBar(s),
    h('h1', { class: 'title' }, `After round ${g.round}`),
    list(s),
    t.el,
    hostButton(s, ctx, g.round >= g.totalRounds ? 'Continue' : 'Next round', true),
  );
  t.update(g);
  return { el, update: (s) => t.update(s.game) };
}

function final(s, ctx) {
  const g = s.game;
  const place = g.standings.findIndex((x) => x.id === g.myTeam);
  const words = ['Your team won!', 'Second place', 'Third place'];
  const el = h('div', { class: 'screen' },
    teamBar(s),
    h('h1', { class: 'title' }, place >= 0 && place < 3 ? words[place] : 'Game over'),
    list(s),
    h('button', { class: 'btn block push', onclick: () => ctx.send({ t: 'again' }) }, 'Play again'),
    h('button', { class: 'btn plain block', onclick: () => ctx.send({ t: 'lobby' }) }, 'Back to the lobby'),
  );
  return { el, update() {} };
}
