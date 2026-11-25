// Finds the mini-games: small client-side games for the Mini-Games game and Solo Practice. Each is a folder with a
// minigame.json manifest and a client.js that exports start(ctx). Built-in ones live in minigames/, your own in
// plugins/<name>/ (or PLUGINS_DIR). See docs/GAME-SDK.md.
const fs = require('fs');
const path = require('path');
const { config } = require('../config');
const profiles = require('../profiles');

const ROOT = path.join(__dirname, '..', '..');
const ID_RE = /^[a-z][a-z0-9-]{1,29}$/;
const GROUPS = ['brain', 'speed', 'other'];
const isStr = (v) => typeof v === 'string' && v.trim().length > 0;
const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

function check(m, where, report) {
  const bad = (msg) => (report(where, msg), null);
  if (!isObj(m)) return bad('minigame.json must be a JSON object');
  if (m.sdk !== 1) return bad('needs "sdk": 1');
  if (typeof m.id !== 'string' || !ID_RE.test(m.id)) return bad('needs an "id" of lowercase letters, numbers and - (2 to 30, starting with a letter)');
  if (!isStr(m.name) || m.name.length > 40) return bad('needs a "name" (up to 40 characters)');
  if (!isStr(m.howto) || m.howto.length > 500) return bad('needs "howto": a short explanation of how to play (up to 500 characters)');
  if (!Number.isInteger(m.duration) || m.duration < 10 || m.duration > 300) return bad('needs "duration", the seconds a round lasts (10 to 300)');
  if (!Number.isInteger(m.max) || m.max < 100 || m.max > 100000) return bad('needs "max", the highest score a round can give (100 to 100000)');
  const client = m.client === undefined ? 'client.js' : m.client;
  if (!isStr(client) || path.isAbsolute(client) || client.split(/[\\/]/).includes('..') || !/\.js$/.test(client)) return bad('"client" must be a .js path inside the folder');
  return {
    id: m.id,
    name: m.name.trim(),
    desc: isStr(m.description) ? m.description.trim().slice(0, 200) : '',
    howto: m.howto.trim(),
    duration: m.duration,
    max: m.max,
    group: GROUPS.includes(m.group) ? m.group : 'other',
    order: Number.isInteger(m.order) ? m.order : 100,
    client,
  };
}

function load(log = console.error) {
  const problems = [];
  const report = (where, msg) => {
    problems.push(`${where}: ${msg}`);
    log(`[minigames] ${where}: ${msg}`);
  };
  const dirs = [{ dir: path.join(ROOT, 'minigames'), source: 'built-in' }];
  if (config.plugins.enabled) dirs.push({ dir: path.resolve(process.env.PLUGINS_DIR || path.join(ROOT, 'plugins')), source: 'plugin' });
  const found = [];
  for (const { dir, source } of dirs) {
    let names;
    try {
      names = fs.readdirSync(dir, { withFileTypes: true }).filter((d) => d.isDirectory() && !d.name.startsWith('.')).map((d) => d.name).sort();
    } catch {
      continue;
    }
    for (const name of names) {
      const mdir = path.join(dir, name);
      const where = `${source} ${name}`;
      let raw;
      try {
        raw = fs.readFileSync(path.join(mdir, 'minigame.json'), 'utf8');
      } catch {
        continue; // not a mini-game folder
      }
      let json;
      try {
        json = JSON.parse(raw);
      } catch (e) {
        report(where, `minigame.json is not valid JSON (${e.message})`);
        continue;
      }
      const m = check(json, where, report);
      if (!m) continue;
      if (m.id !== name) {
        report(where, `the folder name must match the mini-game id "${m.id}"`);
        continue;
      }
      if (!fs.existsSync(path.join(mdir, m.client))) {
        report(where, `${m.client} does not exist`);
        continue;
      }
      found.push({ ...m, dir: mdir, source, url: `/mini/${m.id}/${m.client}` });
    }
  }
  found.sort((a, b) => a.order - b.order || a.id.localeCompare(b.id));
  const byId = Object.create(null);
  for (const m of found) {
    if (byId[m.id]) report(`${m.source} ${m.id}`, `the id "${m.id}" is already used by another mini-game and was skipped`);
    else byId[m.id] = m;
  }
  profiles.registerGameIds(Object.keys(byId)); // scores and leaderboards accept exactly these games
  return { byId, list: Object.values(byId), problems };
}

module.exports = load();
