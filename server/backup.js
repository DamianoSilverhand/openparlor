// Daily backups of the database to data/backups/, keeping the most recent few.
const fs = require('fs');
const path = require('path');
const { config } = require('./config');
const { getDb } = require('./db');

const dir = () => path.join(config.dataDir, 'backups');
const PREFIX = 'openparlor-';

// Writes today's backup unless one exists already (or force is true), and deletes the oldest beyond `keep`.
function backupNow({ keep = 7, force = false } = {}) {
  const file = path.join(dir(), `${PREFIX}${new Date().toISOString().slice(0, 10)}.db`);
  let created = false;
  if (force || !fs.existsSync(file)) {
    getDb().backupTo(file);
    created = true;
  }
  const old = fs.readdirSync(dir()).filter((f) => f.startsWith(PREFIX) && f.endsWith('.db')).sort().reverse().slice(keep);
  for (const f of old) fs.rmSync(path.join(dir(), f), { force: true });
  return { file, created };
}

// A backup at start-up and then a check every few hours, so a server left running for days still backs up daily.
function startBackups() {
  const run = () => {
    try {
      const r = backupNow();
      if (r.created) console.log(`[db] backup written: ${r.file}`);
    } catch (err) {
      console.error('[db] backup failed:', err.message);
    }
  };
  run();
  setInterval(run, 6 * 60 * 60 * 1000).unref();
}

module.exports = { backupNow, startBackups };
