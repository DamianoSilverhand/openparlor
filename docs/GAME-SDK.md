# Game SDK (version 1)

You can add your own games to OpenParlor without changing its code. There are two kinds:

- A **game**: a full party game with its own rules, a TV screen and a phone screen (for example Higher or Lower).
- A **mini-game**: a small solo challenge that runs on the phone. It appears in the Mini-Games game and in Solo Practice (for example Tap Storm).

A mini-game is much simpler to write, so start there. Both are shown in full in [`examples/`](../examples/): `higher-lower` and `tap-storm`.

> **Plugins are trusted code.** A game's `server.js` runs inside the server with full access to the machine and its data. Only install plugins from people you trust, and read the code first. There is no sandbox.

## Installing a plugin

Copy its folder into `plugins/` and restart the server:

    cp -r examples/higher-lower plugins/
    cp -r examples/tap-storm plugins/

The server log says what loaded. A plugin that fails to load is reported (with the reason) and skipped; it never stops the server. To switch all plugins off set `"plugins": { "enabled": false }` in your config. To keep them somewhere else set `PLUGINS_DIR`.

The folder name must be the same as the plugin's `id`, and ids must be unique. A plugin cannot replace a built-in game.

---

## Games

### Folder

    plugins/my-game/
      game.json          the manifest
      server.js          the rules (runs on the server)
      public/
        tv.js            the big-screen view
        play.js          the phone view
        styles.css       optional

Only `public/` is sent to browsers. `server.js` and `game.json` are never served.

### game.json

| Field | Meaning |
|---|---|
| `sdk` | Must be `1`. |
| `id` | Lowercase letters, numbers and `-`, 2 to 30 characters, starting with a letter. Same as the folder name. |
| `name` | Shown to players (up to 40 characters). |
| `description` | One sentence for the lobby. |
| `minPlayers` | The least number of players needed (1 to 100). |
| `usesBands` | `true` if the game wants every player to choose a band (a difficulty group such as Kid or Adult). The lobby then asks. |
| `bandHint` | Text shown under the band picker, when `usesBands` is true. |
| `order` | Where it sits in the game list. Built-in games use 10 to 40; the default is 100. |
| `maxSeats` | Optional. The most people who can play at once (2 to 1000). When more are in the room, the latest arrivals watch as the audience until the game ends. Default: no limit. |
| `lateJoin` | Optional, default `false`. Whether someone who arrives while the game is running can take part at once. If `false` they watch until it ends. |
| `rules` | `{ "steps": ["..."], "scoring": "..." }`. Shown on the How to play screen before the game starts. |
| `tv`, `play` | Paths, inside `public/`, of the two view modules. |
| `styles` | Optional list of CSS paths inside `public/`. |

### server.js

Export an object, or a function that receives the SDK and returns the object:

```js
module.exports = (sdk) => {
  const { GameBase } = sdk;
  class MyGame extends GameBase { /* ... */ }
  return {
    defaults: { rounds: 5 },                       // the settings the host starts with
    options: [{ key: 'rounds', label: 'Rounds', values: [[3, '3'], [5, '5'], [8, '8']] }],
    available: () => true,                          // optional: return false to hide the game (for example no content)
    create: (room) => new MyGame(room),
  };
};
```

`options` become the host's settings. Each value is a `[value, label]` pair, and each default must be one of its option's values. They are checked at start-up.

The SDK object:

| | |
|---|---|
| `GameBase` | The class to extend (below). |
| `shuffle(array)` | A shuffled copy. |
| `clean(text, max)` | Trims, collapses spaces and masks bad words. Use it on any text a player sends. |
| `bands` | `bands.tierName(bandId)` gives `'easy'`, `'medium'` or `'hard'` for a player's band. `bands.list()` lists the bands. |
| `content` | The loaded packs: `questions`, `prompts`, `words`, `scramble`, `literacy` (see [CONTENT-PACKS.md](CONTENT-PACKS.md)). |
| `profiles`, `records` | Saved profiles and group records. Most games do not need them. |
| `minigames` | The installed mini-games: `{ byId, list }`. |
| `settings` | `{ brand, profilesEnabled }`. |
| `log(...)` | Prints to the server log. |

You can also load the SDK with `require('../../server/sdk')` if your plugin sits inside the repository.

### GameBase

Extend it and call `super(room)` first. It gives you:

| | |
|---|---|
| `this.room` | The room: `room.players` (a Map of id to player), `room.hostId`, `room.update()`, `room.toTvs(obj)`, `room.send(ws, obj)`. |
| `this.s` | A copy of the settings the host chose. |
| `this.phase` | A string you set (`'guess'`, `'reveal'`...). Set it to **`'final'`** when the game is over. |
| `this.later(ms, fn)` | Runs `fn` after `ms`, replacing any timer already running. It honours Pause. Use it for every phase timer. |
| `this.timerState()` | `{ deadline, timerTotal }`: spread it into your state so every screen can draw the countdown bar. |
| `this.add(pid, pts)` | Adds points to a player's score and to `this.gains`, the points won this round (for "+100" displays). |
| `this.connected()` | The players who are connected right now. |
| `canPause()` | Override to return `false` in phases that must not be paused (default: any phase except `'final'`). |

You write three methods:

- **`onMessage(pid, msg)`**: a message from a phone. Phones send `{ t: 'g', a: 'action', ... }` and your code receives the whole object, so switch on `msg.a`. **Everything in `msg` comes from the network: check every field**, and check that the sender is allowed to act in the current phase.
- **`tvState()`**: the state the big screen needs, as a plain object that can become JSON.
- **`phoneState(pid)`**: the state for one phone. **Never include a secret (an answer, another player's hidden choice) before it should be revealed**: anything you put here can be read in the browser.

Rules of thumb:

- After you change anything the screens show, call **`this.room.update()`**. It sends fresh state to everyone.
- Include `standings: [{ id, score, gain }]` (best first) in the state of the `'final'` phase: the shared final screens use it.
- Scores live on the players (`room.players.get(id).score`). Reset them to 0 in your constructor.
- Optional methods: `onPlayerChange()` (someone joined, left or reconnected), `onTvConnect(ws)` (a TV connected or reconnected: send it anything it needs to catch up), `onDestroy()` (clear any timers of your own).
- Custom messages to the TV: `room.toTvs({ t: 'game', game: 'my-game', ev: 'something', ... })`. They reach `onEvent` in your `tv.js`.

When a game reaches `'final'`, the room saves everyone's score to the history automatically.

### Big rooms and the audience

A room can hold a hundred people, so design for it:

- **Games only ever see players.** People who are only watching (the audience) are kept in `room.audience`, never in `room.players`, so they cannot get a turn, a team, a vote that counts or a score. Do not look for them in your game.
- **Crowd poll.** Call `this.openPoll(['A', 'B', 'C', 'D'])` to let the audience vote, and `this.closePoll()` when voting is over (`clearPoll()` removes it). The room adds `poll: { labels, counts, total, open }` to every state, and each watcher also gets `myVote`. Show the result on the big screen. Votes never change scores.
- **Reactions** (emoji from anyone) are handled by the room and shown on the TV; you do nothing.
- **Do not list everyone.** With 100 players, show the top few and the viewer's own place (`topAndMe(items, isMe, n)` in `/sdk/play.js`), a count instead of a chip for each person, and choose a sample when a round would otherwise take all night (Who Said That? shows 12 answers a round, with 8-name ballots; Draw & Guess has ten artists above 12 players; the quiz makes teams of about six).
- **State size matters.** Every state change goes to every phone. Keep `phoneState` small, and do not repeat lists the phone already has.
- Updates are throttled by the room (the first change goes out at once, the rest are folded into one send about every 80 ms), so calling `room.update()` often is fine.

### public/tv.js and public/play.js

Both export `screen`. It returns `{ key, build }`:

```js
export function screen(s) {          // phone version: screen(s, ctx)
  const g = s.game;
  return { key: `${g.phase}:${g.round}`, build: (s) => buildScreen(s) };
}
```

When `key` changes, the page calls `build(s)` to make a new screen. While it stays the same, the page calls the existing screen's `update(s)` with each new state. `build` returns `{ el, update, destroy? }`: `el` is a DOM element, `update(s)` refreshes it, `destroy()` is optional clean-up. Use different keys for screens that look different, and the same key for state changes that should just update the screen.

`s` is the whole room state: `s.game` is what you returned from `tvState()` or `phoneState()` (plus `paused` and `canPause`), `s.players` is `[{ id, name, avatar, score, level, connected }]`, `s.me` is the viewer's id on a phone, `s.hostId`, `s.gameName`, `s.settings`.

On the phone, `ctx.send(message)` sends a message to your `onMessage`. The `game('answer', { text })` helper from `/sdk/play.js` builds the `{ t: 'g', a, ... }` object.

**What you can import** (always with these absolute paths):

| Module | Provides |
|---|---|
| `/shared/ui.js` | `h(tag, props, ...children)` (builds DOM), `avatar(player)`, `tag(player)`, `byId(players)`, `timer()`, `ordinal(n)`, `soundToggle()`, `onTick`, `serverNow()` |
| `/shared/sound.js` | `play(name)`. Names: tap, pop, tick, lock, go, good, bad, match, correct, wrong, buzz, whoosh, drum, coin, fanfare |
| `/shared/config.js` | `config` (brand, bands), `bandLabel(id)`, `tierOfBand(id)`, `tierLabel(tier)` |
| `/shared/i18n.js` | `t(key, vars)` for interface text |
| `/shared/canvas.js` | The drawing canvas helpers used by Draw & Guess |
| `/sdk/tv.js` | `finalScreen(s, awards)` (podium and awards), `confetti()` |
| `/sdk/play.js` | `game(a, extra)`, `meBar(s)`, `hostButton(s, ctx, label, primary)`, `list(s)` (standings), `final(s, ctx)` (the standard end screen) |

The `timer()` helper draws the countdown bar: call `t.update(g)` with the game state and it reads `deadline`, `timerTotal` and the pause fields.

**Optional exports:**

- `onEvent(m)` (TV): receives the custom events your server sends with `room.toTvs`.
- `cues`: sounds. On the TV: `{ timedPhases, onPhase(g, sfx), onChange(g, prevG, sfx), tick(g, now) }`. On phones: `{ onChange(s, prevS, phaseChanged, sfx) }`. `sfx(name)` plays a shared sound. All parts are optional; the TV already plays fanfare for `'final'` and a coin sound for a phase named `'scores'`.

### Styling

Use the theme tokens, never fixed colours, so dark mode works. They are listed at the top of `public/shared/style.css`:

- `--paper`, `--card` (backgrounds) and `--ink`, `--soft` (text on them).
- Accent fills: `--mustard`, `--tomato`, `--teal`, `--leaf`, `--pink`, `--sky`. Text on a light or accent fill must use `color: var(--on-color); --soft: var(--on-color-soft);`.
- `--tomato-text` and `--teal-text` for red or green used as text on a card.

Prefix your class names (`.hl-number`) so they cannot clash with others, and list your stylesheet in `styles`. Existing classes such as `.card`, `.btn`, `.screen`, `.stage`, `.bar`, `.pill`, `.title`, `.lead` and `.status` are safe to reuse.

---

## Mini-games

### Folder

    plugins/tap-storm/
      minigame.json
      client.js

### minigame.json

| Field | Meaning |
|---|---|
| `sdk` | Must be `1`. |
| `id`, `name`, `description` | As for games. |
| `howto` | A short explanation shown before each round (up to 500 characters). Give an example. |
| `duration` | Seconds a round lasts (10 to 300). |
| `max` | The most points a round can give (100 to 100000). A score above it is cut to it. |
| `group` | `brain`, `speed` or `other`. The host can restrict a set to brain games or speed games. |
| `client` | The module, default `client.js`. |

### client.js

Export `start(ctx)`; it builds the game inside `ctx.root` and returns `{ score(), destroy() }`:

| `ctx` | |
|---|---|
| `root` | The element to draw into. |
| `seed` | A number the same for everyone in the round. Use `rng(ctx.seed)` from `/sdk/minigame.js` so every player gets the same puzzle. |
| `level` | `'easy'`, `'medium'` or `'hard'`, from the player's band. Make the game gentler or harder. |
| `durationMs` | How long the round lasts. |
| `progress(score)` | Optional: report your score so far (the TV shows live scores). |
| `finish(score)` | Call it if the player finishes early. Otherwise the app ends the round when time is up and uses `score()`. |

`/sdk/minigame.js` provides `rng(seed)`, `pick`, `int`, `shuffled` and `timeouts()` (timers that are all cleared on exit). The same module runs in rooms and in Solo Practice, where `level` comes from the profile's band.

---

## Testing your plugin

1. Put it in `plugins/` and start the server. Watch the log for messages that start with `[games]` or `[minigames]`.
2. `TIME_SCALE=0.05 npm start` makes every game timer 20 times shorter, so you can play a whole game in seconds.
3. The bots in `test-support/bots.js` play a game through the real protocol. `test/plugins.test.js` shows how to load a plugin folder with `PLUGINS_DIR` and play it with bots.
4. Run `npm test` to make sure the built-in games still work.

## Common problems

| Message | Cause |
|---|---|
| `needs "sdk": 1` | The manifest has no `sdk`, or it is for a different SDK version. |
| `the folder name must match the game id` | Rename the folder to the `id`. |
| `public/tv.js does not exist` | A path in the manifest points to a file that is missing. |
| `server.js failed to load: ...` | A syntax error or exception when the file loads. The message says what. |
| `the default for option "x" must be one of its values` | Fix `defaults` or the option's `values`. |
| The game starts but a screen stays blank | Open the browser's console: an error in `tv.js` or `play.js` is shown there. |

The SDK is versioned (`"sdk": 1`). A later incompatible version will use a higher number, and plugins made for another version are refused with a clear message instead of failing in odd ways.
