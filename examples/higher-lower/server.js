// A complete example game for the OpenParlor SDK. Copy this folder to plugins/ to use it. See docs/GAME-SDK.md.
//
// A game's server code extends GameBase and describes only its own rules: the base class supplies phase timers (which
// honour pause), scoring and clean-up. This file may export a plain object or, as here, a function that receives the SDK.
module.exports = (sdk) => {
  const { GameBase } = sdk;

  const GUESS_MS = 12000;
  const REVEAL_MS = 5000;
  const randomNumber = () => 1 + Math.floor(Math.random() * 99);

  class HigherLower extends GameBase {
    constructor(room) {
      super(room); // copies the host's settings into this.s
      for (const p of room.players.values()) p.score = 0;
      this.round = 0;
      this.totalRounds = this.s.rounds;
      this.startRound();
    }

    startRound() {
      this.round++;
      this.gains = new Map();
      this.current = randomNumber();
      do this.next = randomNumber();
      while (this.next === this.current);
      this.guesses = new Map(); // player id -> 'higher' | 'lower'
      this.guessedAt = new Map();
      this.phase = 'guess';
      this.later(GUESS_MS, () => this.reveal()); // when the timer ends, show the answer
      this.room.update(); // every state change ends with room.update(): it sends fresh state to the TV and phones
    }

    reveal() {
      if (this.phase !== 'guess') return;
      const answer = this.next > this.current ? 'higher' : 'lower';
      for (const [pid, choice] of this.guesses) {
        if (choice !== answer) continue;
        const left = Math.max(0, this.deadline - this.guessedAt.get(pid)) / this.timerTotal;
        this.add(pid, 100 + Math.round(100 * left)); // add() updates the player's score and this round's gains
      }
      this.phase = 'reveal';
      this.later(REVEAL_MS, () => {
        if (this.round >= this.totalRounds) {
          this.phase = 'final'; // the room saves the result to the history and shows the final buttons
          this.room.update();
        } else {
          this.startRound();
        }
      });
      this.room.update();
    }

    // Messages from phones arrive here as { a: 'guess', choice: 'higher' }. Validate everything: it comes from the network.
    onMessage(pid, msg) {
      if (msg.a !== 'guess' || this.phase !== 'guess' || this.guesses.has(pid)) return;
      if (msg.choice !== 'higher' && msg.choice !== 'lower') return;
      this.guesses.set(pid, msg.choice);
      this.guessedAt.set(pid, Date.now());
      this.room.update();
      if (this.connected().every((p) => this.guesses.has(p.id))) this.reveal(); // everyone has answered: no need to wait
    }

    standings() {
      return [...this.room.players.values()]
        .sort((a, b) => b.score - a.score)
        .map((p) => ({ id: p.id, score: p.score, gain: this.gains.get(p.id) || 0 }));
    }

    // What the TV may see. Never include the answer before the reveal.
    tvState() {
      const g = { phase: this.phase, round: this.round, totalRounds: this.totalRounds, number: this.current, answered: [...this.guesses.keys()], ...this.timerState() };
      if (this.phase !== 'guess') Object.assign(g, { next: this.next, right: this.next > this.current ? 'higher' : 'lower', standings: this.standings() });
      return g;
    }

    // What one phone sees: the same, plus that player's own guess.
    phoneState(pid) {
      return { ...this.tvState(), myGuess: this.guesses.get(pid) || null };
    }
  }

  return {
    defaults: { rounds: 5 },
    options: [{ key: 'rounds', label: 'Rounds', values: [[3, '3'], [5, '5'], [8, '8']] }],
    create: (room) => new HigherLower(room),
  };
};
