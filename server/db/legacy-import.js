// One-time import of the JSON files used before the database existed (data/profiles.json and data/records.json).
// Safe to run more than once: rows that already exist are skipped. After a successful import the files are renamed
// to *.imported, never deleted.
const fs = require('fs');
const path = require('path');
const { config, bands } = require('../config');

const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const int = (v, d = 0) => (Number.isFinite(Number(v)) ? Math.max(0, Math.round(Number(v))) : d);

function readJson(file) {
  let raw;
  try {
    raw = fs.readFileSync(file, 'utf8');
  } catch (e) {
    if (e.code !== 'ENOENT') console.error(`[db] cannot read ${file}: ${e.message}`);
    return null;
  }
  try {
    return JSON.parse(raw);
  } catch (e) {
    console.error(`[db] ${file} is not valid JSON and was not imported: ${e.message}`);
    return null;
  }
}

function importProfiles(db, file) {
  const data = readJson(file);
  if (!data) return null;
  const list = isObj(data) && Array.isArray(data.profiles) ? data.profiles : null;
  if (!list) {
    console.error(`[db] ${file} has no "profiles" list and was not imported`);
    return null;
  }
  let added = 0;
  const now = new Date().toISOString();
  db.transaction(() => {
    for (const p of list) {
      if (!isObj(p) || typeof p.id !== 'string' || typeof p.name !== 'string' || !p.name.trim()) continue;
      if (db.get('SELECT 1 AS x FROM profiles WHERE id = ?', p.id)) continue;
      let name = p.name.trim().slice(0, 14);
      for (let i = 2; db.get('SELECT 1 AS x FROM profiles WHERE name = ? COLLATE NOCASE', name); i++) name = `${p.name.trim().slice(0, 12)} ${i}`;
      const stats = isObj(p.stats) ? p.stats : {};
      db.run(
        'INSERT INTO profiles (id, name, avatar, band, games_played, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
        p.id, name, Math.min(11, int(p.avatar)), bands.fromLegacy(p.level) || bands.ids[0], int(stats.gamesPlayed), now, now,
      );
      const bests = isObj(stats.bests) ? stats.bests : {};
      const streaks = isObj(stats.streaks) ? stats.streaks : {};
      for (const game of new Set([...Object.keys(bests), ...Object.keys(streaks)])) {
        const st = isObj(streaks[game]) ? streaks[game] : {};
        db.run(
          'INSERT OR IGNORE INTO profile_game_stats (profile_id, game_id, best, plays, streak_current, streak_best, streak_last_date, best_run) VALUES (?, ?, ?, 0, ?, ?, ?, ?)',
          p.id, game, int(bests[game]), int(st.current), int(st.best), typeof st.lastDate === 'string' ? st.lastDate : null, int(st.bestRun),
        );
      }
      added++;
    }
  });
  return added;
}

function importRecords(db, file) {
  const data = readJson(file);
  if (!isObj(data)) return data === null ? null : 0;
  let added = 0;
  db.transaction(() => {
    for (const [rawKey, v] of Object.entries(data)) {
      if (!isObj(v)) continue;
      // Older keys ended with a content setting ("...:off"). Keep the ones with it off, drop the rest.
      let key = rawKey;
      if (/:(on|off):(off|mixed|only)$/.test(key)) {
        if (!key.endsWith(':off')) continue;
        key = key.replace(/:off$/, '');
      }
      const [game, count, handicap] = key.split(':');
      if (!game || !Number.isInteger(Number(count)) || !['on', 'off'].includes(handicap)) continue;
      // If two old keys map to the same new one, the higher total wins.
      const res = db.run('INSERT INTO records (key, game_id, players, handicap, total, date) VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT (key) DO UPDATE SET total = MAX(total, excluded.total), date = CASE WHEN excluded.total > total THEN excluded.date ELSE date END', key, game, Number(count), handicap, int(v.total), typeof v.date === 'string' ? v.date : new Date().toISOString().slice(0, 10));
      added += res.changes;
    }
  });
  return added;
}

function importLegacy(db) {
  for (const [name, fn] of [['profiles.json', importProfiles], ['records.json', importRecords]]) {
    const file = path.join(config.dataDir, name);
    if (!fs.existsSync(file)) continue;
    const added = fn(db, file);
    if (added === null) continue; // unreadable: leave the file alone
    try {
      fs.renameSync(file, `${file}.imported`);
    } catch {}
    console.log(`[db] imported ${added} ${name === 'profiles.json' ? 'profile(s)' : 'record(s)'} from ${name} (kept as ${name}.imported)`);
  }
}

module.exports = { importLegacy };
