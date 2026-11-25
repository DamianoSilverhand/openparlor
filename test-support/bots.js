// Bots that play a whole game through the real WebSocket protocol, used to prove that a game works end to end.
// Start the server with TIME_SCALE (for example 0.05) so a full game takes seconds.
const { connect, createRoom, sleep } = require('./helpers');

const PEOPLE = [['Ana', 'adult'], ['Bo', 'adult'], ['Cy', 'teen'], ['Di', 'kid']];

// Plays `gameId` to its final screen. `act(bot, state, all)` is called on every state change for every bot and may send
// messages; the default handles the four built-in games. Returns { final, phases } or throws on timeout.
async function playGame(server, gameId, { settings = {}, people = PEOPLE, timeoutMs = 60000, act = defaultAct, stopAt = 'final' } = {}) {
  const code = await createRoom(server.base);
  const bots = [];
  for (const [name, level] of people) bots.push(await connect(server, code, name, { level }));
  const host = bots[0];
  const phases = [];
  let final = null;
  const sent = new Map();
  const onState = (bot) => (m) => {
    if (m.t !== 'state' || !m.game) return;
    const g = m.game;
    const key = [g.phase, g.round, g.idx, g.qi, g.turn, g.itemId].join(':');
    if (bot === host && phases[phases.length - 1] !== g.phase) phases.push(g.phase);
    if (g.phase === stopAt) final = m;
    const mark = `${bots.indexOf(bot)}:${key}`;
    if (sent.get(bot) === mark) return;
    sent.set(bot, mark);
    try {
      act(bot, m, bots);
    } catch {}
  };
  for (const b of bots) b.ws.on('message', (d) => onState(b)(JSON.parse(d)));
  host.send({ t: 'pickGame', id: gameId });
  if (Object.keys(settings).length) host.send({ t: 'settings', settings });
  await sleep(100);
  host.send({ t: 'start' });
  await sleep(150);
  host.send({ t: 'skipRules' });
  const t0 = Date.now();
  while (!final && Date.now() - t0 < timeoutMs) await sleep(100);
  if (!final) throw new Error(`${gameId} did not reach "${stopAt}" within ${timeoutMs} ms (phases: ${phases.join(' > ')})`);
  return { final, phases, bots, host, code };
}

function defaultAct(bot, m, bots) {
  const g = m.game;
  const host = m.me === m.hostId;
  const later = (fn, ms = 80) => setTimeout(fn, ms);
  const send = (o) => bot.send({ t: 'g', ...o });
  if (m.gameId === 'whosaidthat') {
    if (g.phase === 'answer' && !g.myText) later(() => send({ a: 'answer', text: `answer from ${m.me}` }));
    if (g.phase === 'vote' && g.options && g.options.length) later(() => { send({ a: 'vote', guess: g.options[0] }); send({ a: 'laugh' }); });
    if (host && ['reveal', 'scores'].includes(g.phase)) later(() => send({ a: 'next' }), 200);
  } else if (m.gameId === 'draw') {
    if (g.phase === 'choose' && g.drawer === m.me) later(() => send({ a: 'pick', i: 0 }));
    if (g.phase === 'draw' && g.drawer === m.me) {
      later(() => send({ a: 'seg', id: 1, c: '#000000', s: 0.01, pts: [[0.1, 0.1], [0.5, 0.5]] }));
      const word = g.word || (g.choices && g.choices[0] && g.choices[0].word);
      bot.word = word;
    }
    if (g.phase === 'draw' && g.drawer !== m.me) {
      const drawer = bots.find((b) => b.last && b.last.me === g.drawer);
      const word = (drawer && drawer.word) || (drawer && drawer.last && drawer.last.game && drawer.last.game.word);
      if (word) later(() => send({ a: 'guess', text: word }), 200);
    }
    if (host && g.phase === 'result') later(() => send({ a: 'next' }), 200);
  } else if (m.gameId === 'quiz') {
    if (g.phase === 'question' && g.mine) later(() => send({ a: g.canAnswer ? 'answer' : 'suggest', idx: g.mine[0] }));
    if (g.phase === 'wager') later(() => send({ a: 'wager', amount: 0 }));
    if (host && ['intro', 'category', 'reveal', 'scores'].includes(g.phase)) later(() => send({ a: 'next' }), 200);
  } else if (m.gameId === 'minigames') {
    if (g.phase === 'play' && g.inRound) later(() => send({ a: 'result', score: Math.floor(g.mg.max * 0.4) }), Math.max(0, g.startAt - Date.now()) + 150);
    if (host && ['intro', 'results'].includes(g.phase)) later(() => send({ a: 'next' }), 200);
  }
}

module.exports = { playGame, defaultAct, PEOPLE };
