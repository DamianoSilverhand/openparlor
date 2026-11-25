const crypto = require('crypto');
const { clean } = require('./util');

const GAMES = {
  whosaidthat: require('./games/whosaidthat'),
  draw: require('./games/draw'),
  quiz: require('./games/quiz'),
  minigames: require('./games/minigames'),
};

const CODE_LETTERS = 'ABCDEFGHJKMNPQRSTUVWXYZ';
const MAX_PLAYERS = 12;
const BRIEF_MS = 30000;
const AVATAR_COUNT = 12;

class Room {
  constructor(code) {
    this.code = code;
    this.players = new Map(); // id -> player
    this.tvs = new Set();
    this.hostId = null;
    this.game = null;
    this.briefing = null; // { until, total } while the how-to-play screen is up
    this.briefTimer = null;
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

  addPlayer(name, avatar, ws, profileId = null, level = null) {
    let n = clean(name, 14) || 'Player';
    const taken = new Set([...this.players.values()].map((p) => p.name.toLowerCase()));
    if (taken.has(n.toLowerCase())) {
      let i = 2;
      while (taken.has(`${n} ${i}`.toLowerCase())) i++;
      n = `${n} ${i}`;
    }
    const a = Number.isInteger(avatar) && avatar >= 0 && avatar < AVATAR_COUNT ? avatar : this.players.size % AVATAR_COUNT;
    const lvl = ['kid', 'teen', 'grownup'].includes(level) ? level : null;
    const p = {
      id: crypto.randomBytes(4).toString('hex'),
      token: crypto.randomBytes(12).toString('hex'),
      profileId: profileId || null,
      name: n,
      avatar: a,
      score: 0,
      level: lvl, // chosen in the lobby for games that use age levels
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
    if (this.briefing && !this.canStart()) {
      this.lobbyNote = 'A player left before the game started.';
      this.cancelBrief();
      return;
    }
    if (this.game && this.game.onPlayerChange) this.game.onPlayerChange();
    this.update();
  }

  // Players who still need to choose Kid, Teen or Grown-up (only matters for games that use levels).
  unchosen() {
    const def = GAMES[this.gameId];
    if (!def || !def.usesLevels) return [];
    return [...this.players.values()].filter((p) => p.connected && !p.level);
  }

  canStart() {
    const def = GAMES[this.gameId];
    return !!def && this.connectedCount() >= def.minPlayers && !this.unchosen().length;
  }

  // Show the how-to-play screen first. It ends when the host taps Start, or after a while.
  brief() {
    if (this.game || this.briefing || !this.canStart()) return;
    this.lobbyNote = '';
    const ms = this.gameId === 'minigames' ? 12000 : BRIEF_MS;
    this.briefing = { until: Date.now() + ms, total: ms };
    this.briefTimer = setTimeout(() => this.endBrief(), ms);
    this.update();
  }

  endBrief() {
    clearTimeout(this.briefTimer);
    this.briefTimer = null;
    if (!this.briefing) return;
    this.briefing = null;
    if (!this.startGame()) this.lobbyNote = 'Not enough players ready to start.';
    this.update();
  }

  cancelBrief() {
    clearTimeout(this.briefTimer);
    this.briefTimer = null;
    this.briefing = null;
    this.update();
  }

  startGame() {
    const def = GAMES[this.gameId];
    if (!def || this.connectedCount() < def.minPlayers || this.unchosen().length) return false;
    if (this.game) this.game.destroy();
    this.game = def.create(this);
    return true;
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
      case 'claimHost':
        if (!this.game && this.players.has(pid)) {
          this.hostId = pid;
          this.update();
        }
        return;
      case 'makeHost':
        if (isHost && !this.game && this.players.has(msg.id)) {
          this.hostId = msg.id;
          this.update();
        }
        return;
      case 'pause':
        if (isHost && this.game && typeof this.game.togglePause === 'function') {
          this.game.togglePause();
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
        if (isHost && !this.game) this.brief();
        return;
      case 'skipRules':
        if (isHost && this.briefing) this.endBrief();
        return;
      case 'cancelRules':
        if (isHost && this.briefing) this.cancelBrief();
        return;
      case 'again':
        // If someone joined late and has not picked a level, go back to the lobby so they can.
        if ((isHost || this.atFinal()) && this.game && !this.startGame()) this.endGame();
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
        // While paused, only the host's Next/skip gets through; answers and strokes wait for Resume.
        if (this.game && (!this.game.paused || (isHost && msg.a === 'next'))) this.game.onMessage(pid, msg);
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
      waitingOn: this.unchosen().map((p) => p.name),
      options: def.options,
      games: Object.values(GAMES).map((g) => ({ id: g.id, name: g.name })),
      settings: this.settings,
      inGame: !!this.game,
      lobbyNote: this.lobbyNote || '',
      briefing: this.briefing && !this.game ? { until: this.briefing.until, total: this.briefing.total, rules: def.rules || null } : null,
      players: [...this.players.values()].map((p) => ({
        id: p.id,
        name: p.name,
        avatar: p.avatar,
        score: p.score,
        level: p.level,
        connected: p.connected,
      })),
    };
    const wrap = (st) => (this.game ? { paused: !!this.game.paused, pausedLeft: this.game.pausedLeft || 0, ...st } : null);
    for (const ws of this.tvs) this.send(ws, { ...base, view: 'tv', game: wrap(this.game && this.game.tvState()) });
    for (const p of this.players.values()) {
      if (p.ws) this.send(p.ws, { ...base, view: 'phone', me: p.id, game: wrap(this.game && this.game.phoneState(p.id)) });
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
        clearTimeout(room.briefTimer);
        this.map.delete(code);
      }
    }
  }
}

module.exports = { Rooms, MAX_PLAYERS };
