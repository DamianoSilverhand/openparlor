// Safe loading and checking of the JSON content packs.
//
// A bad pack must never stop the server from starting. Every file is read inside try/catch, each item is checked,
// and anything invalid is dropped with a message that names the file and the item. `npm run validate` runs the same
// checks and exits with an error code, so a broken pack fails CI.
//
// Core content lives in content/*.json. Anyone can add more by dropping a file into content/packs/ (see
// docs/CONTENT-PACKS.md): it is merged in at start-up, so no code changes are needed.
const fs = require('fs');
const path = require('path');

const DIR = process.env.CONTENT_DIR || path.join(__dirname, '..', 'content');
const TIERS = ['easy', 'medium', 'hard'];
const isStr = (v) => typeof v === 'string' && v.trim().length > 0;
const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const ID_RE = /^[a-z0-9_-]{1,40}$/;

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

// ---- checkers: each returns the cleaned data and calls report(where, message) for every problem -----------------------
function checkQuestion(x, where, report) {
  const bad = (m) => (report(where, m), false);
  if (!isObj(x)) return bad('is not an object');
  if (!isStr(x.q)) return bad('needs a question text "q"');
  if (!isStr(x.a)) return bad('needs a right answer "a"');
  if (!Array.isArray(x.w) || x.w.length !== 3 || !x.w.every(isStr)) return bad('needs exactly three wrong answers in "w"');
  const all = [x.a, ...x.w].map((s) => s.trim().toLowerCase());
  if (new Set(all).size !== all.length) return bad('has a repeated answer option');
  if (![1, 2, 3].includes(x.d)) return bad('needs a difficulty "d" of 1 (easy), 2 (medium) or 3 (hard)');
  return true;
}

function checkQuestionList(list, where, report) {
  return Array.isArray(list) ? list.filter((x, i) => checkQuestion(x, `${where}[${i}]`, report)) : [];
}

function checkQuestions(json, file, report) {
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
    const questions = checkQuestionList(cat.questions, `${file} ${id}`, report);
    if (questions.length) out[id] = { ...cat, name: isStr(cat.name) ? cat.name : id, questions };
    else report(file, `category "${id}" has no valid questions and was skipped`);
  }
  return out;
}

function checkPromptList(list, where, report) {
  const ok = Array.isArray(list) ? list.filter(isStr) : [];
  if (Array.isArray(list) && ok.length < list.length) report(where, `${list.length - ok.length} prompt(s) are not text and were skipped`);
  return ok;
}

function checkPrompts(json, file, report) {
  const src = isObj(json) && isObj(json.packs) ? json.packs : null;
  if (!src) {
    if (json !== null) report(file, 'needs a "packs" object');
    return {};
  }
  const out = {};
  for (const [id, pack] of Object.entries(src)) {
    const prompts = checkPromptList(isObj(pack) ? pack.prompts : null, `${file} ${id}`, report);
    if (prompts.length) out[id] = { ...pack, name: isStr(pack.name) ? pack.name : id, prompts };
    else report(file, `pack "${id}" has no usable "prompts" and was skipped`);
  }
  return out;
}

function checkWordPack(pack) {
  const tiers = {};
  for (const t of TIERS) tiers[t] = isObj(pack) && Array.isArray(pack[t]) ? pack[t].filter(isStr) : [];
  return tiers.easy.length + tiers.medium.length + tiers.hard.length ? tiers : null;
}

function checkWords(json, file, report) {
  const src = isObj(json) && isObj(json.packs) ? json.packs : null;
  if (!src) {
    if (json !== null) report(file, 'needs a "packs" object');
    return {};
  }
  const out = {};
  for (const [id, pack] of Object.entries(src)) {
    const tiers = checkWordPack(pack);
    if (tiers) out[id] = { ...pack, ...tiers, name: isStr(pack.name) ? pack.name : id };
    else report(file, `pack "${id}" has no words and was skipped`);
  }
  return out;
}

// Lists keyed by difficulty tier: { easy: [...], medium: [...], hard: [...] }.
function checkTiers(json, where, report, item, requireAll) {
  if (!isObj(json)) {
    if (json !== null) report(where, 'needs an object keyed by easy, medium and hard');
    return null;
  }
  const out = {};
  for (const t of TIERS) {
    const list = Array.isArray(json[t]) ? json[t] : [];
    if (!list.length && requireAll) report(where, `needs a non-empty "${t}" list`);
    out[t] = list.filter((x, i) => item(x) || (report(`${where} ${t}[${i}]`, 'is not valid'), false));
  }
  return out;
}
const isLiteracy = (x) => isObj(x) && isStr(x.q) && isStr(x.a) && Array.isArray(x.w) && x.w.length >= 2 && x.w.every(isStr);
const isScramble = (x) => isObj(x) && isStr(x.w) && isStr(x.c) && !x.c.toLowerCase().includes(x.w.toLowerCase());
const checkLiteracy = (json, where, report, requireAll = true) => checkTiers(json, where, report, isLiteracy, requireAll);
const checkScramble = (json, where, report, requireAll = true) => checkTiers(json, where, report, isScramble, requireAll);

// ---- user packs in content/packs/ --------------------------------------------------------------------------------------
// One file per pack, with a "type": quiz, prompts, words, scramble or literacy. Returns what to merge into each bank.
function checkPack(json, file, report) {
  const bad = (m) => (report(file, m), null);
  if (!isObj(json)) return bad('must be a JSON object');
  const type = json.type;
  if (!['quiz', 'prompts', 'words', 'scramble', 'literacy'].includes(type)) return bad('needs "type": quiz, prompts, words, scramble or literacy');
  const meta = { name: isStr(json.name) ? json.name.trim() : null, mixIn: json.mixIn !== false, license: isStr(json.license) ? json.license : undefined, source: file };
  if (type === 'scramble' || type === 'literacy') {
    const key = type === 'scramble' ? 'words' : 'questions';
    const data = (type === 'scramble' ? checkScramble : checkLiteracy)(json[key], file, report, false);
    return data && TIERS.some((t) => data[t].length) ? { type, data } : bad(`needs a "${key}" object with easy, medium or hard lists`);
  }
  if (typeof json.id !== 'string' || !ID_RE.test(json.id)) return bad('needs an "id" of lowercase letters, numbers, - or _ (up to 40)');
  if (!meta.name) return bad('needs a "name"');
  if (type === 'quiz') {
    const questions = checkQuestionList(json.questions, file, report);
    return questions.length ? { type, id: json.id, data: { ...meta, questions } } : bad('has no valid questions');
  }
  if (type === 'prompts') {
    const prompts = checkPromptList(json.prompts, file, report);
    return prompts.length ? { type, id: json.id, data: { ...meta, prompts } } : bad('has no usable prompts');
  }
  const tiers = checkWordPack(json);
  return tiers ? { type, id: json.id, data: { ...meta, ...tiers } } : bad('has no words');
}

function readPacks(report) {
  let files = [];
  try {
    files = fs.readdirSync(path.join(DIR, 'packs')).filter((f) => f.endsWith('.json')).sort();
  } catch {}
  return files.map((f) => checkPack(readJson(path.join('packs', f), {}, report), `packs/${f}`, report)).filter(Boolean);
}

function mergePacks(banks, packs, report) {
  const into = { quiz: banks.questions, prompts: banks.prompts, words: banks.words };
  for (const p of packs) {
    if (p.type === 'scramble' || p.type === 'literacy') {
      for (const t of TIERS) banks[p.type][t].push(...p.data[t]);
    } else if (into[p.type][p.id]) {
      report(p.data.source, `id "${p.id}" is already used by another pack and was skipped`);
    } else {
      into[p.type][p.id] = p.data;
    }
  }
}

// ---- loading for the server ---------------------------------------------------------------------------------------------
function build(report) {
  const emptyTiers = () => ({ easy: [], medium: [], hard: [] });
  const banks = {
    questions: checkQuestions(readJson('questions.json', {}, report), 'questions.json', report),
    prompts: checkPrompts(readJson('prompts.json', {}, report), 'prompts.json', report),
    words: checkWords(readJson('words.json', {}, report), 'words.json', report),
    scramble: checkScramble(readJson('scramble.json', {}, report), 'scramble.json', report) || emptyTiers(),
    literacy: checkLiteracy(readJson('literacy.json', {}, report), 'literacy.json', report) || emptyTiers(),
  };
  mergePacks(banks, readPacks(report), report);
  return banks;
}

const problems = [];
const warn = (where, msg) => {
  problems.push(`${where}: ${msg}`);
  console.error(`[content] ${where}: ${msg}`);
};
const loaded = build(warn);

// Full check for `npm run validate`: the same code, but every message is collected and returned.
function validateAll() {
  const found = [];
  const b = build((where, msg) => found.push(`${where}: ${msg}`));
  const count = (cats) => Object.values(cats).reduce((n, c) => n + c.questions.length, 0);
  const summary = [
    `quiz: ${Object.keys(b.questions).length} topics, ${count(b.questions)} questions`,
    `prompts: ${Object.keys(b.prompts).length} packs, ${Object.values(b.prompts).reduce((n, p) => n + p.prompts.length, 0)} prompts`,
    `draw words: ${Object.keys(b.words).length} packs`,
    `word builder: ${TIERS.map((t) => `${b.scramble[t].length} ${t}`).join(', ')}`,
    `word match: ${TIERS.map((t) => `${b.literacy[t].length} ${t}`).join(', ')}`,
  ];
  return { problems: found, summary };
}

module.exports = { ...loaded, problems, validateAll, DIR };
