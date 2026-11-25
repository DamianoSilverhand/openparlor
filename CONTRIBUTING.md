# Contributing to OpenParlor

Thank you for helping. OpenParlor is a small project with a simple goal: party games that a whole room can play, on a
big screen and everyone's phones, with nothing to sign up for. Bug reports, content, plugins, documentation and code
are all welcome.

By taking part you agree to follow the [Code of Conduct](CODE_OF_CONDUCT.md).

## Ways to help

- **Try it and tell us what broke.** The best bug reports say which devices and browsers you used and what the server
  printed. Use the bug report form.
- **Fix a wrong answer or a bad question.** Use the "Content problem or pack" form, or send a pull request that edits
  the file in `content/`.
- **Share a content pack** (questions, prompts or words). See [docs/CONTENT-PACKS.md](docs/CONTENT-PACKS.md).
- **Write a game or mini-game as a plugin.** See [docs/GAME-SDK.md](docs/GAME-SDK.md). A plugin does not need to live in
  this repository; if it is useful to many people, we would be glad to list it.
- **Improve the docs**, translations of the interface text (`public/locales/`), or the test coverage.

For anything larger than a small fix, please open an issue first so we can agree on the approach before you spend time on it.

## Setting up

You need **Node 22.13 or newer** (`nvm use` picks the right one from `.nvmrc`).

    git clone <your fork>
    cd openparlor
    npm install
    npm start          # http://localhost:3100

Before you push:

    npm run lint       # ESLint
    npm run validate   # checks the content files
    npm test           # the whole test suite

The tests start the real server and play every game to the end with bots, so they take about a minute. They use a
temporary data folder and never touch your `data/`.

## How the code is organised

| | |
|---|---|
| `server/` | The server: rooms, the SDK and plugin loader, the database, configuration. |
| `games/<id>/` | The four built-in games, each a plugin: `game.json`, `server.js`, `public/`. |
| `minigames/<id>/` | The eight built-in mini-games. |
| `public/` | The pages (home, TV, phone, solo, scores), shared browser modules and the service worker. |
| `content/` | Built-in questions, prompts and words (CC BY-SA 4.0). |
| `config/` | Defaults and presets. |
| `docs/` | Documentation. |
| `examples/` | Complete example plugins. |
| `test/`, `test-support/` | Tests and the bots that play games. |

Plain JavaScript with no build step: the browser runs the files as they are. Keep it that way, and keep dependencies to
a minimum (a new runtime dependency needs a good reason).

## Guidelines

- **The server decides.** Never send secrets (answers, hidden choices) to a browser before they should be revealed, and
  check every field of every message from a client.
- **Add a test** for a bug fix or a new behaviour. The helpers in `test-support/` start a server and play games with bots.
- **Use the theme tokens** in CSS (`var(--card)`, `var(--on-color)`...) instead of fixed colours, so dark mode works.
- **Interface text** that players read belongs in `public/locales/en.json` (use `t('key')`), not inline.
- **Content:** original wording only (no text copied from other quizzes, books or games), facts you can check, suitable for
  mixed audiences, and exactly three wrong answers per question. `npm run validate` checks the format.
- **Keep changes focused.** One thing per pull request is easier to review. Small commits with a clear message are good:
  say what changed and why.

## Content licence

Code is MIT. Content in `content/` is CC BY-SA 4.0 ([LICENSE-CONTENT.md](LICENSE-CONTENT.md)). By contributing, you agree
your contribution is licensed under the licence of the part of the project it goes into, and that you wrote it or have
the right to share it.

## Reporting security problems

Please do not open a public issue. See [SECURITY.md](SECURITY.md).
