#!/usr/bin/env node
// Writes a backup of the database right now: npm run backup
require('../server/check-node');
const { backupNow } = require('../server/backup');
const { closeDb } = require('../server/db');

const { file } = backupNow({ force: true });
console.log(`Backup written to ${file}`);
closeDb();
