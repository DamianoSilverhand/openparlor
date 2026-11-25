// A room of 100: joining, updates reaching everyone, smaller messages, the audience, and every game played to the end.
const test = require('node:test');
const assert = require('node:assert/strict');
const { startServer } = require('../test-support/helpers');
const { playGame } = require('../test-support/bots');
const { people, joinCrowd, rssMb, fanOut, percentile, createRoom, connect, sleep } = require('../test-support/crowd');

test('100 phones can join at once, and a change reaches all of them quickly', async (t) => {
  const s = await startServer();
  t.after(() => s.stop());
  const code = await createRoom(s.base);
  const { clients, ms, host } = await joinCrowd(s, code, 100);
  assert.ok(ms < 10000, `joined in ${ms} ms`);
  assert.equal(host.last.players.length, 100);
  assert.equal(new Set(host.last.players.map((p) => p.avatar)).size, 100, 'every player has a different avatar');
  const arrival = await fanOut(clients, () => host.send({ t: 'pickGame', id: 'quiz' }), (st) => st.gameId === 'quiz');
  assert.ok(Number.isFinite(arrival[arrival.length - 1]), 'everyone got the update');
  assert.ok(percentile(arrival, 95) < 500, `95% of phones had it within ${percentile(arrival, 95)} ms`);
  assert.ok(arrival[arrival.length - 1] < 1000, `the slowest took ${arrival[arrival.length - 1]} ms`);
});

test('unchanged slow parts of the state are not sent again, and updates are batched', async (t) => {
  const s = await startServer();
  t.after(() => s.stop());
  const code = await createRoom(s.base);
  const { clients, host } = await joinCrowd(s, code, 60);
  const watcher = clients.find((c) => c !== host);
  await sleep(500);
  const sizes = [];
  watcher.ws.on('message', (d) => sizes.push({ bytes: d.length, keys: Object.keys(JSON.parse(d)) }));
  host.send({ t: 'pickGame', id: 'draw' }); // changes the game, not the players
  await sleep(400);
  const first = sizes[0];
  assert.ok(!first.keys.includes('players'), 'the 60 players were not sent again');
  assert.ok(first.bytes < 3000, `the update was ${first.bytes} bytes`);
  // A burst of changes in a big room becomes a few messages, not one per change.
  sizes.length = 0;
  for (let i = 0; i < 40; i++) host.send({ t: 'settings', settings: { turns: (i % 3) + 1 } });
  await sleep(600);
  assert.ok(sizes.length > 0 && sizes.length <= 8, `${sizes.length} messages for 40 changes`);
});

test('people who only watch cannot score, and can react and vote', async (t) => {
  const s = await startServer({ TIME_SCALE: '0.2' });
  t.after(() => s.stop());
  const code = await createRoom(s.base);
  const tv = await connect(s, code, null);
  const reactions = [];
  tv.ws.on('message', (d) => { const m = JSON.parse(d); if (m.t === 'reactions') reactions.push(m.counts); });
  const { clients: players, host } = await joinCrowd(s, code, 6);
  const watchers = await Promise.all(Array.from({ length: 30 }, (_, i) => connect(s, code, `W${i + 1}`, { audience: true })));
  await sleep(300);
  assert.equal(players[0].last.audienceCount, 30);
  assert.equal(players[0].last.players.length, 6, 'watchers are not players');
  assert.ok(watchers[0].last.audience && watchers[0].last.you.name === 'W1');
  host.send({ t: 'pickGame', id: 'quiz' });
  host.send({ t: 'settings', settings: { rounds: 2, teams: 2 } });
  await sleep(100);
  host.send({ t: 'start' });
  await sleep(150);
  host.send({ t: 'skipRules' });
  for (let i = 0; i < 100 && !(watchers[0].last.game && watchers[0].last.game.poll && watchers[0].last.game.poll.open); i++) {
    host.send({ t: 'g', a: 'next' });
    await sleep(100);
  }
  const poll = watchers[0].last.game.poll;
  assert.ok(poll && poll.open, 'the quiz opened a crowd poll');
  // Reactions: every watcher spams, the TV gets a few batches.
  for (const w of watchers) { w.send({ t: 'react', e: '👏' }); w.send({ t: 'react', e: '👏' }); w.send({ t: 'react', e: 'not-an-emoji' }); }
  // Votes: 20 for option 0, 10 for option 1, plus a vote that must be refused.
  watchers.forEach((w, i) => w.send({ t: 'aud', idx: i < 20 ? 0 : 1 }));
  watchers[0].send({ t: 'aud', idx: 99 });
  players[3].send({ t: 'aud', idx: 2 }); // a player is not allowed to vote in the crowd poll
  await sleep(500);
  const state = watchers[0].last.game;
  assert.deepEqual(state.poll.counts.slice(0, 2), [20, 10]);
  assert.equal(state.poll.total, 30);
  assert.equal(state.myVote, 0);
  assert.ok(reactions.length >= 1 && reactions.length <= 4, `${reactions.length} reaction batches for 60 reactions`);
  assert.ok(reactions.every((c) => Object.keys(c).every((e) => e === '👏')), 'only real emoji get through');
  for (const p of players) assert.equal(p.last.players.find((x) => x.id === p.last.me).score, 0, 'nothing scored yet');
  assert.ok(await s.alive());
});

test('people can choose to watch, the host can move them, latecomers watch, and seats come back after the game', async (t) => {
  const s = await startServer();
  t.after(() => s.stop());
  const code = await createRoom(s.base);
  const { clients, host } = await joinCrowd(s, code, 8);
  const others = clients.filter((c) => c !== host);
  // A player can choose to watch in the lobby.
  others[6].send({ t: 'role', audience: true });
  await sleep(200);
  assert.equal(host.last.players.length, 7);
  assert.equal(host.last.audienceCount, 1);
  others[6].send({ t: 'role', audience: false });
  await sleep(200);
  assert.equal(host.last.players.length, 8, 'and take a seat again');
  // The host can move someone to the audience.
  host.send({ t: 'setRole', id: others[5].last.me, audience: true });
  await sleep(200);
  assert.equal(host.last.players.length, 7);
  host.send({ t: 'setRole', id: others[5].last.me, audience: false });
  await sleep(200);
  assert.equal(host.last.players.length, 8);
  // Someone who arrives while a game that cannot take newcomers is on watches; draw and mini-games take them in.
  host.send({ t: 'pickGame', id: 'quiz' });
  await sleep(100);
  host.send({ t: 'start' });
  await sleep(150);
  host.send({ t: 'skipRules' });
  await sleep(200);
  const late = await connect(s, code, 'Late');
  assert.equal(late.last.audience, true, 'late for the quiz: watching');
  host.send({ t: 'lobby' });
  await sleep(300);
  assert.equal(host.last.players.length, 9, 'and has a seat again in the lobby');
  host.send({ t: 'pickGame', id: 'draw' });
  await sleep(100);
  host.send({ t: 'start' });
  await sleep(150);
  host.send({ t: 'skipRules' });
  await sleep(200);
  const late2 = await connect(s, code, 'Late2');
  assert.ok(!late2.last.audience, 'draw takes latecomers');
});

test('whole games with 100 players: Who Said That?', async (t) => {
  const s = await startServer({ TIME_SCALE: '0.02' });
  t.after(() => s.stop());
  let maxOptions = 0;
  const act = (bot, m, bots) => {
    const g = m.game;
    if (m.gameId === 'whosaidthat' && g.phase === 'vote' && g.options) {
      maxOptions = Math.max(maxOptions, g.options.length);
      if (g.options.length) setTimeout(() => bot.send({ t: 'g', a: 'vote', guess: g.options[0] }), 30);
    }
    if (m.gameId === 'whosaidthat' && g.phase === 'answer' && !g.myText) setTimeout(() => bot.send({ t: 'g', a: 'answer', text: `idea from ${m.me}` }), 30);
    void bots;
  };
  const { final, phases, host } = await playGame(s, 'whosaidthat', { people: people(100), settings: { rounds: 3, answerTime: 30 }, act, timeoutMs: 150000 });
  assert.ok(phases.includes('final'));
  assert.ok(maxOptions > 0 && maxOptions <= 8, `a ballot had ${maxOptions} names`);
  assert.equal(final.game.standings.length, 100);
  assert.equal((await (await fetch(`${s.base}/api/history`)).json()).games[0].results.length, 100);
  void host;
});

test('whole games with 100 players: Quiz Show with automatic teams, and memory stays flat', async (t) => {
  const s = await startServer({ TIME_SCALE: '0.04' });
  t.after(() => s.stop());
  const before = rssMb(s);
  let mid = NaN;
  const act = (bot, m) => {
    const g = m.game;
    if (g.phase === 'question' && g.mine && m.me === m.hostId && Number.isNaN(mid)) mid = rssMb(s);
    require('../test-support/bots').defaultAct(bot, m, []);
  };
  const { final } = await playGame(s, 'quiz', { people: people(100), settings: { rounds: 2 }, act, timeoutMs: 150000 });
  const after = rssMb(s);
  assert.ok(final.game.teams.length >= 12 && final.game.teams.length <= 16, `${final.game.teams.length} teams for 100 players`);
  assert.equal(new Set(final.game.teams.flatMap((x) => x.members)).size, 100, 'everyone is on a team');
  if (Number.isFinite(before) && Number.isFinite(mid)) {
    assert.ok(after - before < 250, `memory grew ${Math.round(after - before)} MB`);
    assert.ok(after - mid < 80, `memory grew ${Math.round(after - mid)} MB during the game`);
  }
  assert.equal((await (await fetch(`${s.base}/api/history`)).json()).games[0].results.length, 100);
});

test('whole games with 100 players: Draw & Guess has ten drawings, Mini-Games finishes', async (t) => {
  const s = await startServer({ TIME_SCALE: '0.04' });
  t.after(() => s.stop());
  const draw = await playGame(s, 'draw', { people: people(100), settings: { turns: 1, drawTime: 30 }, timeoutMs: 150000 });
  assert.equal(draw.final.game.turnsTotal, 10, 'ten players draw in a room of a hundred');
  const mini = await playGame(s, 'minigames', { people: people(100), settings: { games: 3 }, timeoutMs: 150000 });
  assert.ok(mini.phases.includes('final'));
  assert.ok(await s.alive());
  assert.doesNotMatch(s.log(), /TypeError|ReferenceError|error in a timer|error handling/);
});

test('the avatar of 144 different people can be told apart', () => {
  const { Rooms } = require('../server/rooms');
  const room = new Rooms().create();
  const ws = { send() {}, close() {}, readyState: 1 };
  const looks = new Set();
  for (let i = 0; i < 144; i++) looks.add(room.addPlayer(`N${i}`, i % 12, ws, null, 'adult').avatar);
  assert.equal(looks.size, 144);
});
