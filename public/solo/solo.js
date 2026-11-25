import { h, avatar, AVATARS, soundToggle } from '/shared/ui.js';
import { config, bands, bandLabel, tierOfBand } from '/shared/config.js';
import { t } from '/shared/i18n.js';
import { play as sfx } from '/shared/sound.js';
import * as memory from '/play/mg/memory.js';
import * as scramble from '/play/mg/scramble.js';
import * as reaction from '/play/mg/reaction.js';
import * as pattern from '/play/mg/pattern.js';
import * as clash from '/play/mg/clash.js';
import * as math from '/play/mg/math.js';
import * as logic from '/play/mg/logic.js';
import * as literacy from '/play/mg/literacy.js';

const GAMES = [
  { id: 'scramble', name: 'Word Builder', desc: 'Tap tiles to spell words and learn clues.', duration: 60, mod: scramble },
  { id: 'literacy', name: 'Word Match', desc: 'Pick the right spelling, meaning, or missing word.', duration: 50, mod: literacy },
  { id: 'math', name: 'Number Dash', desc: 'Solve math sums calibrated to your grade.', duration: 40, mod: math },
  { id: 'logic', name: 'Logic Chain', desc: 'Patterns, odd-one-out, and quick deductions.', duration: 50, mod: logic },
  { id: 'memory', name: 'Memory Match', desc: 'Flip cards and match all pairs.', duration: 60, mod: memory },
  { id: 'pattern', name: 'Copy Cat', desc: 'Watch the lights and repeat the sequence.', duration: 90, mod: pattern },
  { id: 'clash', name: 'Colour Clash', desc: 'Tap the ink colour, not the word.', duration: 30, mod: clash },
  { id: 'reaction', name: 'Quick Tap', desc: 'Wait for green, then tap fast.', duration: 50, mod: reaction },
];

const app = document.getElementById('app');
let profiles = [];
let profile = null;
let activeTimer = null;
let activeApi = null;

const levelLabel = (l) => (bands.length > 1 ? bandLabel(l) : '');

function cleanup() {
  clearInterval(activeTimer);
  activeTimer = null;
  if (activeApi) {
    activeApi.destroy();
    activeApi = null;
  }
}

async function loadProfiles() {
  try {
    const r = await fetch('/api/profiles');
    const d = await r.json();
    profiles = d.profiles || [];
  } catch {
    profiles = [];
  }
}

function profileScreen() {
  cleanup();
  let pick = Math.floor(Math.random() * AVATARS.length);
  let lvl = bands[0].id;
  const name = h('input', { class: 'input', maxlength: 14, placeholder: 'Your name' });
  const grid = h('div', { class: 'avatars' });
  const lvlSeg = h('div', { class: 'seg' });
  const drawLvl = () =>
    lvlSeg.replaceChildren(
      ...bands.map((b) => [b.id, b.label]).map(([v, label]) =>
        h('button', { class: v === lvl ? 'on' : '', onclick: () => { lvl = v; drawLvl(); } }, label),
      ),
    );
  const drawAv = () =>
    grid.replaceChildren(
      ...AVATARS.map((_, i) => h('button', { class: i === pick ? 'on' : '', onclick: () => { pick = i; drawAv(); } }, avatar({ avatar: i }))),
    );
  drawLvl();
  drawAv();

  const create = async () => {
    const n = name.value.trim();
    if (!n) return name.focus();
    const r = await fetch('/api/profiles', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: n, avatar: pick, level: lvl }),
    });
    const d = await r.json();
    if (d.profile) {
      profile = d.profile;
      await loadProfiles();
      hubScreen();
    }
  };

  app.replaceChildren(
    h('div', { class: 'screen' },
      h('div', { class: 'me' }, h('a', { class: 'link', href: '/' }, '← Home'), soundToggle()),
      h('h1', { class: 'title' }, 'Solo Practice'),
      h('p', { class: 'lead' }, 'Pick your profile to save your personal bests and daily streaks.'),
      profiles.length > 0 && h('div', { class: 'prof-grid' },
        profiles.map((p) =>
          h('button', { class: 'prof-btn', onclick: () => { profile = p; hubScreen(); } },
            avatar(p),
            h('span', { class: 'prof-meta' }, h('b', null, p.name), h('small', null, levelLabel(p.level))),
          ),
        ),
      ),
      h('details', { class: 'card pad', open: profiles.length === 0 },
        h('summary', { style: { fontFamily: 'var(--display)', fontWeight: 800, cursor: 'pointer' } }, t('solo.addPerson')),
        h('div', { class: 'field', style: { marginTop: '12px' } }, h('label', null, 'Name'), name),
        bands.length > 1 && h('div', { class: 'field' }, h('label', null, t('level.label')), lvlSeg),
        h('div', { class: 'field' }, h('label', null, 'Animal'), grid),
        h('button', { class: 'btn block', style: { marginTop: '10px' }, onclick: create }, 'Save & Start'),
      ),
    ),
  );
}

function hubScreen() {
  cleanup();
  const bests = (profile.stats && profile.stats.bests) || {};
  const streaks = (profile.stats && profile.stats.streaks) || {};
  app.replaceChildren(
    h('div', { class: 'screen' },
      h('div', { class: 'me' },
        h('span', { class: 'who' }, avatar(profile), profile.name, h('small', { style: { color: 'var(--soft)', fontWeight: 700 } }, levelLabel(profile.level))),
        h('span', { class: 'me-r' }, h('button', { class: 'link', onclick: profileScreen }, 'Switch'), soundToggle()),
      ),
      h('h1', { class: 'title' }, 'Pick a game'),
      h('div', { class: 'words' },
        GAMES.map((g) => {
          const b = bests[g.id] || 0;
          const st = streaks[g.id] ? streaks[g.id].current : 0;
          return h('button', { class: 'word', onclick: () => playGame(g) },
            h('span', { class: 'w', style: { fontSize: '1.35rem', textTransform: 'none' } }, g.name),
            h('span', { class: 'n' }, `${g.desc}${b ? ` · Best: ${b}` : ''}${st ? ` · 🔥 ${st}d` : ''}`),
          );
        }),
      ),
    ),
  );
}

function playGame(g) {
  cleanup();
  const root = h('div', { class: 'mg-root' });
  const clock = h('span', { class: 'mg-clock' }, `${g.duration}s`);
  const durationMs = g.duration * 1000;
  const endAt = Date.now() + durationMs;
  let finished = false;

  const finish = async (score, extra = {}) => {
    if (finished) return;
    finished = true;
    cleanup();
    const finalScore = Math.round(score || 0);
    sfx('coin');
    let res = {};
    try {
      const r = await fetch('/api/profiles/record', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: profile.id, gameId: g.id, score: finalScore, streak: extra.streak || 0 }),
      });
      res = await r.json();
      if (res.profile) profile = res.profile;
    } catch {}

    app.replaceChildren(
      h('div', { class: 'screen' },
        h('div', { class: 'me' }, h('span', { class: 'who' }, avatar(profile), profile.name), soundToggle()),
        res.isNewBest
          ? h('div', { class: 'card pad big-result good' }, h('h2', null, 'New Personal Best!'), h('p', null, `Score: ${finalScore} (previous: ${res.prevBest || 0})`))
          : h('div', { class: 'card pad big-result' }, h('h2', null, `Score: ${finalScore}`), h('p', null, `Personal best: ${(profile.stats && profile.stats.bests && profile.stats.bests[g.id]) || finalScore}`)),
        h('button', { class: 'btn block push', onclick: () => playGame(g) }, 'Play again'),
        h('button', { class: 'btn plain block', onclick: hubScreen }, 'Pick another game'),
      ),
    );
  };

  app.replaceChildren(
    h('div', { class: 'screen mg' },
      h('div', { class: 'mg-head' }, h('b', null, g.name), clock, h('button', { class: 'link', style: { padding: '0' }, onclick: hubScreen }, 'Quit')),
      root,
    ),
  );

  const seed = Math.floor(Math.random() * 2 ** 31);
  activeApi = g.mod.start({
    root,
    seed,
    level: tierOfBand(profile.level),
    durationMs,
    progress: () => {},
    finish,
  });

  activeTimer = setInterval(() => {
    const left = Math.max(0, Math.ceil((endAt - Date.now()) / 1000));
    clock.textContent = `${left}s`;
    clock.classList.toggle('low', left <= 5);
    if (Date.now() >= endAt && activeApi) finish(activeApi.score());
  }, 200);
}

if (config.profiles.enabled) loadProfiles().then(profileScreen);
else app.replaceChildren(h('div', { class: 'screen' }, h('h1', { class: 'title' }, 'Solo Practice'), h('p', { class: 'lead' }, 'Solo practice saves scores to a profile, and profiles are turned off on this server.'), h('a', { class: 'link', href: '/' }, '← Home')));
