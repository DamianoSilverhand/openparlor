const { clean, shuffle, filterLocal, LOCAL_OPTION, schedulePhase, toggleGamePause } = require('../util');

const WORDS = require('../content').words;

const CHOOSE_MS = 15000;
const RESULT_MS = 9000;
const MULT = { easy: 1, medium: 1.3, hard: 1.6 };
const MAX_STROKES = 400;
const MAX_POINTS = 4000;
const COLOR_RE = /^#[0-9a-f]{6}$/i;

const norm = (s) => String(s).toLowerCase().replace(/[^a-z0-9]/g, '').replace(/s$/, '');

function distance(a, b) {
  const m = a.length, n = b.length;
  const d = Array.from({ length: m + 1 }, (_, i) => [i, ...Array(n).fill(0)]);
  for (let j = 0; j <= n; j++) d[0][j] = j;
  for (let i = 1; i <= m; i++)
    for (let j = 1; j <= n; j++)
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
  return d[m][n];
}

function wordPool(pack, tier, local) {
  // "Only Zambian" takes precedence over a chosen topic.
  const packs = pack === 'mix' || !WORDS[pack] || local === 'only' ? Object.values(filterLocal(WORDS, local)) : [WORDS[pack]];
  return packs.flatMap((p) => p[tier] || []);
}

class Draw {
  constructor(room) {
    this.room = room;
    this.s = { ...room.settings };
    this.order = shuffle([...room.players.values()].filter((p) => p.connected).map((p) => p.id));
    this.turnsTotal = this.order.length * this.s.turns;
    this.turn = 0;
    this.used = new Set();
    this.stats = new Map();
    this.gallery = [];
    this.timer = null;
    this.hintTimers = [];
    this.deadline = 0;
    this.timerTotal = 0;
    this.strokes = [];
    for (const p of room.players.values()) p.score = 0;
    this.startTurn();
  }

  // ---- helpers -----------------------------------------------------------
  stat(pid) {
    if (!this.stats.has(pid)) this.stats.set(pid, { artist: 0, correct: 0 });
    return this.stats.get(pid);
  }
  add(pid, pts) {
    const p = this.room.players.get(pid);
    if (!p || !pts) return;
    p.score += pts;
    this.gains.set(pid, (this.gains.get(pid) || 0) + pts);
  }
  later(ms, fn) {
    schedulePhase(this, ms, fn);
  }
  togglePause() {
    toggleGamePause(this);
  }
  clearHints() {
    clearInterval(this.hintInterval);
    this.hintInterval = null;
    this.hintThresholds = [];
  }
  destroy() {
    clearTimeout(this.timer);
    this.clearHints();
  }
  connectedIds() {
    return [...this.room.players.values()].filter((p) => p.connected).map((p) => p.id);
  }
  guessers() {
    return this.connectedIds().filter((id) => id !== this.drawer);
  }
  pickWords() {
    const diff = this.s.difficulty;
    const tiers = diff === 'little' ? ['easy', 'easy', 'easy'] : diff === 'kids' ? ['easy', 'easy', 'medium'] : ['easy', 'medium', 'hard'];
    const out = [];
    for (const tier of tiers) {
      let pool = shuffle(wordPool(this.s.pack, tier, this.s.local)).filter((w) => !this.used.has(w) && !out.some((o) => o.word === w));
      if (!pool.length) pool = shuffle(wordPool(this.s.pack, tier, this.s.local)).filter((w) => !out.some((o) => o.word === w));
      if (pool.length) out.push({ word: pool[0], tier });
    }
    return out;
  }
  broadcastStrokes() {
    this.room.toTvs({ t: 'draw', ev: 'full', strokes: this.strokes });
  }
  onTvConnect(ws) {
    this.room.send(ws, { t: 'draw', ev: 'full', strokes: this.strokes });
  }

  // ---- turn flow ---------------------------------------------------------
  startTurn() {
    this.clearHints();
    this.turn++;
    // Find the next drawer who is still here.
    let drawer = null;
    for (let i = 0; i < this.order.length; i++) {
      const id = this.order[(this.turn - 1 + i) % this.order.length];
      const p = this.room.players.get(id);
      if (p && p.connected) {
        drawer = id;
        break;
      }
    }
    this.drawer = drawer || this.order[0];
    this.strokes = [];
    this.broadcastStrokes();
    this.guessed = new Map(); // pid -> points
    this.guessOrder = [];
    this.feed = [];
    this.myGuesses = new Map();
    this.gains = new Map();
    this.word = null;
    this.tier = null;
    this.choices = this.pickWords();
    this.phase = 'choose';
    this.later(CHOOSE_MS, () => this.choose(Math.floor(Math.random() * this.choices.length)));
    this.room.update();
  }

  choose(i) {
    if (this.phase !== 'choose') return;
    const c = this.choices[i] || this.choices[0];
    this.word = c.word;
    this.tier = c.tier;
    this.used.add(c.word);
    this.phase = 'draw';
    const ms = this.s.drawTime * 1000;
    this.later(ms, () => this.endTurn());
    // Reveal letters over time based on remaining draw time (honours pause).
    const letters = [...this.word].map((ch, idx) => (ch === ' ' ? -1 : idx)).filter((x) => x >= 0);
    this.reveal = shuffle(letters);
    this.revealed = 0;
    const maxHints = letters.length >= 7 ? 2 : letters.length >= 4 ? 1 : 0;
    this.hintThresholds = [0.4, 0.7].slice(0, maxHints).map((f) => ms * (1 - f));
    this.hintInterval = setInterval(() => {
      if (this.paused || this.phase !== 'draw') return;
      const left = Math.max(0, this.deadline - Date.now());
      let changed = false;
      while (this.hintThresholds.length && left <= this.hintThresholds[0]) {
        this.hintThresholds.shift();
        this.revealed++;
        changed = true;
      }
      if (changed) this.room.update();
    }, 500);
    this.room.update();
  }

  hint() {
    const shown = new Set(this.reveal.slice(0, this.revealed));
    return [...this.word].map((ch, i) => (ch === ' ' ? ' ' : shown.has(i) ? ch : '_'));
  }

  endTurn() {
    if (this.phase === 'choose') this.choose(0);
    if (this.phase !== 'draw') return;
    this.clearHints();
    const n = this.guessed.size;
    const everyone = n > 0 && n >= this.guessers().length;
    const drawerPts = Math.round((n * 75 * MULT[this.tier] + (everyone ? 100 : 0)) / 5) * 5;
    this.add(this.drawer, drawerPts);
    this.stat(this.drawer).artist += drawerPts;
    this.gallery.push({ drawer: this.drawer, word: this.word, strokes: this.strokes.map((s) => ({ ...s })) });
    this.phase = 'result';
    this.later(RESULT_MS, () => this.next());
    this.room.update();
  }

  next() {
    if (this.phase !== 'result') return;
    clearTimeout(this.timer);
    if (this.turn >= this.turnsTotal) {
      this.phase = 'final';
      this.deadline = 0;
      this.room.update();
    } else {
      this.startTurn();
    }
  }

  checkProgress() {
    if (this.phase !== 'draw') return;
    const g = this.guessers();
    if (g.length && g.every((id) => this.guessed.has(id)) && this.deadline - Date.now() > 2500) {
      this.later(1800, () => this.endTurn());
      this.room.update();
    }
  }

  onPlayerChange() {
    const drawer = this.room.players.get(this.drawer);
    if (drawer && !drawer.connected && (this.phase === 'choose' || this.phase === 'draw')) {
      if (this.phase === 'choose') this.choose(0);
      return this.endTurn();
    }
    this.checkProgress();
  }

  // ---- input -------------------------------------------------------------
  onMessage(pid, msg) {
    const room = this.room;
    switch (msg.a) {
      case 'pick':
        if (pid === this.drawer && this.phase === 'choose' && Number.isInteger(msg.i)) this.choose(msg.i);
        return;

      case 'seg': {
        if (pid !== this.drawer || this.phase !== 'draw') return;
        if (!Number.isInteger(msg.id) || !COLOR_RE.test(msg.c) || !Array.isArray(msg.pts)) return;
        const s = Math.min(0.06, Math.max(0.003, Number(msg.s) || 0.01));
        const pts = msg.pts
          .slice(0, 60)
          .map((p) => [Math.min(1, Math.max(0, Number(p[0]) || 0)), Math.min(1, Math.max(0, Number(p[1]) || 0))]);
        if (!pts.length) return;
        let st = this.strokes[this.strokes.length - 1];
        if (!st || st.id !== msg.id) {
          if (this.strokes.length >= MAX_STROKES) return;
          st = { id: msg.id, c: msg.c, s, p: [] };
          this.strokes.push(st);
        }
        if (st.p.length + pts.length > MAX_POINTS) return;
        st.p.push(...pts);
        room.toTvs({ t: 'draw', ev: 'seg', id: msg.id, c: st.c, s: st.s, pts });
        return;
      }
      case 'undo':
        if (pid !== this.drawer || this.phase !== 'draw') return;
        this.strokes.pop();
        this.broadcastStrokes();
        return;
      case 'clear':
        if (pid !== this.drawer || this.phase !== 'draw') return;
        this.strokes = [];
        this.broadcastStrokes();
        return;

      case 'guess': {
        if (this.phase !== 'draw' || pid === this.drawer || this.guessed.has(pid)) return;
        const text = clean(msg.text, 30);
        if (!text) return;
        const g = norm(text);
        const w = norm(this.word);
        if (!g) return;
        if (g === w) {
          const left = Math.max(0, this.deadline - Date.now()) / this.timerTotal;
          const pts = Math.round((100 + 400 * left) * MULT[this.tier] / 10) * 10;
          this.guessed.set(pid, pts);
          this.guessOrder.push(pid);
          this.add(pid, pts);
          this.stat(pid).correct++;
          this.feed.push({ pid, kind: 'correct' });
          this.checkProgress();
        } else {
          const close = w.length >= 4 && distance(g, w) <= 1;
          this.feed.push({ pid, kind: 'guess', text });
          const list = this.myGuesses.get(pid) || [];
          list.push({ text, close });
          this.myGuesses.set(pid, list.slice(-4));
        }
        this.feed = this.feed.slice(-9);
        room.update();
        return;
      }
      case 'next': {
        if (pid !== room.hostId) return;
        if (this.phase === 'choose') this.choose(0);
        else if (this.phase === 'draw') this.endTurn();
        else if (this.phase === 'result') this.next();
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
    const pick = (key) => {
      let best = null;
      for (const p of this.room.players.values()) {
        const v = this.stat(p.id)[key];
        if (v > 0 && (!best || v > best.value)) best = { id: p.id, value: v };
      }
      return best;
    };
    return { artist: pick('artist'), eye: pick('correct') };
  }

  state(pid) {
    const g = {
      phase: this.phase,
      turn: this.turn,
      turnsTotal: this.turnsTotal,
      drawer: this.drawer,
      deadline: this.deadline,
      timerTotal: this.timerTotal,
      title: 'Draw & Guess',
    };
    if (this.phase === 'choose') {
      if (pid === this.drawer) g.choices = this.choices.map((c) => ({ word: c.word, tier: c.tier }));
    }
    if (this.phase === 'draw' || this.phase === 'result') {
      g.guessed = [...this.guessed.keys()];
      g.feed = this.feed;
      g.guessers = this.guessers();
    }
    if (this.phase === 'draw') {
      g.hint = this.hint();
      g.tier = this.tier;
      if (pid === this.drawer) g.word = this.word;
      if (pid && pid !== this.drawer) {
        g.iGuessed = this.guessed.has(pid);
        g.myPoints = this.guessed.get(pid) || 0;
        g.myGuesses = this.myGuesses.get(pid) || [];
      }
    }
    if (this.phase === 'result') {
      g.word = this.word;
      g.tier = this.tier;
      g.order = this.guessOrder;
      g.gains = [...this.gains].map(([id, pts]) => ({ id, pts })).sort((a, b) => b.pts - a.pts);
      g.standings = this.standings();
    }
    if (this.phase === 'final') {
      g.standings = this.standings();
      g.awards = this.awards();
      if (!pid) g.gallery = this.gallery;
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
  id: 'draw',
  name: 'Draw & Guess',
  available: () => Object.keys(WORDS).length > 0,
  desc: 'One person draws on their phone while everyone else guesses.',
  rules: {
    steps: [
      'Each turn, one player is the artist. They pick a word on their phone and draw it. Everyone sees it live on the TV.',
      'Everyone else types guesses on their phone. No speaking the answer out loud, and no writing letters in the drawing.',
      'Letters of the word are revealed as time runs out, so the clues get easier.',
      'When the turn ends, the next player draws. Everyone gets a turn.',
    ],
    scoring: 'Guess sooner for more points. Harder words are worth more. The artist earns points for every person who guesses it, plus a bonus if everyone does.',
  },
  minPlayers: 3,
  defaults: { turns: 1, drawTime: 60, difficulty: 'kids', local: 'off', pack: 'mix' },
  options: [
    { key: 'turns', label: 'Drawings each', values: [[1, '1'], [2, '2'], [3, '3']] },
    { key: 'drawTime', label: 'Time to draw', values: [[30, '30s'], [60, '60s'], [90, '90s'], [120, '2 min']] },
    { key: 'difficulty', label: 'Words', values: [['little', 'Little kids'], ['kids', 'Kids'], ['everyone', 'Everyone']] },
    LOCAL_OPTION,
    { key: 'pack', label: 'Topic', values: [['mix', 'Mix'], ...Object.entries(WORDS).map(([k, v]) => [k, v.name])] },
  ],
  create: (room) => new Draw(room),
};
