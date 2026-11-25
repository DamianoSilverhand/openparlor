// Tests for the game SDK: loading plugins, rejecting bad ones, serving their screens, and playing an example game.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { startServer, createRoom, connect, ROOT } = require('../test-support/helpers');
const { playGame } = require('../test-support/bots');

const tmp = (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'op-plugins-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
};
const copyExample = (plugins, name) => fs.cpSync(path.join(ROOT, 'examples', name), path.join(plugins, name), { recursive: true });
const write = (dir, rel, text) => {
  fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
  fs.writeFileSync(path.join(dir, rel), typeof text === 'string' ? text : JSON.stringify(text, null, 2));
};
const gameList = async (s, name = 'Lister') => {
  const code = await createRoom(s.base);
  return (await connect(s, code, name)).last.games;
};

test('the example game and mini-game load from a plugins folder and are served', async (t) => {
  const plugins = tmp(t);
  copyExample(plugins, 'higher-lower');
  copyExample(plugins, 'tap-storm');
  const s = await startServer({ PLUGINS_DIR: plugins });
  t.after(() => s.stop());
  const games = await gameList(s);
  assert.deepEqual(games.map((g) => g.id), ['whosaidthat', 'draw', 'quiz', 'minigames', 'higher-lower'], 'plugins come after the built-in games');
  const hl = games.find((g) => g.id === 'higher-lower');
  assert.equal(hl.client.tv, '/games/higher-lower/tv.js');
  for (const url of [hl.client.tv, hl.client.play, hl.client.styles[0]]) assert.equal((await fetch(`${s.base}${url}`)).status, 200, url);
  const minis = (await (await fetch(`${s.base}/api/minigames`)).json()).minigames;
  assert.ok(minis.some((m) => m.id === 'tap-storm' && m.url === '/mini/tap-storm/client.js'));
  assert.equal((await fetch(`${s.base}/mini/tap-storm/client.js`)).status, 200);
  assert.match(s.log(), /\[games\]|^$/m);
  // Only the public/ folder of a game is reachable.
  for (const p of ['/games/higher-lower/server.js', '/games/higher-lower/game.json', '/games/higher-lower/..%2fserver.js', '/games/higher-lower/%2e%2e/%2e%2e/package.json']) {
    assert.ok([400, 403, 404].includes((await fetch(`${s.base}${p}`)).status), p);
  }
});

test('the example game can be played from start to finish', async (t) => {
  const plugins = tmp(t);
  copyExample(plugins, 'higher-lower');
  const s = await startServer({ PLUGINS_DIR: plugins, TIME_SCALE: '0.05' });
  t.after(() => s.stop());
  const act = (bot, m) => {
    if (m.gameId === 'higher-lower' && m.game.phase === 'guess') setTimeout(() => bot.send({ t: 'g', a: 'guess', choice: Math.random() < 0.5 ? 'higher' : 'lower' }), 50);
  };
  const { phases, final } = await playGame(s, 'higher-lower', { settings: { rounds: 3 }, act });
  assert.deepEqual([...new Set(phases)], ['guess', 'reveal', 'final']);
  assert.equal(final.game.standings.length, 4);
  const games = (await (await fetch(`${s.base}/api/history`)).json()).games;
  assert.equal(games[0].game, 'higher-lower', 'plugin games are saved to the history like any other');
  assert.doesNotMatch(s.log(), /TypeError|error in a timer|error handling/);
});

test('bad plugins are reported and skipped, and the server still starts', async (t) => {
  const plugins = tmp(t);
  copyExample(plugins, 'higher-lower');
  const good = JSON.parse(fs.readFileSync(path.join(ROOT, 'examples/higher-lower/game.json'), 'utf8'));
  const stub = (id, manifest, serverJs = 'module.exports = { defaults: {}, create() {} };') => {
    write(plugins, `${id}/game.json`, manifest);
    write(plugins, `${id}/server.js`, serverJs);
    write(plugins, `${id}/public/tv.js`, 'export function screen() {}');
    write(plugins, `${id}/public/play.js`, 'export function screen() {}');
    write(plugins, `${id}/public/styles.css`, '');
  };
  stub('wrong-sdk', { ...good, id: 'wrong-sdk', sdk: 2 });
  stub('bad-id', { ...good, id: 'Bad Id' });
  stub('mismatch', { ...good, id: 'something-else' });
  stub('quiz', { ...good, id: 'quiz', name: 'Fake quiz' });
  stub('throws', { ...good, id: 'throws' }, "throw new Error('boom at load');");
  stub('no-create', { ...good, id: 'no-create' }, 'module.exports = { defaults: {} };');
  stub('bad-default', { ...good, id: 'bad-default' }, "module.exports = { defaults: { a: 3 }, options: [{ key: 'a', label: 'A', values: [[1, 'one']] }], create() {} };");
  stub('escapes', { ...good, id: 'escapes', tv: '../../server/index.js' });
  write(plugins, 'broken-json/game.json', '{ nope');
  write(plugins, 'missing-file/game.json', { ...good, id: 'missing-file' });
  write(plugins, 'missing-file/server.js', 'module.exports = { defaults: {}, create() {} };');
  write(plugins, 'bad-mini/minigame.json', { sdk: 1, id: 'bad-mini', name: 'Bad', howto: 'x', duration: 5, max: 10 });
  const s = await startServer({ PLUGINS_DIR: plugins });
  t.after(() => s.stop());
  assert.ok(await s.alive());
  const ids = (await gameList(s)).map((g) => g.id);
  assert.deepEqual(ids, ['whosaidthat', 'draw', 'quiz', 'minigames', 'higher-lower'], 'only the good plugin was added');
  const log = s.log();
  for (const re of [/wrong-sdk.*needs "sdk": 1/, /bad-id.*needs an "id"/, /mismatch.*folder name must match/, /already used by another game/, /throws.*boom at load/, /no-create.*"create\(room\)"/, /bad-default.*default for option "a"/, /escapes.*"tv" and "play"/, /broken-json.*not valid JSON/, /missing-file.*does not exist/, /bad-mini.*"duration"/]) assert.match(log, re);
  assert.notEqual((await (await fetch(`${s.base}/games/quiz/tv.js`)).text()).length, 0, 'the real quiz is untouched');
});

test('plugins can be switched off in the config', async (t) => {
  const plugins = tmp(t);
  copyExample(plugins, 'higher-lower');
  const cfg = tmp(t);
  fs.cpSync(path.join(ROOT, 'config'), cfg, { recursive: true });
  write(cfg, 'local.json', { plugins: { enabled: false } });
  const s = await startServer({ PLUGINS_DIR: plugins, CONFIG_DIR: cfg });
  t.after(() => s.stop());
  assert.ok(!(await gameList(s)).some((g) => g.id === 'higher-lower'));
});

test('a plugin game whose server code throws in a handler does not take the server down', async (t) => {
  const plugins = tmp(t);
  copyExample(plugins, 'higher-lower');
  fs.writeFileSync(path.join(plugins, 'higher-lower/server.js'), fs.readFileSync(path.join(plugins, 'higher-lower/server.js'), 'utf8').replace("if (msg.a !== 'guess'", "if (msg.a === 'crash') throw new Error('plugin bug');\n      if (msg.a !== 'guess'"));
  const s = await startServer({ PLUGINS_DIR: plugins });
  t.after(() => s.stop());
  const code = await createRoom(s.base);
  const host = await connect(s, code, 'Host');
  await connect(s, code, 'Two');
  host.send({ t: 'pickGame', id: 'higher-lower' });
  host.send({ t: 'start' });
  await new Promise((r) => setTimeout(r, 200));
  host.send({ t: 'skipRules' });
  await new Promise((r) => setTimeout(r, 200));
  host.send({ t: 'g', a: 'crash' });
  await new Promise((r) => setTimeout(r, 200));
  assert.ok(await s.alive());
  assert.match(s.log(), /plugin bug/);
});
