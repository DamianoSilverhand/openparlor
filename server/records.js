// Group records for "play together" mini-games, kept in the database.
const { getDb } = require('./db');

function get(key) {
  const r = getDb().get('SELECT total, date FROM records WHERE key = ?', key);
  return r ? { total: r.total, date: r.date } : null;
}

// key is "game:players:handicap", for example "memory:4:on".
function save(key, total) {
  const [game, players, handicap] = String(key).split(':');
  getDb().run(
    `INSERT INTO records (key, game_id, players, handicap, total, date) VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT (key) DO UPDATE SET total = excluded.total, date = excluded.date`,
    key, game, Number(players) || 0, handicap || 'on', Math.max(0, Math.round(total)), new Date().toISOString().slice(0, 10),
  );
}

const all = () => getDb().all('SELECT key, game_id, players, handicap, total, date FROM records ORDER BY game_id, players').map((r) => ({ ...r }));

module.exports = { get, save, all };
