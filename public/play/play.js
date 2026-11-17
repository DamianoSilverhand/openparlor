import { h, avatar, AVATARS, byId, setServerNow } from '/shared/ui.js';
import { connect } from '/shared/net.js';
import * as whosaidthat from '/play/whosaidthat.js';

const GAMES = { whosaidthat };
const app = document.getElementById('app');
const room = (new URLSearchParams(location.search).get('room') || '').toUpperCase().slice(0, 4);

const store = {
  get(k) { try { return JSON.parse(localStorage.getItem(k)); } catch { return null; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} },
  del(k) { try { localStorage.removeItem(k); } catch {} },
};
const saveKey = `fgn:${room}`;

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
  let pick = store.get('fgn:avatar');
  if (!Number.isInteger(pick)) pick = Math.floor(Math.random() * AVATARS.length);
  const name = h('input', { class: 'input', maxlength: 14, placeholder: 'Your name', autocomplete: 'nickname', value: store.get('fgn:name') || '' });
  const grid = h('div', { class: 'avatars' });
  const draw = () =>
    grid.replaceChildren(
      ...AVATARS.map((_, i) => h('button', { class: i === pick ? 'on' : '', 'aria-label': `Animal ${i + 1}`, onclick: () => { pick = i; draw(); } }, avatar({ avatar: i }))),
    );
  draw();
  const submit = () => {
    const n = name.value.trim();
    if (!n) return name.focus();
    store.set('fgn:name', n);
    store.set('fgn:avatar', pick);
    send({ t: 'join', room, name: n, avatar: pick });
  };
  name.addEventListener('keydown', (e) => e.key === 'Enter' && submit());
  mount('join', () => ({
    el: h('div', { class: 'screen' },
      h('h1', { class: 'title' }, `Room ${room}`),
      message && h('div', { class: 'err' }, message),
      h('div', { class: 'field' }, h('label', null, 'What should we call you?'), name),
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
        send({ t: 'join', room, token: saved.token, name: saved.name || store.get('fgn:name') || 'Player', avatar: saved.avatar });
      } else if (!joined) {
        joinScreen();
      }
    },
    onMessage: (m) => {
      if (m.t === 'welcome') {
        joined = true;
        store.set(saveKey, { token: m.token, name: m.name, avatar: m.avatar });
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
      }
    },
  });
}

function render(s) {
  if (s.inGame && s.game) {
    const scr = GAMES[s.gameId].screen(s, { send });
    return mount(`game:${s.gameId}:${scr.key}`, scr.build, s);
  }
  mount('lobby', lobby, s);
}

// ---- lobby ------------------------------------------------------------------------------
function seg(options, value, onPick) {
  return h('div', { class: 'seg' }, options.map(([v, label]) => h('button', { class: v === value ? 'on' : '', onclick: () => onPick(v) }, label)));
}

function lobby(s) {
  const el = h('div', { class: 'screen' });
  function update(s) {
    const get = byId(s.players);
    const me = get(s.me);
    const isHost = s.me === s.hostId;
    const connected = s.players.filter((p) => p.connected).length;
    const need = s.minPlayers - connected;
    const set = (patch) => send({ t: 'settings', settings: { ...s.settings, ...patch } });
    el.replaceChildren(...[
      h('div', { class: 'me' }, h('span', { class: 'who' }, me && avatar(me), me && me.name)),
      h('h1', { class: 'title' }, isHost ? "You're the host" : "You're in"),
      h('p', { class: 'lead' }, isHost
        ? need > 0
          ? `${s.gameName} needs ${s.minPlayers} players. Share the code ${s.code} with ${need} more.`
          : 'Everyone ready? Choose your settings, then start.'
        : `Waiting for ${get(s.hostId) ? get(s.hostId).name : 'the host'} to start ${s.gameName}.`),
      h('div', { class: 'players' }, s.players.map((p) => h('span', { class: 'tag' + (p.connected ? '' : ' off') }, avatar(p), p.name))),
      isHost && h('div', { class: 'card pad' },
        h('div', { class: 'seg-label', style: { marginTop: 0 } }, 'Game'),
        seg(s.games.map((g) => [g.id, g.name]), s.gameId, (v) => send({ t: 'pickGame', id: v })),
        s.options.map((o) => [h('div', { class: 'seg-label' }, o.label), seg(o.values, s.settings[o.key], (v) => set({ [o.key]: v }))]),
      ),
      isHost && h('button', { class: 'btn block push', disabled: need > 0, onclick: () => send({ t: 'start' }) }, 'Start the game'),
    ].filter(Boolean));
  }
  update(s);
  return { el, update };
}
