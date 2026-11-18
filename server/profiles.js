const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { clean } = require('./util');

const FILE = path.join(__dirname, '../data/profiles.json');
const LEVELS = ['kid', 'teen', 'grownup'];

function load() {
  try {
    const data = JSON.parse(fs.readFileSync(FILE, 'utf8'));
    return Array.isArray(data.profiles) ? data.profiles : [];
  } catch {
    return [];
  }
}

let profiles = load();

function save() {
  try {
    fs.mkdirSync(path.dirname(FILE), { recursive: true });
    fs.writeFileSync(FILE, JSON.stringify({ profiles }, null, 2));
  } catch {}
}

function list() {
  return profiles;
}

function get(id) {
  return profiles.find((p) => p.id === id) || null;
}

function upsert({ id, name, avatar, level }) {
  const n = clean(name, 14);
  if (!n) return null;
  const lvl = LEVELS.includes(level) ? level : 'kid';
  const av = Number.isInteger(avatar) && avatar >= 0 && avatar < 12 ? avatar : 0;
  let p = id ? get(id) : profiles.find((x) => x.name.toLowerCase() === n.toLowerCase());
  if (p) {
    p.name = n;
    p.avatar = av;
    p.level = lvl;
  } else {
    p = {
      id: 'p_' + crypto.randomBytes(4).toString('hex'),
      name: n,
      avatar: av,
      level: lvl,
      stats: { gamesPlayed: 0, bests: {}, streaks: {} },
    };
    profiles.push(p);
  }
  save();
  return p;
}

function record(id, gameId, score, runStreak = 0) {
  const p = get(id);
  if (!p || !gameId) return null;
  const s = Math.max(0, Math.round(Number(score) || 0));
  p.stats = p.stats || { gamesPlayed: 0, bests: {}, streaks: {} };
  p.stats.bests = p.stats.bests || {};
  p.stats.streaks = p.stats.streaks || {};
  p.stats.gamesPlayed = (p.stats.gamesPlayed || 0) + 1;

  const prevBest = p.stats.bests[gameId] || 0;
  const isNewBest = s > 0 && s > prevBest;
  if (isNewBest) p.stats.bests[gameId] = s;

  const today = new Date().toISOString().slice(0, 10);
  const st = p.stats.streaks[gameId] || { current: 0, best: 0, lastDate: null, bestRun: 0 };
  if (st.lastDate !== today) {
    const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
    st.current = st.lastDate === yesterday ? st.current + 1 : 1;
    st.lastDate = today;
  }
  st.best = Math.max(st.best || 0, st.current);
  if (runStreak > (st.bestRun || 0)) st.bestRun = runStreak;
  p.stats.streaks[gameId] = st;

  save();
  return { profile: p, isNewBest, prevBest };
}

module.exports = { list, get, upsert, record };
