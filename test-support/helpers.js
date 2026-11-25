const { spawn } = require('node:child_process');
const net = require('node:net');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const WebSocket = require('ws');

const ROOT = path.join(__dirname, '..');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function freePort() {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.listen(0, '127.0.0.1', () => {
      const { port } = srv.address();
      srv.close(() => resolve(port));
    });
    srv.on('error', reject);
  });
}

// Starts the real server as a child process and waits until it answers.
async function startServer(env = {}) {
  const port = await freePort();
  // Tests never touch the real data folder: each server gets its own temporary one.
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'op-data-'));
  const child = spawn(process.execPath, ['--disable-warning=ExperimentalWarning', 'server/index.js'], { cwd: ROOT, env: { ...process.env, PORT: String(port), DATA_DIR: dataDir, ...env }, stdio: ['ignore', 'pipe', 'pipe'] });
  let log = '';
  child.stdout.on('data', (d) => (log += d));
  child.stderr.on('data', (d) => (log += d));
  const base = `http://127.0.0.1:${port}`;
  for (let i = 0; i < 50; i++) {
    try {
      if ((await fetch(`${base}/api/info`)).ok) break;
    } catch {}
    await sleep(100);
  }
  const alive = async () => {
    try {
      return (await fetch(`${base}/api/info`)).ok;
    } catch {
      return false;
    }
  };
  return { port, base, child, alive, log: () => log, stop: () => new Promise((r) => {
      if (child.exitCode !== null || child.signalCode) return r();
      child.once('exit', () => { fs.rmSync(dataDir, { recursive: true, force: true }); r(); }); child.kill('SIGTERM'); setTimeout(() => child.kill('SIGKILL'), 3000).unref(); }) };
}

const createRoom = async (base) => (await (await fetch(`${base}/api/room`, { method: 'POST' })).json()).code;

// A connected player (or the TV when name is null). `last` is always the newest state message.
function connect(server, code, name, extra = {}) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://127.0.0.1:${server.port}/ws`);
    let welcomed = false;
    const c = { ws, last: null, closed: null, send: (o) => ws.send(typeof o === 'string' ? o : JSON.stringify(o)) };
    ws.on('close', (code) => (c.closed = code));
    ws.on('error', reject);
    ws.on('message', (d) => {
      const m = JSON.parse(d);
      if (m.t === 'welcome') welcomed = true;
      if (m.t === 'state') {
        c.last = m;
        if (welcomed || name === null) resolve(c); // ready once the first state has arrived
      }
    });
    ws.on('open', () => c.send(name === null ? { t: 'tv', room: code } : { t: 'join', room: code, name, avatar: 1, level: 'grownup', ...extra }));
  });
}

module.exports = { startServer, createRoom, connect, sleep, ROOT };
