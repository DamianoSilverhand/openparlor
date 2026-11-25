// Base class for server-side games. It supplies what every game needs (phase timers that can be paused, scoring,
// clean-up) so a game only has to describe its own rules.
//
//   class MyGame extends GameBase {
//     constructor(room) { super(room); this.phase = 'play'; this.later(30000, () => this.finish()); room.update(); }
//     phoneState(pid) { return { phase: this.phase, ...this.timerState() }; }
//     tvState() { return { phase: this.phase, ...this.timerState() }; }
//     onMessage(pid, msg) { ... }
//   }
//
// Required: tvState(), phoneState(pid), onMessage(pid, msg). Set this.phase = 'final' when the game is over: the room
// then saves the result to the history and shows the final buttons. Optional: onPlayerChange(), onTvConnect(ws),
// onDestroy(), canPause().
const { schedulePhase, toggleGamePause } = require('../util');

class GameBase {
  constructor(room) {
    this.room = room;
    this.s = { ...room.settings }; // the settings the host chose, copied so they cannot change mid-game
    this.phase = null;
    this.timer = null;
    this.deadline = 0; // when the current timer fires (ms since epoch), for the countdown bar on every screen
    this.timerTotal = 0; // how long the current timer is, for the bar's width
    this.paused = false;
    this.pausedLeft = 0;
    this.gains = new Map(); // player id -> points won in the current round, for "+100" displays
  }

  // Runs fn after ms, replacing any timer already running. Honours pause and TIME_SCALE.
  later(ms, fn) {
    schedulePhase(this, ms, fn);
  }

  // The fields every screen needs to draw the countdown bar: spread them into tvState() and phoneState().
  timerState() {
    return { deadline: this.deadline, timerTotal: this.timerTotal };
  }

  canPause() {
    return this.phase !== 'final';
  }

  togglePause() {
    toggleGamePause(this, this.canPause());
  }

  // Adds points to a player's total score and to this round's gains.
  add(pid, pts) {
    const p = this.room.players.get(pid);
    if (!p || !pts) return;
    p.score += pts;
    this.gains.set(pid, (this.gains.get(pid) || 0) + pts);
  }

  // Players who are currently connected.
  connected() {
    return [...this.room.players.values()].filter((p) => p.connected);
  }

  destroy() {
    clearTimeout(this.timer);
    this.timer = null;
    if (typeof this.onDestroy === 'function') this.onDestroy();
  }
}

module.exports = { GameBase };
