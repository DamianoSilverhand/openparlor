// Applies the numbered .sql files in server/db/migrations/ that have not run yet, each in its own transaction.
// A migration never changes after release: later changes are new files.
const fs = require('fs');
const path = require('path');

const DIR = path.join(__dirname, 'migrations');

function available() {
  return fs
    .readdirSync(DIR)
    .filter((f) => /^\d+_.+\.sql$/.test(f))
    .sort()
    .map((f) => ({ version: Number(f.split('_')[0]), name: f.replace(/\.sql$/, ''), file: path.join(DIR, f) }));
}

function migrate(db) {
  db.exec('CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY, name TEXT NOT NULL, applied_at TEXT NOT NULL)');
  const known = available();
  const applied = new Set(db.all('SELECT version FROM schema_migrations').map((r) => r.version));
  const newest = Math.max(0, ...known.map((m) => m.version));
  const dbNewest = Math.max(0, ...applied);
  if (dbNewest > newest) {
    throw new Error(`This database was made by a newer version of the app (schema ${dbNewest}, this version knows ${newest}). Update the app or use a different data folder.`);
  }
  const ran = [];
  for (const m of known) {
    if (applied.has(m.version)) continue;
    db.transaction(() => {
      db.exec(fs.readFileSync(m.file, 'utf8'));
      db.run('INSERT INTO schema_migrations (version, name, applied_at) VALUES (?, ?, ?)', m.version, m.name, new Date().toISOString());
    });
    ran.push(m.name);
  }
  return ran;
}

module.exports = { migrate, available };
