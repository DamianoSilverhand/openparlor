const fs = require('fs');
const path = require('path');
const { shuffle, schedulePhase, toggleGamePause } = require('../util');
const { bands } = require('../config');
const profiles = require('../profiles');

// Group records for "play together" mode, kept between sessions. The key is the game, the number of players
// who started the round and the handicap setting (handicaps change scores).
const RECORDS_FILE = path.join(require('../config').config.dataDir, 'records.json');
let RECORDS = {};
try {
  RECORDS = JSON.parse(fs.readFileSync(RECORDS_FILE, 'utf8'));
  // Older records had a trailing content setting ("...:off"). Keep the ones that had it off.
  for (const [k, v] of Object.entries({ ...RECORDS })) {
    if (/:(on|off):(off|mixed|only)$/.test(k)) {
      delete RECORDS[k];
      if (k.endsWith(':off')) RECORDS[k.replace(/:off$/, '')] = v;
    }
  }
} catch {}
function saveRecord(key, total) {
  RECORDS[key] = { total, date: new Date().toISOString().slice(0, 10) };
  try {
    fs.mkdirSync(path.dirname(RECORDS_FILE), { recursive: true });
    fs.writeFileSync(RECORDS_FILE, JSON.stringify(RECORDS, null, 2));
  } catch {}
}

// The mini-games themselves run on the phones. The server picks the set, hands out a shared seed and
// start time, collects each player's score, and awards points for finishing 1st, 2nd, 3rd and so on.
const MINI = {
  memory: { name: 'Memory Match', howto: 'Flip two cards at a time and find every matching pair. Fewer misses and a faster finish score more.', duration: 60, max: 1400 },
  scramble: { name: 'Word Builder', howto: 'Tap the letter tiles to spell the word that fits the clue. Example: the clue "Frozen water" is ICE. Tap Hint if you are stuck (it costs points). Words in a row build a streak bonus.', duration: 60, max: 3000 },
  math: { name: 'Number Dash', howto: 'Tap the right answer to each sum as fast as you can. Example: 6 × 7 is 42. A streak of right answers multiplies your points. A wrong tap costs you.', duration: 40, max: 3500 },
  logic: { name: 'Logic Chain', howto: 'Work out the answer to each puzzle. Number pattern: 2, 4, 6, ? is 8. Odd one out: 2, 4, 7, 8 is 7. Some are quick riddles, like who is taller.', duration: 50, max: 3000 },
  literacy: { name: 'Word Match', howto: 'Pick the correct option. It might be the right spelling (because, not becuase), the meaning of a word, or the missing word in a sentence.', duration: 50, max: 3000 },
  reaction: { name: 'Quick Tap', howto: 'Wait for the screen to turn green, then tap as fast as you can. Tap too early and you lose time. Five tries.', duration: 50, max: 2500 },
  pattern: { name: 'Copy Cat', howto: 'Watch the colours light up, then repeat the pattern. It gets one step longer each round.', duration: 90, max: 3500 },
  clash: { name: 'Colour Clash', howto: 'Tap the colour of the INK, not the colour the word says. Wrong taps cost you.', duration: 30, max: 3500 },
};
const POINTS = [10, 7, 5];
const OTHER_POINTS = 3;
const INTRO_MS = 9000;
const COUNTDOWN_MS = 3200;
const GRACE_MS = 3000;
const RESULTS_MS = 10000;

const FOCUS = {
  mix: Object.keys(MINI),
  brain: ['scramble', 'math', 'logic', 'literacy', 'memory'],
  speed: ['reaction', 'pattern', 'clash'],
};

class MiniGames {
  constructor(room) {
    this.room = room;
    this.s = { ...room.settings };
    const pool = FOCUS[this.s.focus] || FOCUS.mix;
    const picked = shuffle(pool);
    while (picked.length < this.s.games) picked.push(...shuffle(Object.keys(MINI)).filter((k) => !picked.includes(k)));
    this.order = picked.slice(0, this.s.games);
    this.total = this.order.length;
    this.idx = 0;
    this.timer = null;
    this.liveTimer = null;
    this.deadline = 0;
    this.timerTotal = 0;
    this.stats = new Map();
    this.gains = new Map();
    this.setRecords = [];
    for (const p of room.players.values()) p.score = 0;
    this.startIntro();
  }

  // ---- helpers -----------------------------------------------------------
  later(ms, fn) {
    schedulePhase(this, ms, fn);
  }
  togglePause() {
    toggleGamePause(this, this.phase !== 'play');
  }
  destroy() {
    clearTimeout(this.timer);
    clearTimeout(this.liveTimer);
  }
  stat(id) {
    if (!this.stats.has(id)) this.stats.set(id, { wins: 0, best: 0 });
    return this.stats.get(id);
  }
  levelOf(id) {
    const p = this.room.players.get(id);
    return this.s.handicap === 'on' && p && p.level ? bands.tierName(p.level) : 'hard';
  }
  connectedRoster() {
    return this.roster.filter((id) => (this.room.players.get(id) || {}).connected);
  }

  // ---- flow --------------------------------------------------------------
  startIntro() {
    this.idx++;
    this.id = this.order[this.idx - 1];
    this.def = MINI[this.id];
    this.roster = [...this.room.players.values()].filter((p) => p.connected).map((p) => p.id);
    this.results = new Map(); // pid -> score
    this.live = new Map();
    this.gains = new Map();
    this.seed = Math.floor(Math.random() * 2 ** 31);
    this.phase = 'intro';
    this.later(INTRO_MS, () => this.startPlay());
    this.room.update();
  }

  startPlay() {
    if (this.phase !== 'intro') return;
    this.startAt = Date.now() + COUNTDOWN_MS;
    this.endAt = this.startAt + this.def.duration * 1000;
    this.phase = 'play';
    this.later(this.endAt + GRACE_MS - Date.now(), () => this.finish());
    this.room.update();
  }

  checkProgress() {
    if (this.phase !== 'play') return;
    const conn = this.connectedRoster();
    if (conn.length && conn.every((id) => this.results.has(id)) && this.deadline - Date.now() > 2500) {
      this.later(1500, () => this.finish());
    }
  }
  onPlayerChange() {
    this.checkProgress();
  }

  finish() {
    if (this.phase !== 'play') return;
    const rows = this.roster.filter((id) => this.results.has(id)).map((id) => ({ id, score: this.results.get(id) }));
    rows.sort((a, b) => b.score - a.score);
    if (this.s.mode === 'team') {
      // Playing together: everyone's score goes into one group total. There are no winners.
      rows.forEach((r, i) => {
        r.rank = i;
        r.pts = null;
        const p = this.room.players.get(r.id);
        if (p) p.score += r.score;
        this.gains.set(r.id, r.score);
        this.stat(r.id).best = Math.max(this.stat(r.id).best, r.score / this.def.max);
      });
      const total = rows.reduce((sum, r) => sum + r.score, 0);
      const count = this.roster.length;
      // A record needs a score from everyone who started the round, so a dropped phone can't set a low one.
      const complete = rows.length === count;
      const key = `${this.id}:${count}:${this.s.handicap}`;
      const previous = RECORDS[key] ? RECORDS[key].total : 0;
      const record = complete && count >= 2 && total > previous;
      if (record) saveRecord(key, total);
      // A plain-English description of what this record is for, so every message can say what it compares against.
      const scope = `${count} players, handicaps ${this.s.handicap}`;
      this.teamRound = { total, previous, record, count, complete, scope };
      this.setRecords.push({ name: this.def.name, total, previous, record, scope });
    } else {
      let rank = 0;
      rows.forEach((r, i) => {
        if (i === 0 || r.score !== rows[i - 1].score) rank = i;
        r.rank = rank;
        r.pts = POINTS[rank] || OTHER_POINTS;
        const p = this.room.players.get(r.id);
        if (p) p.score += r.pts;
        this.gains.set(r.id, r.pts);
        if (rank === 0) this.stat(r.id).wins++;
        this.stat(r.id).best = Math.max(this.stat(r.id).best, r.score / this.def.max);
      });
    }
    this.personalBests = [];
    rows.forEach((r) => {
      const p = this.room.players.get(r.id);
      if (p && p.profileId && require('../config').config.profiles.enabled) {
        const res = profiles.record(p.profileId, this.id, r.score);
        if (res && res.isNewBest) this.personalBests.push(r.id);
      }
    });
    this.rows = rows;
    this.phase = 'results';
    this.later(RESULTS_MS, () => this.afterResults());
    this.room.update();
  }

  afterResults() {
    if (this.phase !== 'results') return;
    if (this.idx >= this.total) {
      clearTimeout(this.timer);
      this.deadline = 0;
      this.phase = 'final';
      this.room.update();
    } else {
      this.startIntro();
    }
  }

  // ---- input -------------------------------------------------------------
  onMessage(pid, msg) {
    const room = this.room;
    switch (msg.a) {
      case 'progress': {
        if (this.phase !== 'play' || !this.roster.includes(pid) || this.results.has(pid)) return;
        this.live.set(pid, Math.max(0, Math.min(this.def.max, Number(msg.score) || 0)));
        if (!this.liveTimer) {
          this.liveTimer = setTimeout(() => {
            this.liveTimer = null;
            if (this.phase === 'play') room.update();
          }, 600);
        }
        return;
      }
      case 'result': {
        if (this.phase !== 'play' || !this.roster.includes(pid) || this.results.has(pid)) return;
        if (Date.now() < this.startAt) return;
        const score = Math.round(Math.max(0, Math.min(this.def.max, Number(msg.score) || 0)));
        this.results.set(pid, score);
        this.live.set(pid, score);
        room.update();
        this.checkProgress();
        return;
      }
      case 'next': {
        if (pid !== room.hostId) return;
        if (this.phase === 'intro') this.startPlay();
        else if (this.phase === 'play') this.finish();
        else if (this.phase === 'results') this.afterResults();
        return;
      }
    }
  }

  // ---- views -------------------------------------------------------------
  standings() {
    return [...this.room.players.values()]
      .map((p) => ({ id: p.id, score: p.score, gain: this.gains.get(p.id) || 0 }))
      .sort((a, b) => b.score - a.score);
  }

  awards() {
    let wins = null;
    let best = null;
    for (const p of this.room.players.values()) {
      const st = this.stat(p.id);
      if (st.wins > 0 && (!wins || st.wins > wins.value)) wins = { id: p.id, value: st.wins };
      if (st.best > 0 && (!best || st.best > best.value)) best = { id: p.id, value: Math.round(st.best * 100) };
    }
    return { wins, best };
  }

  state(pid) {
    const g = {
      phase: this.phase,
      idx: this.idx,
      total: this.total,
      deadline: this.deadline,
      timerTotal: this.timerTotal,
      title: 'Mini-Games',
      mg: { id: this.id, name: this.def.name, howto: this.def.howto, duration: this.def.duration, max: this.def.max },
      lineup: this.order.map((id) => MINI[id].name),
      team: this.s.mode === 'team',
    };
    if (this.phase === 'play') {
      g.seed = this.seed;
      g.startAt = this.startAt;
      g.endAt = this.endAt;
      g.roster = this.roster;
      g.done = [...this.results.keys()];
      if (!pid) g.live = this.roster.map((id) => ({ id, score: this.live.get(id) || 0 }));
      else {
        g.level = this.levelOf(pid);
        g.inRound = this.roster.includes(pid);
        g.myResult = this.results.has(pid) ? this.results.get(pid) : null;
      }
    }
    if (this.phase === 'results') {
      g.rows = this.rows;
      g.standings = this.standings();
      g.personalBests = this.personalBests || [];
      if (g.team) g.teamRound = this.teamRound;
    }
    if (this.phase === 'final') {
      g.standings = this.standings();
      g.awards = this.awards();
      if (g.team) {
        g.teamTotal = this.standings().reduce((sum, x) => sum + x.score, 0);
        g.setRecords = this.setRecords;
      }
    }
    return g;
  }

  tvState() {
    return this.state(null);
  }
  phoneState(pid) {
    return this.state(pid);
  }
}

module.exports = {
  id: 'minigames',
  name: 'Mini-Games',
  desc: 'Quick rounds of memory, words, reflexes and numbers. Everyone gets a chance to shine.',
  rules: {
    steps: [
      'Everyone plays a short game on their own phone at the same time. Before each game you get a how-to and a countdown.',
      'Players in an easier group get an easier version, so everyone has a fair shot.',
      "Race mode ranks you against each other. Play together mode adds everyone's scores into one group total to beat.",
    ],
    scoring: 'Race: 1st place 10 points, 2nd 7, 3rd 5, everyone else 3. Play together: the group total is saved as a record.',
  },
  minPlayers: 2,
  usesLevels: true,
  levelHint: 'Players in easier groups get a gentler challenge (smaller boards, easier words and sums, extra lives, a bigger reaction window), so everyone has a fair shot.',
  defaults: { games: 5, focus: 'mix', handicap: 'on', mode: 'race' },
  options: [
    { key: 'games', label: 'Games in the set', values: [[3, '3'], [4, '4'], [5, '5'], [6, '6']] },
    { key: 'focus', label: 'Game focus', values: [['mix', 'Mix of all'], ['brain', 'Words, Math & Memory'], ['speed', 'Speed & Reflexes']] },
    { key: 'mode', label: 'How to play', values: [['race', 'Race (ranked)'], ['team', 'Play together']] },
    { key: 'handicap', label: 'Fair-play handicaps', values: [['on', 'On (by age)'], ['off', 'Off']] },
  ],
  create: (room) => new MiniGames(room),
};
