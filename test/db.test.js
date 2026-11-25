// Tests for the SQLite layer: migrations, profiles, records, history, backups and the import of old JSON data.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

// The repositories read DATA_DIR when first loaded, so point it at a temporary folder before requiring them.
const DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'op-db-'));
process.env.DATA_DIR = DATA;
const { startServer, ROOT } = require('../test-support/helpers');
const { getDb, closeDb } = require('../server/db');
const { migrate, available } = require('../server/db/migrate');
const driver = require('../server/db/driver');
const profiles = require('../server/profiles');
const records = require('../server/records');
const history = require('../server/history');
const { backupNow } = require('../server/backup');
const { Rooms } = require('../server/rooms');

test.after(() => {
  closeDb();
  fs.rmSync(DATA, { recursive: true, force: true });
});

const post = (base, p, body) => fetch(`${base}${p}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }).then((r) => r.json());
const tmp = (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'op-db-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
};

test('migrations create the schema once and refuse a database from a newer version', () => {
  const db = driver.open(':memory:');
  const first = migrate(db);
  assert.deepEqual(first, available().map((m) => m.name));
  assert.deepEqual(migrate(db), [], 'running again changes nothing');
  for (const table of ['profiles', 'profile_game_stats', 'scores', 'records', 'games', 'game_results', 'meta']) assert.ok(db.get("SELECT 1 AS x FROM sqlite_master WHERE name = ?", table), `${table} exists`);
  db.run('INSERT INTO schema_migrations (version, name, applied_at) VALUES (999, ?, ?)', 'future', 'x');
  assert.throws(() => migrate(db), /newer version/);
  db.close();
});

test('a failed transaction rolls back, and transactions can nest', () => {
  const db = driver.open(':memory:');
  db.exec('CREATE TABLE t (a INTEGER)');
  assert.throws(() => db.transaction(() => { db.run('INSERT INTO t VALUES (1)'); throw new Error('boom'); }), /boom/);
  assert.equal(db.get('SELECT COUNT(*) AS n FROM t').n, 0);
  db.transaction(() => {
    db.run('INSERT INTO t VALUES (1)');
    assert.throws(() => db.transaction(() => { db.run('INSERT INTO t VALUES (2)'); throw new Error('inner'); }), /inner/);
    db.run('INSERT INTO t VALUES (3)');
  });
  assert.deepEqual(db.all('SELECT a FROM t ORDER BY a').map((r) => r.a), [1, 3]);
  db.close();
});

test('profiles: create, same name returns the existing one, rename clash is refused', () => {
  const a = profiles.upsert({ name: 'Alex', avatar: 3, level: 'teen' });
  assert.match(a.id, /^p_[0-9a-f]{8}$/);
  assert.equal(a.level, 'teen');
  const again = profiles.upsert({ name: 'alex', avatar: 9, level: 'adult' });
  assert.equal(again.id, a.id);
  assert.equal(again.avatar, 3, 'the existing profile is not rewritten');
  const b = profiles.upsert({ name: 'Blake' });
  assert.equal(profiles.upsert({ id: b.id, name: 'ALEX' }), null, 'cannot take a name that is in use');
  assert.equal(profiles.upsert({ id: b.id, name: 'Blake', avatar: 5 }).avatar, 5);
  assert.equal(profiles.upsert({ name: '   ' }), null);
  assert.deepEqual(profiles.list().map((p) => p.name).slice(0, 2), ['Alex', 'Blake']);
});

test('profiles: personal bests, plays and daily streaks', () => {
  const p = profiles.upsert({ name: 'Streaky' });
  const realNow = Date.now;
  t_after(() => { Date.now = realNow; });
  const at = (iso) => { Date.now = () => new Date(iso).getTime(); };
  at('2026-03-01T10:00:00Z');
  let r = profiles.record(p.id, 'math', 500);
  assert.equal(r.isNewBest, true);
  assert.equal(r.profile.stats.streaks.math.current, 1);
  r = profiles.record(p.id, 'math', 300);
  assert.equal(r.isNewBest, false);
  assert.equal(r.profile.stats.bests.math, 500);
  assert.equal(r.profile.stats.streaks.math.current, 1, 'same day does not extend the streak');
  at('2026-03-02T09:00:00Z');
  assert.equal(profiles.record(p.id, 'math', 600, 7).profile.stats.streaks.math.current, 2);
  at('2026-03-05T09:00:00Z');
  r = profiles.record(p.id, 'math', 100);
  assert.equal(r.profile.stats.streaks.math.current, 1, 'a gap resets the streak');
  assert.equal(r.profile.stats.streaks.math.best, 2);
  assert.equal(r.profile.stats.streaks.math.bestRun, 7);
  assert.equal(r.profile.stats.gamesPlayed, 4);
  assert.equal(profiles.record(p.id, 'not-a-game', 5), null);
  assert.equal(profiles.record('p_00000000', 'math', 5), null);
});
function t_after(fn) { test.after(fn); }

test('leaderboard orders by best and ignores zero', () => {
  const x = profiles.upsert({ name: 'LbOne' });
  const y = profiles.upsert({ name: 'LbTwo' });
  const z = profiles.upsert({ name: 'LbZero' });
  profiles.record(x.id, 'clash', 900);
  profiles.record(y.id, 'clash', 1200);
  profiles.record(z.id, 'clash', 0);
  const board = profiles.leaderboard('clash', 10).filter((e) => e.name.startsWith('Lb'));
  assert.deepEqual(board.map((e) => [e.name, e.best]), [['LbTwo', 1200], ['LbOne', 900]]);
  assert.equal(profiles.leaderboard('clash', 1).length, 1);
});

test('records: save and read, keyed by game, players and handicap', () => {
  assert.equal(records.get('memory:4:on'), null);
  records.save('memory:4:on', 2100);
  assert.equal(records.get('memory:4:on').total, 2100);
  records.save('memory:4:on', 2500);
  const row = records.all().find((r) => r.key === 'memory:4:on');
  assert.deepEqual([row.game_id, row.players, row.handicap, row.total], ['memory', 4, 'on', 2500]);
});

test('history: a room game is saved once when it reaches the final screen', () => {
  const rooms = new Rooms();
  const room = rooms.create();
  const ws = { send() {}, close() {}, readyState: 1 };
  const p1 = room.addPlayer('Hist One', 1, ws, profiles.upsert({ name: 'Hist One' }).id, 'teen');
  const p2 = room.addPlayer('Hist Two', 2, ws, null, 'adult');
  const p3 = room.addPlayer('Hist Three', 3, ws, null, 'adult');
  p1.score = 300;
  p2.score = 500;
  p3.score = 500;
  room.gameId = 'quiz';
  room.game = { phase: 'final', startedAt: Date.now() - 60000, destroy() {}, tvState: () => ({}), phoneState: () => ({}) };
  room.update();
  room.update();
  const games = history.recent(5).filter((g) => g.roomCode === room.code);
  assert.equal(games.length, 1, 'recorded once');
  assert.equal(games[0].game, 'quiz');
  assert.deepEqual(games[0].results.map((r) => [r.name, r.score, r.rank]).sort(), [['Hist One', 300, 2], ['Hist Three', 500, 0], ['Hist Two', 500, 0]]);
  assert.equal(history.forProfile(p1.profileId).length, 1);
  profiles.remove(p1.profileId);
  const after = history.recent(5).find((g) => g.roomCode === room.code);
  assert.equal(after.results.find((r) => r.name === 'Hist One').profileId, null, 'the result stays, unlinked');
});

test('export and import: stats merge into the same profile, or make a new one', () => {
  const a = profiles.upsert({ name: 'Porter' });
  profiles.record(a.id, 'memory', 700);
  profiles.record(a.id, 'memory', 900);
  const bundle = profiles.exportProfile(a.id);
  assert.equal(bundle.format, 'openparlor-profile');
  assert.equal(bundle.scores.length, 2);
  // Same id: merged, nothing duplicated.
  const merged = profiles.importProfile(JSON.parse(JSON.stringify(bundle)));
  assert.equal(merged.profile.id, a.id);
  assert.equal(merged.profile.stats.bests.memory, 900);
  assert.equal(getDb().get('SELECT COUNT(*) AS n FROM scores WHERE profile_id = ?', a.id).n, 2);
  // Deleted, then imported again: comes back as a new profile with the stats.
  profiles.remove(a.id);
  const back = profiles.importProfile(bundle);
  assert.notEqual(back.profile.id, undefined);
  assert.equal(back.profile.name, 'Porter');
  assert.equal(back.profile.stats.bests.memory, 900);
  // The name is taken: numbered.
  const twice = profiles.importProfile({ ...bundle, profile: { ...bundle.profile, id: 'p_ffffffff' } });
  assert.equal(twice.profile.name, 'Porter 2');
  for (const bad of [null, {}, { format: 'openparlor-profile', version: 2, profile: {} }, { format: 'openparlor-profile', version: 1, profile: { name: '' } }]) assert.ok(profiles.importProfile(bad).error);
});

test('backups: one a day, and the copy is a working database', () => {
  const r = backupNow({ keep: 2, force: true });
  assert.ok(fs.existsSync(r.file));
  assert.equal(backupNow({ keep: 2 }).created, false, 'only one per day unless forced');
  const copy = driver.open(r.file);
  assert.ok(copy.get('SELECT COUNT(*) AS n FROM profiles').n > 0);
  copy.close();
  const dir = path.dirname(r.file);
  for (const d of ['2026-01-01', '2026-01-02', '2026-01-03']) fs.writeFileSync(path.join(dir, `openparlor-${d}.db`), 'x');
  backupNow({ keep: 2 });
  assert.equal(fs.readdirSync(dir).filter((f) => f.endsWith('.db')).length, 2, 'old backups are pruned');
});

test('old JSON files are imported once, mapped onto the bands, and kept as .imported', async (t) => {
  const dir = tmp(t);
  fs.writeFileSync(path.join(dir, 'profiles.json'), JSON.stringify({ profiles: [
    { id: 'p_aaaaaaaa', name: 'Old Kid', avatar: 4, level: 'kid', stats: { gamesPlayed: 5, bests: { math: 800 }, streaks: { math: { current: 2, best: 3, lastDate: '2026-02-01', bestRun: 9 } } } },
    { id: 'p_bbbbbbbb', name: 'Old Grown', avatar: 1, level: 'grownup', stats: { gamesPlayed: 1, bests: {}, streaks: {} } },
    { id: 'p_cccccccc', name: 'old kid', avatar: 2, level: 'teen' },
    { nope: true },
  ] }));
  fs.writeFileSync(path.join(dir, 'records.json'), JSON.stringify({ 'memory:3:on': { total: 1000, date: '2026-01-05' }, 'memory:3:on:off': { total: 1500, date: '2026-01-06' }, 'clash:2:on:only': { total: 5, date: 'x' } }));
  const s = await startServer({ DATA_DIR: dir });
  t.after(() => s.stop());
  const list = (await (await fetch(`${s.base}/api/profiles`)).json()).profiles;
  assert.deepEqual(list.map((p) => p.name).sort(), ['Old Grown', 'Old Kid', 'old kid 2']);
  const kid = list.find((p) => p.id === 'p_aaaaaaaa');
  assert.equal(kid.level, 'kid');
  assert.equal(list.find((p) => p.id === 'p_bbbbbbbb').level, 'adult', 'grownup is mapped to the adult band');
  assert.equal(kid.stats.bests.math, 800);
  assert.deepEqual(kid.stats.streaks.math, { current: 2, best: 3, lastDate: '2026-02-01', bestRun: 9 });
  const recs = (await (await fetch(`${s.base}/api/records`)).json()).records;
  assert.deepEqual(recs.map((r) => [r.key, r.total]), [['memory:3:on', 1500]], 'the content-setting suffix is dropped, other settings discarded');
  assert.ok(fs.existsSync(path.join(dir, 'profiles.json.imported')));
  assert.ok(!fs.existsSync(path.join(dir, 'profiles.json')));
  assert.match(s.log(), /imported 3 profile/);
  await s.stop();
  const again = await startServer({ DATA_DIR: dir });
  t.after(() => again.stop());
  assert.equal((await (await fetch(`${again.base}/api/profiles`)).json()).profiles.length, 3, 'a restart does not duplicate anything');
});

test('an unreadable old JSON file is left alone and does not stop the server', async (t) => {
  const dir = tmp(t);
  fs.writeFileSync(path.join(dir, 'profiles.json'), '{ "profiles": [');
  const s = await startServer({ DATA_DIR: dir });
  t.after(() => s.stop());
  assert.ok(await s.alive());
  assert.match(s.log(), /profiles\.json is not valid JSON and was not imported/);
  assert.ok(fs.existsSync(path.join(dir, 'profiles.json')), 'the file is untouched');
});

test('the HTTP API: leaderboard, history, export, import and delete', async (t) => {
  const s = await startServer();
  t.after(() => s.stop());
  const { profile } = await post(s.base, '/api/profiles', { name: 'Webby', avatar: 2, level: 'teen' });
  await post(s.base, '/api/profiles/record', { id: profile.id, gameId: 'logic', score: 1500, streak: 3 });
  const board = await (await fetch(`${s.base}/api/leaderboard?game=logic`)).json();
  assert.deepEqual(board.entries.map((e) => [e.name, e.best]), [['Webby', 1500]]);
  assert.equal((await fetch(`${s.base}/api/leaderboard?game=bogus`)).status, 400);
  assert.deepEqual((await (await fetch(`${s.base}/api/history`)).json()).games, []);
  const exp = await fetch(`${s.base}/api/profiles/${profile.id}/export`);
  assert.match(exp.headers.get('content-disposition'), /attachment/);
  const bundle = await exp.json();
  assert.equal(bundle.profile.name, 'Webby');
  assert.equal((await fetch(`${s.base}/api/profiles/p_00000000/export`)).status, 404);
  assert.equal((await fetch(`${s.base}/api/profiles/not-an-id`, { method: 'DELETE' })).status, 404);
  assert.equal((await post(s.base, '/api/profiles/import', { hello: 1 })).error.length > 0, true);
  const del = await (await fetch(`${s.base}/api/profiles/${profile.id}`, { method: 'DELETE' })).json();
  assert.equal(del.deleted, true);
  assert.equal((await (await fetch(`${s.base}/api/profiles`)).json()).profiles.length, 0);
  const back = await post(s.base, '/api/profiles/import', bundle);
  assert.equal(back.profile.stats.bests.logic, 1500);
});

test('with profiles off, scores and history endpoints are off but group records stay', async (t) => {
  const dir = tmp(t);
  const cfg = path.join(dir, 'config');
  fs.cpSync(path.join(ROOT, 'config'), cfg, { recursive: true });
  fs.writeFileSync(path.join(cfg, 'local.json'), JSON.stringify({ profiles: { enabled: false } }));
  const s = await startServer({ CONFIG_DIR: cfg, DATA_DIR: dir });
  t.after(() => s.stop());
  for (const p of ['/api/leaderboard?game=math', '/api/history', '/api/profiles/p_00000000/export']) assert.equal((await fetch(`${s.base}${p}`)).status, 404, p);
  assert.equal((await fetch(`${s.base}/api/records`)).status, 200);
});

test('an old Node prints a clear message instead of a stack trace', (t) => {
  const old = ['v20.20.2', 'v20.17.0'].map((v) => path.join(os.homedir(), '.nvm/versions/node', v, 'bin/node')).find((f) => fs.existsSync(f));
  if (!old) return t.skip('no Node 20 installed');
  const r = spawnSync(old, ['server/index.js'], { cwd: ROOT, encoding: 'utf8', timeout: 10000 });
  assert.equal(r.status, 1);
  assert.match(r.stderr, /needs Node 22\.13 or newer/);
  assert.doesNotMatch(r.stderr, /at Module/);
});
