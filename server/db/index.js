// Opens the database once (data/openparlor.db), runs any pending migrations, and imports old JSON data.
const path = require('path');
const { config } = require('../config');
const driver = require('./driver');
const { migrate } = require('./migrate');

let db = null;

function getDb() {
  if (db) return db;
  const opened = driver.open(path.join(config.dataDir, 'openparlor.db'));
  try {
    const ran = migrate(opened);
    if (ran.length) console.log(`[db] applied ${ran.join(', ')}`);
    require('./legacy-import').importLegacy(opened);
  } catch (err) {
    opened.close();
    throw err;
  }
  db = opened;
  return db;
}

function closeDb() {
  if (db) db.close();
  db = null;
}

module.exports = { getDb, closeDb };
