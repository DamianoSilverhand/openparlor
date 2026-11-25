// Local-first scores for Solo Practice, so a finished game is never lost when the network is down.
//
// A finished game is applied to the saved copy of the profile on this device at once (so the "New personal best!"
// message and the streak work offline), and put in a queue. The queue is sent to the server when there is a
// connection, in order. Each entry carries a unique runId, so a result that was sent but whose answer got lost is
// recognised by the server and not counted twice.
const QUEUE = 'op:queue';
const PROFILES = 'op:profiles';

const read = (key, fallback) => {
  try {
    const v = JSON.parse(localStorage.getItem(key));
    return v === null || v === undefined ? fallback : v;
  } catch {
    return fallback;
  }
};
const write = (key, value) => {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // storage is full or blocked: the app still works online
  }
};

export const cachedProfiles = () => read(PROFILES, []);
export const cacheProfiles = (list) => write(PROFILES, list);
export const pending = () => read(QUEUE, []).length;

export function newRunId() {
  const id = (globalThis.crypto && crypto.randomUUID ? crypto.randomUUID() : `${Date.now().toString(36)}${Math.random().toString(36).slice(2)}`);
  return id.replace(/[^\w-]/g, '').slice(0, 64);
}

// The same rules the server uses for personal bests and daily streaks. Returns a new profile object.
export function applyLocally(profile, gameId, score, runStreak, atIso = new Date().toISOString()) {
  const p = JSON.parse(JSON.stringify(profile));
  p.stats = p.stats || { gamesPlayed: 0, bests: {}, streaks: {} };
  p.stats.bests = p.stats.bests || {};
  p.stats.streaks = p.stats.streaks || {};
  const prevBest = p.stats.bests[gameId] || 0;
  const isNewBest = score > 0 && score > prevBest;
  if (isNewBest) p.stats.bests[gameId] = score;
  p.stats.gamesPlayed = (p.stats.gamesPlayed || 0) + 1;
  const day = atIso.slice(0, 10);
  const before = new Date(Date.parse(atIso) - 86400000).toISOString().slice(0, 10);
  const st = p.stats.streaks[gameId] || { current: 0, best: 0, lastDate: null, bestRun: 0 };
  if (!st.lastDate || day > st.lastDate) {
    st.current = st.lastDate === before ? st.current + 1 : 1;
    st.lastDate = day;
  }
  st.best = Math.max(st.best || 0, st.current);
  st.bestRun = Math.max(st.bestRun || 0, runStreak || 0);
  p.stats.streaks[gameId] = st;
  return { profile: p, isNewBest, prevBest };
}

// Adds a finished game to the queue and to the saved profile copy.
export function enqueue({ profileId, gameId, score, streak }) {
  const item = { runId: newRunId(), id: profileId, gameId, score, streak: streak || 0, playedAt: new Date().toISOString() };
  write(QUEUE, [...read(QUEUE, []), item]);
  return item;
}

const listeners = new Set();
export const onSynced = (fn) => listeners.add(fn);
let flushing = null;

// Sends the queue in order. Stops at the first network failure and keeps the rest. A result the server refuses for good
// (the profile was deleted, or the data is invalid) is dropped, so one bad entry cannot block the others.
export function flush() {
  if (flushing) return flushing;
  const run = (async () => {
    let sent = 0;
    for (;;) {
      const queue = read(QUEUE, []);
      if (!queue.length) break;
      let res;
      try {
        res = await fetch('/api/profiles/record', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(queue[0]) });
      } catch {
        break; // offline: try again later
      }
      if (res.status >= 500 || res.status === 429) break; // the server is busy or down: try again later
      write(QUEUE, read(QUEUE, []).slice(1)); // re-read, so a game finished meanwhile is kept
      sent++;
    }
    if (sent) listeners.forEach((fn) => fn(sent));
    return read(QUEUE, []).length;
  })();
  flushing = run;
  // Cleared only after `flushing` was set: an empty queue finishes at once, and clearing from inside would be undone.
  run.finally(() => { if (flushing === run) flushing = null; });
  return run;
}

export function startSync() {
  flush();
  window.addEventListener('online', flush);
  setInterval(flush, 30000);
}
