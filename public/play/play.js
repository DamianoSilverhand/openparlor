import { h, avatar, AVATARS, byId, setServerNow, soundToggle, timer } from '/shared/ui.js';
import '/shared/pwa.js';
import '/shared/store.js';
import { play } from '/shared/sound.js';
import { config, bands, bandId, bandLabel } from '/shared/config.js';
import { t } from '/shared/i18n.js';
import { connect } from '/shared/net.js';
import { keepAwake } from '/shared/wake.js';

// Games are loaded on demand from the paths the server lists in s.games (see docs/GAME-SDK.md).
const loaded = new Map();
const loading = new Map();

function ensureGame(s) {
  const id = s.gameId;
  const meta = (s.games || []).find((g) => g.id === id);
  if (!meta || loaded.has(id) || loading.has(id)) return loaded.get(id) || null;
  for (const href of meta.client.styles || []) {
    if (!document.querySelector(`link[href="${href}"]`)) document.head.append(Object.assign(document.createElement('link'), { rel: 'stylesheet', href }));
  }
  loading.set(id, import(meta.client.play).then((mod) => {
    loaded.set(id, mod);
    if (last) render(last);
  }).catch((err) => {
    console.error(`Could not load the screens for "${id}"`, err);
    loading.set(id, null);
  }));
  return null;
}
const app = document.getElementById('app');
const room = (new URLSearchParams(location.search).get('room') || '').toUpperCase().slice(0, 4);

const store = {
  get(k) { try { return JSON.parse(localStorage.getItem(k)); } catch { return null; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} },
  del(k) { try { localStorage.removeItem(k); } catch {} },
};
const saveKey = `op:${room}`;

let current = { key: null, api: null };
let last = null;
let joined = false;
let net = null;

function mount(key, build, s) {
  if (current.key === key) return current.api.update && current.api.update(s);
  if (current.api && current.api.destroy) current.api.destroy();
  current = { key, api: build(s) };
  app.replaceChildren(current.api.el);
  window.scrollTo(0, 0);
}
const send = (o) => net && net.send(o);

// ---- entry: no room code yet ---------------------------------------------------
function entryScreen(message) {
  const input = h('input', { class: 'input code-input', maxlength: 4, placeholder: 'ABCD', autocapitalize: 'characters', autocomplete: 'off', inputmode: 'text' });
  const go = () => {
    const code = input.value.trim().toUpperCase();
    if (code.length === 4) location.href = `/play?room=${code}`;
  };
  input.addEventListener('keydown', (e) => e.key === 'Enter' && go());
  mount('entry', () => ({
    el: h('div', { class: 'screen' },
      h('h1', { class: 'title' }, 'Join the game'),
      h('p', { class: 'lead' }, 'Type the four letters you can see on the TV.'),
      message && h('div', { class: 'err' }, message),
      input,
      h('button', { class: 'btn block', onclick: go }, 'Continue'),
    ),
  }));
}

// ---- join form --------------------------------------------------------------------
function joinScreen(message) {
  let pick = store.get('op:avatar');
  if (!Number.isInteger(pick)) pick = Math.floor(Math.random() * AVATARS.length);
  let lvl = bandId(store.get('op:level')) || bands[0].id;
  const name = h('input', { class: 'input', maxlength: 14, placeholder: 'Your name', autocomplete: 'nickname', value: store.get('op:name') || '' });
  const grid = h('div', { class: 'avatars' });
  const savedBox = h('div', { class: 'prof-list' });
  const lvlSeg = h('div', { class: 'seg' });
  const drawLvl = () =>
    lvlSeg.replaceChildren(
      ...bands.map((b) => [b.id, b.label]).map(([v, label]) =>
        h('button', { class: v === lvl ? 'on' : '', onclick: () => { lvl = v; drawLvl(); } }, label),
      ),
    );
  drawLvl();
  const draw = () =>
    grid.replaceChildren(
      ...AVATARS.map((_, i) => h('button', { class: i === pick ? 'on' : '', 'aria-label': `Animal ${i + 1}`, onclick: () => { pick = i; draw(); } }, avatar({ avatar: i }))),
    );
  draw();

  const joinWith = (n, av, level, profileId) => {
    store.set('op:name', n);
    store.set('op:avatar', av);
    if (level) store.set('op:level', level);
    send({ t: 'join', room, name: n, avatar: av, level, profileId });
  };

  if (config.profiles.enabled) fetch('/api/profiles').then((r) => r.json()).then((d) => {
    const list = d.profiles || [];
    if (!list.length) return;
    savedBox.replaceChildren(
      h('label', { style: { display: 'block', fontFamily: 'var(--display)', fontWeight: 800, marginBottom: '6px' } }, t('profile.tap')),
      h('div', { class: 'prof-grid' },
        list.map((p) =>
          h('button', { class: 'prof-btn', onclick: () => joinWith(p.name, p.avatar, p.level, p.id) },
            avatar(p),
            h('span', { class: 'prof-meta' }, h('b', null, p.name), h('small', null, bands.length > 1 ? bandLabel(p.level) : '')),
          ),
        ),
      ),
    );
  }).catch(() => {});

  const submit = async () => {
    const n = name.value.trim();
    if (!n) return name.focus();
    let profileId = null;
    let useName = n;
    let useAvatar = pick;
    let useLevel = lvl;
    if (config.profiles.enabled) try {
      const r = await fetch('/api/profiles', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: n, avatar: pick, level: lvl }) });
      const data = await r.json();
      if (data.profile) {
        profileId = data.profile.id;
        useName = data.profile.name;
        useAvatar = data.profile.avatar;
        useLevel = data.profile.level;
      }
    } catch {}
    joinWith(useName, useAvatar, useLevel, profileId);
  };
  name.addEventListener('keydown', (e) => e.key === 'Enter' && submit());
  mount('join', () => ({
    el: h('div', { class: 'screen' },
      h('h1', { class: 'title' }, `Room ${room}`),
      message && h('div', { class: 'err' }, message),
      savedBox,
      h('div', { class: 'field' }, h('label', null, t('profile.orNew')), name),
      bands.length > 1 && h('div', { class: 'field' }, h('label', null, t('level.label')), lvlSeg),
      h('div', { class: 'field' }, h('label', null, 'Pick an animal'), grid),
      h('button', { class: 'btn block push', onclick: submit }, "I'm ready"),
    ),
  }));
}

function messageScreen(title, body, action) {
  mount('msg:' + title, () => ({
    el: h('div', { class: 'screen' },
      h('h1', { class: 'title' }, title),
      h('p', { class: 'lead' }, body),
      action && h('button', { class: 'btn block', onclick: action.fn }, action.label),
    ),
  }));
}

// ---- boot ------------------------------------------------------------------------------
if (!room) {
  entryScreen();
} else {
  messageScreen('Connecting...', 'Hold on a second.');
  net = connect({
    onOpen: () => {
      const saved = store.get(saveKey);
      if (saved && saved.token) {
        send({ t: 'join', room, token: saved.token, name: saved.name || store.get('op:name') || 'Player', avatar: saved.avatar });
      } else if (!joined) {
        joinScreen();
      }
    },
    onMessage: (m) => {
      if (m.t === 'welcome') {
        joined = true;
        store.set(saveKey, { token: m.token, name: m.name, avatar: m.avatar });
        const savedLvl = bandId(store.get('op:level'));
        if (savedLvl && bands.length > 1) send({ t: 'level', level: savedLvl });
      } else if (m.t === 'error') {
        store.del(saveKey);
        if (m.code === 'noroom') entryScreen(m.message);
        else joinScreen(m.message);
      } else if (m.t === 'kicked') {
        store.del(saveKey);
        joined = false;
        messageScreen('You were removed', 'The host took you out of the room. You can join again if that was a mistake.', { label: 'Join again', fn: () => location.reload() });
      } else if (m.t === 'state') {
        setServerNow(m.now);
        last = m;
        render(m);
        cues(m);
      }
    },
  });
}

// Phones stay awake while a game is on (and while the lobby waits), so nobody misses their turn.
const wake = keepAwake();
let wakeOn = false;

function render(s) {
  if (!wakeOn) { wakeOn = true; wake.start(); }
  const mod = ensureGame(s); // start loading the chosen game as soon as it is picked
  if (s.inGame && s.game) {
    if (!mod) return mount('loading', () => ({ el: h('div', { class: 'screen' }, h('h1', { class: 'title' }, '...')) }), s);
    const scr = mod.screen(s, { send });
    return mount(`game:${s.gameId}:${scr.key}`, scr.build, s);
  }
  if (s.briefing && s.briefing.rules) return mount('briefing:' + s.gameId, briefing, s);
  mount('lobby', lobby, s);
}

// ---- how to play ------------------------------------------------------------------------
function briefing(s) {
  const r = s.briefing.rules;
  const me = byId(s.players)(s.me);
  const isHost = s.me === s.hostId;
  const t = timer();
  const el = h('div', { class: 'screen' },
    h('div', { class: 'me' }, h('span', { class: 'who' }, me && avatar(me), me && me.name), soundToggle()),
    h('h1', { class: 'title' }, 'How to play'),
    h('p', { class: 'lead', style: { fontWeight: 800 } }, s.gameName),
    h('ol', { class: 'rule-list' }, r.steps.map((x) => h('li', null, x))),
    h('div', { class: 'card pad' }, h('div', { class: 'seg-label', style: { marginTop: 0 } }, 'Scoring'), h('p', { class: 'lead', style: { marginTop: '4px' } }, r.scoring)),
    t.el,
    isHost ? h('button', { class: 'btn block push', onclick: () => send({ t: 'skipRules' }) }, "Got it, let's go") : h('p', { class: 'status' }, 'Starting soon...'),
    isHost && h('button', { class: 'link', onclick: () => send({ t: 'cancelRules' }) }, 'Back to the lobby'),
  );
  const up = (s) => t.update({ deadline: s.briefing ? s.briefing.until : 0, timerTotal: s.briefing ? s.briefing.total : 1 });
  up(s);
  return { el, update: up };
}

// ---- lobby ------------------------------------------------------------------------------
function seg(options, value, onPick) {
  return h('div', { class: 'seg' }, options.map(([v, label]) => h('button', { class: v === value ? 'on' : '', onclick: () => onPick(v) }, label)));
}

function lobby(s) {
  const el = h('div', { class: 'screen' });
  let settingsOpen = false;
  function update(s) {
    const prevDetails = el.querySelector('.rules-toggle');
    if (prevDetails) settingsOpen = prevDetails.open;
    const get = byId(s.players);
    const me = get(s.me);
    const isHost = s.me === s.hostId;
    const connected = s.players.filter((p) => p.connected).length;
    const need = s.minPlayers - connected;
    const set = (patch) => send({ t: 'settings', settings: { ...s.settings, ...patch } });
    el.replaceChildren(...[
      h('div', { class: 'me' }, h('span', { class: 'who' }, me && avatar(me), me && me.name), soundToggle()),
      h('h1', { class: 'title' }, isHost ? "You're the host" : "You're in"),
      s.lobbyNote && h('div', { class: 'err' }, s.lobbyNote),
      h('p', { class: 'lead' }, isHost
        ? need > 0
          ? `${s.gameName} needs ${s.minPlayers} players. Share the code ${s.code} with ${need} more.`
          : 'Everyone ready? Choose your settings, then start.'
        : `Waiting for ${get(s.hostId) ? get(s.hostId).name : 'the host'} to start ${s.gameName}.`),
      h('div', { class: 'players' }, s.players.map((p) =>
        h('span', { class: 'tag' + (p.connected ? '' : ' off') },
          avatar(p),
          p.name,
          p.id === s.hostId && h('span', { class: 'host-pill' }, 'host'),
          isHost && p.id !== s.me && p.connected && h('button', { class: 'pass-host', title: `Make ${p.name} host`, onclick: () => send({ t: 'makeHost', id: p.id }) }, '→ host'),
        ),
      )),
      !isHost && config.host.allowClaim && h('button', { class: 'link', style: { alignSelf: 'flex-start', padding: '2px 0' }, onclick: () => send({ t: 'claimHost' }) }, 'Take over as host'),
      s.usesLevels && bands.length > 1 && h('div', { class: 'card pad' },
        h('div', { class: 'seg-label', style: { marginTop: 0 } }, t('level.whoHolding')),
        me && !me.level && h('p', { class: 'lead', style: { fontSize: '0.9rem', color: 'var(--tomato)', fontWeight: 800, marginBottom: '6px' } }, t('level.pickOne')),
        seg(bands.map((b) => [b.id, b.hint ? `${b.label} (${b.hint})` : b.label]), me ? me.level : null, (v) => { store.set('op:level', v); send({ t: 'level', level: v }); }),
        h('p', { class: 'lead', style: { fontSize: '0.9rem', marginTop: '8px' } }, s.levelHint),
      ),
      isHost && h('div', { class: 'card pad' },
        h('div', { class: 'seg-label', style: { marginTop: 0 } }, 'Game'),
        seg(s.games.map((g) => [g.id, g.name]), s.gameId, (v) => send({ t: 'pickGame', id: v })),
        h('details', { class: 'rules-toggle', open: settingsOpen, ontoggle: (e) => { settingsOpen = e.currentTarget.open; } },
          h('summary', null, 'Game settings'),
          s.options.map((o) => [h('div', { class: 'seg-label' }, o.label), seg(o.values, s.settings[o.key], (v) => set({ [o.key]: v }))]),
        ),
      ),
      isHost && s.waitingOn.length > 0 && h('p', { class: 'status' }, t('level.waitingHost', { names: s.waitingOn.join(', ') })),
      isHost && h('button', { class: 'btn block push', disabled: need > 0 || s.waitingOn.length > 0, onclick: () => send({ t: 'start' }) }, 'Start the game'),
    ].filter(Boolean));
  }
  update(s);
  return { el, update };
}

// ---- sound: private feedback on your own phone --------------------------------------
document.addEventListener('pointerdown', (e) => {
  const b = e.target.closest && e.target.closest('button');
  if (b && !b.disabled && !b.hasAttribute('data-quiet')) play('tap');
});

let prev = null;
const phaseKey = (g) => [g.phase, g.round, g.idx, g.qi, g.turn].join(':');

function cues(s) {
  const p = prev;
  prev = s;
  if (!p || !s.inGame || !s.game || !p.inGame || !p.game) return;
  const g = s.game;
  const pg = p.game;
  const changed = phaseKey(g) !== phaseKey(pg);
  if (changed && g.phase === 'final') {
    const place = g.myTeam !== undefined ? g.standings.findIndex((x) => x.id === g.myTeam) : g.standings.findIndex((x) => x.id === s.me);
    return play(place === 0 ? 'fanfare' : place > 0 && place < 3 ? 'coin' : 'tap');
  }
  const own = (loaded.get(s.gameId) || {}).cues;
  if (own && own.onChange) own.onChange(s, p, changed, play);
}
