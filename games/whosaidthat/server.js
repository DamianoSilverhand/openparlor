const { GameBase, clean, shuffle, content } = require('../../server/sdk');

const CONTENT = { packs: content.prompts };

const VOTE_MS = 25000;
const REVEAL_MS = 14000;
const SCORES_MS = 30000;
const POINTS_CORRECT = 100;
const POINTS_FOOLED = 50;
const POINTS_LAUGH = 10;
const MAX_LAUGHS = 3;

function promptPool(pack) {
  if (pack && CONTENT.packs[pack]) return CONTENT.packs[pack].prompts;
  return Object.values(CONTENT.packs).filter((p) => p.mixIn !== false).flatMap((p) => p.prompts); // "Mix": every pack that has not opted out
}

class WhoSaidThat extends GameBase {
  constructor(room) {
    super(room);
    const pool = shuffle(promptPool(this.s.pack));
    this.totalRounds = Math.min(this.s.rounds, pool.length);
    this.prompts = pool.slice(0, this.totalRounds);
    this.round = 0;
    this.stats = new Map();
    for (const p of room.players.values()) p.score = 0;
    this.startRound();
  }

  // ---- helpers -----------------------------------------------------------
  stat(pid) {
    if (!this.stats.has(pid)) this.stats.set(pid, { correct: 0, fooled: 0, laughs: 0 });
    return this.stats.get(pid);
  }
  get cur() {
    return this.items && this.items[this.idx];
  }

  // ---- phases ------------------------------------------------------------
  startRound() {
    this.round++;
    this.prompt = this.prompts[this.round - 1];
    this.answers = new Map();
    this.passed = new Set(); // players who chose to pass on this prompt
    this.hidden = new Set(); // authors whose answer the host hid this round
    this.items = [];
    this.idx = -1;
    this.gains = new Map();
    this.note = '';
    this.phase = 'answer';
    this.later(this.s.answerTime * 1000, () => this.endAnswers());
    this.room.update();
  }

  endAnswers() {
    if (this.phase !== 'answer') return;
    this.itemSeq = this.itemSeq || 0;
    const list = [...this.answers].map(([author, text]) => ({
      id: ++this.itemSeq, // changes for every answer, so screens always refresh when one is hidden
      author,
      text,
      votes: new Map(),
      laughs: new Map(),
      correct: [],
      fooled: [],
    }));
    if (list.length < 2) {
      this.items = [];
      this.note = 'Not enough answers came in this round, so we are moving on.';
      this.toScores();
      return;
    }
    this.items = shuffle(list);
    this.idx = -1;
    this.nextItem();
  }

  nextItem() {
    this.idx++;
    if (this.idx >= this.items.length) return this.toScores();
    this.phase = 'vote';
    this.later(VOTE_MS, () => this.reveal());
    this.room.update();
    this.checkProgress();
  }

  reveal() {
    if (this.phase !== 'vote') return;
    const it = this.cur;
    for (const [voter, guess] of it.votes) {
      if (guess === it.author) {
        it.correct.push(voter);
        this.add(voter, POINTS_CORRECT);
        this.stat(voter).correct++;
      } else {
        it.fooled.push(voter);
        this.add(it.author, POINTS_FOOLED);
        this.stat(it.author).fooled++;
      }
    }
    this.phase = 'reveal';
    this.later(REVEAL_MS, () => this.finishItem());
    this.room.update();
  }

  finishItem() {
    if (this.phase !== 'reveal') return;
    const it = this.cur;
    const laughs = [...it.laughs.values()].reduce((a, b) => a + b, 0);
    if (laughs) {
      this.add(it.author, laughs * POINTS_LAUGH);
      this.stat(it.author).laughs += laughs;
    }
    this.nextItem();
  }

  toScores() {
    this.phase = 'scores';
    this.later(SCORES_MS, () => this.afterScores());
    this.room.update();
  }

  afterScores() {
    if (this.phase !== 'scores') return;
    clearTimeout(this.timer);
    if (this.round >= this.totalRounds) {
      this.phase = 'final';
      this.deadline = 0;
      this.room.update();
    } else {
      this.startRound();
    }
  }

  // Move on early if everyone who can act has acted.
  checkProgress() {
    const conn = this.connected();
    if (!conn.length) return;
    if (this.phase === 'answer') {
      if (conn.every((p) => this.answers.has(p.id) || this.passed.has(p.id)) && this.deadline - Date.now() > 2500) {
        this.later(1200, () => this.endAnswers());
        this.room.update();
      }
    } else if (this.phase === 'vote') {
      const it = this.cur;
      const eligible = conn.filter((p) => p.id !== it.author);
      if (eligible.every((p) => it.votes.has(p.id)) && this.deadline - Date.now() > 2000) {
        this.later(900, () => this.reveal());
        this.room.update();
      }
    }
  }

  onPlayerChange() {
    this.checkProgress();
  }

  // ---- input -------------------------------------------------------------
  onMessage(pid, msg) {
    const room = this.room;
    switch (msg.a) {
      case 'answer': {
        if (this.phase !== 'answer' || this.answers.has(pid)) return;
        const text = clean(msg.text);
        if (text.length < 1) return;
        this.answers.set(pid, text);
        room.update();
        this.checkProgress();
        return;
      }
      case 'pass': {
        if (this.phase !== 'answer' || this.answers.has(pid) || this.passed.has(pid)) return;
        this.passed.add(pid);
        room.update();
        this.checkProgress();
        return;
      }
      case 'drop': {
        // The host can hide an answer that is awkward or unsuitable. It is not scored.
        if (pid !== room.hostId || this.phase !== 'vote') return;
        this.hidden.add(this.cur.author);
        this.items.splice(this.idx, 1);
        this.idx--;
        this.nextItem();
        return;
      }
      case 'vote': {
        const it = this.cur;
        if (this.phase !== 'vote' || !it || pid === it.author) return;
        if (!this.answers.has(msg.guess) || this.hidden.has(msg.guess) || msg.guess === pid) return;
        it.votes.set(pid, msg.guess);
        room.update();
        this.checkProgress();
        return;
      }
      case 'laugh': {
        const it = this.cur;
        if ((this.phase !== 'vote' && this.phase !== 'reveal') || !it || pid === it.author) return;
        const n = it.laughs.get(pid) || 0;
        if (n >= MAX_LAUGHS) return;
        it.laughs.set(pid, n + 1);
        room.update();
        return;
      }
      case 'next': {
        if (pid !== room.hostId) return;
        if (this.phase === 'answer') this.endAnswers();
        else if (this.phase === 'vote') this.reveal();
        else if (this.phase === 'reveal') this.finishItem();
        else if (this.phase === 'scores') this.afterScores();
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
    return { detective: pick('correct'), trickster: pick('fooled'), funniest: pick('laughs') };
  }

  // pid === null means the big screen.
  state(pid) {
    const g = {
      phase: this.phase,
      round: this.round,
      totalRounds: this.totalRounds,
      prompt: this.prompt,
      deadline: this.deadline,
      timerTotal: this.timerTotal,
      title: 'Who Said That?',
    };
    const conn = this.connected().map((p) => p.id);

    if (this.phase === 'answer') {
      // A pass looks the same as an answer on the big screen, so nobody is singled out.
      g.answered = [...this.answers.keys(), ...this.passed];
      if (pid) {
        g.iAnswered = this.answers.has(pid) || this.passed.has(pid);
        g.myText = this.answers.get(pid) || '';
      }
    }

    if (this.phase === 'vote' || this.phase === 'reveal') {
      const it = this.cur;
      g.idx = this.idx;
      g.itemId = it.id;
      g.total = this.items.length;
      g.text = it.text;
      g.voted = [...it.votes.keys()];
      g.laughs = [...it.laughs.values()].reduce((a, b) => a + b, 0);
      g.connected = conn;
      if (pid) {
        g.isAuthor = it.author === pid;
        g.myVote = it.votes.get(pid) || null;
        g.myLaughs = it.laughs.get(pid) || 0;
        g.options = [...this.answers.keys()].filter((id) => id !== pid && !this.hidden.has(id));
      }
      if (this.phase === 'reveal') {
        g.author = it.author;
        g.correct = it.correct;
        g.fooled = it.fooled;
        g.guesses = [...it.votes].map(([voter, guess]) => ({ voter, guess }));
        g.pointsCorrect = POINTS_CORRECT;
        g.pointsFooled = POINTS_FOOLED;
        g.pointsLaugh = POINTS_LAUGH;
        if (pid) {
          g.myGain =
            (it.correct.includes(pid) ? POINTS_CORRECT : 0) +
            (pid === it.author ? it.fooled.length * POINTS_FOOLED : 0);
        }
      }
    }

    if (this.phase === 'scores' || this.phase === 'final') {
      g.standings = this.standings();
      g.note = this.note;
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

const PACKS = Object.fromEntries(Object.entries(CONTENT.packs).map(([k, v]) => [k, v.name]));

module.exports = {
  available: () => Object.keys(CONTENT.packs).length > 0,
  defaults: { rounds: 5, answerTime: 45, pack: 'mix' },
  options: [
    { key: 'rounds', label: 'Rounds', values: [[3, '3'], [5, '5'], [8, '8']] },
    { key: 'answerTime', label: 'Time to answer', values: [[30, '30s'], [45, '45s'], [60, '60s'], [90, '90s'], [120, '2 min']] },
    { key: 'pack', label: 'Prompts', values: [['mix', 'Mix'], ...Object.entries(PACKS)] },
  ],
  create: (room) => new WhoSaidThat(room),
};
