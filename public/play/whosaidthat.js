import { h, avatar, timer, byId, soundToggle } from '/shared/ui.js';

export function screen(s, ctx) {
  const g = s.game;
  const key =
    g.phase === 'answer' ? `answer:${g.round}:${g.iAnswered ? 1 : 0}`
    : g.phase === 'vote' ? `vote:${g.round}:${g.itemId}:${g.isAuthor ? 1 : 0}`
    : g.phase === 'reveal' ? `reveal:${g.round}:${g.itemId}`
    : g.phase;
  const b = { answer, vote, reveal, scores, final }[g.phase];
  return { key, build: (s) => b(s, ctx) };
}

const game = (a, extra) => ({ t: 'g', a, ...extra });

export function meBar(s) {
  const me = byId(s.players)(s.me);
  return h('div', { class: 'me' },
    h('span', { class: 'who' }, me && avatar(me), me && me.name),
    h('span', { class: 'me-r' }, h('span', { class: 'score' }, h('small', null, 'Score'), me ? me.score : 0), soundToggle()),
  );
}

export function hostButton(s, ctx, label, primary) {
  if (s.me !== s.hostId) return null;
  return primary
    ? h('button', { class: 'btn block push', onclick: () => ctx.send(game('next')) }, label)
    : h('button', { class: 'link', onclick: () => ctx.send(game('next')) }, label);
}

// Lets the host remove an answer from the round if it is awkward or unsuitable.
function hideLink(s, ctx) {
  if (s.me !== s.hostId) return null;
  return h('button', { class: 'link', onclick: () => ctx.send(game('drop')) }, 'Hide this answer (host)');
}

function laughButton(g, ctx) {
  if (g.isAuthor) return null;
  const btn = h('button', { class: 'btn plain small laugh' });
  const set = (n) => {
    btn.textContent = n ? `😂 That's funny  ×${n}` : "😂 That's funny";
    btn.disabled = n >= 3;
  };
  btn.onclick = () => {
    ctx.send(game('laugh'));
    set(Math.min(3, (btn._n || 0) + 1));
    btn._n = Math.min(3, (btn._n || 0) + 1);
  };
  btn._n = g.myLaughs;
  set(g.myLaughs);
  return { btn, sync: (g) => { btn._n = g.myLaughs; set(g.myLaughs); } };
}

// ---- answer --------------------------------------------------------------------
function answer(s, ctx) {
  const g = s.game;
  const t = timer();
  if (!g.iAnswered) {
    const area = h('textarea', { class: 'area', maxlength: 140, placeholder: 'Type your answer. Funny beats fancy.', 'aria-label': 'Your answer' });
    const count = h('div', { class: 'count' }, '0 / 140');
    area.addEventListener('input', () => (count.textContent = `${area.value.length} / 140`));
    const lock = () => {
      const text = area.value.trim();
      if (!text) return area.focus();
      ctx.send(game('answer', { text }));
    };
    const el = h('div', { class: 'screen' },
      meBar(s),
      t.el,
      h('div', { class: 'card prompt' }, h('h2', null, g.prompt)),
      h('div', null, area, count),
      h('button', { class: 'btn block push', onclick: lock }, 'Lock it in'),
      h('button', { class: 'btn plain block', onclick: () => ctx.send(game('pass')) }, 'Pass on this one'),
      hostButton(s, ctx, 'Skip ahead', false),
    );
    t.update(g);
    return { el, update: (s) => t.update(s.game) };
  }
  const status = h('p', { class: 'status' });
  const el = h('div', { class: 'screen' },
    meBar(s),
    t.el,
    h('div', { class: 'card prompt' }, h('h2', null, g.prompt)),
    h('div', { class: 'card pad' }, g.myText ? [h('p', { class: 'lead' }, 'Your answer'), h('h2', { style: { fontSize: '1.3rem', marginTop: '4px' } }, g.myText)] : h('p', { class: 'lead' }, 'You passed on this one.')),
    status,
    hostButton(s, ctx, 'Skip ahead', false),
  );
  function update(s) {
    const g = s.game;
    t.update(g);
    const conn = s.players.filter((p) => p.connected).length;
    const done = s.players.filter((p) => p.connected && g.answered.includes(p.id)).length;
    status.textContent = done >= conn ? 'Everyone is in!' : `Locked in. ${done} of ${conn} answered.`;
  }
  update(s);
  return { el, update };
}

// ---- vote ----------------------------------------------------------------------
function vote(s, ctx) {
  const g = s.game;
  const get = byId(s.players);
  const t = timer();
  const quote = h('div', { class: 'card quote' }, h('h2', null, `“${g.text}”`));
  const status = h('p', { class: 'status' });

  if (g.isAuthor) {
    const el = h('div', { class: 'screen' },
      meBar(s),
      t.el,
      quote,
      h('div', { class: 'card pad big-result fool' }, h('h2', null, "That one's yours"), h('p', null, 'Keep a straight face.')),
      status,
      hostButton(s, ctx, 'Skip ahead', false),
      hideLink(s, ctx),
    );
    const update = (s) => {
      t.update(s.game);
      status.textContent = `${s.game.voted.length} guesses so far`;
    };
    update(s);
    return { el, update };
  }

  let mine = g.myVote;
  const buttons = new Map();
  const opts = h('div', { class: 'options' },
    g.options.map((id) => {
      const p = get(id);
      const b = h('button', { class: 'opt', onclick: () => { mine = id; paint(); ctx.send(game('vote', { guess: id })); } }, avatar(p), h('span', null, p ? p.name : '?'));
      buttons.set(id, b);
      return b;
    }),
  );
  const paint = () => buttons.forEach((b, id) => b.classList.toggle('on', id === mine));
  paint();
  const laugh = laughButton(g, ctx);
  const el = h('div', { class: 'screen' },
    meBar(s),
    t.el,
    quote,
    h('p', { class: 'lead', style: { fontWeight: 800 } }, 'Who wrote it?'),
    opts,
    laugh && laugh.btn,
    status,
    hostButton(s, ctx, 'Skip ahead', false),
    hideLink(s, ctx),
  );
  function update(s) {
    const g = s.game;
    t.update(g);
    if (laugh) laugh.sync(g);
    status.textContent = mine ? 'Vote locked. Tap another name to change it.' : '';
  }
  t.update(g);
  update(s);
  return { el, update };
}

// ---- reveal --------------------------------------------------------------------
function reveal(s, ctx) {
  const g = s.game;
  const get = byId(s.players);
  const author = get(g.author);
  let result;
  if (g.isAuthor) {
    result = g.fooled.length
      ? h('div', { class: 'card pad big-result fool' }, h('h2', null, `You fooled ${g.fooled.length}!`), h('p', null, `+${g.myGain} points`))
      : h('div', { class: 'card pad big-result' }, h('h2', null, 'Busted'), h('p', null, 'Everyone knew it was you.'));
  } else if (g.correct.includes(s.me)) {
    result = h('div', { class: 'card pad big-result good' }, h('h2', null, 'You got it!'), h('p', null, `+${g.pointsCorrect} points`));
  } else if (g.myVote) {
    result = h('div', { class: 'card pad big-result' }, h('h2', null, 'Not this time'), h('p', null, 'You guessed ' + (get(g.myVote) ? get(g.myVote).name : 'someone else')));
  } else {
    result = h('div', { class: 'card pad big-result' }, h('h2', null, 'You sat that one out'), h('p', null, 'No vote, no points.'));
  }
  const t = timer();
  const laugh = laughButton(g, ctx);
  const el = h('div', { class: 'screen' },
    meBar(s),
    t.el,
    h('div', { class: 'card quote' }, h('h2', null, `“${g.text}”`)),
    h('div', { class: 'who-wrote' }, author && avatar(author), h('div', null, h('small', null, 'Written by'), h('h2', null, author ? author.name : 'Someone'))),
    result,
    laugh && laugh.btn,
    hostButton(s, ctx, 'Next', true),
  );
  function update(s) {
    t.update(s.game);
    if (laugh) laugh.sync(s.game);
  }
  update(s);
  return { el, update };
}

// ---- scores / final --------------------------------------------------------------
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

function scores(s, ctx) {
  const g = s.game;
  const t = timer();
  const last = g.round >= g.totalRounds;
  const el = h('div', { class: 'screen' },
    meBar(s),
    h('h1', { class: 'title' }, `After round ${g.round}`),
    g.note && h('p', { class: 'lead' }, g.note),
    list(s),
    t.el,
    hostButton(s, ctx, last ? 'See the winners' : 'Next round', true),
  );
  t.update(g);
  return { el, update: (s) => t.update(s.game) };
}

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
