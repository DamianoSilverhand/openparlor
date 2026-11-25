# Roadmap

OpenParlor is early. This is what is planned, roughly in order, and what is known to be missing. Nothing here is a promise,
and priorities follow what people actually need.

## Before a first stable release

- **Rooms of 100.** Remove the hard player limit (it is 12 by default today), add an audience mode where extra people can
  react and vote, make each game scale (for example fewer answers per vote in Who Said That? and several artists in
  Draw & Guess), distinguish avatars beyond twelve, send smaller state updates, and load-test with 100 simulated phones.
- **More neutral content.** The built-in bank is small (about 120 questions, 47 prompts, 120 drawing words). The goal is
  300 questions, 120 prompts and 250 drawing words, original wording, each question checked against a source.
- **Interface text in the string table.** Most screens still have English text inline; moving it to `public/locales/` makes
  translation possible.
- **Real-device testing** of the installable app (home-screen install, offline Solo Practice, https, keeping screens awake)
  on a range of phones and TVs.

## Later

- **An optional internet mode** for people who want remote rooms: https only, longer room codes, rate limits per address,
  room PINs, host moderation and a name filter. Guests only; no accounts, no public lobby, no chat.
- **A pack editor** in the browser for questions, prompts and words.
- **A PIN for profiles**, so a name cannot be taken over by someone else in the room.
- **More games and mini-games**, mostly as plugins: a bluffing game, Two Truths and a Lie, charades with the phone showing
  the secret word, a buzzer quiz, a speed-typing race.
- **Party mode** that chains games with a running leaderboard, achievements, emoji reactions to the big screen, and an
  end-of-night recap you can save as an image.
- **Per-game stylesheets** for the built-in games (their styles still live in the shared files).

## Known limitations

- No accounts or login (see SECURITY.md).
- Service worker, wake lock and https behaviour are tested in a simulated environment and in one desktop browser, not yet
  across real devices.
- Scores from phones are trusted up to each game's maximum.
- A new profile cannot be created offline.

If you want to help with any of this, see CONTRIBUTING.md.
