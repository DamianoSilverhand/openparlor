# Family Game Night

Local-network party and learning games. One computer runs the server, a TV shows the big screen, and everyone plays on their phone—or practices solo between game nights.

## Run it

    npm install
    npm start

Then open the "On your network" address it prints (for example `http://192.168.1.190:3100`) on the TV, tap **Put it on the big screen**, and scan the QR code with phones. Phones can also open **Practice on your own** (`/solo`) without a TV. Use `PORT=4000 npm start` to change the port.

## Games

- **Who Said That?**: answer a prompt, then guess who wrote each answer. Anyone can pass on a prompt, and the host can hide an answer that is awkward.
- **Draw & Guess**: one person draws on their phone, the TV shows it live, everyone else guesses. Words live in `content/words.json`. At the end, drawings appear in the TV gallery with a **Save** PNG link.
- **Family Quiz Show**: teams of mixed ages, a double-points question each round, and a final wager. Questions are matched to age (**Kid (Gr 3)**, **Teen (Gr 8)**, **Grown-up**), and the player on each team at that level locks the answer while teammates tap suggestions to help. Includes **Words & Stories** and **Numbers & Logic** alongside general topics. The question timer defaults to 30 seconds, and the host can have the TV read questions aloud.
- **Family Mini-Games**: quick rounds across 8 games (**Word Builder**, **Word Match**, **Number Dash**, **Logic Chain**, **Memory Match**, **Copy Cat**, **Colour Clash**, **Quick Tap**). The host can set **Game focus** to *Mix of all*, *Words, Math & Memory*, or *Speed & Reflexes*, and play as a ranked race or together for a saved family record.

Before each game starts, the TV and every phone show a **How to play** screen with the steps and the scoring. The host taps *Got it, let's go* to skip it, or it moves on by itself after 30 seconds. Each mini-game also shows its own how-to, with an example, just before it begins. The text lives in the `rules` of each game in `server/games/`.

## Profiles, Solo Practice & Host Controls

- **Saved Family Profiles**: tapping your profile on `/play` or `/solo` remembers your name, animal avatar, and challenge level (**Kid (Gr 3)**, **Teen (Gr 8)**, **Grown-up**). Mini-game personal bests and daily streaks are saved per profile in `data/profiles.json` (not committed).
- **Solo Practice (`/solo`)**: play any of the 8 mini-games on a phone or tablet without a TV or second player, saving personal bests and streaks to your profile.
- **Host Controls**: the host can pass host controls to someone else in the lobby (`→ host`), anyone in the lobby can **Take over as host**, and the host can **Pause / Resume** active game timers.

## Your own content & languages

Everything is plain JSON in `content/`.

- **Our Family quiz topic**: add at least four questions to `content/family-questions.json` (the file explains the format, and `d` 1, 2 or 3 sets how hard each question is) and an "Our Family" topic appears in the quiz. Restart the server after editing `questions.json` or `family-questions.json`.
- **Word Builder & Word Match**: English words and clues live in `content/scramble.json`, and literacy/spelling questions live in `content/literacy.json`, grouped by `kid`, `teen`, and `grownup`.
- **Other languages / Zambian content** (optional): English is the default. Extra language packs live as JSON files in `content/lang/` (for example `content/lang/zambia.json`) and are loaded automatically via `/api/langs`. In `scramble` entries, each item uses `{ "w": "nshima", "c": "Staple maize dish", "ok": ["nsima", "sima"] }`. The Quiz, Draw & Guess, Who Said That?, and Word Builder each have an optional *Off* / *Mixed in* / *Only Zambian* setting.

Play-together records are saved in `data/records.json` (not committed), keyed by game, player count, handicap setting, and local-content setting.

## Theme & Sound

- **Evening / Dark Mode**: automatically follows the device's `prefers-color-scheme: dark` setting.
- **Sound**: sound effects are generated in the browser (no audio files). The TV plays shared cues and each phone plays private feedback. Click anywhere on the TV page once to enable audio, and use the speaker button (or press `M` on the TV) to mute.

## Development

    npm test            # robustness and flow tests (needs no extra setup)
    npm run validate    # checks every file in content/ and exits 1 if a pack is broken

A broken content pack never stops the server from starting: invalid items are skipped with a message that names the file, and a game with no usable content is hidden from the lobby. Run `npm run validate` to see everything that is wrong.

Optional environment variables: `PORT` (default 3100), `MAX_ROOMS` (default 500), `MAX_CONNECTIONS` (default 2000), and `CONTENT_DIR` to load packs from another folder.
