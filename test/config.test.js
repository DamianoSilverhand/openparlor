// Tests for configuration, bands and user content packs (phase 1).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { startServer, createRoom, connect, sleep, ROOT } = require('../test-support/helpers');

const tmp = (t, prefix) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
};

test('/api/config exposes the brand and the family preset bands by default', async (t) => {
  const s = await startServer();
  t.after(() => s.stop());
  const cfg = await (await fetch(`${s.base}/api/config`)).json();
  assert.equal(cfg.brand.name, 'OpenParlor');
  assert.deepEqual(cfg.bands.map((b) => b.id), ['kid', 'teen', 'adult']);
  assert.equal(cfg.preset, 'family');
  assert.equal(cfg.limits, undefined, 'limits are not sent to browsers');
});

test('PRESET=party gives one band, and games start without anyone choosing a level', async (t) => {
  const s = await startServer({ PRESET: 'party' });
  t.after(() => s.stop());
  const cfg = await (await fetch(`${s.base}/api/config`)).json();
  assert.deepEqual(cfg.bands.map((b) => b.id), ['everyone']);
  const code = await createRoom(s.base);
  const host = await connect(s, code, 'Host', { level: undefined });
  await connect(s, code, 'Two', { level: undefined });
  await connect(s, code, 'Three', { level: undefined });
  assert.deepEqual(host.last.waitingOn, [], 'nobody has to pick a band');
  assert.equal(host.last.players[0].level, 'everyone');
  host.send({ t: 'pickGame', id: 'minigames' });
  await sleep(100);
  assert.equal(host.last.settings.handicap, 'off', 'the party preset turns handicaps off');
  for (const id of ['quiz', 'minigames']) {
    host.send({ t: 'pickGame', id });
    await sleep(100);
    host.send({ t: 'start' });
    await sleep(150);
    host.send({ t: 'skipRules' });
    await sleep(250);
    assert.ok(host.last.inGame, `${id} starts with a single band`);
    host.send({ t: 'lobby' });
    await sleep(150);
  }
  assert.ok(await s.alive());
});

test('older saved levels (kid, grownup) map onto the configured bands', async (t) => {
  const s = await startServer();
  t.after(() => s.stop());
  const code = await createRoom(s.base);
  const host = await connect(s, code, 'Host', { level: 'grownup' });
  const kid = await connect(s, code, 'Kiddo', { level: 'kid' });
  const odd = await connect(s, code, 'Odd', { level: 'wizard' });
  assert.equal(host.last.players.find((p) => p.name === 'Host').level, 'adult');
  assert.equal(host.last.players.find((p) => p.name === 'Kiddo').level, 'kid');
  assert.equal(host.last.players.find((p) => p.name === 'Odd').level, null, 'an unknown level is not accepted');
  kid.send({ t: 'level', level: 'teen' });
  await sleep(100);
  assert.equal(host.last.players.find((p) => p.name === 'Kiddo').level, 'teen');
  void odd;
});

test('a bad config file is reported and skipped, never fatal', async (t) => {
  const dir = tmp(t, 'op-config-');
  fs.cpSync(path.join(ROOT, 'config'), dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'local.json'), '{ "brand": ');
  const s = await startServer({ CONFIG_DIR: dir });
  t.after(() => s.stop());
  assert.ok(await s.alive());
  assert.match(s.log(), /local\.json: is not valid JSON/);
  assert.equal((await (await fetch(`${s.base}/api/config`)).json()).brand.name, 'OpenParlor');
});

test('config/local.json can rename the brand and define its own bands', async (t) => {
  const dir = tmp(t, 'op-config-');
  fs.cpSync(path.join(ROOT, 'config'), dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'local.json'), JSON.stringify({ brand: { name: 'Quiz Club', tagline: 'Thursdays' }, bands: [{ id: 'novice', label: 'Novice', tier: 1 }, { id: 'pro', label: 'Pro', tier: 3 }, { id: 'bad id!', label: 'Ignored', tier: 2 }] }));
  const s = await startServer({ CONFIG_DIR: dir });
  t.after(() => s.stop());
  const cfg = await (await fetch(`${s.base}/api/config`)).json();
  assert.equal(cfg.brand.name, 'Quiz Club');
  assert.deepEqual(cfg.bands.map((b) => b.id), ['novice', 'pro'], 'the invalid band is dropped');
  assert.match(s.log(), /ignored an invalid band/);
});

test('the player limit gives extra people the audience, and host-claim can be switched off', async (t) => {
  const dir = tmp(t, 'op-config-');
  fs.cpSync(path.join(ROOT, 'config'), dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'local.json'), JSON.stringify({ host: { allowClaim: false }, limits: { maxPlayers: 2 } }));
  const s = await startServer({ CONFIG_DIR: dir });
  t.after(() => s.stop());
  const code = await createRoom(s.base);
  const host = await connect(s, code, 'Host');
  const guest = await connect(s, code, 'Guest');
  // The player limit applies to seats: the next person joins the audience instead of being turned away.
  const third = await new Promise((resolve, reject) => {
    const WebSocket = require('ws');
    const ws = new WebSocket(`ws://127.0.0.1:${s.port}/ws`);
    ws.on('open', () => ws.send(JSON.stringify({ t: 'join', room: code, name: 'Third', avatar: 1 })));
    ws.on('message', (d) => {
      const m = JSON.parse(d);
      if (m.t === 'welcome') resolve(m);
    });
    setTimeout(() => reject(new Error('no welcome')), 5000);
  });
  assert.equal(third.audience, true, 'no seat left, so they watch');
  await sleep(150);
  assert.equal(host.last.players.length, 2);
  assert.equal(host.last.audienceCount, 1);
  guest.send({ t: 'claimHost' });
  await sleep(150);
  assert.equal(host.last.hostId, host.last.players.find((p) => p.name === 'Host').id, 'claiming host is switched off');
});

test('profiles can be switched off', async (t) => {
  const dir = tmp(t, 'op-config-');
  fs.cpSync(path.join(ROOT, 'config'), dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'local.json'), JSON.stringify({ profiles: { enabled: false } }));
  const s = await startServer({ CONFIG_DIR: dir });
  t.after(() => s.stop());
  assert.equal((await fetch(`${s.base}/api/profiles`)).status, 404);
  assert.equal((await fetch(`${s.base}/api/profiles`, { method: 'POST', body: '{"name":"x"}' })).status, 404);
});

test('the Zambian content and its settings are gone from the defaults', async (t) => {
  const s = await startServer();
  t.after(() => s.stop());
  const code = await createRoom(s.base);
  const host = await connect(s, code, 'Host');
  const settingKeys = (id) => {
    host.send({ t: 'pickGame', id });
    return sleep(100).then(() => host.last.options.map((o) => o.key));
  };
  for (const id of ['whosaidthat', 'draw', 'quiz', 'minigames']) assert.ok(!(await settingKeys(id)).includes('local'), `${id} has no "local" option`);
  const text = JSON.stringify(host.last.options);
  assert.doesNotMatch(text, /zambia/i);
  assert.equal((await fetch(`${s.base}/api/langs`)).status, 404);
});

test('packs dropped into content/packs/ are merged, and bad ones are skipped', async (t) => {
  const dir = tmp(t, 'op-content-');
  fs.cpSync(path.join(ROOT, 'content'), dir, { recursive: true });
  fs.mkdirSync(path.join(dir, 'packs'), { recursive: true });
  const w = (name, obj) => fs.writeFileSync(path.join(dir, 'packs', name), typeof obj === 'string' ? obj : JSON.stringify(obj));
  w('quiz.json', { type: 'quiz', id: 'club', name: 'Club trivia', license: 'CC0-1.0', questions: [{ q: 'Which planet is closest to the Sun?', a: 'Mercury', w: ['Venus', 'Mars', 'Earth'], d: 1 }] });
  w('prompts.json', { type: 'prompts', id: 'office', name: 'Office', mixIn: false, prompts: ['What is the worst meeting snack?'] });
  w('words.json', { type: 'words', id: 'tools', name: 'Tools', easy: ['hammer'], medium: ['wrench'], hard: ['spirit level'] });
  w('scramble.json', { type: 'scramble', words: { easy: [{ w: 'kettle', c: 'Boils water' }] } });
  w('broken.json', '{ nope');
  w('wrongtype.json', { type: 'poem' });
  w('badquiz.json', { type: 'quiz', id: 'oops', name: 'Oops', questions: [{ q: 'x' }] });
  w('dupe.json', { type: 'quiz', id: 'animals', name: 'Clash', questions: [{ q: 'q?', a: 'a', w: ['b', 'c', 'd'], d: 1 }] });
  const s = await startServer({ CONTENT_DIR: dir });
  t.after(() => s.stop());
  assert.ok(await s.alive());
  for (const re of [/broken\.json: is not valid JSON/, /wrongtype\.json: needs "type"/, /badquiz\.json/, /dupe\.json: id "animals" is already used/]) assert.match(s.log(), re);
  const code = await createRoom(s.base);
  const host = await connect(s, code, 'Host');
  const optionValues = async (game, key) => {
    host.send({ t: 'pickGame', id: game });
    await sleep(100);
    return host.last.options.find((o) => o.key === key).values.map((v) => v[0]);
  };
  assert.ok((await optionValues('quiz', 'cats')).includes('club'), 'the quiz topic appears');
  assert.ok((await optionValues('whosaidthat', 'pack')).includes('office'), 'the prompt pack appears');
  assert.ok((await optionValues('draw', 'pack')).includes('tools'), 'the word pack appears');
  const scramble = await (await fetch(`${s.base}/api/content/scramble`)).json();
  assert.ok(scramble.easy.some((x) => x.w === 'kettle'), 'Word Builder gets the extra words');
  assert.ok(scramble.easy.length > 40);
});

test('npm run validate checks user packs too', (t) => {
  const dir = tmp(t, 'op-content-');
  fs.cpSync(path.join(ROOT, 'content'), dir, { recursive: true });
  fs.mkdirSync(path.join(dir, 'packs'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'packs', 'bad.json'), JSON.stringify({ type: 'prompts', id: 'x', name: 'X', prompts: [] }));
  const r = spawnSync(process.execPath, ['scripts/validate-content.js'], { cwd: ROOT, encoding: 'utf8', env: { ...process.env, CONTENT_DIR: dir } });
  assert.equal(r.status, 1);
  assert.match(r.stderr, /packs\/bad\.json/);
});
