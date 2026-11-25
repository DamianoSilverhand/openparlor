import { h } from '/shared/ui.js';
import { play } from '/shared/sound.js';
import { rng, shuffled, timeouts } from '/sdk/minigame.js';

const FALLBACK = {
  easy: [
    { w: 'because', c: 'Explains the reason why' },
    { w: 'friend', c: 'Someone you like to play with' },
    { w: 'school', c: 'A place where you learn' },
    { w: 'write', c: 'Put words on paper (silent W)' },
    { w: 'listen', c: 'Pay attention with your ears (silent T)' },
    { w: 'island', c: 'Land with water all around it (silent S)' },
  ],
  medium: [
    { w: 'believe', c: 'Think something is true' },
    { w: 'fraction', c: 'Part of a whole, like 3/4' },
    { w: 'gravity', c: 'Force that pulls things down' },
    { w: 'receipt', c: 'Paper showing you paid (silent P)' },
  ],
  hard: [
    { w: 'necessary', c: 'Needed; essential (1 C, 2 S)' },
    { w: 'conscience', c: 'Inner sense of right and wrong' },
    { w: 'parallel', c: 'Lines that never meet' },
    { w: 'privilege', c: 'Special right or advantage' },
  ],
};

let PACK = FALLBACK;
fetch('/api/content/scramble').then((r) => r.json()).then((d) => { if (d && d.easy) PACK = d; }).catch(() => {});

const entry = (item) => {
  const w = typeof item === 'string' ? item : item.w;
  const c = typeof item === 'string' ? '' : item.c || '';
  const ok = item.ok ? [w, ...item.ok] : [w];
  return { word: w.toLowerCase(), clue: c, ok: ok.map((x) => x.toLowerCase()) };
};

export function start(ctx) {
  const r = rng(ctx.seed);
  const level = PACK[ctx.level] ? ctx.level : 'hard';
  const list = shuffled(r, (PACK[level] && PACK[level].length ? PACK[level] : FALLBACK.easy).map(entry));

  const t = timeouts();
  let i = 0;
  let solved = 0;
  let streak = 0;
  let totalScore = 0;
  let locked = false;

  const info = h('div', { class: 'mg-info' });
  const clueEl = h('div', { class: 'wb-clue' });
  const slotsEl = h('div', { class: 'wb-slots' });
  const tilesEl = h('div', { class: 'scr-tiles' });
  let letters = []; // [{ ch, used }]
  let picks = []; // indices into letters, or null

  const score = () => Math.max(0, totalScore);

  const scrambleOf = (word) => {
    let arr = word.split('');
    for (let n = 0; n < 25 && arr.join('') === word; n++) arr = shuffled(r, arr);
    return arr;
  };

  function paint() {
    const cur = list[i];
    info.textContent = `Solved ${solved}${streak >= 2 ? `  ·  🔥 Streak ${streak}` : ''}  ·  ${totalScore} pts`;
    clueEl.textContent = cur.clue ? `Clue: ${cur.clue}` : '';
    slotsEl.replaceChildren(
      ...picks.map((li, slotIdx) =>
        h('button', {
          class: 'wb-slot' + (li != null ? ' filled' : ''),
          'data-quiet': '',
          onclick: () => removeSlot(slotIdx),
        }, li != null ? letters[li].ch : ''),
      ),
    );
    tilesEl.replaceChildren(
      ...letters.map((item, li) =>
        h('button', {
          class: 'scr-tile' + (item.used ? ' used' : ''),
          disabled: item.used,
          'data-quiet': '',
          onclick: () => pickTile(li),
        }, item.ch),
      ),
    );
  }

  function pickTile(li) {
    if (locked || letters[li].used) return;
    const empty = picks.indexOf(null);
    if (empty === -1) return;
    letters[li].used = true;
    picks[empty] = li;
    play('tap');
    paint();
    if (!picks.includes(null)) checkWord();
  }

  function removeSlot(slotIdx) {
    if (locked || picks[slotIdx] == null) return;
    letters[picks[slotIdx]].used = false;
    picks[slotIdx] = null;
    play('tap');
    paint();
  }

  function checkWord() {
    const cur = list[i];
    const guess = picks.map((li) => (li != null ? letters[li].ch : '')).join('');
    if (cur.ok.includes(guess)) {
      locked = true;
      solved++;
      streak++;
      totalScore += 100 + Math.min(4, streak - 1) * 20;
      play('correct');
      ctx.progress(score());
      slotsEl.classList.add('ok');
      t.set(() => {
        slotsEl.classList.remove('ok');
        locked = false;
        next();
      }, 320);
    } else {
      streak = 0;
      play('buzz');
      slotsEl.classList.add('shake');
      t.set(() => {
        slotsEl.classList.remove('shake');
        clearSlots();
      }, 420);
    }
  }

  function clearSlots() {
    letters.forEach((x) => (x.used = false));
    picks = picks.map(() => null);
    paint();
  }

  function hint() {
    if (locked) return;
    const cur = list[i];
    const targetIdx = picks.findIndex((li, idx) => li == null || letters[li].ch !== cur.word[idx]);
    if (targetIdx === -1) return;
    const wantCh = cur.word[targetIdx];
    if (picks[targetIdx] != null) {
      letters[picks[targetIdx]].used = false;
      picks[targetIdx] = null;
    }
    const avail = letters.findIndex((x) => !x.used && x.ch === wantCh);
    if (avail === -1) return;
    totalScore = Math.max(0, totalScore - 25);
    pickTile(avail);
    // Move picked tile into targetIdx if pickTile placed it earlier
    const placedAt = picks.indexOf(avail);
    if (placedAt !== -1 && placedAt !== targetIdx) {
      [picks[placedAt], picks[targetIdx]] = [picks[targetIdx], picks[placedAt]];
      paint();
      if (!picks.includes(null)) checkWord();
    }
  }

  function skip() {
    if (locked) return;
    streak = 0;
    next();
  }

  function next() {
    i++;
    if (i >= list.length) return ctx.finish(score(), { streak });
    show();
  }

  function show() {
    const w = list[i].word;
    letters = scrambleOf(w).map((ch) => ({ ch, used: false }));
    picks = Array(w.length).fill(null);
    paint();
  }

  const onKey = (e) => {
    if (locked) return;
    if (e.key === 'Backspace') {
      const last = picks.map((v, idx) => (v != null ? idx : -1)).filter((v) => v >= 0).pop();
      if (last != null) removeSlot(last);
      return;
    }
    const ch = e.key.toLowerCase();
    if (/^[a-z]$/.test(ch)) {
      const li = letters.findIndex((x) => !x.used && x.ch === ch);
      if (li !== -1) pickTile(li);
    }
  };
  window.addEventListener('keydown', onKey);

  ctx.root.replaceChildren(
    info,
    slotsEl,
    clueEl,
    tilesEl,
    h('div', { class: 'mg-row' },
      h('button', { class: 'btn plain', onclick: clearSlots }, 'Clear'),
      h('button', { class: 'btn plain', onclick: hint }, 'Hint (-25)'),
      h('button', { class: 'btn plain', onclick: skip }, 'Skip'),
    ),
  );
  show();
  return {
    score,
    destroy: () => {
      t.clearAll();
      window.removeEventListener('keydown', onKey);
    },
  };
}
