// Plays every built-in game from start to finish with bots (timers shortened with TIME_SCALE).
const test = require('node:test');
const assert = require('node:assert/strict');
const { startServer } = require('../test-support/helpers');
const { playGame } = require('../test-support/bots');

const GAMES = [
  ['whosaidthat', { rounds: 3, answerTime: 30 }],
  ['draw', { turns: 1, drawTime: 30 }],
  ['quiz', { rounds: 1, teams: 2 }],
  ['minigames', { games: 3 }],
];

for (const [id, settings] of GAMES) {
  test(`${id}: a whole game runs to the final screen and is saved to the history`, async (t) => {
    const s = await startServer({ TIME_SCALE: '0.04' });
    t.after(() => s.stop());
    const { phases, host } = await playGame(s, id, { settings });
    assert.ok(phases.includes('final'), phases.join(' > '));
    assert.ok(await s.alive());
    assert.doesNotMatch(s.log(), /TypeError|ReferenceError|error in a timer|error handling/);
    // Start another game from the final screen.
    host.send({ t: 'again' });
    // The history is written when the final screen is reached.
    const games = (await (await fetch(`${s.base}/api/history`)).json()).games;
    assert.equal(games.length, 1);
    assert.equal(games[0].game, id);
    assert.equal(games[0].results.length, 4);
  });
}
