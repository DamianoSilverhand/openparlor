const fs = require('fs');
const path = require('path');
const { shuffle } = require('../util');

const read = (f) => {
  try {
    return JSON.parse(fs.readFileSync(path.join(__dirname, '../../content', f), 'utf8'));
  } catch {
    return null;
  }
};
const BANK = read('questions.json').categories;
const FAMILY = ((read('family-questions.json') || {}).questions || []).filter((q) => q && q.q && q.a && Array.isArray(q.w) && q.w.length >= 1);
const CATS = { ...BANK };
if (FAMILY.length >= 4) CATS.family = { name: 'Our Family', questions: FAMILY };

const INTRO_MS = 12000;
const CATEGORY_MS = 4500;
const REVEAL_MS = 8000;
const SCORES_MS = 10000;
const WAGER_MS = 20000;
const BASE = { 1: 100, 2: 200, 3: 300 };
const TIERS = [1, 1, 2, 3]; // difficulty of the four questions in each round
const SHOWN = { kid: 2, teen: 3, grownup: 4 }; // answer choices each age group sees
const RANK = { grownup: 2, teen: 1, kid: 0 };
const TEAM_DEFS = [
  { name: 'Red Foxes', color: '#e8472b' },
  { name: 'Blue Whales', color: '#6fb3e0' },
  { name: 'Green Frogs', color: '#6baa4f' },
  { name: 'Gold Lions', color: '#f2b632' },
];
const SOLO_COLORS = ['#e8472b', '#6fb3e0', '#6baa4f', '#f2b632', '#f29bb5', '#2e9c9c', '#f28c38', '#3e5c99', '#d9b88f', '#b5523b', '#9ad1b0', '#ff9f8f'];

class Quiz {
  constructor(room) {
    this.room = room;
    this.s = { ...room.settings };
    this.timer = null;
    this.deadline = 0;
    this.timerTotal = 0;
    this.used = new Set();
    this.round = 0;
    this.qi = 0;
    this.finale = false;
    this.gains = new Map();
    this.stats = new Map();
    this.assignTeams();
    const ids = Object.keys(CATS);
    this.totalRounds = this.s.rounds;
    this.cats = this.s.cats === 'mix' || !CATS[this.s.cats] ? shuffle(ids).slice(0, this.totalRounds) : Array(this.totalRounds).fill(this.s.cats);
    this.phase = 'intro';
    this.later(INTRO_MS, () => this.startRound());
    this.syncScores();
    room.update();
  }

  // ---- teams -------------------------------------------------------------
  assignTeams() {
    const players = shuffle([...this.room.players.values()].filter((p) => p.connected)).sort((a, b) => RANK[b.level] - RANK[a.level]);
    const n = players.length;
    const k = this.s.teams === 'solo' ? n : Math.min(this.s.teams, n);
    this.teams = [];
    this.teamOf = new Map();
    if (k === n) {
      players.forEach((p, i) => {
        this.teams.push({ id: `t${i}`, name: p.name, color: SOLO_COLORS[i % SOLO_COLORS.length], members: [p.id], score: 0 });
        this.teamOf.set(p.id, `t${i}`);
      });
    } else {
      for (let i = 0; i < k; i++) this.teams.push({ id: `t${i}`, name: TEAM_DEFS[i].name, color: TEAM_DEFS[i].color, members: [], score: 0 });
      // Snake draft, strongest age group first, so every team gets a mix.
      players.forEach((p, i) => {
        const lap = Math.floor(i / k);
        const pos = i % k;
        const t = this.teams[lap % 2 === 0 ? pos : k - 1 - pos];
        t.members.push(p.id);
        this.teamOf.set(p.id, t.id);
      });
    }
    this.solo = k === n;
  }
  team(id) {
    return this.teams.find((t) => t.id === id);
  }
  activeTeams() {
    return this.teams.filter((t) => t.members.some((id) => (this.room.players.get(id) || {}).connected));
  }
  stat(id) {
    if (!this.stats.has(id)) this.stats.set(id, { correct: 0, speed: 0, wager: 0 });
    return this.stats.get(id);
  }
  syncScores() {
    for (const t of this.teams) for (const id of t.members) if (this.room.players.get(id)) this.room.players.get(id).score = t.score;
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
  }

  pickQuestion(catId, tier) {
    const free = (list) => shuffle(list).find((q) => !this.used.has(q));
    const tryCat = (cat, t) => free((CATS[cat].questions || []).filter((q) => q.d === t));
    let q = null;
    for (const t of [tier, tier - 1, tier + 1, tier - 2, tier + 2]) {
      if (t < 1 || t > 3) continue;
      q = tryCat(catId, t);
      if (q) break;
    }
    if (!q) {
      for (const c of shuffle(Object.keys(CATS))) {
        q = tryCat(c, tier) || free(CATS[c].questions);
        if (q) {
          catId = c;
          break;
        }
      }
    }
    if (!q) {
      this.used.clear();
      return this.pickQuestion(catId, tier);
    }
    this.used.add(q);
    const options = shuffle([q.a, ...q.w.slice(0, 3)]);
    return { q: q.q, options, correct: options.indexOf(q.a), d: q.d, fact: q.f || '', cat: catId };
  }

  // ---- flow --------------------------------------------------------------
  startRound() {
    if (this.phase !== 'intro' && this.phase !== 'scores') return;
    this.round++;
    this.qi = 0;
    this.catId = this.cats[this.round - 1];
    this.doubleAt = 2 + Math.floor(Math.random() * 3); // question 2, 3 or 4
    this.phase = 'category';
    this.later(CATEGORY_MS, () => this.nextQuestion());
    this.room.update();
  }

  nextQuestion() {
    this.qi++;
    if (this.qi > TIERS.length) return this.toScores();
    this.cur = this.pickQuestion(this.catId, TIERS[this.qi - 1]);
    this.cur.double = this.qi === this.doubleAt;
    this.openQuestion(this.s.time);
  }

  openQuestion(seconds) {
    this.answers = new Map();
    this.tapped = new Set(); // players who have tapped at least once
    this.visible = new Map();
    for (const t of this.teams) {
      for (const id of t.members) {
        const p = this.room.players.get(id);
        const want = SHOWN[(p && p.level) || 'grownup'];
        const wrong = shuffle(this.cur.options.map((_, i) => i).filter((i) => i !== this.cur.correct)).slice(0, want - 1);
        this.visible.set(id, [this.cur.correct, ...wrong].sort((a, b) => a - b));
      }
    }
    this.phase = 'question';
    this.later(seconds * 1000, () => this.reveal());
    this.room.update();
  }

  checkProgress() {
    if (this.phase === 'question') {
      if (this.everyoneTapped(this.tapped) && this.deadline - Date.now() > 2500) {
        this.later(1500, () => this.reveal());
        this.room.update();
      }
    } else if (this.phase === 'wager') {
      if (this.everyoneTapped(this.tappedWager) && this.deadline - Date.now() > 2500) {
        this.later(1500, () => this.startFinaleQuestion());
        this.room.update();
      }
    }
  }
  // True when every connected player on a team has tapped at least once.
  everyoneTapped(set) {
    const people = [...this.teamOf.keys()].filter((id) => (this.room.players.get(id) || {}).connected);
    return people.length > 0 && people.every((id) => set.has(id));
  }
  onPlayerChange() {
    this.checkProgress();
  }

  reveal() {
    if (this.phase !== 'question') return;
    this.gains = new Map();
    this.results = [];
    for (const t of this.teams) {
      const ans = this.answers.get(t.id);
      const correct = !!ans && ans.idx === this.cur.correct;
      let pts = 0;
      let wager = 0;
      if (this.finale) {
        wager = this.wagers.get(t.id) || 0;
        pts = correct ? wager : -Math.min(wager, t.score);
        if (correct && wager) this.stat(t.id).wager += wager;
      } else if (correct) {
        const base = BASE[this.cur.d];
        const left = Math.max(0, Math.min(1, (this.deadline - ans.at) / this.timerTotal));
        const bonus = Math.round((base * 0.5 * left) / 5) * 5;
        this.stat(t.id).speed += bonus;
        pts = (base + bonus) * (this.cur.double ? 2 : 1);
      }
      if (correct) this.stat(t.id).correct++;
      t.score = Math.max(0, t.score + pts);
      this.gains.set(t.id, pts);
      this.results.push({ team: t.id, choice: ans ? ans.idx : null, by: ans ? ans.pid : null, correct, pts, wager });
    }
    this.syncScores();
    this.phase = 'reveal';
    this.later(REVEAL_MS, () => this.afterReveal());
    this.room.update();
  }

  afterReveal() {
    if (this.phase !== 'reveal') return;
    if (this.finale) return this.toFinal();
    this.nextQuestion();
  }

  toScores() {
    this.phase = 'scores';
    this.later(SCORES_MS, () => this.afterScores());
    this.room.update();
  }

  afterScores() {
    if (this.phase !== 'scores') return;
    if (this.round < this.totalRounds) return this.startRound();
    if (this.s.finale === 'on' && this.teams.some((t) => t.score > 0)) return this.startWager();
    this.toFinal();
  }

  wagerChoices(team) {
    const out = new Set([0]);
    if (team.score > 0) for (const f of [0.25, 0.5, 1]) out.add(f === 1 ? team.score : Math.max(10, Math.round((team.score * f) / 10) * 10));
    return [...out].sort((a, b) => a - b);
  }

  startWager() {
    this.finale = true;
    this.wagers = new Map();
    this.tappedWager = new Set();
    const cats = shuffle(Object.keys(CATS));
    this.cur = this.pickQuestion(cats[0], 3);
    this.cur.double = false;
    this.gains = new Map();
    this.phase = 'wager';
    this.later(WAGER_MS, () => this.startFinaleQuestion());
    this.room.update();
  }

  startFinaleQuestion() {
    if (this.phase !== 'wager') return;
    this.openQuestion(this.s.time + 10);
  }

  toFinal() {
    clearTimeout(this.timer);
    this.deadline = 0;
    this.phase = 'final';
    this.room.update();
  }

  // ---- input -------------------------------------------------------------
  onMessage(pid, msg) {
    const room = this.room;
    const teamId = this.teamOf.get(pid);
    switch (msg.a) {
      case 'answer': {
        if (this.phase !== 'question' || !teamId) return;
        if (!(this.visible.get(pid) || []).includes(msg.idx)) return;
        this.answers.set(teamId, { pid, idx: msg.idx, at: Date.now() });
        this.tapped.add(pid);
        room.update();
        this.checkProgress();
        return;
      }
      case 'wager': {
        if (this.phase !== 'wager' || !teamId) return;
        const team = this.team(teamId);
        if (!this.wagerChoices(team).includes(msg.amount)) return;
        this.wagers.set(teamId, msg.amount);
        this.tappedWager.add(pid);
        room.update();
        this.checkProgress();
        return;
      }
      case 'next': {
        if (pid !== room.hostId) return;
        if (this.phase === 'intro') this.startRound();
        else if (this.phase === 'category') this.nextQuestion();
        else if (this.phase === 'question') this.reveal();
        else if (this.phase === 'reveal') this.afterReveal();
        else if (this.phase === 'scores') this.afterScores();
        else if (this.phase === 'wager') this.startFinaleQuestion();
        return;
      }
    }
  }

  // ---- views -------------------------------------------------------------
  standings() {
    return this.teams
      .map((t) => ({ id: t.id, name: t.name, color: t.color, members: t.members, score: t.score, gain: this.gains.get(t.id) || 0 }))
      .sort((a, b) => b.score - a.score);
  }

  awards() {
    const pick = (key) => {
      let best = null;
      for (const t of this.teams) {
        const v = this.stat(t.id)[key];
        if (v > 0 && (!best || v > best.value)) best = { id: t.id, value: v };
      }
      return best;
    };
    return { brainy: pick('correct'), fast: pick('speed'), gambler: pick('wager') };
  }

  state(pid) {
    const g = {
      phase: this.phase,
      round: this.round,
      totalRounds: this.totalRounds,
      qi: this.qi,
      qTotal: TIERS.length,
      finale: this.finale,
      deadline: this.deadline,
      timerTotal: this.timerTotal,
      title: 'Family Quiz Show',
      solo: this.solo,
      teams: this.teams.map((t) => ({ id: t.id, name: t.name, color: t.color, members: t.members, score: t.score })),
    };
    const myTeam = pid ? this.teamOf.get(pid) || null : null;
    if (pid) g.myTeam = myTeam;
    if (['category', 'question', 'reveal', 'wager'].includes(this.phase)) g.category = (CATS[this.finale ? this.cur.cat : this.catId] || {}).name;

    if (this.phase === 'question' || this.phase === 'reveal' || this.phase === 'wager') {
      g.d = this.cur.d;
      g.double = this.cur.double;
    }
    if (this.phase === 'question' || this.phase === 'reveal') {
      g.q = this.cur.q;
      g.options = this.cur.options;
    }
    if (this.phase === 'question') {
      g.answered = [...this.answers.keys()];
      g.active = this.activeTeams().map((t) => t.id);
      if (pid && myTeam) {
        g.mine = this.visible.get(pid) || [];
        const a = this.answers.get(myTeam);
        g.teamChoice = a ? a.idx : null;
        g.teamBy = a ? a.pid : null;
      }
    }
    if (this.phase === 'wager') {
      g.wagered = [...this.wagers.keys()];
      g.active = this.activeTeams().map((t) => t.id);
      if (pid && myTeam) {
        g.wagerChoices = this.wagerChoices(this.team(myTeam));
        g.myWager = this.wagers.has(myTeam) ? this.wagers.get(myTeam) : null;
      }
    }
    if (this.phase === 'reveal') {
      g.correct = this.cur.correct;
      g.fact = this.cur.fact;
      g.results = this.results;
    }
    if (this.phase === 'scores' || this.phase === 'final') {
      g.standings = this.standings();
      if (this.phase === 'final') g.awards = this.awards();
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
  id: 'quiz',
  name: 'Family Quiz Show',
  desc: 'Teams of mixed ages answer questions, with a big final wager.',
  minPlayers: 2,
  usesLevels: true,
  levelHint: 'Kids see fewer answer choices, so the questions feel fair. Teams get a mix of ages.',
  defaults: { teams: 2, rounds: 3, time: 20, finale: 'on', cats: 'mix' },
  options: [
    { key: 'teams', label: 'Teams', values: [[2, '2 teams'], [3, '3 teams'], [4, '4 teams'], ['solo', 'Everyone solo']] },
    { key: 'rounds', label: 'Rounds', values: [[2, '2'], [3, '3'], [4, '4']] },
    { key: 'time', label: 'Time per question', values: [[15, '15s'], [20, '20s'], [30, '30s'], [45, '45s']] },
    { key: 'finale', label: 'Final wager', values: [['on', 'On'], ['off', 'Off']] },
    { key: 'cats', label: 'Topics', values: [['mix', 'Mix'], ...Object.entries(CATS).map(([k, v]) => [k, v.name])] },
  ],
  create: (room) => new Quiz(room),
};
