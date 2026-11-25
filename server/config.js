// Configuration: config/default.json, then a preset from config/presets/, then config/local.json (not committed),
// then environment variables. A bad file is reported and skipped; it never stops the server from starting.
const fs = require('fs');
const path = require('path');

const DIR = process.env.CONFIG_DIR || path.join(__dirname, '..', 'config');
const TIERS = ['easy', 'medium', 'hard'];
const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const problems = [];
const warn = (file, msg) => {
  problems.push(`${file}: ${msg}`);
  console.error(`[config] ${file}: ${msg}`);
};

function readJson(...parts) {
  const file = path.join(DIR, ...parts);
  let raw;
  try {
    raw = fs.readFileSync(file, 'utf8');
  } catch (e) {
    if (e.code !== 'ENOENT') warn(parts.join('/'), `cannot be read (${e.message})`);
    return null;
  }
  try {
    return JSON.parse(raw);
  } catch (e) {
    warn(parts.join('/'), `is not valid JSON (${e.message})`);
    return null;
  }
}

function merge(base, extra) {
  if (!isObj(extra)) return base;
  const out = { ...base };
  for (const [k, v] of Object.entries(extra)) out[k] = isObj(v) && isObj(base[k]) ? merge(base[k], v) : v;
  return out;
}

// Bands are the groups players choose from (for example Kid, Teen, Adult). Each maps to a difficulty tier of 1 to 3.
function cleanBands(list) {
  if (!Array.isArray(list)) return null;
  const seen = new Set();
  const out = [];
  for (const b of list) {
    const ok = isObj(b) && typeof b.id === 'string' && /^[a-z0-9_-]{1,24}$/.test(b.id) && typeof b.label === 'string' && b.label.trim() && Number.isInteger(b.tier) && b.tier >= 1 && b.tier <= 3 && !seen.has(b.id);
    if (!ok) {
      warn('bands', `ignored an invalid band: ${JSON.stringify(b)}`);
      continue;
    }
    seen.add(b.id);
    out.push({ id: b.id, label: b.label.trim().slice(0, 30), hint: typeof b.hint === 'string' ? b.hint.slice(0, 60) : '', tier: b.tier });
  }
  return out.length ? out : null;
}

function load() {
  let cfg = merge({}, readJson('default.json') || {});
  const clean = (v) => String(v || '').replace(/[^a-z0-9_-]/gi, '');
  const local = readJson('local.json');
  // The environment wins over config/local.json, which wins over default.json.
  let wanted = clean(process.env.PRESET) || clean(local && local.preset) || clean(cfg.preset) || 'family';
  let preset = readJson('presets', `${wanted}.json`);
  if (!preset) {
    if (wanted !== 'family') warn(`presets/${wanted}.json`, 'not found, using the family preset');
    wanted = 'family';
    preset = readJson('presets', 'family.json') || {};
  }
  cfg = merge(cfg, preset);
  cfg = merge(cfg, local);
  cfg.preset = wanted;

  const env = process.env;
  if (env.MAX_ROOMS) cfg.limits.maxRooms = Number(env.MAX_ROOMS) || cfg.limits.maxRooms;
  if (env.MAX_CONNECTIONS) cfg.limits.maxConnections = Number(env.MAX_CONNECTIONS) || cfg.limits.maxConnections;
  if (env.MAX_PLAYERS !== undefined && env.MAX_PLAYERS !== '') cfg.limits.maxPlayers = Math.max(0, Number(env.MAX_PLAYERS) || 0);

  // Where profiles and records are saved. DATA_DIR overrides it (the tests use a temporary folder).
  cfg.dataDir = path.resolve(env.DATA_DIR || cfg.dataDir || path.join(__dirname, '..', 'data'));
  cfg.bands = cleanBands(cfg.bands) || [{ id: 'everyone', label: 'Everyone', hint: '', tier: 2 }];
  if (!isObj(cfg.gameDefaults)) cfg.gameDefaults = {};
  cfg.plugins = merge({ enabled: true }, cfg.plugins);
  cfg.brand = merge({ name: 'OpenParlor', tagline: '', accent: null }, cfg.brand);
  return cfg;
}

const config = load();

// ---- bands -----------------------------------------------------------------------------------------------------------
const bandIds = config.bands.map((b) => b.id);
const bands = {
  list: () => config.bands,
  ids: bandIds,
  isBand: (id) => typeof id === 'string' && bandIds.includes(id),
  get: (id) => config.bands.find((b) => b.id === id) || null,
  // 'easy', 'medium' or 'hard': what games use to pick content and difficulty. Unknown or empty means the hardest tier.
  tierName: (id) => {
    const b = config.bands.find((x) => x.id === id);
    return TIERS[(b ? b.tier : 3) - 1];
  },
  tierNumber: (id) => {
    const b = config.bands.find((x) => x.id === id);
    return b ? b.tier : 3;
  },
  // Maps the old fixed ids (kid, teen, grownup) from saved data onto this configuration's bands.
  fromLegacy: (id) => {
    if (bandIds.includes(id)) return id;
    const tier = { kid: 1, teen: 2, grownup: 3 }[id];
    const hit = tier && config.bands.find((b) => b.tier === tier);
    return hit ? hit.id : null;
  },
  // The text shown for a tier, for example "Kid" or "Kid / Teen" when two bands share it.
  tierLabel: (tierName) => {
    const n = TIERS.indexOf(tierName) + 1;
    const names = config.bands.filter((b) => b.tier === n).map((b) => b.label);
    return names.length ? names.join(' / ') : tierName;
  },
};

// What the browser may know. Nothing private belongs here.
function publicConfig() {
  return {
    brand: config.brand,
    language: config.language,
    preset: config.preset,
    bands: config.bands,
    host: { allowClaim: !!config.host.allowClaim },
    profiles: { enabled: !!config.profiles.enabled },
  };
}

module.exports = { config, bands, publicConfig, problems, TIERS };
