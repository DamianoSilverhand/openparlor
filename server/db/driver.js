// The only file that knows which SQLite library is in use (Node's built-in node:sqlite). Everything else talks to
// this small interface, so another driver could replace it without touching the rest of the code.
const fs = require('fs');
const path = require('path');
const { DatabaseSync } = require('node:sqlite');

function open(file) {
  if (file !== ':memory:') fs.mkdirSync(path.dirname(file), { recursive: true });
  const raw = new DatabaseSync(file);
  raw.exec('PRAGMA journal_mode = WAL; PRAGMA synchronous = NORMAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;');
  let depth = 0;
  return {
    file,
    exec: (sql) => raw.exec(sql),
    run: (sql, ...params) => raw.prepare(sql).run(...params),
    get: (sql, ...params) => raw.prepare(sql).get(...params),
    all: (sql, ...params) => raw.prepare(sql).all(...params),
    // Runs fn in a transaction (a savepoint when already inside one). An exception rolls everything back.
    transaction(fn) {
      const name = `sp${depth}`;
      raw.exec(depth === 0 ? 'BEGIN IMMEDIATE' : `SAVEPOINT ${name}`);
      depth++;
      try {
        const result = fn();
        depth--;
        raw.exec(depth === 0 ? 'COMMIT' : `RELEASE ${name}`);
        return result;
      } catch (err) {
        depth--;
        raw.exec(depth === 0 ? 'ROLLBACK' : `ROLLBACK TO ${name}; RELEASE ${name}`);
        throw err;
      }
    },
    // A consistent copy of the whole database, safe to take while the server is running.
    backupTo(dest) {
      fs.mkdirSync(path.dirname(dest), { recursive: true });
      if (fs.existsSync(dest)) fs.rmSync(dest);
      raw.prepare('VACUUM INTO ?').run(dest);
    },
    close: () => raw.close(),
  };
}

module.exports = { open };
