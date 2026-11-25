// Finished room games and each player's result, kept in the database.
const { getDb } = require('./db');

// results: [{ profileId, name, band, score, rank }]
function recordGame({ gameId, roomCode, startedAt, endedAt, settings, results }) {
  const db = getDb();
  return db.transaction(() => {
    const res = db.run(
      'INSERT INTO games (game_id, room_code, started_at, ended_at, player_count, settings) VALUES (?, ?, ?, ?, ?, ?)',
      gameId, roomCode || null, new Date(startedAt).toISOString(), new Date(endedAt).toISOString(), results.length, JSON.stringify(settings || {}),
    );
    const ref = Number(res.lastInsertRowid);
    for (const r of results.slice(0, 500)) {
      // A profile that was deleted in the meantime is stored without a link.
      const pid = r.profileId && db.get('SELECT 1 AS x FROM profiles WHERE id = ?', r.profileId) ? r.profileId : null;
      db.run('INSERT INTO game_results (game_ref, profile_id, name, band, score, rank) VALUES (?, ?, ?, ?, ?, ?)', ref, pid, String(r.name).slice(0, 14), r.band || null, Math.round(r.score) || 0, r.rank);
    }
    return ref;
  });
}

function withResults(games) {
  const db = getDb();
  return games.map((g) => ({
    id: g.id,
    game: g.game_id,
    roomCode: g.room_code,
    startedAt: g.started_at,
    endedAt: g.ended_at,
    players: g.player_count,
    results: db.all('SELECT profile_id AS profileId, name, band, score, rank FROM game_results WHERE game_ref = ? ORDER BY rank, name', g.id).map((r) => ({ ...r })),
  }));
}

function recent(limit = 20) {
  const n = Math.min(100, Math.max(1, Math.round(Number(limit)) || 20));
  return withResults(getDb().all('SELECT * FROM games ORDER BY ended_at DESC, id DESC LIMIT ?', n));
}

function forProfile(profileId, limit = 20) {
  const n = Math.min(100, Math.max(1, Math.round(Number(limit)) || 20));
  return withResults(
    getDb().all('SELECT DISTINCT g.* FROM games g JOIN game_results r ON r.game_ref = g.id WHERE r.profile_id = ? ORDER BY g.ended_at DESC, g.id DESC LIMIT ?', profileId, n),
  );
}

module.exports = { recordGame, recent, forProfile };
