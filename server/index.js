const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { WebSocketServer } = require('ws');
const QRCode = require('qrcode');
const { Rooms, MAX_PLAYERS } = require('./rooms');
const profiles = require('./profiles');
const content = require('./content');

const PORT = Number(process.env.PORT) || 3100;
const PUBLIC = path.join(__dirname, '..', 'public');
const rooms = new Rooms();

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.mp3': 'audio/mpeg',
  '.woff2': 'font/woff2',
};

function lanAddresses() {
  const out = [];
  for (const list of Object.values(os.networkInterfaces())) {
    for (const i of list || []) if (i.family === 'IPv4' && !i.internal) out.push(i.address);
  }
  // Home networks first.
  return out.sort((a, b) => Number(/^(192\.168|10\.)/.test(b)) - Number(/^(192\.168|10\.)/.test(a)));
}

function json(res, code, obj) {
  res.writeHead(code, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(obj));
}

function readBody(req) {
  return new Promise((resolve) => {
    let raw = '';
    req.on('data', (c) => {
      raw += c;
      if (raw.length > 32768) {
        req.destroy();
        resolve(null); // too big: the caller drops the request
      }
    });
    req.on('error', () => resolve(null));
    req.on('end', () => {
      try {
        resolve(JSON.parse(raw || '{}'));
      } catch {
        resolve({});
      }
    });
  });
}

function serveStatic(req, res, pathname) {
  let rel;
  try {
    rel = decodeURIComponent(pathname);
  } catch {
    return json(res, 400, { error: 'bad request' });
  }
  if (rel.includes('\0')) return json(res, 400, { error: 'bad request' });
  let file = path.normalize(path.join(PUBLIC, rel));
  const inside = path.relative(PUBLIC, file);
  if (inside.startsWith('..') || path.isAbsolute(inside)) return json(res, 403, { error: 'forbidden' });
  try {
    if (fs.statSync(file).isDirectory()) file = path.join(file, 'index.html');
  } catch {
    return json(res, 404, { error: 'not found' });
  }
  fs.readFile(file, (err, data) => {
    if (err) return json(res, 404, { error: 'not found' });
    res.writeHead(200, {
      'Content-Type': MIME[path.extname(file)] || 'application/octet-stream',
      'Cache-Control': 'no-cache',
    });
    res.end(data);
  });
}

// Headers for every response. The CSP keeps scripts and connections on this server; the pages use no external assets.
const SECURITY_HEADERS = {
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
  'X-Frame-Options': 'DENY',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
  'Content-Security-Policy': "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; connect-src 'self' ws: wss:; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'",
};

// Simple per-address limit for creating rooms: 20 per minute.
const roomHits = new Map();
function roomRateOk(ip) {
  const now = Date.now();
  const hits = (roomHits.get(ip) || []).filter((t) => now - t < 60000);
  if (hits.length >= 20) return false;
  hits.push(now);
  roomHits.set(ip, hits);
  return true;
}
setInterval(() => {
  const now = Date.now();
  for (const [ip, hits] of roomHits) if (!hits.some((t) => now - t < 60000)) roomHits.delete(ip);
}, 60000).unref();

async function handleRequest(req, res) {
  for (const [k, v] of Object.entries(SECURITY_HEADERS)) res.setHeader(k, v);
  let url;
  try {
    url = new URL(req.url, 'http://x');
  } catch {
    return json(res, 400, { error: 'bad request' });
  }
  const { pathname } = url;

  if (pathname === '/api/info') {
    const ips = lanAddresses();
    return json(res, 200, { ips, port: PORT, base: `http://${ips[0] || 'localhost'}:${PORT}` });
  }
  if (pathname === '/api/room' && req.method === 'POST') {
    if (!roomRateOk(req.socket.remoteAddress)) return json(res, 429, { error: 'Too many rooms created. Wait a minute and try again.' });
    const room = rooms.create();
    return room ? json(res, 200, { code: room.code }) : json(res, 503, { error: 'This server is full of rooms right now. Try again later.' });
  }
  if (pathname === '/api/room' && req.method === 'GET') {
    const room = rooms.get(url.searchParams.get('code'));
    return json(res, 200, { exists: !!room });
  }
  if (pathname === '/api/profiles' && req.method === 'GET') {
    return json(res, 200, { profiles: profiles.list() });
  }
  if (pathname === '/api/profiles' && req.method === 'POST') {
    const body = await readBody(req);
    if (body === null) return;
    const p = profiles.upsert(body);
    return p ? json(res, 200, { profile: p }) : json(res, 400, { error: 'bad profile' });
  }
  if (pathname === '/api/profiles/record' && req.method === 'POST') {
    const body = await readBody(req);
    if (body === null) return;
    const resObj = profiles.record(body.id, body.gameId, body.score, body.streak);
    return resObj ? json(res, 200, resObj) : json(res, 404, { error: 'profile not found' });
  }
  if (pathname.startsWith('/api/content/') && req.method === 'GET') {
    const name = pathname.slice('/api/content/'.length);
    if (!['scramble', 'literacy'].includes(name)) return json(res, 404, { error: 'not found' });
    const file = path.join(content.DIR, `${name}.json`);
    try {
      const data = JSON.parse(fs.readFileSync(file, 'utf8'));
      return json(res, 200, data);
    } catch {
      return json(res, 404, { error: 'not found' });
    }
  }
  if (pathname === '/api/langs' && req.method === 'GET') {
    const dir = path.join(content.DIR, 'lang');
    const langs = [];
    try {
      for (const f of fs.readdirSync(dir)) {
        if (!f.endsWith('.json')) continue;
        try {
          const d = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));
          langs.push({ id: d.id || f.replace(/\.json$/, ''), name: d.name || f, ...d });
        } catch {}
      }
    } catch {}
    return json(res, 200, { langs });
  }
  if (pathname === '/qr') {
    const text = (url.searchParams.get('text') || '').slice(0, 300);
    try {
      const svg = await QRCode.toString(text, { type: 'svg', margin: 1, color: { dark: '#1d1a17', light: '#fffbf2' } });
      res.writeHead(200, { 'Content-Type': 'image/svg+xml', 'Cache-Control': 'no-cache' });
      return res.end(svg);
    } catch {
      return json(res, 400, { error: 'bad qr' });
    }
  }
  serveStatic(req, res, pathname);
}

const server = http.createServer((req, res) => {
  handleRequest(req, res).catch((err) => {
    console.error('[http] error handling', req.method, req.url, err);
    if (!res.headersSent) json(res, 500, { error: 'server error' });
    else res.end();
  });
});

// ---- WebSockets ------------------------------------------------------------
// Messages are small (a stroke segment is the biggest), so 64 KB is generous. Larger ones close the connection.
const MAX_MESSAGE = 64 * 1024;
const MAX_CONNECTIONS = Number(process.env.MAX_CONNECTIONS) || 2000;
const wss = new WebSocketServer({ server, path: '/ws', maxPayload: MAX_MESSAGE });

wss.on('connection', (ws) => {
  if (wss.clients.size > MAX_CONNECTIONS) return ws.close(1013, 'server busy');
  const ctx = { room: null, pid: null, tv: false };
  ws.isAlive = true;
  ws.on('pong', () => (ws.isAlive = true));
  // Without an error listener, an oversized or malformed frame would be an uncaught exception.
  ws.on('error', () => {});

  // Per-connection rate limit (token bucket): 60 messages a second on average, bursts up to 200.
  let tokens = 200;
  let last = Date.now();
  let dropped = 0;

  const fail = (code, message) => ws.send(JSON.stringify({ t: 'error', code, message }));

  ws.on('message', (raw) => {
    const now = Date.now();
    tokens = Math.min(200, tokens + ((now - last) / 1000) * 60);
    last = now;
    if (tokens < 1) {
      if (++dropped > 200) ws.close(1008, 'too many messages');
      return;
    }
    tokens -= 1;
    dropped = 0;
    let msg;
    try {
      msg = JSON.parse(raw);
    } catch {
      return;
    }
    if (!msg || typeof msg.t !== 'string') return;
    try {
      onMessage(msg);
    } catch (err) {
      console.error('[ws] error handling message:', err);
    }
  });

  function onMessage(msg) {
    if (msg.t === 'tv') {
      const room = rooms.get(msg.room);
      if (!room) return fail('noroom', 'That room has gone. Start a new one.');
      ctx.room = room;
      ctx.tv = true;
      room.attachTv(ws);
      return;
    }

    if (msg.t === 'join') {
      const room = rooms.get(msg.room);
      if (!room) return fail('noroom', 'No room with that code. Check the TV and try again.');
      let p = room.byToken(msg.token);
      if (p) {
        if (p.ws && p.ws !== ws) p.ws.close();
        p.ws = ws;
        p.connected = true;
      } else {
        if (room.players.size >= MAX_PLAYERS) return fail('full', 'This room is full.');
        p = room.addPlayer(msg.name, msg.avatar, ws, msg.profileId, msg.level);
      }
      ctx.room = room;
      ctx.pid = p.id;
      ws.send(JSON.stringify({ t: 'welcome', id: p.id, token: p.token, code: room.code, name: p.name, avatar: p.avatar }));
      room.playerChanged();
      return;
    }

    if (ctx.room && ctx.pid) ctx.room.handle(ctx.pid, msg);
  }

  ws.on('close', () => {
    const room = ctx.room;
    if (!room) return;
    if (ctx.tv) {
      room.tvs.delete(ws);
      return;
    }
    const p = room.players.get(ctx.pid);
    if (p && p.ws === ws) {
      p.ws = null;
      p.connected = false;
      room.playerChanged();
    }
  });
});

setInterval(() => {
  for (const ws of wss.clients) {
    if (!ws.isAlive) {
      ws.terminate();
      continue;
    }
    ws.isAlive = false;
    ws.ping();
  }
}, 25000).unref();

// A bug should be logged, not end everyone's game night.
process.on('uncaughtException', (err) => console.error('[process] uncaught exception:', err));
process.on('unhandledRejection', (err) => console.error('[process] unhandled rejection:', err));

function shutdown(signal) {
  console.log(`\n${signal} received, shutting down.`);
  for (const ws of wss.clients) ws.close(1001, 'server stopping');
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 2000).unref();
}
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));

server.listen(PORT, '0.0.0.0', () => {
  const ips = lanAddresses();
  console.log('\nFamily Game Night is running.\n');
  console.log(`  On this computer:  http://localhost:${PORT}`);
  for (const ip of ips) console.log(`  On your network:   http://${ip}:${PORT}`);
  console.log('\nOpen the network address on the TV, then scan the QR code with phones.\n');
  if (content.problems.length) console.log(`Some content packs have problems (${content.problems.length}); run "npm run validate" for details.\n`);
});
