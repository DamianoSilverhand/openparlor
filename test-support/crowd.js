// Helpers for big-room tests: many simulated phones at once, timing, and the server's memory use.
const { execSync } = require('node:child_process');
const { connect, createRoom, sleep } = require('./helpers');

const LEVELS = ['adult', 'teen', 'kid'];
const people = (n) => Array.from({ length: n }, (_, i) => [`P${i + 1}`, LEVELS[i % 3]]);

// Connects n clients at the same moment, as a room full of people scanning the QR code would.
async function joinCrowd(server, code, n, extra = () => ({})) {
  const started = Date.now();
  const clients = await Promise.all(Array.from({ length: n }, (_, i) => connect(server, code, `P${i + 1}`, { level: LEVELS[i % 3], ...extra(i) })));
  const ms = Date.now() - started;
  await sleep(200);
  // Everyone joined at once, so who became the host is a matter of who arrived first.
  const host = clients.find((c) => c.last.me === c.last.hostId);
  return { clients, ms, host };
}

// The server's resident memory in megabytes (ps works on macOS and Linux).
function rssMb(server) {
  try {
    return Number(execSync(`ps -o rss= -p ${server.child.pid}`).toString().trim()) / 1024;
  } catch {
    return NaN;
  }
}

// After `send()`, how long until every client's state satisfies `ready(state)`? Returns the sorted arrival times in ms.
async function fanOut(clients, send, ready, timeoutMs = 5000) {
  const t0 = Date.now();
  const arrived = new Array(clients.length).fill(null);
  const handlers = clients.map((c, i) => {
    const h = () => { if (arrived[i] === null && c.last && ready(c.last)) arrived[i] = Date.now() - t0; };
    c.ws.on('message', h);
    return h;
  });
  send();
  while (arrived.some((a) => a === null) && Date.now() - t0 < timeoutMs) await sleep(10);
  clients.forEach((c, i) => c.ws.off('message', handlers[i]));
  return arrived.map((a) => (a === null ? Infinity : a)).sort((a, b) => a - b);
}

const percentile = (sorted, p) => sorted[Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1)];

module.exports = { people, joinCrowd, rssMb, fanOut, percentile, createRoom, connect, sleep };
