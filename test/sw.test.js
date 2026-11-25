// Runs public/sw.js in a simulated service worker environment (there is no browser in the test run) and checks what it
// stores and when it answers from the stored copy.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const SOURCE = fs.readFileSync(path.join(__dirname, '../public/sw.js'), 'utf8');
const ORIGIN = 'http://phone.local';

function makeWorker({ serve }) {
  const handlers = {};
  const stores = new Map(); // cache name -> Map(url -> Response)
  const strip = (u) => { const x = new URL(u, ORIGIN); x.search = ''; return x.href; };
  const makeCache = (map) => ({
    async add(req) { const r = req instanceof Request ? req : new Request(new URL(req, ORIGIN)); const res = await env.fetch(r); if (!res.ok) throw new TypeError('bad status'); map.set(r.url, res.clone()); },
    async put(req, res) { map.set(req.url, res.clone()); },
    async match(req, opts = {}) {
      const key = typeof req === 'string' ? new URL(req, ORIGIN).href : req.url;
      for (const [k, v] of map) if (opts.ignoreSearch ? strip(k) === strip(key) : k === key) return v.clone();
      return undefined;
    },
    async keys() { return [...map.keys()].map((u) => new Request(u)); },
  });
  const env = {
    online: true,
    fetched: [],
    fetch: async (req) => {
      const url = new URL(req.url || String(req), ORIGIN);
      env.fetched.push(url.pathname);
      if (!env.online) throw new TypeError('Failed to fetch');
      return serve(url.pathname, req);
    },
  };
  const self = {
    addEventListener: (type, fn) => (handlers[type] = fn),
    skipWaiting: async () => {},
    clients: { claim: async () => {} },
  };
  // Inside a worker a relative address is resolved against the worker's own address; do the same here.
  class WorkerRequest extends Request {
    constructor(input, init) { super(typeof input === 'string' ? new URL(input, ORIGIN).href : input, init); }
  }
  const ctx = vm.createContext({
    self, location: { origin: ORIGIN }, URL, Request: WorkerRequest, Response, console,
    fetch: (r) => env.fetch(r),
    caches: {
      async open(name) { if (!stores.has(name)) stores.set(name, new Map()); return makeCache(stores.get(name)); },
      async keys() { return [...stores.keys()]; },
      async delete(name) { return stores.delete(name); },
    },
  });
  vm.runInContext(SOURCE, ctx);
  const lifecycle = async (type) => {
    let pending = Promise.resolve();
    handlers[type]({ waitUntil: (p) => (pending = p) });
    await pending;
  };
  // Returns the Response the worker answers with, or null when it leaves the request to the browser.
  const request = async (url, init = {}) => {
    // Request() cannot be given mode "navigate" outside a browser, so a page load is simulated with a plain object.
    const req = init.mode === 'navigate' ? { url: new URL(url, ORIGIN).href, method: 'GET', mode: 'navigate' } : new Request(new URL(url, ORIGIN), init);
    let answer = null;
    handlers.fetch({ request: req, respondWith: (p) => (answer = p) });
    return answer ? answer : null;
  };
  return { env, stores, install: () => lifecycle('install'), activate: () => lifecycle('activate'), request };
}

const files = { '/': 'home', '/solo': 'solo', '/solo/solo.js': 'code', '/api/config': '{"brand":1}', '/missing.js': null };
const serve = (pathname, req) => {
  if (pathname === '/api/precache') return Response.json({ version: 'v1', urls: ['/', '/solo', '/solo/solo.js', '/api/config', '/missing.js'] });
  if (files[pathname] === null) return new Response('no', { status: 404 });
  return new Response(files[pathname] ?? `live ${pathname}`, { status: 200 });
};

test('install stores every listed file and survives one that is missing', async () => {
  const w = makeWorker({ serve });
  await w.install();
  const cache = w.stores.get('openparlor-v1');
  assert.ok(cache, 'a cache named after the version');
  assert.deepEqual([...cache.keys()].map((u) => new URL(u).pathname).sort(), ['/', '/api/config', '/solo', '/solo/solo.js']);
});

test('online it always asks the network first and refreshes the stored copy', async () => {
  const w = makeWorker({ serve });
  await w.install();
  files['/solo/solo.js'] = 'new code';
  const res = await (await w.request('/solo/solo.js'));
  assert.equal(await res.text(), 'new code', 'the current version, not the stored one');
  w.env.online = false;
  assert.equal(await (await w.request('/solo/solo.js')).text(), 'new code', 'and the refreshed copy is what is kept');
  files['/solo/solo.js'] = 'code';
});

test('offline it answers from the stored copy, ignoring query strings', async () => {
  const w = makeWorker({ serve });
  await w.install();
  w.env.online = false;
  assert.equal(await (await w.request('/solo?utm=1')).text(), 'solo');
  assert.equal(await (await w.request('/api/config')).text(), '{"brand":1}');
});

test('offline, an unknown page opens the home page and an unknown file fails cleanly', async () => {
  const w = makeWorker({ serve });
  await w.install();
  w.env.online = false;
  const page = await (await w.request('/somewhere/else', { mode: 'navigate' }));
  assert.equal(await page.text(), 'home', 'a page that was never stored opens the stored home page');
  const file = await (await w.request('/never-stored.png'));
  assert.equal(file.type, 'error', 'a file that was never stored fails instead of returning the wrong thing');
});

test('live rooms, profile data and non-GET requests are never touched', async () => {
  const w = makeWorker({ serve });
  await w.install();
  for (const p of ['/api/room', '/api/profiles', '/api/profiles/record', '/api/leaderboard?game=math', '/api/history', '/api/records', '/api/info', '/qr?text=x', '/ws', '/api/precache']) assert.equal(await w.request(p), null, p);
  assert.equal(await w.request('/solo', { method: 'POST', body: 'x' }), null);
  assert.equal(await w.request('http://elsewhere.example/solo'), null, 'other origins are left alone');
});

test('activating a new version removes the old caches and keeps the newest', async () => {
  const w = makeWorker({ serve });
  w.stores.set('openparlor-a1', new Map());
  w.stores.set('openparlor-b2', new Map());
  w.stores.set('someone-elses-cache', new Map());
  await w.activate();
  assert.deepEqual([...w.stores.keys()].sort(), ['openparlor-b2', 'someone-elses-cache']);
});
