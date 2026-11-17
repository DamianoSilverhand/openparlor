const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { WebSocketServer } = require('ws');
const QRCode = require('qrcode');
const { Rooms, MAX_PLAYERS } = require('./rooms');

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

function serveStatic(req, res, pathname) {
  let rel = decodeURIComponent(pathname);
  let file = path.normalize(path.join(PUBLIC, rel));
  if (!file.startsWith(PUBLIC)) return json(res, 403, { error: 'forbidden' });
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

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  const { pathname } = url;

  if (pathname === '/api/info') {
    const ips = lanAddresses();
    return json(res, 200, { ips, port: PORT, base: `http://${ips[0] || 'localhost'}:${PORT}` });
  }
  if (pathname === '/api/room' && req.method === 'POST') {
    return json(res, 200, { code: rooms.create().code });
  }
  if (pathname === '/api/room' && req.method === 'GET') {
    const room = rooms.get(url.searchParams.get('code'));
    return json(res, 200, { exists: !!room });
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
});

// ---- WebSockets ------------------------------------------------------------
const wss = new WebSocketServer({ server, path: '/ws' });

wss.on('connection', (ws) => {
  const ctx = { room: null, pid: null, tv: false };
  ws.isAlive = true;
  ws.on('pong', () => (ws.isAlive = true));

  const fail = (code, message) => ws.send(JSON.stringify({ t: 'error', code, message }));

  ws.on('message', (raw) => {
    let msg;
    try {
      msg = JSON.parse(raw);
    } catch {
      return;
    }
    if (!msg || typeof msg.t !== 'string') return;

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
        p = room.addPlayer(msg.name, msg.avatar, ws);
      }
      ctx.room = room;
      ctx.pid = p.id;
      ws.send(JSON.stringify({ t: 'welcome', id: p.id, token: p.token, code: room.code, name: p.name, avatar: p.avatar }));
      room.playerChanged();
      return;
    }

    if (ctx.room && ctx.pid) ctx.room.handle(ctx.pid, msg);
  });

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

server.listen(PORT, '0.0.0.0', () => {
  const ips = lanAddresses();
  console.log('\nFamily Game Night is running.\n');
  console.log(`  On this computer:  http://localhost:${PORT}`);
  for (const ip of ips) console.log(`  On your network:   http://${ip}:${PORT}`);
  console.log('\nOpen the network address on the TV, then scan the QR code with phones.\n');
});
