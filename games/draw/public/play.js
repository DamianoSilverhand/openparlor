import { h, avatar, timer, byId } from '/shared/ui.js';
import { prepare, redraw, drawStroke, COLORS, SIZES, BG } from '/shared/canvas.js';
import { meBar, hostButton, final } from '/sdk/play.js';

const game = (a, extra) => ({ t: 'g', a, ...extra });
const TIER = { easy: 'Easy', medium: 'Medium', hard: 'Hard' };
const TIER_NOTE = { easy: 'Standard points', medium: 'Bonus points', hard: 'Big bonus points' };

export function screen(s, ctx) {
  const g = s.game;
  const isDrawer = g.drawer === s.me;
  const key =
    g.phase === 'choose' ? `choose:${g.turn}:${isDrawer ? 1 : 0}`
    : g.phase === 'draw' ? `draw:${g.turn}:${isDrawer ? 'd' : `g${g.iGuessed ? 1 : 0}`}`
    : g.phase === 'result' ? `result:${g.turn}`
    : g.phase;
  const build = {
    choose: isDrawer ? chooseDrawer : waiting,
    draw: isDrawer ? drawer : guesser,
    result,
    final,
  }[g.phase];
  return { key, build: (s) => build(s, ctx) };
}

// ---- choosing a word ----------------------------------------------------------
function chooseDrawer(s, ctx) {
  const g = s.game;
  const t = timer();
  const el = h('div', { class: 'screen' },
    meBar(s),
    t.el,
    h('h1', { class: 'title' }, "You're drawing"),
    h('p', { class: 'lead' }, 'Pick a word. Harder words are worth more points.'),
    h('div', { class: 'words' },
      g.choices.map((c, i) =>
        h('button', { class: `word ${c.tier}`, onclick: () => ctx.send(game('pick', { i })) },
          h('span', { class: 'w' }, c.word),
          h('span', { class: 'n' }, `${TIER[c.tier]} · ${TIER_NOTE[c.tier]}`),
        ),
      ),
    ),
  );
  t.update(g);
  return { el, update: (s) => t.update(s.game) };
}

function waiting(s, ctx) {
  const g = s.game;
  const get = byId(s.players);
  const d = get(g.drawer);
  const t = timer();
  const el = h('div', { class: 'screen' },
    meBar(s),
    t.el,
    h('div', { class: 'who-wrote', style: { marginTop: '12px' } }, d && avatar(d), h('div', null, h('small', null, 'Up next to draw'), h('h2', null, d ? d.name : 'Someone'))),
    h('p', { class: 'lead' }, 'They are picking a word. Get ready to guess.'),
    hostButton(s, ctx, 'Skip ahead', false),
  );
  t.update(g);
  return { el, update: (s) => t.update(s.game) };
}

// ---- the drawer -----------------------------------------------------------------
function drawer(s, ctx) {
  const g = s.game;
  const t = timer();
  const canvas = h('canvas', { class: 'pad-canvas' });
  const c = prepare(canvas);
  let color = COLORS[0];
  let size = SIZES[1];
  let strokes = [];
  let cur = null;
  let pend = null;
  let nextId = 1;

  const flush = () => {
    if (pend && pend.pts.length) {
      ctx.send(game('seg', { id: pend.id, c: pend.c, s: pend.s, pts: pend.pts.splice(0, 60) }));
    }
  };
  const timerId = setInterval(() => {
    if (!canvas.isConnected && canvas._seen) return clearInterval(timerId);
    if (canvas.isConnected) canvas._seen = true;
    flush();
  }, 50);

  const pos = (e) => {
    const r = canvas.getBoundingClientRect();
    return [Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)), Math.min(1, Math.max(0, (e.clientY - r.top) / r.height))];
  };
  canvas.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    canvas.setPointerCapture(e.pointerId);
    flush();
    const p = pos(e);
    const w = color === BG ? size * 2 : size;
    cur = { id: nextId++, c: color, s: w, p: [p] };
    pend = { id: cur.id, c: cur.c, s: cur.s, pts: [p] };
    strokes.push(cur);
    drawStroke(c, cur, 0);
  });
  canvas.addEventListener('pointermove', (e) => {
    if (!cur) return;
    const events = e.getCoalescedEvents ? e.getCoalescedEvents() : [e];
    const from = cur.p.length;
    for (const ev of events.length ? events : [e]) {
      const p = pos(ev);
      const last = cur.p[cur.p.length - 1];
      if (Math.abs(p[0] - last[0]) + Math.abs(p[1] - last[1]) < 0.002) continue;
      cur.p.push(p);
      pend.pts.push(p);
    }
    if (cur.p.length > from) drawStroke(c, cur, from);
  });
  const end = () => {
    cur = null;
    flush();
  };
  canvas.addEventListener('pointerup', end);
  canvas.addEventListener('pointercancel', end);

  const swatches = h('div', { class: 'swatches' });
  const sizes = h('div', { class: 'sizes' });
  const paint = () => {
    swatches.replaceChildren(
      ...COLORS.map((col) => h('button', { class: 'sw' + (col === color ? ' on' : ''), style: { background: col }, 'aria-label': 'Colour', onclick: () => { color = col; paint(); } })),
      h('button', { class: 'sw eraser' + (color === BG ? ' on' : ''), 'aria-label': 'Eraser', onclick: () => { color = BG; paint(); } }, 'Erase'),
    );
    sizes.replaceChildren(
      ...SIZES.map((sz, i) => h('button', { class: 'sz' + (sz === size ? ' on' : ''), 'aria-label': `Brush ${i + 1}`, onclick: () => { size = sz; paint(); } }, h('i', { style: { width: `${6 + i * 6}px`, height: `${6 + i * 6}px` } }))),
    );
  };
  paint();

  const status = h('p', { class: 'status' });
  const el = h('div', { class: 'screen drawing' },
    h('div', { class: 'word-bar' },
      h('div', null, h('small', null, `Draw this (${TIER[g.tier]})`), h('h2', null, g.word)),
      h('div', { class: 'tmr' }, t.el),
    ),
    h('div', { class: 'card pad-wrap' }, canvas),
    swatches,
    h('div', { class: 'tools' },
      sizes,
      h('button', { class: 'btn plain small', onclick: () => { strokes.pop(); redraw(c, strokes); ctx.send(game('undo')); } }, 'Undo'),
      h('button', { class: 'btn plain small', onclick: () => { strokes = []; redraw(c, strokes); ctx.send(game('clear')); } }, 'Clear'),
    ),
    status,
    hostButton(s, ctx, 'End this drawing', false),
  );
  function update(s) {
    const g = s.game;
    t.update(g);
    status.textContent = `${g.guessed.length} of ${g.guessers.length} have guessed it`;
  }
  update(s);
  return { el, update };
}

// ---- a guesser --------------------------------------------------------------------
function guesser(s, ctx) {
  const g = s.game;
  const t = timer();
  const tiles = h('div', { class: 'ptiles' });
  const log = h('div', { class: 'glog' });
  const status = h('p', { class: 'status' });
  const input = h('input', { class: 'input', maxlength: 30, placeholder: 'Type your guess', autocomplete: 'off', autocapitalize: 'none', enterkeyhint: 'send', 'aria-label': 'Your guess' });
  const submit = () => {
    const text = input.value.trim();
    if (!text) return;
    ctx.send(game('guess', { text }));
    input.value = '';
    input.focus();
  };
  input.addEventListener('keydown', (e) => e.key === 'Enter' && submit());

  const el = h('div', { class: 'screen' },
    meBar(s),
    t.el,
    tiles,
    g.iGuessed
      ? h('div', { class: 'card pad big-result good' }, h('h2', null, 'You got it!'), h('p', null, `+${g.myPoints} points`))
      : [h('div', { class: 'guessrow' }, input, h('button', { class: 'btn', onclick: submit }, 'Guess')), log],
    status,
    hostButton(s, ctx, 'Skip ahead', false),
  );
  function update(s) {
    const g = s.game;
    t.update(g);
    tiles.replaceChildren(...g.hint.map((ch) => (ch === ' ' ? h('span', { class: 'pgap' }) : h('span', { class: 'ptile' + (ch === '_' ? '' : ' shown') }, ch === '_' ? '' : ch))));
    log.replaceChildren(...g.myGuesses.slice().reverse().map((x) => h('div', { class: 'gl' + (x.close ? ' close' : '') }, x.text, x.close && h('b', null, 'So close!'))));
    const left = g.guessers.length - g.guessed.length;
    status.textContent = g.iGuessed ? (left > 0 ? `Waiting for ${left} more` : 'Everyone got it!') : `${g.guessed.length} of ${g.guessers.length} have guessed it`;
  }
  t.update(g);
  update(s);
  return { el, update };
}

// ---- result -----------------------------------------------------------------------
function result(s, ctx) {
  const g = s.game;
  const get = byId(s.players);
  const d = get(g.drawer);
  const mine = g.gains.find((x) => x.id === s.me);
  const t = timer();
  const el = h('div', { class: 'screen' },
    meBar(s),
    h('p', { class: 'lead' }, 'The word was'),
    h('div', { class: 'card pad prompt' }, h('h2', { style: { textTransform: 'capitalize' } }, g.word)),
    h('p', { class: 'lead' }, `Drawn by ${d ? d.name : 'someone'}`),
    mine ? h('div', { class: 'card pad big-result good' }, h('h2', null, `+${mine.pts} points`)) : h('div', { class: 'card pad big-result' }, h('h2', null, 'No points this time')),
    t.el,
    hostButton(s, ctx, g.turn >= g.turnsTotal ? 'See the winners' : 'Next drawing', true),
  );
  t.update(g);
  return { el, update: (s) => t.update(s.game) };
}

// ---- sounds on your own phone ---------------------------------------------------------------
export const cues = {
  onChange(s, ps, changed, sfx) {
    const g = s.game;
    const pg = ps.game;
    if (g.phase === 'draw' && !pg.iGuessed && g.iGuessed) sfx('correct');
    else if (g.phase === 'draw' && g.myGuesses && pg.myGuesses && g.myGuesses.length > pg.myGuesses.length) sfx(g.myGuesses[g.myGuesses.length - 1].close ? 'good' : 'bad');
    if (changed && g.phase === 'result') {
      const mine = g.gains.find((x) => x.id === s.me);
      if (mine) sfx('coin');
      else if (g.drawer !== s.me) sfx('bad');
    }
  },
};
