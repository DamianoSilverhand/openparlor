// Finds and loads games. Each game is a folder with a game.json manifest, a server.js and a public/ folder holding its
// TV and phone screens. Built-in games live in games/, your own in plugins/ (or PLUGINS_DIR). See docs/GAME-SDK.md.
//
// A game that fails to load is reported and skipped. It never stops the server from starting.
const fs = require('fs');
const path = require('path');
const { config } = require('../config');
const sdk = require('./index');

const ROOT = path.join(__dirname, '..', '..');
const ID_RE = /^[a-z][a-z0-9-]{1,29}$/;
const SDK_VERSION = 1;
const isStr = (v) => typeof v === 'string' && v.trim().length > 0;
const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const safeRel = (p, ext) => isStr(p) && !path.isAbsolute(p) && !p.split(/[\\/]/).includes('..') && ext.test(p);

function sources() {
  const list = [{ dir: path.join(ROOT, 'games'), source: 'built-in' }];
  if (config.plugins.enabled) list.push({ dir: path.resolve(process.env.PLUGINS_DIR || path.join(ROOT, 'plugins')), source: 'plugin' });
  return list;
}

function checkManifest(m, where, report) {
  const bad = (msg) => (report(where, msg), null);
  if (!isObj(m)) return bad('game.json must be a JSON object');
  if (m.sdk !== SDK_VERSION) return bad(`needs "sdk": ${SDK_VERSION} (this server runs SDK ${SDK_VERSION}${m.sdk ? `, the game was made for ${m.sdk}` : ''})`);
  if (typeof m.id !== 'string' || !ID_RE.test(m.id)) return bad('needs an "id" of lowercase letters, numbers and - (2 to 30, starting with a letter)');
  if (!isStr(m.name) || m.name.length > 40) return bad('needs a "name" (up to 40 characters)');
  if (!Number.isInteger(m.minPlayers) || m.minPlayers < 1 || m.minPlayers > 100) return bad('needs "minPlayers", a whole number from 1 to 100');
  if (!safeRel(m.tv, /\.js$/) || !safeRel(m.play, /\.js$/)) return bad('needs "tv" and "play": paths of .js files inside the game\'s public/ folder');
  const styles = m.styles === undefined ? [] : m.styles;
  if (!Array.isArray(styles) || !styles.every((s) => safeRel(s, /\.css$/))) return bad('"styles" must be a list of .css paths inside public/');
  const rules = isObj(m.rules) ? m.rules : {};
  return {
    id: m.id,
    name: m.name.trim(),
    desc: isStr(m.description) ? m.description.trim().slice(0, 200) : '',
    minPlayers: m.minPlayers,
    usesLevels: !!m.usesBands,
    levelHint: isStr(m.bandHint) ? m.bandHint : '',
    order: Number.isInteger(m.order) ? m.order : 100,
    rules: Array.isArray(rules.steps) && rules.steps.every(isStr) && rules.steps.length ? { steps: rules.steps, scoring: isStr(rules.scoring) ? rules.scoring : '' } : null,
    tv: m.tv,
    play: m.play,
    styles,
  };
}

function checkOptions(def, where, report) {
  const bad = (msg) => (report(where, msg), false);
  if (!isObj(def.defaults)) return bad('server.js must provide "defaults"');
  if (typeof def.create !== 'function') return bad('server.js must provide "create(room)"');
  const options = typeof def.options === 'function' ? def.options() : def.options || [];
  if (!Array.isArray(options)) return bad('"options" must be a list');
  for (const o of options) {
    if (!isObj(o) || !isStr(o.key) || !isStr(o.label) || !Array.isArray(o.values) || !o.values.length || !o.values.every((v) => Array.isArray(v) && v.length === 2)) return bad(`option ${JSON.stringify(o && o.key)} needs a key, a label and values as [value, label] pairs`);
    if (!(o.key in def.defaults) || !o.values.some(([v]) => v === def.defaults[o.key])) return bad(`the default for option "${o.key}" must be one of its values`);
  }
  def.options = options;
  return true;
}

// Returns { games, problems }. games is a null-prototype map in display order.
function loadGames(log = console.error) {
  const problems = [];
  const report = (where, msg) => {
    problems.push(`${where}: ${msg}`);
    log(`[games] ${where}: ${msg}`);
  };
  const found = [];
  for (const { dir, source } of sources()) {
    let names = [];
    try {
      names = fs.readdirSync(dir, { withFileTypes: true }).filter((d) => d.isDirectory() && !d.name.startsWith('.')).map((d) => d.name).sort();
    } catch {
      continue;
    }
    for (const name of names) {
      const gdir = path.join(dir, name);
      const where = `${source} ${name}`;
      let raw;
      try {
        raw = fs.readFileSync(path.join(gdir, 'game.json'), 'utf8');
      } catch {
        continue; // not a game folder
      }
      let json;
      try {
        json = JSON.parse(raw);
      } catch (e) {
        report(where, `game.json is not valid JSON (${e.message})`);
        continue;
      }
      const manifest = checkManifest(json, where, report);
      if (!manifest) continue;
      if (manifest.id !== name) {
        report(where, `the folder name must match the game id "${manifest.id}"`);
        continue;
      }
      const pub = path.join(gdir, 'public');
      const missing = [manifest.tv, manifest.play, ...manifest.styles].find((f) => !fs.existsSync(path.join(pub, f)));
      if (missing) {
        report(where, `public/${missing} does not exist`);
        continue;
      }
      let mod;
      try {
        mod = require(path.join(gdir, 'server.js'));
        if (typeof mod === 'function') mod = mod(sdk);
      } catch (e) {
        report(where, `server.js failed to load: ${e.message}`);
        continue;
      }
      if (!isObj(mod) || !checkOptions(mod, where, report)) {
        if (!isObj(mod)) report(where, 'server.js must export an object (or a function that returns one)');
        continue;
      }
      found.push({ ...manifest, ...mod, dir: gdir, publicDir: pub, source, client: { tv: manifest.tv, play: manifest.play, styles: manifest.styles } });
    }
  }
  found.sort((a, b) => a.order - b.order || a.id.localeCompare(b.id));
  const games = Object.create(null);
  for (const g of found) {
    if (games[g.id]) report(`${g.source} ${g.id}`, `the id "${g.id}" is already used by another game and was skipped`);
    else games[g.id] = g;
  }
  return { games, problems };
}

module.exports = { loadGames, sources, SDK_VERSION };
