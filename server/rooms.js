const crypto = require('crypto');
const { clean } = require('./util');

const GAMES = {
  whosaidthat: require('./games/whosaidthat'),
  draw: require('./games/draw'),
  quiz: require('./games/quiz'),
};

const CODE_LETTERS = 'ABCDEFGHJKMNPQRSTUVWXYZ';
const MAX_PLAYERS = 12;
const AVATAR_COUNT = 12;

class Room {
  constructor(code) {
    this.code = code;
    this.players = new Map(); // id -> player
    this.tvs = new Set();
    this.hostId = null;
    this.game = null;
    this.gameId = 'whosaidthat';
    this.settingsAll = {};
    for (const [id, def] of Object.entries(GAMES)) this.settingsAll[id] = { ...def.defaults };
    this.touched = Date.now();
  }

  get settings() {
    return this.settingsAll[this.gameId];
  }

  send(ws, obj) {
    if (ws && ws.readyState === 1) ws.send(JSON.stringify(obj));
  }

  toTvs(obj) {
    for (const ws of this.tvs) this.send(ws, obj);
  }

  attachTv(ws) {
    this.tvs.add(ws);
    this.touched = Date.now();
    this.update();
    if (this.game && this.game.onTvConnect) this.game.onTvConnect(ws);
  }

  byToken(token) {
    if (!token) return null;
    for (const p of this.players.values()) if (p.token === token) return p;
    return null;
  }

  addPlayer(name, avatar, ws) {
    let n = clean(name, 14) || 'Player';
    const taken = new Set([...this.players.values()].map((p) => p.name.toLowerCase()));
    if (taken.has(n.toLowerCase())) {
      let i = 2;
      while (taken.has(`${n} ${i}`.toLowerCase())) i++;
      n = `${n} ${i}`;
    }
    const a = Number.isInteger(avatar) && avatar >= 0 && avatar < AVATAR_COUNT ? avatar : this.players.size % AVATAR_COUNT;
    const p = {
      id: crypto.randomBytes(4).toString('hex'),
      token: crypto.randomBytes(12).toString('hex'),
      name: n,
      avatar: a,
      score: 0,
      level: 'grownup',
      connected: true,
      ws,
    };
    this.players.set(p.id, p);
    if (!this.hostId) this.hostId = p.id;
    return p;
  }

  reassignHost() {
    const host = this.players.get(this.hostId);
    if (host && host.connected) return;
    const next = [...this.players.values()].find((p) => p.connected);
    if (next) this.hostId = next.id;
  }

  connectedCount() {
    return [...this.players.values()].filter((p) => p.connected).length;
  }

  isEmpty() {
    return this.connectedCount() === 0 && this.tvs.size === 0;
  }

  playerChanged() {
    this.touched = Date.now();
    this.reassignHost();
    if (this.game && this.game.onPlayerChange) this.game.onPlayerChange();
    this.update();
  }

  startGame() {
    const def = GAMES[this.gameId];
    if (!def || this.connectedCount() < def.minPlayers) return;
    if (this.game) this.game.destroy();
    this.game = def.create(this);
  }

  endGame() {
    if (this.game) this.game.destroy();
    this.game = null;
    for (const p of this.players.values()) p.score = 0;
    this.update();
  }

  // Once a game is over, anyone can start the next one.
  atFinal() {
    return !!this.game && this.game.phase === 'final';
  }

  handle(pid, msg) {
    this.touched = Date.now();
    const isHost = pid === this.hostId;
    switch (msg.t) {
      case 'level':
        if (!this.game && ['kid', 'teen', 'grownup'].includes(msg.level)) {
          const me = this.players.get(pid);
          if (me) me.level = msg.level;
          this.update();
        }
        return;
      case 'pickGame':
        if (isHost && !this.game && GAMES[msg.id]) {
          this.gameId = msg.id;
          this.update();
        }
        return;
      case 'settings': {
        if (!isHost || this.game) return;
        const incoming = msg.settings || {};
        for (const opt of GAMES[this.gameId].options) {
          if (opt.values.some(([v]) => v === incoming[opt.key])) this.settings[opt.key] = incoming[opt.key];
        }
        this.update();
        return;
      }
      case 'start':
        if (isHost && !this.game) this.startGame();
        return;
      case 'again':
        if ((isHost || this.atFinal()) && this.game) this.startGame();
        return;
      case 'lobby':
        if (isHost || this.atFinal()) {
          this.hostId = pid; // whoever heads back to the lobby can choose the next game
          this.endGame();
        }
        return;
      case 'kick': {
        if (!isHost || msg.id === pid) return;
        const p = this.players.get(msg.id);
        if (!p) return;
        this.players.delete(p.id);
        this.send(p.ws, { t: 'kicked' });
        if (p.ws) p.ws.close();
        this.playerChanged();
        return;
      }
      case 'g':
        if (this.game) this.game.onMessage(pid, msg);
        return;
    }
  }

  update() {
    const def = GAMES[this.gameId];
    const base = {
      t: 'state',
      now: Date.now(),
      code: this.code,
      hostId: this.hostId,
      gameId: this.gameId,
      gameName: def.name,
      gameDesc: def.desc,
      minPlayers: def.minPlayers,
      usesLevels: !!def.usesLevels,
      levelHint: def.levelHint || '',
      options: def.options,
      games: Object.values(GAMES).map((g) => ({ id: g.id, name: g.name })),
      settings: this.settings,
      inGame: !!this.game,
      players: [...this.players.values()].map((p) => ({
        id: p.id,
        name: p.name,
        avatar: p.avatar,
        score: p.score,
        level: p.level,
        connected: p.connected,
      })),
    };
    for (const ws of this.tvs) this.send(ws, { ...base, view: 'tv', game: this.game ? this.game.tvState() : null });
    for (const p of this.players.values()) {
      if (p.ws) this.send(p.ws, { ...base, view: 'phone', me: p.id, game: this.game ? this.game.phoneState(p.id) : null });
    }
  }
}

class Rooms {
  constructor() {
    this.map = new Map();
    setInterval(() => this.sweep(), 10 * 60 * 1000).unref();
  }

  create() {
    let code;
    do {
      code = Array.from({ length: 4 }, () => CODE_LETTERS[Math.floor(Math.random() * CODE_LETTERS.length)]).join('');
    } while (this.map.has(code));
    const room = new Room(code);
    this.map.set(code, room);
    return room;
  }

  get(code) {
    return this.map.get(String(code || '').toUpperCase());
  }

  sweep() {
    const cutoff = Date.now() - 3 * 60 * 60 * 1000;
    for (const [code, room] of this.map) {
      if (room.isEmpty() && room.touched < cutoff) {
        if (room.game) room.game.destroy();
        this.map.delete(code);
      }
    }
  }
}

module.exports = { Rooms, MAX_PLAYERS };
