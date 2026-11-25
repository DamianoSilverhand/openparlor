// Sound effects made on the fly with the Web Audio API, so there are no audio files and it works offline.
import '/shared/store.js'; // moves old "fgn:" keys to "op:" before anything reads them
const KEY = 'op:mute';
let muted = false;
try {
  muted = localStorage.getItem(KEY) === '1';
} catch {}

let ctx = null;
let master = null;
let noiseBuf = null;
const listeners = new Set();
const emit = () => listeners.forEach((f) => f());

function ensure() {
  if (ctx) return ctx;
  const AC = window.AudioContext || window.webkitAudioContext;
  if (!AC) return null;
  ctx = new AC();
  master = ctx.createGain();
  master.gain.value = 0.6;
  master.connect(ctx.destination);
  ctx.onstatechange = emit;
  return ctx;
}

// Browsers only allow sound after a tap or key press, so any interaction unlocks it.
export function unlock() {
  const c = ensure();
  if (c && c.state !== 'running') c.resume().catch(() => {});
}
['pointerdown', 'touchend', 'click', 'keydown'].forEach((ev) => window.addEventListener(ev, unlock, { capture: true, passive: true }));

export const isRunning = () => !!ctx && ctx.state === 'running';
export const isMuted = () => muted;
export function setMuted(v) {
  muted = !!v;
  try {
    localStorage.setItem(KEY, muted ? '1' : '0');
  } catch {}
  emit();
}
export function onChange(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

function tone(c, { f, at = 0, d = 0.15, type = 'sine', v = 0.25, to }) {
  const t = c.currentTime + at;
  const o = c.createOscillator();
  const g = c.createGain();
  o.type = type;
  o.frequency.setValueAtTime(f, t);
  if (to) o.frequency.exponentialRampToValueAtTime(to, t + d);
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(v, t + 0.01);
  g.gain.exponentialRampToValueAtTime(0.0001, t + d);
  o.connect(g);
  g.connect(master);
  o.start(t);
  o.stop(t + d + 0.05);
}

function noise(c, { at = 0, d = 0.3, from = 400, to = 3000, v = 0.2, q = 1 }) {
  if (!noiseBuf) {
    noiseBuf = c.createBuffer(1, c.sampleRate, c.sampleRate);
    const data = noiseBuf.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
  }
  const t = c.currentTime + at;
  const src = c.createBufferSource();
  src.buffer = noiseBuf;
  const filter = c.createBiquadFilter();
  filter.type = 'bandpass';
  filter.Q.value = q;
  filter.frequency.setValueAtTime(from, t);
  filter.frequency.exponentialRampToValueAtTime(to, t + d);
  const g = c.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(v, t + d * 0.3);
  g.gain.exponentialRampToValueAtTime(0.0001, t + d);
  src.connect(filter);
  filter.connect(g);
  g.connect(master);
  src.start(t);
  src.stop(t + d + 0.05);
}

const PAD_NOTES = [330, 392, 494, 587];

const LIB = {
  tap: (c) => tone(c, { f: 600, d: 0.05, type: 'triangle', v: 0.1 }),
  pop: (c) => tone(c, { f: 500, to: 900, d: 0.1, v: 0.2 }),
  tick: (c) => tone(c, { f: 880, d: 0.06, type: 'square', v: 0.07 }),
  lock: (c) => tone(c, { f: 440, d: 0.07, type: 'triangle', v: 0.11 }),
  go: (c) => {
    tone(c, { f: 660, d: 0.1, v: 0.2 });
    tone(c, { f: 990, at: 0.1, d: 0.28, v: 0.22 });
  },
  good: (c) => tone(c, { f: 700, to: 1000, d: 0.1, v: 0.15 }),
  bad: (c) => tone(c, { f: 220, to: 150, d: 0.18, type: 'sawtooth', v: 0.1 }),
  match: (c) => {
    tone(c, { f: 660, d: 0.1, v: 0.15 });
    tone(c, { f: 880, at: 0.09, d: 0.18, v: 0.15 });
  },
  correct: (c) => [523, 659, 784].forEach((f, i) => tone(c, { f, at: i * 0.08, d: 0.24, v: 0.2 })),
  wrong: (c) => {
    tone(c, { f: 300, to: 200, d: 0.25, type: 'sawtooth', v: 0.13 });
    tone(c, { f: 220, at: 0.16, to: 140, d: 0.3, type: 'sawtooth', v: 0.13 });
  },
  buzz: (c) => tone(c, { f: 140, d: 0.3, type: 'sawtooth', v: 0.15 }),
  whoosh: (c) => noise(c, { d: 0.4, from: 300, to: 2500, v: 0.13 }),
  drum: (c) => {
    for (let i = 0; i < 7; i++) noise(c, { at: i * 0.075, d: 0.07, from: 180, to: 160, v: 0.1 + i * 0.02, q: 2 });
    tone(c, { f: 110, at: 0.55, d: 0.3, v: 0.3 });
  },
  coin: (c) => {
    tone(c, { f: 988, d: 0.08, type: 'square', v: 0.09 });
    tone(c, { f: 1319, at: 0.08, d: 0.3, type: 'square', v: 0.09 });
  },
  fanfare: (c) => {
    [[523, 0, 0.14], [523, 0.16, 0.14], [523, 0.32, 0.14], [659, 0.5, 0.25], [784, 0.78, 0.25], [1047, 1.06, 0.7]].forEach(([f, at, d]) => {
      tone(c, { f, at, d, type: 'triangle', v: 0.25 });
      tone(c, { f: f / 2, at, d, type: 'square', v: 0.05 });
    });
  },
  pad0: (c) => tone(c, { f: PAD_NOTES[0], d: 0.3, type: 'triangle', v: 0.25 }),
  pad1: (c) => tone(c, { f: PAD_NOTES[1], d: 0.3, type: 'triangle', v: 0.25 }),
  pad2: (c) => tone(c, { f: PAD_NOTES[2], d: 0.3, type: 'triangle', v: 0.25 }),
  pad3: (c) => tone(c, { f: PAD_NOTES[3], d: 0.3, type: 'triangle', v: 0.25 }),
};
export const SOUND_NAMES = Object.keys(LIB);

export function play(name) {
  if (muted) return;
  const c = ensure();
  if (!c || c.state !== 'running') return;
  const fn = LIB[name];
  if (!fn) return;
  try {
    fn(c);
  } catch {}
}
