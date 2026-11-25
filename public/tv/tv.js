import { h, avatar, byId, setServerNow, serverNow, soundToggle, timer } from '/shared/ui.js';
import '/shared/pwa.js';
import { play, isRunning, isMuted, onChange } from '/shared/sound.js';
import { connect } from '/shared/net.js';
import { keepAwake } from '/shared/wake.js';
import { config } from '/shared/config.js';
import { t } from '/shared/i18n.js';

// Games are loaded on demand from the paths the server lists in s.games (see docs/GAME-SDK.md). `loaded` holds each
// game's module once it is ready; events the server sends before that are kept and replayed.
const loaded = new Map();
const loading = new Map();
const waiting = new Map();

function ensureGame(s) {
  const id = s.gameId;
  const meta = (s.games || []).find((g) => g.id === id);
  if (!meta || loaded.has(id) || loading.has(id)) return loaded.get(id) || null;
  for (const href of meta.client.styles || []) {
    if (!document.querySelector(`link[href="${href}"]`)) document.head.append(Object.assign(document.createElement('link'), { rel: 'stylesheet', href }));
  }
  loading.set(id, import(meta.client.tv).then((mod) => {
    loaded.set(id, mod);
    for (const ev of waiting.get(id) || []) if (mod.onEvent) mod.onEvent(ev);
    waiting.delete(id);
    if (last) render(last);
  }).catch((err) => {
    console.error(`Could not load the screens for "${id}"`, err);
    loading.set(id, null);
  }));
  return null;
}
const app = document.getElementById('app');
const room = (new URLSearchParams(location.search).get('room') || '').toUpperCase();
let info = null;
let last = null;
let current = { key: null, api: null };

fetch('/api/info').then((r) => r.json()).then((i) => { info = i; if (last) render(last); });

// The big screen should never go to sleep during a game night.
keepAwake().start();

const net = connect({
  onOpen: () => net.send({ t: 'tv', room }),
  onMessage: (m) => {
    if (m.t === 'error') return showError(m.message);
    if (m.t === 'game') {
      // A custom event from one game's server code, for example live drawing strokes.
      const mod = loaded.get(m.game);
      if (mod && mod.onEvent) return mod.onEvent(m);
      if (!waiting.has(m.game)) waiting.set(m.game, []);
      return waiting.get(m.game).push(m);
    }
    if (m.t !== 'state') return;
    setServerNow(m.now);
    last = m;
    render(m);
    cues(m);
  },
});

function mount(key, build, s) {
  if (current.key === key) return current.api.update(s);
  if (current.api && current.api.destroy) current.api.destroy();
  current = { key, api: build(s) };
  app.replaceChildren(current.api.el);
}

function showError(message) {
  current = { key: 'error', api: null };
  app.replaceChildren(
    h('div', { class: 'center-msg' },
      h('h1', null, 'This room has closed'),
      h('p', null, message),
      h('button', { class: 'btn', onclick: () => (location.href = '/') }, 'Start a new room'),
    ),
  );
}

function render(s) {
  const mod = ensureGame(s); // start loading the chosen game as soon as it is picked
  if (s.inGame && s.game) {
    if (!mod) return mount('loading', () => ({ el: h('div', { class: 'center-msg' }, h('h1', null, '...')) }), s);
    const scr = mod.screen(s);
    return mount(`game:${s.gameId}:${scr.key}`, scr.build, s);
  }
  if (s.briefing && s.briefing.rules) return mount('briefing:' + s.gameId, briefing, s);
  mount('lobby', lobby, s);
}

// ---- how to play ------------------------------------------------------------
function briefing(s) {
  const r = s.briefing.rules;
  const t = timer();
  const el = h('div', { class: 'stage' },
    h('div', { class: 'bar' }, h('span', { class: 'pill' }, 'How to play'), h('span', { class: 'code' }, s.gameName.toUpperCase())),
    h('div', { class: 'rules' },
      h('ol', { class: 'steps big' }, r.steps.map((x, i) => h('li', null, h('b', null, String(i + 1)), x))),
      h('div', { class: 'card rules-score' }, h('small', null, 'Scoring'), h('p', null, r.scoring)),
    ),
    h('div', { class: 'big-timer' }, t.el),
  );
  const up = (s) => t.update({ deadline: s.briefing ? s.briefing.until : 0, timerTotal: s.briefing ? s.briefing.total : 1 });
  up(s);
  return { el, update: up };
}

// The brand name as a title: the last word goes on its own line in the accent colour.
function brandTitle() {
  const words = config.brand.name.split(' ');
  const last = words.pop();
  return h('h1', null, ...(words.length ? [words.join(' ')] : []), h('span', null, last));
}

// ---- lobby ------------------------------------------------------------------
function lobby(s) {
  const base = info ? info.base : location.origin;
  const joinUrl = `${base}/play?room=${s.code}`;
  const roster = h('div', { class: 'roster' });
  const hint = h('p', { class: 'hint' });
  const gameName = h('div', { class: 'pill', style: { marginTop: '1.4rem', fontSize: '1.2rem' } });
  const gameDesc = h('p', { class: 'hint', style: { marginTop: '0.8rem' } });

  const el = h('div', { class: 'stage' },
    h('div', { class: 'lobby' },
      h('div', null,
        brandTitle(),
        gameName,
        gameDesc,
        h('ol', { class: 'steps' },
          h('li', null, h('b', null, '1'), 'Scan the code with your phone'),
          h('li', null, h('b', null, '2'), 'Pick a name and an animal'),
          h('li', null, h('b', null, '3'), 'Wait for the host to hit start'),
        ),
        roster,
        hint,
      ),
      h('div', { class: 'card join-card' },
        h('img', { class: 'qr', alt: 'QR code to join', src: `/qr?text=${encodeURIComponent(joinUrl)}` }),
        h('div', { class: 'label' }, 'Or go to the address below and enter'),
        h('div', { class: 'room' }, s.code),
        h('div', { class: 'url' }, `${base.replace(/^https?:\/\//, '')}/play`),
      ),
    ),
  );

  function update(s) {
    gameName.textContent = s.gameName;
    gameDesc.textContent = s.gameDesc;
    const get = byId(s.players);
    roster.replaceChildren(
      ...s.players.map((p) =>
        h('span', { class: 'tag' + (p.connected ? '' : ' off') },
          avatar(p),
          h('span', { class: 'tag-name' }, p.name),
          p.id === s.hostId && h('span', { class: 'host' }, 'host'),
        ),
      ),
    );
    const need = s.minPlayers - s.players.filter((p) => p.connected).length;
    const host = get(s.hostId);
    hint.replaceChildren(
      s.lobbyNote
        ? h('span', { style: { color: 'var(--tomato)', fontWeight: 800 } }, s.lobbyNote)
        : s.waitingOn && s.waitingOn.length > 0
        ? h('span', null, t('level.waitingPhone', { names: s.waitingOn.join(', ') }))
        : need > 0
        ? h('span', null, `Waiting for ${need} more ${need === 1 ? 'player' : 'players'}. `)
        : h('span', null, h('b', null, host ? host.name : 'The host'), ' can start the game from their phone.'),
    );
  }
  update(s);
  return { el, update };
}

// ---- sound: the big screen plays the shared moments ------------------------------------
const snd = soundToggle('snd-float');
const sndHint = h('div', { class: 'snd-hint' }, 'Click anywhere to turn sound on');
document.body.append(snd, sndHint);
const syncHint = () => (sndHint.style.display = isRunning() || isMuted() ? 'none' : 'block');
onChange(syncHint);
syncHint();
window.addEventListener('keydown', (e) => {
  if (e.key === 'm' || e.key === 'M') snd.click();
});

let prevState = null;
let tickTag = null;
const keyOf = (s) => (s.inGame && s.game ? [s.gameId, s.game.phase, s.game.round, s.game.idx, s.game.qi, s.game.turn].join(':') : 'lobby');

// Sound cues. Shared ones live here; each game adds its own through the `cues` it exports (see docs/GAME-SDK.md).
function cues(s) {
  const prev = prevState;
  prevState = s;
  if (!prev) return;
  if (!s.inGame) {
    if (s.briefing && !prev.briefing) play('whoosh');
    else if (prev.inGame) play('whoosh');
    else if (s.players.length > prev.players.length) play('pop');
    return;
  }
  const g = s.game;
  const pg = prev.inGame ? prev.game : null;
  const mod = loaded.get(s.gameId);
  const own = (mod && mod.cues) || {};
  if (keyOf(s) !== keyOf(prev)) {
    tickTag = null;
    if (g.phase === 'final') return play('fanfare');
    if (g.phase === 'scores') return play('coin');
    return own.onPhase && own.onPhase(g, play);
  }
  if (pg && own.onChange) own.onChange(g, pg, play);
}

// Ticks in the last three seconds of a timed phase, or whatever a game's own tick(g, now) asks for.
setInterval(() => {
  const s = prevState;
  if (!s || !s.inGame || !s.game) return;
  const g = s.game;
  const own = (loaded.get(s.gameId) || {}).cues || {};
  let target = null;
  if (own.tick) target = own.tick(g, serverNow());
  else if (g.deadline && (own.timedPhases || []).includes(g.phase)) {
    const left = Math.ceil((g.deadline - serverNow()) / 1000);
    if (left >= 1 && left <= 3) target = { tag: `t:${left}`, sound: 'tick' };
  }
  if (target && target.tag !== tickTag) {
    tickTag = target.tag;
    play(target.sound);
  }
}, 150);
