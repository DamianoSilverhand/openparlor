import { h } from '/shared/ui.js';
import { play } from '/shared/sound.js';
import { rng, shuffled, timeouts } from './util.js';

// Words picked so that none has a common anagram.
const WORDS = {
  kid: ['apple', 'tiger', 'happy', 'house', 'water', 'mouse', 'train', 'chair', 'beach', 'cloud', 'bunny', 'panda', 'robot', 'candy', 'pizza', 'music', 'river', 'sunny', 'zebra', 'cake', 'frog', 'duck', 'moon', 'tree'],
  teen: ['castle', 'rocket', 'planet', 'jungle', 'window', 'pencil', 'dragon', 'bridge', 'button', 'summer', 'winter', 'guitar', 'pirate', 'island', 'rabbit', 'monkey', 'yellow', 'orange', 'purple', 'basket', 'ticket', 'pocket', 'turtle', 'puzzle'],
  grownup: ['chocolate', 'adventure', 'mountain', 'elephant', 'umbrella', 'calendar', 'dinosaur', 'sandwich', 'birthday', 'hospital', 'football', 'treasure', 'notebook', 'language', 'telescope', 'kangaroo', 'butterfly', 'rainbow', 'strawberry', 'pineapple', 'volcano', 'dolphin', 'lantern', 'blanket'],
};

// Zambian words for the optional local setting. The first spelling is scrambled; any listed spelling is accepted.
const LOCAL = {
  kid: [['hippo'], ['maize'], ['drum'], ['fish'], ['kafue'], ['hut'], ['cow'], ['okra'], ['river'], ['baby'], ['taxi'], ['sugar'], ['bike'], ['kiosk'], ['bush'], ['tent']],
  teen: [['zambia'], ['lusaka'], ['kwacha'], ['baobab'], ['safari'], ['kitwe'], ['copper'], ['impala'], ['nshima', ['nsima', 'sima']], ['village'], ['market'], ['cassava'], ['kasama'], ['mongu'], ['sunset'], ['charcoal']],
  grownup: [['livingstone'], ['copperbelt'], ['chipolopolo'], ['crocodile'], ['giraffe'], ['zambezi'], ['chitenge', ['chitenje']], ['kapenta'], ['luangwa'], ['chipata'], ['solwezi'], ['minibus'], ['wildlife'], ['mosquito'], ['waterfall'], ['kafue']],
};
const entry = (w) => (Array.isArray(w) ? { word: w[0], ok: [w[0], ...(w[1] || [])] } : { word: w, ok: [w] });

export function start(ctx) {
  const r = rng(ctx.seed);
  const level = WORDS[ctx.level] ? ctx.level : 'grownup';
  const general = WORDS[level].map(entry);
  const local = LOCAL[level].map(entry);
  // "Only Zambian" uses just the local words; "Mixed in" adds them to the general ones.
  const list = ctx.local === 'only' ? shuffled(r, local) : ctx.local === 'mixed' ? shuffled(r, [...general, ...local]) : shuffled(r, general);
  const t = timeouts();
  let i = 0;
  let solved = 0;

  const scrambleOf = (word) => {
    let s = word;
    for (let n = 0; n < 30 && s === word; n++) s = shuffled(r, word.split('')).join('');
    return s;
  };
  const tiles = h('div', { class: 'scr-tiles' });
  const input = h('input', { class: 'input scr-input', placeholder: 'Type the word', autocomplete: 'off', autocapitalize: 'none', spellcheck: 'false', 'aria-label': 'Your answer' });
  input.setAttribute('autocorrect', 'off');
  const count = h('div', { class: 'mg-info' });
  const go = () => {
    if (list[i].ok.includes(input.value.trim().toLowerCase())) {
      solved++;
      play('correct');
      ctx.progress(solved * 100);
      next();
    } else {
      play('buzz');
      input.classList.add('shake');
      t.set(() => input.classList.remove('shake'), 400);
      input.select();
    }
  };
  input.addEventListener('keydown', (e) => e.key === 'Enter' && go());
  const skip = () => next();
  function next() {
    i++;
    if (i >= list.length) return ctx.finish(solved * 100);
    show();
  }
  function show() {
    tiles.replaceChildren(...scrambleOf(list[i].word).split('').map((c) => h('span', { class: 'scr-tile' }, c)));
    input.value = '';
    count.textContent = `Solved ${solved}`;
    input.focus();
  }
  ctx.root.replaceChildren(
    count,
    tiles,
    input,
    h('div', { class: 'mg-row' }, h('button', { class: 'btn', onclick: go }, 'Go'), h('button', { class: 'btn plain', onclick: skip }, 'Skip')),
  );
  show();
  return { score: () => solved * 100, destroy: () => t.clearAll() };
}
