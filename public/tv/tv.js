import { h, avatar, byId, setServerNow, serverNow, soundToggle } from '/shared/ui.js';
import { play, isRunning, isMuted, onChange } from '/shared/sound.js';
import { connect } from '/shared/net.js';
import * as whosaidthat from '/tv/whosaidthat.js';
import * as draw from '/tv/draw.js';
import * as quiz from '/tv/quiz.js';
import * as minigames from '/tv/minigames.js';

const GAMES = { whosaidthat, draw, quiz, minigames };
const app = document.getElementById('app');
const room = (new URLSearchParams(location.search).get('room') || '').toUpperCase();
let info = null;
let last = null;
let current = { key: null, api: null };

fetch('/api/info').then((r) => r.json()).then((i) => { info = i; if (last) render(last); });

const net = connect({
  onOpen: () => net.send({ t: 'tv', room }),
  onMessage: (m) => {
    if (m.t === 'error') return showError(m.message);
    if (m.t === 'draw') return draw.onEvent(m);
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
  if (s.inGame && s.game) {
    const mod = GAMES[s.gameId];
    const scr = mod.screen(s);
    return mount(`game:${s.gameId}:${scr.key}`, scr.build, s);
  }
  mount('lobby', lobby, s);
}

// ---- lobby ------------------------------------------------------------------
function lobby(s) {
  const base = info ? info.base : location.origin;
  const joinUrl = `${base}/play?room=${s.code}`;
  const roster = h('div', { class: 'roster' });
  const hint = h('p', { class: 'hint' });
  const gameName = h('div', { class: 'pill', style: { marginTop: '1.4rem', fontSize: '1.2rem' } });
  const gameDesc = h('p', { class: 'hint', style: { marginTop: '0.8rem' } });
  const startable = () => last && last.players.filter((p) => p.connected).length >= last.minPlayers;

  const el = h('div', { class: 'stage' },
    h('div', { class: 'lobby' },
      h('div', null,
        h('h1', null, 'Family', h('span', null, 'Game Night')),
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
        h('div', { class: 'url' }, `${base.replace('http://', '')}/play`),
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
      need > 0
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

const TIMED = { whosaidthat: ['answer', 'vote'], draw: ['choose', 'draw'], quiz: ['question', 'wager'] };
let prevState = null;
let tickTag = null;
const len = (a) => (Array.isArray(a) ? a.length : 0);
const keyOf = (s) => (s.inGame && s.game ? [s.gameId, s.game.phase, s.game.round, s.game.idx, s.game.qi, s.game.turn].join(':') : 'lobby');

function cues(s) {
  const prev = prevState;
  prevState = s;
  if (!prev) return;
  if (!s.inGame) {
    if (prev.inGame) play('whoosh');
    else if (s.players.length > prev.players.length) play('pop');
    return;
  }
  const g = s.game;
  const pg = prev.inGame ? prev.game : null;
  if (keyOf(s) !== keyOf(prev)) {
    tickTag = null;
    return onPhase(s.gameId, g);
  }
  if (!pg) return;
  if (s.gameId === 'draw') {
    if (len(g.guessed) > len(pg.guessed)) play('correct');
  } else if (s.gameId === 'whosaidthat') {
    if (len(g.answered) > len(pg.answered) || len(g.voted) > len(pg.voted)) play('lock');
    if ((g.laughs || 0) > (pg.laughs || 0)) play('pop');
  } else if (s.gameId === 'quiz') {
    if (len(g.answered) > len(pg.answered) || len(g.wagered) > len(pg.wagered)) play('lock');
  } else if (s.gameId === 'minigames') {
    if (len(g.done) > len(pg.done)) play('lock');
  }
}

function onPhase(id, g) {
  const P = g.phase;
  if (P === 'final') return play('fanfare');
  if (P === 'scores') return play('coin');
  if (id === 'whosaidthat') play(P === 'reveal' ? 'drum' : 'whoosh');
  else if (id === 'draw') play(P === 'draw' ? 'go' : P === 'result' ? (len(g.guessed) ? 'coin' : 'wrong') : 'whoosh');
  else if (id === 'quiz') {
    if (P === 'reveal') play(g.results.some((r) => r.correct) ? 'correct' : 'wrong');
    else if (P === 'wager') play('drum');
    else play(P === 'question' ? (g.finale ? 'drum' : 'go') : 'whoosh');
  } else if (id === 'minigames') {
    if (P === 'results') play('coin');
    else if (P === 'intro') play('whoosh');
  }
}

// Last-three-seconds ticks, and the 3-2-1-GO before each mini-game.
setInterval(() => {
  const s = prevState;
  if (!s || !s.inGame || !s.game) return;
  const g = s.game;
  let target = null;
  if (s.gameId === 'minigames' && g.phase === 'play') {
    const left = g.startAt - serverNow();
    const remain = g.endAt - serverNow();
    if (left > 0) target = `count:${Math.ceil(left / 1000)}`;
    else if (left > -400) target = 'go';
    else if (remain > 0 && remain <= 3000) target = `end:${Math.ceil(remain / 1000)}`;
  } else if (g.deadline && (TIMED[s.gameId] || []).includes(g.phase)) {
    const left = Math.ceil((g.deadline - serverNow()) / 1000);
    if (left >= 1 && left <= 3) target = `t:${left}`;
  }
  if (target && target !== tickTag) {
    tickTag = target;
    play(target === 'go' ? 'go' : 'tick');
  }
}, 150);
