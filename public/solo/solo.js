import { h, avatar, AVATARS, soundToggle } from '/shared/ui.js';
import '/shared/pwa.js';
import { cachedProfiles, cacheProfiles, applyLocally, enqueue, flush, pending, startSync, onSynced } from '/shared/offline.js';
import { config, bands, bandLabel, tierOfBand } from '/shared/config.js';
import { t } from '/shared/i18n.js';
import { play as sfx } from '/shared/sound.js';

// The mini-games come from the server (the built-in ones plus any plugins).
let GAMES = [];

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

// With no connection the profiles saved on this device are used, so Solo Practice still works (a new profile needs the
// server, because it is the server that makes its id).
let offline = false;
async function loadProfiles() {
  try {
    const r = await fetch('/api/profiles');
    const d = await r.json();
    profiles = d.profiles || [];
    cacheProfiles(profiles);
    offline = false;
  } catch {
    profiles = cachedProfiles();
    offline = true;
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
    let d = {};
    try {
      const r = await fetch('/api/profiles', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: n, avatar: pick, level: lvl }),
      });
      d = await r.json();
    } catch {
      return alert(t('solo.needsConnection'));
    }
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
      offline && h('p', { class: 'lead' }, t('solo.offlineNote')),
      pending() > 0 && h('p', { class: 'lead' }, t('solo.pendingNote', { count: pending() })),
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
      h('label', { class: 'link import-link' }, t('solo.import'), h('input', { type: 'file', accept: 'application/json,.json', hidden: true, onchange: (e) => importProfile(e.target) })),
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
      h('div', { class: 'data-links' },
        h('a', { class: 'link', href: `/api/profiles/${profile.id}/export`, download: `openparlor-${profile.name}.json` }, t('solo.download')),
        h('button', { class: 'link', onclick: deleteProfile }, t('solo.delete')),
      ),
    ),
  );
}

async function deleteProfile() {
  if (!confirm(t('solo.deleteConfirm', { name: profile.name }))) return;
  try {
    await fetch(`/api/profiles/${profile.id}`, { method: 'DELETE' });
  } catch {}
  profile = null;
  await loadProfiles();
  profileScreen();
}

// Reads an exported profile file and adds it (or merges its scores into the profile it came from).
function importProfile(input) {
  const file = input.files && input.files[0];
  if (!file) return;
  file.text().then((text) => fetch('/api/profiles/import', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: text })).then((r) => r.json()).then(async (d) => {
    if (d.profile) {
      profile = d.profile;
      await loadProfiles();
      hubScreen();
    } else {
      alert(d.error || 'That file could not be imported.');
    }
  }).catch(() => alert('That file could not be imported.'));
}

async function playGame(g) {
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
    // Local first: apply the result to the saved profile and queue it, then try to send. If the network is down the
    // result stays in the queue and is sent later, with the same run id, so it is counted exactly once.
    const local = applyLocally(profile, g.id, finalScore, extra.streak || 0);
    profile = local.profile;
    const cached = cachedProfiles().map((p) => (p.id === profile.id ? profile : p));
    cacheProfiles(cached);
    enqueue({ profileId: profile.id, gameId: g.id, score: finalScore, streak: extra.streak || 0 });
    const res = { isNewBest: local.isNewBest, prevBest: local.prevBest };
    const left = await flush();
    const savedOffline = left > 0;

    app.replaceChildren(
      h('div', { class: 'screen' },
        h('div', { class: 'me' }, h('span', { class: 'who' }, avatar(profile), profile.name), soundToggle()),
        res.isNewBest
          ? h('div', { class: 'card pad big-result good' }, h('h2', null, 'New Personal Best!'), h('p', null, `Score: ${finalScore} (previous: ${res.prevBest || 0})`))
          : h('div', { class: 'card pad big-result' }, h('h2', null, `Score: ${finalScore}`), h('p', null, `Personal best: ${(profile.stats && profile.stats.bests && profile.stats.bests[g.id]) || finalScore}`)),
        savedOffline && h('p', { class: 'lead' }, t('solo.savedOffline')),
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
  const mod = await import(g.url).catch(() => null);
  if (!mod) return hubScreen();
  activeApi = mod.start({
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

async function start() {
  startSync();
  onSynced(async () => {
    await loadProfiles(); // the server's copy now includes the results that were waiting
    if (profile) profile = profiles.find((p) => p.id === profile.id) || profile;
  });
  try {
    GAMES = ((await (await fetch('/api/minigames')).json()).minigames || []).map((m) => ({ id: m.id, name: m.name, desc: m.desc, duration: m.duration, url: m.url }));
  } catch {}
  await loadProfiles();
  profileScreen();
}
if (config.profiles.enabled) start();
else app.replaceChildren(h('div', { class: 'screen' }, h('h1', { class: 'title' }, 'Solo Practice'), h('p', { class: 'lead' }, 'Solo practice saves scores to a profile, and profiles are turned off on this server.'), h('a', { class: 'link', href: '/' }, '← Home')));
