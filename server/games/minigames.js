const { shuffle } = require('../util');

// The mini-games themselves run on the phones. The server picks the set, hands out a shared seed and
// start time, collects each player's score, and awards points for finishing 1st, 2nd, 3rd and so on.
const MINI = {
  memory: { name: 'Memory Match', howto: 'Flip two cards at a time and find every matching pair. Fewer misses and a faster finish score more.', duration: 60, max: 1400 },
  scramble: { name: 'Word Scramble', howto: 'Unscramble as many words as you can. Type the word and press Go, or skip a tricky one.', duration: 60, max: 3000 },
  reaction: { name: 'Quick Tap', howto: 'Wait for the screen to turn green, then tap as fast as you can. Tap too early and you lose time. Five tries.', duration: 50, max: 2500 },
  pattern: { name: 'Copy Cat', howto: 'Watch the colours light up, then repeat the pattern. It gets one step longer each round.', duration: 90, max: 3500 },
  clash: { name: 'Colour Clash', howto: 'Tap the colour of the INK, not the colour the word says. Wrong taps cost you.', duration: 30, max: 3500 },
  math: { name: 'Number Dash', howto: 'Solve sums as fast as you can by tapping the right answer. Wrong answers cost you.', duration: 40, max: 3500 },
};
const POINTS = [10, 7, 5];
const OTHER_POINTS = 3;
const INTRO_MS = 9000;
const COUNTDOWN_MS = 3200;
const GRACE_MS = 3000;
const RESULTS_MS = 10000;

class MiniGames {
  constructor(room) {
    this.room = room;
    this.s = { ...room.settings };
    this.order = shuffle(Object.keys(MINI)).slice(0, this.s.games);
    this.total = this.order.length;
    this.idx = 0;
    this.timer = null;
    this.liveTimer = null;
    this.deadline = 0;
    this.timerTotal = 0;
    this.stats = new Map();
    this.gains = new Map();
    for (const p of room.players.values()) p.score = 0;
    this.startIntro();
  }

  // ---- helpers -----------------------------------------------------------
  later(ms, fn) {
    clearTimeout(this.timer);
    this.timerTotal = ms;
    this.deadline = Date.now() + ms;
    this.timer = setTimeout(fn, ms);
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
    return this.s.handicap === 'on' && p ? p.level : 'grownup';
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
      title: 'Family Mini-Games',
      mg: { id: this.id, name: this.def.name, howto: this.def.howto, duration: this.def.duration, max: this.def.max },
      lineup: this.order.map((id) => MINI[id].name),
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
    }
    if (this.phase === 'final') {
      g.standings = this.standings();
      g.awards = this.awards();
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
  name: 'Family Mini-Games',
  desc: 'Quick rounds of memory, words, reflexes and numbers. Everyone gets a chance to shine.',
  minPlayers: 2,
  usesLevels: true,
  levelHint: 'Younger players get a gentler challenge (smaller boards, easier words and sums, extra lives, a bigger reaction window), so everyone has a fair shot.',
  defaults: { games: 5, handicap: 'on' },
  options: [
    { key: 'games', label: 'Games in the set', values: [[3, '3'], [4, '4'], [5, '5'], [6, '6']] },
    { key: 'handicap', label: 'Fair-play handicaps', values: [['on', 'On (by age)'], ['off', 'Off']] },
  ],
  create: (room) => new MiniGames(room),
};
