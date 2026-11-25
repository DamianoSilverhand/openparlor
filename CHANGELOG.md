# Changelog

All notable changes are listed here. The format follows [Keep a Changelog](https://keepachangelog.com/), and the project
uses [Semantic Versioning](https://semver.org/) once it has a first release.

## [Unreleased]

First public version, preparing for 0.1.0.

### Games and play

- Four games: Who Said That?, Draw & Guess, Quiz Show and Mini-Games (eight mini-games), each with a How to play screen.
- Solo Practice with saved profiles, personal bests and daily streaks, a scores page, and a download, import and delete
  control for your own data.
- Host controls: pause, pass host, and (optionally) let anyone take over.

- Rooms of 100: updates are batched and slimmed down, 144 distinguishable avatars, and the games scale (Who Said That? shows 12
  answers a round with 8-name ballots, Draw & Guess has ten artists in big rooms, the quiz makes teams automatically, long
  lists show the top and your own place). Tested with 100 simulated phones.
- Audience: people can choose to watch, the host can move players, latecomers watch until the game ends, and watchers send
  emoji reactions to the TV and vote in a quiz crowd poll. They never score. No limit on players by default.

### Configuration and content

- Configurable bands (difficulty groups) with presets for family, classroom and party, a configurable brand name, limits and
  per-game default settings.
- Content packs: drop JSON files into `content/packs/` to add quiz topics, prompts, word lists and mini-game word lists.
  `npm run validate` checks them, and a broken pack never stops the server.

### Platform

- Game SDK: games and mini-games are plugins with manifests, loaded from `games/`, `minigames/` and `plugins/`. Two
  complete examples and full documentation.
- SQLite storage (Node's built-in `node:sqlite`, Node 22.13 or newer) with migrations, daily backups and import of the older
  JSON files.
- Installable app: manifest and icons, screens stay awake, a reconnecting socket with a heartbeat, optional https, a
  service worker and offline Solo Practice with a queue that sends scores when the connection returns.
- Hardened server: limits on message size, rate and rooms, security headers, and handling of malformed input.

### Project

- MIT licence for code, CC BY-SA 4.0 for the content, CI, lint, issue templates, a contributing guide, a code of conduct and a
  security policy.
