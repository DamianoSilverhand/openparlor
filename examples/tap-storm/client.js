// A complete example mini-game. Copy this folder to plugins/ to use it in Mini-Games and Solo Practice.
//
// start(ctx) builds the game inside ctx.root and returns { score(), destroy() }. ctx has:
//   root        the element to draw into
//   seed        a number shared by everyone in the round: use rng(ctx.seed) so all players get the same puzzle
//   level       'easy', 'medium' or 'hard' (from the player's band): make it gentler or harder
//   durationMs  how long the round lasts
//   progress(score)  optional: tell the server your score so far
//   finish(score)    call when the player is done early; otherwise the app finishes the round when time is up
import { h } from '/shared/ui.js';
import { play } from '/shared/sound.js';

export function start(ctx) {
  let taps = 0;
  const label = h('div', { class: 'lead' }, 'Taps: 0');
  const button = h('button', {
    class: 'btn block',
    style: { fontSize: '2rem', padding: '2.2rem 1rem' },
    onpointerdown: (e) => {
      e.preventDefault();
      taps++;
      label.textContent = `Taps: ${taps}`;
      play('tap');
      ctx.progress(taps * 10);
    },
  }, 'TAP!');
  ctx.root.replaceChildren(label, button);
  return {
    score: () => Math.min(3000, taps * 10), // must not exceed "max" in minigame.json
    destroy() {},
  };
}
