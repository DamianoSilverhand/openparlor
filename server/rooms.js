const crypto = require('crypto');
const { clean } = require('./util');
const { config, bands } = require('./config');
const history = require('./history');
const { loadGames } = require('./sdk/loader');

// Every game found in games/ and plugins/, as a null-prototype map so ids such as "__proto__" are not games.
const { games: GAMES, problems: gameProblems } = loadGames();
// A game whose content packs are missing or invalid is hidden instead of crashing.
const usable = (id) => typeof id === 'string' && !!GAMES[id] && (typeof GAMES[id].available !== 'function' || GAMES[id].available());
const firstUsable = () => Object.keys(GAMES).find(usable) || Object.keys(GAMES)[0];
const MAX_ROOMS = config.limits.maxRooms;
const UPDATE_MS = 80;
const REACTIONS = ['👏', '😂', '😮', '❤️', '🔥', '👍', '🎉', '😱'];
// The parts of the state that rarely change. A connection that already has the current copy is not sent it again.
const SLOW_KEYS = ['players', 'games', 'options', 'settings'];
// Preset or local config may change a game's default settings, but only to values the game really offers.
function configuredDefaults(def) {
  const wanted = (config.gameDefaults || {})[def.id];
  const out = {};
  if (wanted && typeof wanted === 'object') {
    for (const opt of def.options || []) if (opt.key in wanted && opt.values.some(([v]) => v === wanted[opt.key])) out[opt.key] = wanted[opt.key];
  }
  return out;
}

const CODE_LETTERS = 'ABCDEFGHJKMNPQRSTUVWXYZ';
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
    this.audience = new Map(); // people who are only watching: they react and vote, but are never part of a game
    this.reactCounts = {};
    this.reactTimer = null;
    this.lastFlush = 0;
    this.flushTimer = null;
    this.gameId = firstUsable();
    this.settingsAll = {};
    for (const [id, def] of Object.entries(GAMES)) this.settingsAll[id] = { ...def.defaults, ...configuredDefaults(def) };
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
    for (const p of [...this.players.values(), ...this.audience.values()]) if (p.token === token) return p;
    return null;
  }

  // The definition of the game currently picked.
  def() {
    return GAMES[this.gameId];
  }

  // A player or an audience member.
  participant(id) {
    return this.players.get(id) || this.audience.get(id) || null;
  }

  // The audience are kept apart from the players on purpose: games only ever see players, so a hundred people watching
  // can never be given a turn, a team, a vote that counts, or a score.
  moveToAudience(p, auto) {
    if (!this.players.delete(p.id)) return;
    p.audience = true;
    p.autoAudience = !!auto;
    p.score = 0;
    this.audience.set(p.id, p);
    this.reassignHost();
  }

  moveToPlayers(p) {
    if (!this.audience.delete(p.id)) return;
    p.audience = false;
    p.autoAudience = false;
    this.players.set(p.id, p);
    if (!this.hostId || !this.players.has(this.hostId)) this.hostId = p.id;
  }

  // Emoji reactions from anyone go to the big screen as small batches, so a crowd cheering does not flood it.
  react(p, emoji) {
    if (!REACTIONS.includes(emoji)) return;
    const now = Date.now();
    if (p.lastReact && now - p.lastReact < 350) return;
    p.lastReact = now;
    this.reactCounts[emoji] = (this.reactCounts[emoji] || 0) + 1;
    if (this.reactTimer) return;
    this.reactTimer = setTimeout(() => {
      this.reactTimer = null;
      const counts = this.reactCounts;
      this.reactCounts = {};
      this.toTvs({ t: 'reactions', counts });
    }, 400);
    this.reactTimer.unref();
  }

  // Messages from someone who is only watching: a role change in the lobby, reactions, and the crowd poll.
  audienceMessage(p, msg) {
    switch (msg.t) {
      case 'role':
        if (msg.audience === false && !this.game && !this.briefing) {
          if (config.limits.maxPlayers > 0 && this.players.size >= config.limits.maxPlayers) return;
          this.moveToPlayers(p);
          this.update();
        }
        return;
      case 'react':
        return this.react(p, msg.e);
      case 'aud':
        if (this.game && typeof this.game.audienceVote === 'function') this.game.audienceVote(p.id, msg.idx);
        return;
    }
  }

  // An avatar is an animal (0 to 11) plus a colour shift (0 to 11, times 12), so up to 144 players look different. The
  // animal is the player's choice when it is free in some colour; otherwise the next animal along is used.
  freeAvatar(wanted) {
    const crowd = this.players.size + this.audience.size;
    const animal = Number.isInteger(wanted) && wanted >= 0 ? wanted % AVATAR_COUNT : crowd % AVATAR_COUNT;
    const used = new Set([...this.players.values(), ...this.audience.values()].map((p) => p.avatar));
    // First the player's own animal in each colour, then the neighbouring animals: 144 looks before any repeat.
    for (let k = 0; k < AVATAR_COUNT; k++) {
      for (let shift = 0; shift < AVATAR_COUNT; shift++) {
        const candidate = ((animal + k) % AVATAR_COUNT) + AVATAR_COUNT * shift;
        if (!used.has(candidate)) return candidate;
      }
    }
    return animal + AVATAR_COUNT * (crowd % AVATAR_COUNT);
  }

  addPlayer(name, avatar, ws, profileId = null, level = null, { audience = false, auto = false } = {}) {
    let n = clean(name, 14) || 'Player';
    const taken = new Set([...this.players.values(), ...this.audience.values()].map((p) => p.name.toLowerCase()));
    if (taken.has(n.toLowerCase())) {
      let i = 2;
      while (taken.has(`${n} ${i}`.toLowerCase())) i++;
      n = `${n} ${i}`;
    }
    const a = this.freeAvatar(avatar);
    // A band id from the config (older saved data may still use kid, teen or grownup). With a single band, nobody has to choose.
    const lvl = bands.fromLegacy(level) || (bands.ids.length === 1 ? bands.ids[0] : null);
    const p = {
      id: crypto.randomBytes(4).toString('hex'),
      token: crypto.randomBytes(12).toString('hex'),
      profileId: profileId || null,
      name: n,
      avatar: a,
      score: 0,
      level: lvl, // a band id, chosen in the lobby for games that use bands
      connected: true,
      audience: !!audience,
      autoAudience: !!audience && !!auto, // moved to the audience by the room (late arrival, or a game with limited seats), not by choice
      ws,
    };
    if (audience) {
      this.audience.set(p.id, p);
    } else {
      this.players.set(p.id, p);
      if (!this.hostId) this.hostId = p.id;
    }
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

  // Players who still need to choose a band (only matters for games that use bands).
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
    // A game with limited seats: the latest arrivals watch instead, until the game ends.
    if (def.maxSeats && this.players.size > def.maxSeats) {
      const extra = [...this.players.values()].filter((p) => p.id !== this.hostId).slice(def.maxSeats - 1);
      for (const p of extra) this.moveToAudience(p, true);
      this.lobbyNote = `${def.name} has seats for ${def.maxSeats} players, so ${extra.length} of you are watching and can react and vote.`;
    }
    if (this.game) this.game.destroy();
    this.game = def.create(this);
    this.game.startedAt = Date.now();
    return true;
  }

  // When a game reaches its final screen, keep the result for the history and leaderboards (once per game).
  recordHistory() {
    const g = this.game;
    if (!g || g.phase !== 'final' || g.historyDone || !config.profiles.enabled) return;
    g.historyDone = true;
    try {
      const ranked = [...this.players.values()].sort((a, b) => b.score - a.score);
      let rank = 0;
      const results = ranked.map((p, i) => {
        if (i === 0 || p.score !== ranked[i - 1].score) rank = i;
        return { profileId: p.profileId, name: p.name, band: p.level, score: p.score, rank };
      });
      history.recordGame({ gameId: this.gameId, roomCode: this.code, startedAt: g.startedAt || Date.now(), endedAt: Date.now(), settings: this.settings, results });
    } catch (err) {
      console.error('[history] could not save the game:', err);
    }
  }

  endGame() {
    if (this.game) this.game.destroy();
    this.game = null;
    for (const p of this.players.values()) p.score = 0;
    // People the room moved to the audience for this game (late arrivals, limited seats) get their seat back.
    for (const p of [...this.audience.values()]) if (p.autoAudience) this.moveToPlayers(p);
    this.update();
  }

  // Once a game is over, anyone can start the next one.
  atFinal() {
    return !!this.game && this.game.phase === 'final';
  }

  // One bad message must never take the server down: log it and carry on.
  handle(pid, msg) {
    try {
      this.dispatch(pid, msg);
    } catch (err) {
      console.error(`[room ${this.code}] error handling "${msg && msg.t}":`, err);
    }
  }

  dispatch(pid, msg) {
    this.touched = Date.now();
    const watcher = this.audience.get(pid);
    if (watcher) return this.audienceMessage(watcher, msg);
    const isHost = pid === this.hostId;
    switch (msg.t) {
      case 'react':
        if (this.players.has(pid)) this.react(this.players.get(pid), msg.e);
        return;
      case 'role': {
        // A player chooses to just watch (only in the lobby, and the host stays a player while others are here).
        const me = this.players.get(pid);
        if (me && msg.audience === true && !this.game && !this.briefing && !(isHost && this.players.size === 1)) {
          this.moveToAudience(me, false);
          this.update();
        }
        return;
      }
      case 'setRole': {
        const them = this.participant(msg.id);
        if (!isHost || !them || this.game || this.briefing || them.id === pid) return;
        if (msg.audience === true) this.moveToAudience(them, false);
        else if (!(config.limits.maxPlayers > 0 && this.players.size >= config.limits.maxPlayers)) this.moveToPlayers(them);
        this.update();
        return;
      }
      case 'level':
        if (!this.game && bands.fromLegacy(msg.level)) {
          const me = this.players.get(pid);
          if (me) me.level = bands.fromLegacy(msg.level);
          this.update();
        }
        return;
      case 'pickGame':
        if (isHost && !this.game && usable(msg.id)) {
          this.gameId = msg.id;
          this.update();
        }
        return;
      case 'claimHost':
        if (config.host.allowClaim && !this.game && this.players.has(pid)) {
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
        const incoming = msg.settings !== null && typeof msg.settings === 'object' && !Array.isArray(msg.settings) ? msg.settings : {};
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
        const p = this.participant(msg.id);
        if (!p) return;
        this.players.delete(p.id);
        this.audience.delete(p.id);
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

  // Sends fresh state to the TV and every phone. Many things can change at once in a big room (a hundred answers
  // arriving together), so this is throttled: the first change goes out at once and anything in the next UPDATE_MS is
  // folded into one more send. A small room feels instant; a big one sends about ten updates a second at most.
  update() {
    const wait = this.lastFlush + UPDATE_MS - Date.now();
    if (wait <= 0) return this.flush();
    if (!this.flushTimer) {
      this.flushTimer = setTimeout(() => this.flush(), wait);
      this.flushTimer.unref();
    }
  }

  flush() {
    clearTimeout(this.flushTimer);
    this.flushTimer = null;
    this.lastFlush = Date.now();
    this.recordHistory();
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
      games: Object.values(GAMES).filter((g) => usable(g.id)).map((g) => ({ id: g.id, name: g.name, client: { tv: `/games/${g.id}/${g.client.tv}`, play: `/games/${g.id}/${g.client.play}`, styles: g.client.styles.map((f) => `/games/${g.id}/${f}`) } })),
      settings: this.settings,
      inGame: !!this.game,
      lobbyNote: this.lobbyNote || '',
      audienceCount: [...this.audience.values()].filter((p) => p.connected).length,
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
    const canPause = this.game ? (typeof this.game.canPause === 'function' ? this.game.canPause() : this.game.phase !== 'final') : false;
    const poll = this.game && this.game.poll ? this.game.pollState() : undefined;
    const wrap = (st) => (this.game ? { paused: !!this.game.paused, pausedLeft: this.game.pausedLeft || 0, canPause, ...(poll ? { poll } : {}), ...st } : null);
    // Each slow part is turned into text once, and left out for a connection that was already sent the same text.
    const slow = {};
    for (const k of SLOW_KEYS) slow[k] = JSON.stringify(base[k]);
    const out = (ws, msg) => {
      ws.slowSent = ws.slowSent || {};
      for (const k of SLOW_KEYS) {
        if (ws.slowSent[k] === slow[k]) delete msg[k];
        else ws.slowSent[k] = slow[k];
      }
      this.send(ws, msg);
    };
    for (const ws of this.tvs) out(ws, { ...base, view: 'tv', game: wrap(this.game && this.game.tvState()) });
    for (const p of this.players.values()) {
      if (p.ws) out(p.ws, { ...base, view: 'phone', me: p.id, game: wrap(this.game && this.game.phoneState(p.id)) });
    }
    // Watchers see what the big screen shows (never a player's private state).
    for (const [id, p] of this.audience) {
      if (!p.connected && p.leftAt && Date.now() - p.leftAt > 5 * 60 * 1000) this.audience.delete(id);
      else if (p.ws) out(p.ws, { ...base, view: 'phone', me: p.id, audience: true, you: { id: p.id, name: p.name, avatar: p.avatar }, game: wrap(this.game && { ...this.game.tvState(), myVote: this.game.poll ? this.game.poll.votes.get(id) ?? null : null }) });
    }
  }
}

class Rooms {
  constructor() {
    this.map = new Map();
    setInterval(() => this.sweep(), 10 * 60 * 1000).unref();
  }

  // Returns null when the server is full of rooms (MAX_ROOMS). Empty rooms older than ten minutes are reclaimed first.
  create() {
    if (this.map.size >= MAX_ROOMS) this.sweep(10 * 60 * 1000);
    if (this.map.size >= MAX_ROOMS) return null;
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

  sweep(maxAge = 3 * 60 * 60 * 1000) {
    const cutoff = Date.now() - maxAge;
    for (const [code, room] of this.map) {
      if (room.isEmpty() && room.touched < cutoff) {
        if (room.game) room.game.destroy();
        clearTimeout(room.briefTimer);
        clearTimeout(room.flushTimer);
        this.map.delete(code);
      }
    }
  }
}

module.exports = { Rooms, GAMES, gameProblems };
