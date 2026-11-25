// Profiles, personal bests, daily streaks and mini-game scores, stored in the database (see server/db/).
// The shapes returned here are the same ones the browser has always received.
const crypto = require('crypto');
const { clean } = require('./util');
const { bands } = require('./config');
const { getDb } = require('./db');

// The mini-games that can have scores. The mini-game loader fills this in at start-up.
let GAME_IDS = ['scramble', 'literacy', 'math', 'logic', 'memory', 'pattern', 'clash', 'reaction'];
const registerGameIds = (ids) => { GAME_IDS = [...ids]; };
const isGameId = (id) => GAME_IDS.includes(id);
const ID_RE = /^p_[0-9a-f]{8}$/;

function shape(row, statRows) {
  const stats = { gamesPlayed: row.games_played, bests: {}, streaks: {} };
  for (const s of statRows) {
    if (s.best > 0) stats.bests[s.game_id] = s.best;
    stats.streaks[s.game_id] = { current: s.streak_current, best: s.streak_best, lastDate: s.streak_last_date, bestRun: s.best_run };
  }
  return { id: row.id, name: row.name, avatar: row.avatar, level: bands.fromLegacy(row.band) || bands.ids[0], stats };
}

function list() {
  const db = getDb();
  const stats = new Map();
  for (const s of db.all('SELECT * FROM profile_game_stats')) {
    if (!stats.has(s.profile_id)) stats.set(s.profile_id, []);
    stats.get(s.profile_id).push(s);
  }
  return db.all('SELECT * FROM profiles ORDER BY created_at, rowid').map((r) => shape(r, stats.get(r.id) || []));
}

function get(id) {
  const db = getDb();
  const row = typeof id === 'string' ? db.get('SELECT * FROM profiles WHERE id = ?', id) : null;
  return row ? shape(row, db.all('SELECT * FROM profile_game_stats WHERE profile_id = ?', row.id)) : null;
}

const newId = (db) => {
  let id;
  do id = 'p_' + crypto.randomBytes(4).toString('hex');
  while (db.get('SELECT 1 AS x FROM profiles WHERE id = ?', id));
  return id;
};

function upsert({ id, name, avatar, level }) {
  const db = getDb();
  const n = clean(name, 14);
  if (!n) return null;
  const band = bands.fromLegacy(level) || bands.ids[0];
  const av = Number.isInteger(avatar) && avatar >= 0 && avatar < 12 ? avatar : 0;
  const now = new Date().toISOString();
  return db.transaction(() => {
    const existing = id ? db.get('SELECT id FROM profiles WHERE id = ?', id) : null;
    if (existing) {
      const clash = db.get('SELECT id FROM profiles WHERE name = ? COLLATE NOCASE AND id <> ?', n, existing.id);
      if (clash) return null; // that name belongs to someone else
      db.run('UPDATE profiles SET name = ?, avatar = ?, band = ?, updated_at = ? WHERE id = ?', n, av, band, now, existing.id);
      return get(existing.id);
    }
    if (!id) {
      // Same name and no id: hand back the existing profile untouched instead of rewriting it.
      const same = db.get('SELECT id FROM profiles WHERE name = ? COLLATE NOCASE', n);
      if (same) return get(same.id);
    } else if (db.get('SELECT 1 AS x FROM profiles WHERE name = ? COLLATE NOCASE', n)) {
      return get(db.get('SELECT id FROM profiles WHERE name = ? COLLATE NOCASE', n).id);
    }
    const pid = newId(db);
    db.run('INSERT INTO profiles (id, name, avatar, band, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)', pid, n, av, band, now, now);
    return get(pid);
  });
}

// Records one mini-game result: updates the personal best and the daily streak, and keeps the score for history.
//
// Options for results that were saved offline and sent later:
//   runId     a unique id made on the device. Sending the same runId again changes nothing (the result is not counted twice).
//   playedAt  when the game was really played (ISO date). Accepted if it is within the last 45 days and not in the future;
//             otherwise "now" is used. The streak follows the day it was played, and a result from before the latest streak
//             day adds to the best and play count without touching the streak.
function record(id, gameId, score, runStreak = 0, mode = 'solo', { runId, playedAt } = {}) {
  if (!isGameId(gameId)) return null;
  const db = getDb();
  const s = Math.max(0, Math.round(Number(score) || 0));
  const run = Math.max(0, Math.round(Number(runStreak) || 0));
  const rid = typeof runId === 'string' && /^[\w-]{1,64}$/.test(runId) ? runId : null;
  let when = Date.now();
  const claimed = Date.parse(playedAt);
  if (Number.isFinite(claimed) && claimed <= Date.now() + 3600000 && claimed >= Date.now() - 45 * 86400000) when = claimed;
  const atDay = new Date(when).toISOString().slice(0, 10);
  const dayBefore = new Date(when - 86400000).toISOString().slice(0, 10);
  return db.transaction(() => {
    if (!db.get('SELECT 1 AS x FROM profiles WHERE id = ?', id)) return null;
    const st = db.get('SELECT * FROM profile_game_stats WHERE profile_id = ? AND game_id = ?', id, gameId) || { best: 0, plays: 0, streak_current: 0, streak_best: 0, streak_last_date: null, best_run: 0 };
    if (rid && db.get('SELECT 1 AS x FROM scores WHERE profile_id = ? AND run_id = ?', id, rid)) {
      return { profile: get(id), isNewBest: false, prevBest: st.best, duplicate: true };
    }
    const prevBest = st.best;
    const isNewBest = s > 0 && s > prevBest;
    let current = st.streak_current;
    let lastDate = st.streak_last_date;
    if (!lastDate || atDay > lastDate) {
      current = lastDate === dayBefore ? current + 1 : 1;
      lastDate = atDay;
    }
    db.run(
      `INSERT INTO profile_game_stats (profile_id, game_id, best, plays, streak_current, streak_best, streak_last_date, best_run)
       VALUES (?, ?, ?, 1, ?, ?, ?, ?)
       ON CONFLICT (profile_id, game_id) DO UPDATE SET best = excluded.best, plays = plays + 1, streak_current = excluded.streak_current,
         streak_best = excluded.streak_best, streak_last_date = excluded.streak_last_date, best_run = excluded.best_run`,
      id, gameId, isNewBest ? s : prevBest, current, Math.max(st.streak_best, current), lastDate, Math.max(st.best_run, run),
    );
    const now = new Date().toISOString();
    db.run('UPDATE profiles SET games_played = games_played + 1, updated_at = ? WHERE id = ?', now, id);
    db.run('INSERT INTO scores (profile_id, game_id, score, mode, played_at, run_id) VALUES (?, ?, ?, ?, ?, ?)', id, gameId, s, mode === 'room' ? 'room' : 'solo', new Date(when).toISOString(), rid);
    return { profile: get(id), isNewBest, prevBest };
  });
}

// Deletes a profile and its personal stats. Results in past games stay, with the name but no link to the profile.
function remove(id) {
  const db = getDb();
  return db.run('DELETE FROM profiles WHERE id = ?', id).changes > 0;
}

function leaderboard(gameId, limit = 10) {
  const n = Math.min(50, Math.max(1, Math.round(Number(limit)) || 10));
  return getDb().all(
    `SELECT p.id, p.name, p.avatar, p.band AS level, s.best
       FROM profile_game_stats s JOIN profiles p ON p.id = s.profile_id
      WHERE s.game_id = ? AND s.best > 0 ORDER BY s.best DESC, p.name LIMIT ?`,
    gameId, n,
  );
}

// ---- export and import of one person's data ---------------------------------------------------------------------------
function exportProfile(id) {
  const db = getDb();
  const p = db.get('SELECT * FROM profiles WHERE id = ?', id);
  if (!p) return null;
  return {
    format: 'openparlor-profile',
    version: 1,
    exportedAt: new Date().toISOString(),
    profile: { id: p.id, name: p.name, avatar: p.avatar, level: p.band, gamesPlayed: p.games_played },
    stats: db.all('SELECT game_id, best, plays, streak_current, streak_best, streak_last_date, best_run FROM profile_game_stats WHERE profile_id = ?', id).map((r) => ({ ...r })),
    scores: db.all('SELECT game_id, score, mode, played_at FROM scores WHERE profile_id = ? ORDER BY played_at', id).map((r) => ({ ...r })),
  };
}

// Adds an exported profile. An existing profile with the same id has its stats merged (best of both); otherwise a new
// profile is created, with a numbered name if the name is taken.
function importProfile(bundle) {
  const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
  if (!isObj(bundle) || bundle.format !== 'openparlor-profile' || bundle.version !== 1 || !isObj(bundle.profile)) return { error: 'This is not an OpenParlor profile export.' };
  const name = clean(bundle.profile.name, 14);
  if (!name) return { error: 'The export has no name.' };
  const stats = Array.isArray(bundle.stats) ? bundle.stats.slice(0, 50) : [];
  const scores = Array.isArray(bundle.scores) ? bundle.scores.slice(0, 5000) : [];
  const int = (v) => Math.max(0, Math.round(Number(v)) || 0);
  const db = getDb();
  const now = new Date().toISOString();
  const pid = db.transaction(() => {
    let target = typeof bundle.profile.id === 'string' && ID_RE.test(bundle.profile.id) ? db.get('SELECT id FROM profiles WHERE id = ?', bundle.profile.id) : null;
    let id;
    if (target) {
      id = target.id;
    } else {
      let unique = name;
      for (let i = 2; db.get('SELECT 1 AS x FROM profiles WHERE name = ? COLLATE NOCASE', unique); i++) unique = `${name.slice(0, 12)} ${i}`;
      id = newId(db);
      const band = bands.fromLegacy(bundle.profile.level) || bands.ids[0];
      const av = Number.isInteger(bundle.profile.avatar) && bundle.profile.avatar >= 0 && bundle.profile.avatar < 12 ? bundle.profile.avatar : 0;
      db.run('INSERT INTO profiles (id, name, avatar, band, games_played, created_at, updated_at) VALUES (?, ?, ?, ?, 0, ?, ?)', id, unique, av, band, now, now);
    }
    for (const s of stats) {
      if (!isObj(s) || !isGameId(s.game_id)) continue;
      db.run(
        `INSERT INTO profile_game_stats (profile_id, game_id, best, plays, streak_current, streak_best, streak_last_date, best_run)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT (profile_id, game_id) DO UPDATE SET best = MAX(best, excluded.best), plays = MAX(plays, excluded.plays),
           streak_best = MAX(streak_best, excluded.streak_best), best_run = MAX(best_run, excluded.best_run)`,
        id, s.game_id, int(s.best), int(s.plays), int(s.streak_current), int(s.streak_best), typeof s.streak_last_date === 'string' ? s.streak_last_date : null, int(s.best_run),
      );
    }
    for (const sc of scores) {
      if (!isObj(sc) || !isGameId(sc.game_id) || typeof sc.played_at !== 'string') continue;
      if (db.get('SELECT 1 AS x FROM scores WHERE profile_id = ? AND game_id = ? AND score = ? AND played_at = ?', id, sc.game_id, int(sc.score), sc.played_at)) continue;
      db.run('INSERT INTO scores (profile_id, game_id, score, mode, played_at) VALUES (?, ?, ?, ?, ?)', id, sc.game_id, int(sc.score), sc.mode === 'room' ? 'room' : 'solo', sc.played_at);
    }
    db.run('UPDATE profiles SET games_played = MAX(games_played, ?), updated_at = ? WHERE id = ?', int(bundle.profile.gamesPlayed), now, id);
    return id;
  });
  return { profile: get(pid) };
}

module.exports = { list, get, upsert, record, remove, leaderboard, exportProfile, importProfile, registerGameIds, isGameId, ID_RE };
