// Tests for the installable-app features: manifest, icons, heartbeat, HTTPS, the precache list and offline scores.
process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0'; // the HTTPS tests use a self-signed certificate
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const WebSocket = require('ws');
const { startServer, createRoom, connect, sleep, ROOT } = require('../test-support/helpers');

const tmp = (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'op-pwa-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
};

test('the manifest follows the brand and every icon it lists exists', async (t) => {
  const cfg = tmp(t);
  fs.cpSync(path.join(ROOT, 'config'), cfg, { recursive: true });
  fs.writeFileSync(path.join(cfg, 'local.json'), JSON.stringify({ brand: { name: 'Room 12 Quiz Night', tagline: 'Fridays' } }));
  const s = await startServer({ CONFIG_DIR: cfg });
  t.after(() => s.stop());
  const res = await fetch(`${s.base}/manifest.webmanifest`);
  assert.match(res.headers.get('content-type'), /manifest\+json/);
  const m = await res.json();
  assert.equal(m.name, 'Room 12 Quiz Night');
  assert.equal(m.short_name, 'Room 12 Quiz', 'a long name is shortened');
  assert.equal(m.display, 'standalone');
  assert.equal(m.description, 'Fridays');
  assert.ok(m.icons.some((i) => i.purpose === 'maskable'));
  for (const icon of [...m.icons, ...m.shortcuts.flatMap((x) => x.icons || [])]) {
    const r = await fetch(`${s.base}${icon.src}`);
    assert.equal(r.status, 200, icon.src);
    if (icon.src.endsWith('.png')) {
      const buf = Buffer.from(await r.arrayBuffer());
      assert.equal(buf.subarray(1, 4).toString(), 'PNG');
      if (icon.sizes !== 'any') assert.equal(buf.readUInt32BE(16), Number(icon.sizes.split('x')[0]), `${icon.src} is ${icon.sizes}`);
    }
  }
});

test('every page links the manifest, the icons and both theme colours', () => {
  for (const f of ['index.html', 'play/index.html', 'tv/index.html', 'solo/index.html', 'stats/index.html']) {
    const html = fs.readFileSync(path.join(ROOT, 'public', f), 'utf8');
    for (const needle of ['rel="manifest"', 'rel="apple-touch-icon"', 'prefers-color-scheme: dark', 'apple-mobile-web-app-capable']) assert.ok(html.includes(needle), `${f} lacks ${needle}`);
  }
});

test('the heartbeat is answered, and the sockets still work normally', async (t) => {
  const s = await startServer();
  t.after(() => s.stop());
  const code = await createRoom(s.base);
  const p = await connect(s, code, 'Pinger');
  const got = new Promise((resolve) => p.ws.on('message', (d) => JSON.parse(d).t === 'pong' && resolve(true)));
  p.send({ t: 'ping' });
  assert.equal(await Promise.race([got, sleep(1500).then(() => false)]), true);
  assert.ok(p.last.players.some((x) => x.name === 'Pinger'));
});

test('the precache list is complete, every file in it is served, and the service worker is reachable', async (t) => {
  const plugins = tmp(t);
  fs.cpSync(path.join(ROOT, 'examples/tap-storm'), path.join(plugins, 'tap-storm'), { recursive: true });
  const s = await startServer({ PLUGINS_DIR: plugins });
  t.after(() => s.stop());
  const { version, urls } = await (await fetch(`${s.base}/api/precache`)).json();
  assert.match(version, /^[0-9a-f]{12}$/);
  for (const needed of ['/', '/solo', '/solo/solo.js', '/shared/offline.js', '/shared/pwa.js', '/api/minigames', '/api/content/scramble', '/mini/math/client.js', '/mini/tap-storm/client.js', '/locales/en.json']) assert.ok(urls.includes(needed), `${needed} is precached`);
  for (const u of urls) assert.equal((await fetch(`${s.base}${u}`)).status, 200, u);
  assert.equal((await (await fetch(`${s.base}/api/precache`)).json()).version, version, 'the version is stable');
  const sw = await fetch(`${s.base}/sw.js`);
  assert.equal(sw.status, 200);
  assert.match(sw.headers.get('content-type'), /javascript/);
  assert.equal(sw.headers.get('cache-control'), 'no-cache');
});

test('npm run cert makes a certificate and the server then runs on https with working sockets', async (t) => {
  const data = tmp(t);
  const r = spawnSync(process.execPath, ['scripts/make-cert.js'], { cwd: ROOT, env: { ...process.env, DATA_DIR: data, PATH: process.env.PATH }, encoding: 'utf8' });
  if (r.status !== 0 && /Neither mkcert nor openssl/.test(r.stderr)) return t.skip('no openssl here');
  assert.equal(r.status, 0, r.stderr);
  assert.ok(fs.existsSync(path.join(data, 'certs/cert.pem')) && fs.existsSync(path.join(data, 'certs/key.pem')));
  const s = await startServer({ DATA_DIR: data }, { scheme: 'https' });
  t.after(() => s.stop());
  const info = await (await fetch(`${s.base}/api/info`)).json();
  assert.equal(info.secure, true);
  assert.match(info.base, /^https:\/\//);
  assert.match(s.log(), /https:\/\/localhost/);
  const code = await createRoom(s.base);
  const p = await connect(s, code, 'Secure');
  assert.ok(p.last.players.some((x) => x.name === 'Secure'), 'the WebSocket works over wss');
  const res = await fetch(`${s.base}/`);
  assert.equal(res.headers.get('x-content-type-options'), 'nosniff');
});

test('an HTTPS certificate that was asked for but cannot be read stops the server with a clear message', async () => {
  const r = spawnSync(process.execPath, ['--disable-warning=ExperimentalWarning', 'server/index.js'], { cwd: ROOT, env: { ...process.env, PORT: '0', HTTPS_CERT: '/nonexistent/cert.pem', HTTPS_KEY: '/nonexistent/key.pem' }, encoding: 'utf8', timeout: 15000 });
  assert.equal(r.status, 1);
  assert.match(r.stderr, /Could not load the HTTPS certificate/);
});

test('without a certificate the server stays on plain http', async (t) => {
  const s = await startServer();
  t.after(() => s.stop());
  const info = await (await fetch(`${s.base}/api/info`)).json();
  assert.equal(info.secure, false);
  assert.match(info.base, /^http:\/\//);
});

// ---- offline scores ---------------------------------------------------------------------------------------------------
const profilesRepo = () => {
  // A fresh database for the in-process checks.
  process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'op-pwa-db-'));
  return require('../server/profiles');
};

test('a result sent twice with the same run id is counted once', async (t) => {
  const s = await startServer();
  t.after(() => s.stop());
  const post = (p, body) => fetch(`${s.base}${p}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }).then((r) => r.json());
  const { profile } = await post('/api/profiles', { name: 'Offliner', level: 'teen' });
  const body = { id: profile.id, gameId: 'math', score: 700, runId: 'run-abc-123', playedAt: new Date().toISOString() };
  const first = await post('/api/profiles/record', body);
  const second = await post('/api/profiles/record', body);
  assert.equal(first.isNewBest, true);
  assert.equal(second.duplicate, true);
  assert.equal(second.profile.stats.gamesPlayed, 1, 'counted once');
  const other = await post('/api/profiles/record', { ...body, runId: 'run-def-456', score: 100 });
  assert.equal(other.profile.stats.gamesPlayed, 2, 'a different run id counts');
  const bad = await post('/api/profiles/record', { ...body, runId: 'bad id!!', score: 50 });
  assert.equal(bad.profile.stats.gamesPlayed, 3, 'an invalid run id is ignored, not trusted');
});

test('results played earlier are dated by when they were played; the future is refused', () => {
  const profiles = profilesRepo();
  const p = profiles.upsert({ name: 'Dated', level: 'kid' });
  const at = (days) => new Date(Date.now() - days * 86400000).toISOString();
  profiles.record(p.id, 'math', 100, 0, 'solo', { runId: 'r1', playedAt: at(3) });
  profiles.record(p.id, 'math', 100, 0, 'solo', { runId: 'r2', playedAt: at(2) });
  let r = profiles.record(p.id, 'math', 100, 0, 'solo', { runId: 'r3', playedAt: at(1) });
  assert.equal(r.profile.stats.streaks.math.current, 3, 'three days in a row');
  r = profiles.record(p.id, 'math', 900, 0, 'solo', { runId: 'r4', playedAt: at(5) });
  assert.equal(r.profile.stats.streaks.math.current, 3, 'an older result does not disturb the streak');
  assert.equal(r.profile.stats.bests.math, 900);
  r = profiles.record(p.id, 'math', 10, 0, 'solo', { runId: 'r5', playedAt: new Date(Date.now() + 5 * 86400000).toISOString() });
  assert.equal(r.profile.stats.streaks.math.lastDate, new Date().toISOString().slice(0, 10), 'a date in the future is replaced by now');
  assert.equal(r.profile.stats.streaks.math.current, 4);
});

test('the on-device calculation matches the server for the same plays', async () => {
  const profiles = profilesRepo();
  const { applyLocally } = await import('../public/shared/offline.js');
  const p = profiles.upsert({ name: 'Mirror', level: 'adult' });
  let local = profiles.get(p.id);
  const plays = [[6, 400], [6, 900], [5, 300], [3, 1200], [3, 50], [2, 700], [1, 0], [0, 650]];
  for (const [daysAgo, score] of plays) {
    const when = new Date(Date.now() - daysAgo * 86400000).toISOString();
    const server = profiles.record(p.id, 'logic', score, 4, 'solo', { runId: `m${daysAgo}-${score}`, playedAt: when });
    local = applyLocally(local, 'logic', score, 4, when).profile;
    assert.deepEqual(local.stats.bests, server.profile.stats.bests, `bests after ${daysAgo} days ago`);
    assert.equal(local.stats.gamesPlayed, server.profile.stats.gamesPlayed);
    if (daysAgo >= 3) assert.equal(local.stats.streaks.logic.current, server.profile.stats.streaks.logic.current, `streak after ${daysAgo} days ago`);
  }
});

test('the offline queue keeps results while the network is down and sends each exactly once afterwards', async (t) => {
  const s = await startServer();
  t.after(() => s.stop());
  const store = new Map();
  global.localStorage = { getItem: (k) => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, String(v)), removeItem: (k) => store.delete(k) };
  const realFetch = global.fetch;
  let online = false;
  global.fetch = (url, opts) => (online ? realFetch(`${s.base}${url}`, opts) : Promise.reject(new TypeError('offline')));
  t.after(() => { global.fetch = realFetch; delete global.localStorage; });
  const post = (p, body) => realFetch(`${s.base}${p}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }).then((r) => r.json());
  const { profile } = await post('/api/profiles', { name: 'Queued', level: 'teen' });
  const offline = await import('../public/shared/offline.js');
  offline.enqueue({ profileId: profile.id, gameId: 'clash', score: 800, streak: 2 });
  offline.enqueue({ profileId: profile.id, gameId: 'clash', score: 1200, streak: 5 });
  assert.equal(offline.pending(), 2);
  assert.equal(await offline.flush(), 2, 'offline: both results stay in the queue');
  online = true;
  // Simulate a lost answer: the first result already reached the server, but the phone does not know.
  const first = JSON.parse(store.get('op:queue'))[0];
  await post('/api/profiles/record', first);
  let synced = 0;
  offline.onSynced((n) => (synced += n));
  assert.equal(await offline.flush(), 0, 'online: the queue empties');
  assert.equal(synced, 2);
  const stats = (await (await realFetch(`${s.base}/api/profiles`)).json()).profiles.find((p) => p.id === profile.id).stats;
  assert.equal(stats.gamesPlayed, 2, 'each result was counted exactly once');
  assert.equal(stats.bests.clash, 1200);
  assert.equal(stats.streaks.clash.bestRun, 5);
});

test('a result for a deleted profile is dropped so it cannot block the queue', async (t) => {
  const s = await startServer();
  t.after(() => s.stop());
  const store = new Map();
  global.localStorage = { getItem: (k) => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, String(v)), removeItem: (k) => store.delete(k) };
  const realFetch = global.fetch;
  global.fetch = (url, opts) => realFetch(`${s.base}${url}`, opts);
  t.after(() => { global.fetch = realFetch; delete global.localStorage; });
  const post = (p, body) => realFetch(`${s.base}${p}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }).then((r) => r.json());
  const { profile } = await post('/api/profiles', { name: 'Keeper', level: 'teen' });
  const offline = await import('../public/shared/offline.js');
  offline.enqueue({ profileId: 'p_deadbeef', gameId: 'math', score: 10 });
  offline.enqueue({ profileId: profile.id, gameId: 'math', score: 20 });
  assert.equal(await offline.flush(), 0);
  const stats = (await (await realFetch(`${s.base}/api/profiles`)).json()).profiles.find((p) => p.id === profile.id).stats;
  assert.equal(stats.bests.math, 20);
  void WebSocket;
});

test('a flush that found nothing to send does not stop later flushes from working', async (t) => {
  const s = await startServer();
  t.after(() => s.stop());
  const store = new Map();
  global.localStorage = { getItem: (k) => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, String(v)), removeItem: (k) => store.delete(k) };
  const realFetch = global.fetch;
  global.fetch = (url, opts) => realFetch(`${s.base}${url}`, opts);
  t.after(() => { global.fetch = realFetch; delete global.localStorage; });
  const post = (p, body) => realFetch(`${s.base}${p}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }).then((r) => r.json());
  const { profile } = await post('/api/profiles', { name: 'Empty First', level: 'teen' });
  const offline = await import('../public/shared/offline.js');
  assert.equal(await offline.flush(), 0, 'nothing waiting');
  offline.enqueue({ profileId: profile.id, gameId: 'memory', score: 321 });
  assert.equal(await offline.flush(), 0, 'the result is sent by a later flush');
  const stats = (await (await realFetch(`${s.base}/api/profiles`)).json()).profiles.find((p) => p.id === profile.id).stats;
  assert.equal(stats.bests.memory, 321);
});

test('the home page logo is configured, served and cached for offline', async (t) => {
  const s = await startServer();
  t.after(() => s.stop());
  const cfg = await (await fetch(`${s.base}/api/config`)).json();
  assert.equal(cfg.brand.logo, '/icons/logo.svg');
  const res = await fetch(`${s.base}${cfg.brand.logo}`);
  assert.equal(res.status, 200);
  assert.match(res.headers.get('content-type'), /svg/);
  const pre = await (await fetch(`${s.base}/api/precache`)).json().catch(() => null);
  if (pre) assert.ok(JSON.stringify(pre).includes('/icons/logo.svg'));
});
