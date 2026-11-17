// Tiny DOM helper plus the pieces shared by the TV and the phones.
export function h(tag, props, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props || {})) {
    if (v == null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'style' && typeof v === 'object') {
      for (const [prop, val] of Object.entries(v)) {
        if (prop.startsWith('--')) el.style.setProperty(prop, val);
        else el.style[prop] = val;
      }
    }
    else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v);
    else if (k === 'text') el.textContent = v;
    else el.setAttribute(k, v === true ? '' : v);
  }
  const add = (c) => {
    if (c == null || c === false) return;
    if (Array.isArray(c)) c.forEach(add);
    else el.append(c.nodeType ? c : document.createTextNode(String(c)));
  };
  kids.forEach(add);
  return el;
}

export const AVATARS = [
  { e: '🦊', c: '#E8472B' },
  { e: '🐼', c: '#9AD1B0' },
  { e: '🐸', c: '#6BAA4F' },
  { e: '🐙', c: '#F29BB5' },
  { e: '🦁', c: '#F2B632' },
  { e: '🐧', c: '#6FB3E0' },
  { e: '🐨', c: '#C9C2B8' },
  { e: '🐯', c: '#F28C38' },
  { e: '🐵', c: '#D9B88F' },
  { e: '🦉', c: '#B5523B' },
  { e: '🐢', c: '#2E9C9C' },
  { e: '🦄', c: '#FF9F8F' },
];

export function avatar(p, size) {
  const a = AVATARS[(p && p.avatar) % AVATARS.length] || AVATARS[0];
  return h('span', { class: 'avatar', style: { background: a.c, ...(size ? { '--s': size } : {}) } }, a.e);
}

export function tag(p, extra) {
  return h('span', { class: 'tag' }, avatar(p), h('span', { class: 'tag-name' }, p ? p.name : '?'), extra);
}

import { isMuted, setMuted, onChange } from '/shared/sound.js';

// ---- server clock + countdown ---------------------------------------------
let offset = 0;
export const setServerNow = (n) => (offset = n - Date.now());
export const serverNow = () => Date.now() + offset;

const tickers = new Set();
setInterval(() => {
  for (const t of tickers) {
    if (t.el.isConnected) t.seen = true;
    else if (t.seen) {
      tickers.delete(t);
      continue;
    }
    t.fn();
  }
}, 100);

// Run fn about ten times a second for as long as el is on the page.
export function onTick(el, fn) {
  tickers.add({ el, fn, seen: false });
}

// A countdown bar with the seconds left. Call update(game) whenever state changes.
export function timer() {
  const fill = h('i');
  const num = h('b');
  const el = h('div', { class: 'timer' }, h('div', { class: 'track' }, fill), num);
  let deadline = 0;
  let total = 1;
  const fn = () => {
    const left = Math.max(0, deadline - serverNow());
    fill.style.transform = `scaleX(${total ? Math.min(1, left / total) : 0})`;
    num.textContent = Math.ceil(left / 1000);
    el.classList.toggle('low', left > 0 && left <= 5000);
  };
  tickers.add({ el, fn, seen: false });
  return {
    el,
    update(g) {
      deadline = g.deadline;
      total = g.timerTotal || 1;
      fn();
    },
  };
}

export function byId(players) {
  const m = new Map(players.map((p) => [p.id, p]));
  return (id) => m.get(id);
}

export const ordinal = (n) => ['1st', '2nd', '3rd'][n] || `${n + 1}th`;

// A small sound on/off button. The icon follows the shared setting.
const ICON_ON = '<svg viewBox="0 0 24 24" width="1.2em" height="1.2em" aria-hidden="true"><path d="M3 9v6h4l5 4V5L7 9H3z" fill="currentColor"/><path d="M15 8.5a5 5 0 0 1 0 7M17.5 6a8.5 8.5 0 0 1 0 12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>';
const ICON_OFF = '<svg viewBox="0 0 24 24" width="1.2em" height="1.2em" aria-hidden="true"><path d="M3 9v6h4l5 4V5L7 9H3z" fill="currentColor"/><path d="M16 9l5 6M21 9l-5 6" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>';
const paintSnd = (b) => {
  b.innerHTML = isMuted() ? ICON_OFF : ICON_ON;
  b.setAttribute('aria-label', isMuted() ? 'Turn sound on' : 'Turn sound off');
  b.title = isMuted() ? 'Sound is off' : 'Sound is on';
};
onChange(() => document.querySelectorAll('.snd').forEach(paintSnd));
export function soundToggle(extraClass = '') {
  const b = h('button', { class: `snd ${extraClass}`.trim(), 'data-quiet': '' });
  paintSnd(b);
  b.addEventListener('click', () => setMuted(!isMuted()));
  return b;
}
