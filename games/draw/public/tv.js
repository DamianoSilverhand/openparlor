import { h, avatar, tag, timer, byId } from '/shared/ui.js';
import { prepare, redraw, drawStroke } from '/shared/canvas.js';
import { finalScreen } from '/sdk/tv.js';

// The live drawing lives outside the screen so it survives re-renders and TV reconnects.
let strokes = [];
let ctx = null;

export function onEvent(m) {
  if (m.ev === 'full') {
    strokes = m.strokes;
    if (ctx) redraw(ctx, strokes);
  } else if (m.ev === 'seg') {
    let st = strokes[strokes.length - 1];
    if (!st || st.id !== m.id) {
      st = { id: m.id, c: m.c, s: m.s, p: [] };
      strokes.push(st);
    }
    const from = st.p.length;
    st.p.push(...m.pts);
    if (ctx) drawStroke(ctx, st, from);
  }
}

export function screen(s) {
  const g = s.game;
  const key = g.phase === 'choose' ? `choose:${g.turn}` : g.phase === 'final' ? 'final' : `play:${g.turn}`;
  const builders = { choose, draw: play, result: play, final };
  return { key, build: builders[g.phase] };
}

const pill = (g) => h('span', { class: 'pill' }, `Drawing ${g.turn} of ${g.turnsTotal}`);

// ---- choose ----------------------------------------------------------------------
function choose(s) {
  const g = s.game;
  const get = byId(s.players);
  const t = timer();
  const el = h('div', { class: 'stage' },
    h('div', { class: 'bar' }, pill(g), h('span', { class: 'code' }, 'DRAW & GUESS')),
    h('div', { class: 'center-msg' },
      h('div', { style: { display: 'flex', justifyContent: 'center', marginBottom: '1.4rem' } }, avatar(get(g.drawer), '8rem')),
      h('h1', null, `${get(g.drawer).name} is picking a word`),
      h('p', null, 'Get ready to guess on your phone.'),
    ),
    h('div', { class: 'big-timer' }, t.el),
  );
  t.update(g);
  return { el, update: (s) => t.update(s.game) };
}

// ---- draw + result (same canvas, different side panel) --------------------------------------
function play(s) {
  const canvas = h('canvas', { class: 'draw-canvas' });
  ctx = prepare(canvas);
  redraw(ctx, strokes);
  const t = timer();
  const side = h('div', { class: 'side' });
  const head = h('div', { class: 'bar' });
  const el = h('div', { class: 'stage' },
    head,
    h('div', { class: 'draw-layout' }, h('div', { class: 'card canvas-card' }, canvas), side),
  );

  function update(s) {
    const g = s.game;
    const get = byId(s.players);
    const drawer = get(g.drawer);
    head.replaceChildren(pill(g), h('span', { class: 'code' }, 'DRAW & GUESS'));
    t.update(g);

    if (g.phase === 'draw') {
      const tiles = h('div', { class: 'tiles' },
        g.hint.map((c) => (c === ' ' ? h('span', { class: 'gap' }) : h('span', { class: 'tile' + (c === '_' ? '' : ' shown') }, c === '_' ? '' : c))),
      );
      const chips = g.guessers
        .map((id) => get(id))
        .filter(Boolean)
        .map((p) => h('span', { class: 'chip ' + (g.guessed.includes(p.id) ? 'done' : 'wait') }, avatar(p), p.name, g.guessed.includes(p.id) && h('span', { class: 'mark' }, '✓')));
      const feed = g.feed
        .slice()
        .reverse()
        .map((f) => {
          const p = get(f.pid);
          if (!p) return null;
          return f.kind === 'correct'
            ? h('div', { class: 'line ok' }, avatar(p), h('b', null, p.name), ' got it!')
            : h('div', { class: 'line' }, avatar(p), h('b', null, p.name), h('span', { class: 'say' }, f.text));
        });
      side.replaceChildren(
        h('div', { class: 'who' }, avatar(drawer), h('div', null, h('small', null, 'Drawing now'), h('h2', null, drawer.name))),
        tiles,
        h('p', { class: 'sub' }, `${g.hint.filter((c) => c !== ' ').length} letters. Type your guess on your phone.`),
        t.el,
        h('div', { class: 'chips' }, chips),
        h('div', { class: 'feed' }, feed),
      );
    } else {
      const guessers = g.order.map((id) => get(id)).filter(Boolean);
      side.replaceChildren(
        h('p', { class: 'sub', style: { margin: 0 } }, 'The word was'),
        h('h2', { class: 'the-word' }, g.word),
        h('p', { class: 'sub' }, `Drawn by ${drawer.name}`),
        h('div', { class: 'card gains' },
          g.gains.length
            ? g.gains.map((x) => h('div', { class: 'g' }, tag(get(x.id)), h('b', null, `+${x.pts}`)))
            : h('p', { class: 'empty' }, 'Nobody got it this time.'),
        ),
        t.el,
      );
    }
  }
  update(s);
  return { el, update };
}

// ---- final: podium, then the gallery, swapping every few seconds ---------------------------
function final(s) {
  const g = s.game;
  const get = byId(s.players);
  const a = g.awards;
  const base = finalScreen(s, [
    a.artist && { id: a.artist.id, title: 'Best artist', text: `${a.artist.value} points from their drawings` },
    a.eye && { id: a.eye.id, title: 'Sharpest eye', text: `${a.eye.value} correct ${a.eye.value === 1 ? 'guess' : 'guesses'}` },
  ]);
  const shots = (g.gallery || []).map((it) => {
    const c = h('canvas', { class: 'thumb' });
    redraw(prepare(c), it.strokes);
    const save = h('a', { class: 'save-png', href: c.toDataURL('image/png'), download: `${it.word.replace(/\s+/g, '-')}.png` }, 'Save');
    return h('div', { class: 'card shot' }, c, h('div', { class: 'cap', style: { display: 'flex', justifyContent: 'space-between', alignItems: 'center' } }, h('span', null, h('b', null, it.word), ` by ${get(it.drawer) ? get(it.drawer).name : '?'}`), save));
  });
  const gallery = h('div', { class: 'stage hidden' },
    h('div', { class: 'bar' }, h('span', { class: 'pill' }, 'The gallery'), h('span', { class: 'code' }, 'DRAW & GUESS')),
    h('div', { class: 'gallery' }, shots),
  );
  const el = h('div', { class: 'stage' }, base, gallery);
  let showGallery = false;
  let seen = false;
  const id = setInterval(() => {
    if (el.isConnected) seen = true;
    else if (seen) return clearInterval(id);
    if (!shots.length) return;
    showGallery = !showGallery;
    base.classList.toggle('hidden', showGallery);
    gallery.classList.toggle('hidden', !showGallery);
  }, 12000);
  return { el, update() {} };
}

// ---- sounds ---------------------------------------------------------------------------------
const len = (a) => (Array.isArray(a) ? a.length : 0);
export const cues = {
  timedPhases: ['choose', 'draw'],
  onPhase: (g, sfx) => sfx(g.phase === 'draw' ? 'go' : g.phase === 'result' ? (len(g.guessed) ? 'coin' : 'wrong') : 'whoosh'),
  onChange: (g, pg, sfx) => { if (len(g.guessed) > len(pg.guessed)) sfx('correct'); },
};
