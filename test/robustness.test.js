// Regression tests for the crashes found in the audit (R1 to R4, D5, S3, S4). Run with `npm test`.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const WebSocket = require('ws');
const { startServer, createRoom, connect, sleep, ROOT } = require('../test-support/helpers');

test('a malformed URL does not crash the server (R1)', async (t) => {
  const s = await startServer();
  t.after(() => s.stop());
  const res = await fetch(`${s.base}/%E0%A4%A`).catch(() => null);
  assert.ok(res, 'the server answered');
  assert.equal(res.status, 400);
  assert.ok(await s.alive(), 'still running');
});

test('path traversal is refused, including sibling-folder prefixes (S3)', async (t) => {
  const s = await startServer();
  t.after(() => s.stop());
  for (const p of ['/..%2fserver/index.js', '/%2e%2e/server/index.js', '/..%2fpublic-old/x', '/%00']) {
    const res = await fetch(`${s.base}${p}`);
    assert.ok([400, 403, 404].includes(res.status), `${p} gave ${res.status}`);
  }
  assert.ok(await s.alive());
});

test('responses carry security headers (S4)', async (t) => {
  const s = await startServer();
  t.after(() => s.stop());
  const res = await fetch(`${s.base}/`);
  assert.equal(res.headers.get('x-content-type-options'), 'nosniff');
  assert.equal(res.headers.get('x-frame-options'), 'DENY');
  assert.match(res.headers.get('content-security-policy'), /script-src 'self'/);
  const api = await fetch(`${s.base}/api/info`);
  assert.equal(api.headers.get('x-content-type-options'), 'nosniff');
});

test('hostile room messages are ignored and the room keeps working (R2, R3)', async (t) => {
  const s = await startServer();
  t.after(() => s.stop());
  const code = await createRoom(s.base);
  const host = await connect(s, code, 'Host');
  await connect(s, code, 'Guest');
  const bad = [
    { t: 'pickGame', id: '__proto__' },
    { t: 'pickGame', id: 'constructor' },
    { t: 'pickGame', id: { a: 1 } },
    { t: 'settings', settings: null },
    { t: 'settings', settings: 'x' },
    { t: 'settings', settings: [1, 2] },
    { t: 'level', level: {} },
    { t: 'makeHost', id: {} },
    { t: 'kick', id: null },
    { t: 'g', a: 'answer', idx: {} },
    { t: 'start' },
    { t: 'skipRules' },
    { t: 'g', a: 'answer', idx: {} },
    { t: 'g', a: 'text', text: {} },
  ];
  for (const m of bad) host.send(m);
  host.send('not json at all');
  await sleep(300);
  assert.ok(await s.alive(), 'server still running');
  assert.doesNotMatch(s.log(), /TypeError|URIError/, 'no uncaught errors in the log');
  assert.ok(host.last.games.every((g) => g.id !== '__proto__' && g.id !== 'constructor'));
  host.send({ t: 'pickGame', id: 'quiz' });
  await sleep(150);
  assert.equal(host.last.gameId, 'quiz', 'a real game can still be picked');
});

test('oversized WebSocket messages close the connection, not the server (R4)', async (t) => {
  const s = await startServer();
  t.after(() => s.stop());
  const code = await createRoom(s.base);
  const p = await connect(s, code, 'Big');
  p.send(JSON.stringify({ t: 'x', pad: 'a'.repeat(1024 * 1024) }));
  await sleep(400);
  assert.equal(p.closed, 1009, 'closed with "message too big"');
  assert.ok(await s.alive());
});

test('a flood of messages is throttled, not fatal (R4)', async (t) => {
  const s = await startServer();
  t.after(() => s.stop());
  const code = await createRoom(s.base);
  const p = await connect(s, code, 'Flood');
  for (let i = 0; i < 3000; i++) p.send({ t: 'g', a: 'noop', i });
  await sleep(500);
  assert.ok(await s.alive());
  assert.equal(p.closed, 1008, 'a sustained flood is disconnected');
});

test('the number of rooms is capped (R4)', async (t) => {
  const s = await startServer({ MAX_ROOMS: '3' });
  t.after(() => s.stop());
  for (let i = 0; i < 3; i++) assert.equal((await fetch(`${s.base}/api/room`, { method: 'POST' })).status, 200);
  const res = await fetch(`${s.base}/api/room`, { method: 'POST' });
  assert.equal(res.status, 503);
  assert.match((await res.json()).error, /full/);
});

test('creating rooms is rate limited per address (R4)', async (t) => {
  const s = await startServer({ MAX_ROOMS: '1000' });
  t.after(() => s.stop());
  let limited = 0;
  for (let i = 0; i < 25; i++) if ((await fetch(`${s.base}/api/room`, { method: 'POST' })).status === 429) limited++;
  assert.equal(limited, 5, '20 allowed, the rest refused');
});

test('an oversized request body is dropped without hanging the server (R4)', async (t) => {
  const s = await startServer();
  t.after(() => s.stop());
  await fetch(`${s.base}/api/profiles`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: 'x'.repeat(100000) }) }).catch(() => {});
  assert.ok(await s.alive());
});

test('a broken content pack does not stop the server from starting (D5)', async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'op-content-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  fs.cpSync(path.join(ROOT, 'content'), dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'words.json'), '{ "packs": ');
  fs.writeFileSync(path.join(dir, 'questions.json'), '{ "categories": { "a": { "questions": [ { "q": "x" } ] } } }');
  const s = await startServer({ CONTENT_DIR: dir });
  t.after(() => s.stop());
  assert.ok(await s.alive(), 'server started');
  assert.match(s.log(), /words\.json: is not valid JSON/);
  const code = await createRoom(s.base);
  const host = await connect(s, code, 'Host');
  const ids = host.last.games.map((g) => g.id);
  assert.ok(!ids.includes('draw'), 'Draw & Guess is hidden without words');
  assert.ok(!ids.includes('quiz'), 'the quiz is hidden without valid questions');
  assert.ok(ids.includes('whosaidthat') && ids.includes('minigames'), 'the other games still work');
  host.send({ t: 'pickGame', id: 'draw' });
  await sleep(150);
  assert.notEqual(host.last.gameId, 'draw');
});

test('the validator passes on the shipped content and fails on a bad pack (D5)', () => {
  const ok = spawnSync(process.execPath, ['scripts/validate-content.js'], { cwd: ROOT, encoding: 'utf8' });
  assert.equal(ok.status, 0, ok.stderr);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'op-content-'));
  try {
    fs.cpSync(path.join(ROOT, 'content'), dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'prompts.json'), '{ "packs": { "a": { "prompts": [] } } }');
    const bad = spawnSync(process.execPath, ['scripts/validate-content.js'], { cwd: ROOT, encoding: 'utf8', env: { ...process.env, CONTENT_DIR: dir } });
    assert.equal(bad.status, 1);
    assert.match(bad.stderr, /prompts\.json/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('every game still goes lobby, how to play, then in game', async (t) => {
  const s = await startServer();
  t.after(() => s.stop());
  const code = await createRoom(s.base);
  const host = await connect(s, code, 'Host');
  const guest = await connect(s, code, 'Guest');
  const third = await connect(s, code, 'Third');
  for (const id of ['whosaidthat', 'draw', 'quiz', 'minigames']) {
    host.send({ t: 'pickGame', id });
    await sleep(100);
    host.send({ t: 'start' });
    await sleep(150);
    assert.ok(host.last.briefing && !host.last.inGame, `${id}: how to play shows`);
    guest.send({ t: 'skipRules' });
    await sleep(100);
    assert.ok(host.last.briefing, `${id}: a guest cannot skip`);
    host.send({ t: 'skipRules' });
    await sleep(200);
    assert.ok(host.last.inGame && !host.last.briefing, `${id}: the game starts`);
    host.send({ t: 'lobby' });
    await sleep(150);
  }
  assert.ok(await s.alive());
  void third;
  void WebSocket;
});
