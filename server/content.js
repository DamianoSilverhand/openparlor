// Safe loading and checking of the JSON content packs.
//
// A bad pack must never stop the server from starting. Every file is read inside try/catch, each item is checked,
// and anything invalid is dropped with a message that names the file and the item. `npm run validate` runs the same
// checks and exits with an error code, so a broken pack fails CI.
const fs = require('fs');
const path = require('path');

const DIR = process.env.CONTENT_DIR || path.join(__dirname, '..', 'content');
const isStr = (v) => typeof v === 'string' && v.trim().length > 0;
const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const BANDS = ['kid', 'teen', 'grownup'];

function readJson(file, { optional = false } = {}, report = () => {}) {
  let raw;
  try {
    raw = fs.readFileSync(path.join(DIR, file), 'utf8');
  } catch (e) {
    if (!(optional && e.code === 'ENOENT')) report(file, e.code === 'ENOENT' ? 'file not found' : `cannot be read (${e.message})`);
    return null;
  }
  try {
    return JSON.parse(raw);
  } catch (e) {
    report(file, `is not valid JSON (${e.message})`);
    return null;
  }
}

// ---- checkers: each returns the cleaned data and calls report(file, message) for every problem ------------------------
function checkQuestions(json, file, report, { strict = true } = {}) {
  const src = isObj(json) && isObj(json.categories) ? json.categories : null;
  if (!src) {
    if (json !== null) report(file, 'needs a "categories" object');
    return {};
  }
  const out = {};
  for (const [id, cat] of Object.entries(src)) {
    if (!isObj(cat) || !Array.isArray(cat.questions)) {
      report(file, `category "${id}" needs a "questions" list`);
      continue;
    }
    const questions = cat.questions.filter((x, i) => checkQuestion(x, `${file} ${id}[${i}]`, report, strict));
    if (questions.length) out[id] = { ...cat, name: isStr(cat.name) ? cat.name : id, questions };
    else report(file, `category "${id}" has no valid questions and was skipped`);
  }
  return out;
}

function checkQuestion(x, where, report, strict = true) {
  const bad = (m) => (report(where, m), false);
  if (!isObj(x)) return bad('is not an object');
  if (!isStr(x.q)) return bad('needs a question text "q"');
  if (!isStr(x.a)) return bad('needs a right answer "a"');
  if (!Array.isArray(x.w) || !x.w.every(isStr)) return bad('needs a list of wrong answers "w"');
  if (strict && x.w.length !== 3) return bad('needs exactly three wrong answers');
  const all = [x.a, ...x.w].map((s) => s.trim().toLowerCase());
  if (new Set(all).size !== all.length) return bad('has a repeated answer option');
  if (strict && ![1, 2, 3].includes(x.d)) return bad('needs a difficulty "d" of 1, 2 or 3');
  return true;
}

function checkPrompts(json, file, report) {
  const src = isObj(json) && isObj(json.packs) ? json.packs : null;
  if (!src) {
    if (json !== null) report(file, 'needs a "packs" object');
    return {};
  }
  const out = {};
  for (const [id, pack] of Object.entries(src)) {
    const list = isObj(pack) && Array.isArray(pack.prompts) ? pack.prompts.filter(isStr) : [];
    if (!list.length) report(file, `pack "${id}" has no usable "prompts" and was skipped`);
    else out[id] = { ...pack, name: isStr(pack.name) ? pack.name : id, prompts: list };
  }
  return out;
}

function checkWords(json, file, report) {
  const src = isObj(json) && isObj(json.packs) ? json.packs : null;
  if (!src) {
    if (json !== null) report(file, 'needs a "packs" object');
    return {};
  }
  const out = {};
  for (const [id, pack] of Object.entries(src)) {
    const tiers = {};
    for (const t of ['easy', 'medium', 'hard']) tiers[t] = isObj(pack) && Array.isArray(pack[t]) ? pack[t].filter(isStr) : [];
    if (!tiers.easy.length && !tiers.medium.length && !tiers.hard.length) report(file, `pack "${id}" has no words and was skipped`);
    else out[id] = { ...pack, ...tiers, name: isStr(pack.name) ? pack.name : id };
  }
  return out;
}

// Word lists keyed by band: { kid: [...], teen: [...], grownup: [...] }.
function checkBands(json, file, report, item, requireAll = true) {
  if (!isObj(json)) {
    if (json !== null) report(file, 'needs an object keyed by kid, teen and grownup');
    return null;
  }
  let any = false;
  for (const b of BANDS) {
    if (!Array.isArray(json[b]) || !json[b].length) {
      if (requireAll) report(file, `needs a non-empty "${b}" list`);
      continue;
    }
    any = true;
    json[b].forEach((x, i) => item(x) || report(`${file} ${b}[${i}]`, 'is not valid'));
  }
  if (!any && !requireAll) report(file, 'has no word lists');
  return json;
}
const checkLiteracy = (json, file, report) => checkBands(json, file, report, (x) => isObj(x) && isStr(x.q) && isStr(x.a) && Array.isArray(x.w) && x.w.length >= 2 && x.w.every(isStr));
const checkScramble = (json, file, report, _strict, requireAll = true) => checkBands(json, file, report, (x) => isObj(x) && isStr(x.w) && isStr(x.c) && !x.c.toLowerCase().includes(x.w.toLowerCase()), requireAll);

// ---- loading for the server ---------------------------------------------------------------------------------------------
const problems = [];
const warn = (where, msg) => {
  problems.push(`${where}: ${msg}`);
  console.error(`[content] ${where}: ${msg}`);
};

const loaded = {
  questions: checkQuestions(readJson('questions.json', {}, warn), 'questions.json', warn),
  prompts: checkPrompts(readJson('prompts.json', {}, warn), 'prompts.json', warn),
  words: checkWords(readJson('words.json', {}, warn), 'words.json', warn),
};
const fam = readJson('family-questions.json', { optional: true }, warn);
loaded.family = fam && Array.isArray(fam.questions) ? fam.questions.filter((x, i) => checkQuestion(x, `family-questions.json[${i}]`, warn, false)) : [];

// ---- full check for `npm run validate` ---------------------------------------------------------------------------------
function validateAll() {
  const found = [];
  const report = (where, msg) => found.push(`${where}: ${msg}`);
  const dropped = (fn, file, strict) => {
    const json = readJson(file, {}, report);
    return json === null ? null : fn(json, file, report, strict);
  };
  const countQ = (cats) => Object.values(cats || {}).reduce((n, c) => n + c.questions.length, 0);
  const summary = [];
  const q = dropped(checkQuestions, 'questions.json');
  if (q) summary.push(`questions.json: ${Object.keys(q).length} topics, ${countQ(q)} questions`);
  const p = dropped(checkPrompts, 'prompts.json');
  if (p) summary.push(`prompts.json: ${Object.keys(p).length} packs, ${Object.values(p).reduce((n, x) => n + x.prompts.length, 0)} prompts`);
  const w = dropped(checkWords, 'words.json');
  if (w) summary.push(`words.json: ${Object.keys(w).length} packs`);
  const fq = readJson('family-questions.json', { optional: true }, report);
  if (fq && Array.isArray(fq.questions)) fq.questions.forEach((x, i) => checkQuestion(x, `family-questions.json[${i}]`, report, false));
  dropped(checkLiteracy, 'literacy.json');
  dropped(checkScramble, 'scramble.json');
  let langs = [];
  try {
    langs = fs.readdirSync(path.join(DIR, 'lang')).filter((f) => f.endsWith('.json'));
  } catch {}
  for (const f of langs) {
    const d = readJson(path.join('lang', f), {}, report);
    if (isObj(d) && isObj(d.scramble)) checkScramble(d.scramble, `lang/${f} scramble`, report, true, false);
  }
  return { problems: found, summary };
}

module.exports = { ...loaded, problems, validateAll, DIR };
