const BAD = ['fuck', 'shit', 'bitch', 'cunt', 'dick', 'piss', 'asshole', 'bastard', 'slut', 'whore', 'nigg', 'fag', 'porn'];

// Trim, collapse whitespace, cap length, and mask a short list of bad words.
function clean(input, max = 140) {
  let s = String(input == null ? '' : input).replace(/\s+/g, ' ').trim().slice(0, max);
  for (const w of BAD) s = s.replace(new RegExp(w, 'gi'), (m) => '*'.repeat(m.length));
  return s;
}

function shuffle(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function schedulePhase(game, ms, fn, keepTotal = false) {
  clearTimeout(game.timer);
  game.paused = false;
  game.pausedLeft = 0;
  // A throwing timer callback is logged, never fatal.
  const safe = () => {
    try {
      fn();
    } catch (err) {
      console.error('[game] error in a timer:', err);
    }
  };
  game._timerFn = fn;
  if (!keepTotal) game.timerTotal = ms;
  game.deadline = Date.now() + ms;
  game.timer = setTimeout(safe, ms);
}

function toggleGamePause(game, canPause = true) {
  if (!game || !canPause || game.phase === 'final') return;
  if (game.paused) {
    const left = game.pausedLeft || 1000;
    const fn = game._timerFn;
    game.paused = false;
    game.pausedLeft = 0;
    if (fn) schedulePhase(game, left, fn, true);
  } else if (game.deadline > Date.now()) {
    game.pausedLeft = Math.max(500, game.deadline - Date.now());
    clearTimeout(game.timer);
    game.paused = true;
    game.deadline = 0;
  }
  game.room.update();
}

module.exports = { clean, shuffle, schedulePhase, toggleGamePause };
