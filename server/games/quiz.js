const fs = require('fs');
const path = require('path');
const { shuffle, filterLocal, LOCAL_OPTION, schedulePhase, toggleGamePause } = require('../util');

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
if (FAMILY.length >= 4) CATS.family = { name: 'Our Family', questions: FAMILY, always: true };

const INTRO_MS = 12000;
const CATEGORY_MS = 4500;
const REVEAL_MS = 8000;
const SCORES_MS = 10000;
const WAGER_MS = 20000;
// Every question is aimed at one age group, so it is the right difficulty for the person who answers.
// Each question is worth the same, so no age group gets the "cheap" ones.
const BASE_POINTS = 200;
const SLOTS = 4; // questions per round
const LEVEL_ORDER = ['kid', 'teen', 'grownup'];
const PREF = { kid: [1, 2], teen: [2, 1, 3], grownup: [3, 2] }; // question tiers each age group is asked, best first
const SHOWN = { kid: 3, teen: 4, grownup: 4 }; // answer choices the person answering sees
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
    this.turns = new Map(); // how often each player has been the one answering
    this.presentLevels = LEVEL_ORDER.filter((l) => this.teams.some((t) => t.members.some((id) => ((this.room.players.get(id) || {}).level || 'grownup') === l)));
    this.target = null;
    this.spot = new Map();
    this.catMap = filterLocal(CATS, this.s.local);
    // "Only Zambian" takes precedence: a chosen topic is ignored so no general topic sneaks back in.
    const onlyLocal = this.s.local === 'only';
    if (CATS[this.s.cats] && !onlyLocal) this.catMap[this.s.cats] = CATS[this.s.cats];
    const ids = Object.keys(this.catMap);
    this.totalRounds = this.s.rounds;
    const order = shuffle(ids);
    this.cats = onlyLocal || this.s.cats === 'mix' || !CATS[this.s.cats] ? Array.from({ length: this.totalRounds }, (_, i) => order[i % order.length]) : Array(this.totalRounds).fill(this.s.cats);
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
    schedulePhase(this, ms, fn);
  }
  togglePause() {
    toggleGamePause(this);
  }
  destroy() {
    clearTimeout(this.timer);
  }

  // Pick an unused question whose difficulty suits the age group (level) it is aimed at.
  pickQuestion(catId, level) {
    const prefs = PREF[level] || PREF.grownup;
    const free = (list) => shuffle(list).find((q) => !this.used.has(q));
    const tryCat = (cat, t) => free((this.catMap[cat].questions || []).filter((q) => q.d === t));
    let q = null;
    for (const t of prefs) {
      q = tryCat(catId, t);
      if (q) break;
    }
    if (!q) {
      for (const c of shuffle(Object.keys(this.catMap))) {
        for (const t of prefs) {
          q = tryCat(c, t);
          if (q) break;
        }
        q = q || free(this.catMap[c].questions);
        if (q) {
          catId = c;
          break;
        }
      }
    }
    if (!q) {
      this.used.clear();
      return this.pickQuestion(catId, level);
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
    this.targets = this.slotTargets();
    this.phase = 'category';
    this.later(CATEGORY_MS, () => this.nextQuestion());
    this.room.update();
  }

  nextQuestion() {
    this.qi++;
    if (this.qi > SLOTS) return this.toScores();
    this.target = this.targets[this.qi - 1];
    this.cur = this.pickQuestion(this.catId, this.target);
    this.cur.double = this.qi === this.doubleAt;
    this.openQuestion(this.s.time + this.readExtra());
  }

  // Which age group each question in a round is aimed at. Every group in play gets a turn, and the
  // starting group rotates from round to round.
  slotTargets() {
    const L = this.presentLevels.length ? this.presentLevels : ['grownup'];
    // With three groups in play one of them gets a second question. Give that extra turn to a
    // different group each round, so no age group is favoured over a whole game.
    const base = L.length === 1 ? Array(SLOTS).fill(L[0]) : L.length === 2 ? [...L, ...L] : [...L, L[(this.round - 1) % L.length]];
    const r = (this.round - 1) % base.length;
    return base.slice(r).concat(base.slice(0, r));
  }

  // The player on a team who answers this question: the member closest to the target age group,
  // taking turns when several fit.
  pickSpotlight(team) {
    const members = team.members.map((id) => this.room.players.get(id)).filter((p) => p && p.connected);
    if (!members.length) return null;
    const want = RANK[this.target];
    const rank = (p) => RANK[p.level || 'grownup'];
    members.sort((a, b) => Math.abs(rank(a) - want) - Math.abs(rank(b) - want) || (this.turns.get(a.id) || 0) - (this.turns.get(b.id) || 0));
    this.turns.set(members[0].id, (this.turns.get(members[0].id) || 0) + 1);
    return members[0].id;
  }

  subsetFor(level) {
    const wrong = shuffle(this.cur.options.map((_, i) => i).filter((i) => i !== this.cur.correct)).slice(0, SHOWN[level] - 1);
    return [this.cur.correct, ...wrong].sort((a, b) => a - b);
  }

  // Reading aloud takes a few seconds, so give teams that long back.
  readExtra() {
    return this.s.read === 'on' ? 8 : 0;
  }

  openQuestion(seconds) {
    this.answers = new Map();
    this.suggestions = new Map(); // teamId -> Map(pid -> idx)
    this.tapped = new Set(); // players who have tapped at least once
    this.visible = new Map();
    this.spot = new Map();
    for (const t of this.teams) {
      if (this.target) {
        // The whole team sees the same choices as the player answering.
        const sp = this.pickSpotlight(t);
        if (sp) this.spot.set(t.id, sp);
        const subset = this.subsetFor(((this.room.players.get(sp) || {}).level) || 'grownup');
        for (const id of t.members) this.visible.set(id, subset);
      } else {
        // The final question: anyone on the team can answer, each seeing choices for their own age group.
        for (const id of t.members) this.visible.set(id, this.subsetFor(((this.room.players.get(id) || {}).level) || 'grownup'));
      }
    }
    this.phase = 'question';
    this.later(seconds * 1000, () => this.reveal());
    this.room.update();
  }

  checkProgress() {
    if (this.phase === 'question') {
      const active = this.activeTeams();
      const done = this.finale ? this.everyoneTapped(this.tapped) : active.length > 0 && active.every((t) => this.answers.has(t.id));
      if (done && this.deadline - Date.now() > 2500) {
        this.later(this.finale ? 1500 : 2000, () => this.reveal());
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
      let half = false;
      if (this.finale) {
        wager = this.wagers.get(t.id) || 0;
        pts = correct ? wager : -Math.min(wager, t.score);
        if (correct && wager) this.stat(t.id).wager += wager;
      } else if (correct) {
        const left = Math.max(0, Math.min(1, (this.deadline - ans.at) / this.timerTotal));
        const bonus = Math.round((BASE_POINTS * 0.5 * left) / 5) * 5;
        this.stat(t.id).speed += bonus;
        // Half points if a question aimed at one age group is answered by another.
        const lvl = ((this.room.players.get(this.spot.get(t.id)) || {}).level) || 'grownup';
        // In solo play there is only one person, so a mismatch is half points. A team that has nobody at
        // that age group is not penalised; a team whose matching player left is.
        const lvlOf = (id) => ((this.room.players.get(id) || {}).level) || 'grownup';
        const hasMatch = t.members.some((id) => (this.room.players.get(id) || {}).connected && lvlOf(id) === this.target);
        half = lvl !== this.target && (this.solo || hasMatch);
        pts = Math.round(((BASE_POINTS + bonus) * (this.cur.double ? 2 : 1) * (half ? 0.5 : 1)) / 5) * 5;
      }
      if (correct) this.stat(t.id).correct++;
      t.score = Math.max(0, t.score + pts);
      this.gains.set(t.id, pts);
      this.results.push({ team: t.id, choice: ans ? ans.idx : null, by: ans ? ans.pid : null, correct, pts, wager, half });
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
    this.target = null;
    this.spot = new Map();
    this.wagers = new Map();
    this.tappedWager = new Set();
    const cats = shuffle(Object.keys(this.catMap));
    // Kids in the room make the final question medium; otherwise it is the hard one.
    const L = this.presentLevels;
    const finalLevel = L.includes('kid') ? (L.length === 1 ? 'kid' : 'teen') : 'grownup';
    this.cur = this.pickQuestion(cats[0], finalLevel);
    this.cur.double = false;
    this.gains = new Map();
    this.phase = 'wager';
    this.later(WAGER_MS, () => this.startFinaleQuestion());
    this.room.update();
  }

  startFinaleQuestion() {
    if (this.phase !== 'wager') return;
    this.openQuestion(this.s.time + 10 + this.readExtra());
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
        // Only the player whose age group the question is aimed at answers for the team.
        if (!this.finale) {
          const sp = this.spot.get(teamId);
          const spPlayer = this.room.players.get(sp);
          if (sp && sp !== pid && spPlayer && spPlayer.connected) return;
        }
        this.answers.set(teamId, { pid, idx: msg.idx, at: Date.now() });
        this.tapped.add(pid);
        room.update();
        this.checkProgress();
        return;
      }
      case 'suggest': {
        if (this.phase !== 'question' || !teamId) return;
        if (!(this.visible.get(pid) || []).includes(msg.idx)) return;
        if (!this.suggestions.has(teamId)) this.suggestions.set(teamId, new Map());
        this.suggestions.get(teamId).set(pid, msg.idx);
        room.update();
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
      qTotal: SLOTS,
      presentLevels: this.presentLevels,
      finale: this.finale,
      readAloud: this.s.read === 'on',
      deadline: this.deadline,
      timerTotal: this.timerTotal,
      title: 'Family Quiz Show',
      solo: this.solo,
      teams: this.teams.map((t) => ({ id: t.id, name: t.name, color: t.color, members: t.members, score: t.score })),
    };
    const myTeam = pid ? this.teamOf.get(pid) || null : null;
    if (pid) g.myTeam = myTeam;
    if (['category', 'question', 'reveal', 'wager'].includes(this.phase)) g.category = (this.catMap[this.finale ? this.cur.cat : this.catId] || {}).name;

    if (this.phase === 'question' || this.phase === 'reveal' || this.phase === 'wager') {
      g.d = this.cur.d;
      g.double = this.cur.double;
    }
    if (this.phase === 'question' || this.phase === 'reveal') {
      g.q = this.cur.q;
      g.options = this.cur.options;
      g.target = this.finale ? null : this.target;
      g.spots = [...this.spot].map(([team, p]) => ({ team, pid: p }));
    }
    if (this.phase === 'question') {
      g.answered = [...this.answers.keys()];
      g.active = this.activeTeams().map((t) => t.id);
      if (pid && myTeam) {
        g.mine = this.visible.get(pid) || [];
        // Who answers for my team, and is it me? (If they have left, anyone on the team may answer.)
        const sp = this.spot.get(myTeam);
        const spPlayer = this.room.players.get(sp);
        g.spotPid = sp || null;
        g.canAnswer = this.finale || !sp || sp === pid || !(spPlayer && spPlayer.connected);
        const a = this.answers.get(myTeam);
        g.teamChoice = a ? a.idx : null;
        g.teamBy = a ? a.pid : null;
        const sug = this.suggestions.get(myTeam);
        g.suggestions = sug ? [...sug].map(([id, idx]) => ({ id, idx })) : [];
        g.mySuggestion = sug ? sug.get(pid) ?? null : null;
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
  levelHint: 'Each question is aimed at one age group: easy for kids, harder for grown-ups. The player in your team at that level answers, and the rest help. Teams get a mix of ages.',
  defaults: { teams: 2, rounds: 3, time: 30, finale: 'on', read: 'off', local: 'off', cats: 'mix' },
  options: [
    { key: 'teams', label: 'Teams', values: [[2, '2 teams'], [3, '3 teams'], [4, '4 teams'], ['solo', 'Everyone solo']] },
    { key: 'rounds', label: 'Rounds', values: [[2, '2'], [3, '3'], [4, '4']] },
    { key: 'time', label: 'Time per question', values: [[15, '15s'], [20, '20s'], [30, '30s'], [45, '45s']] },
    { key: 'finale', label: 'Final wager', values: [['on', 'On'], ['off', 'Off']] },
    { key: 'read', label: 'Read questions aloud on the TV', values: [['off', 'Off'], ['on', 'On']] },
    LOCAL_OPTION,
    { key: 'cats', label: 'Topics', values: [['mix', 'Mix'], ...Object.entries(CATS).map(([k, v]) => [k, v.name])] },
  ],
  create: (room) => new Quiz(room),
};
