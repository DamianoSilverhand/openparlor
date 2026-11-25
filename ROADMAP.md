# Roadmap

OpenParlor is early. This is what is planned, roughly in order, and what is known to be missing. Nothing here is a promise,
and priorities follow what people actually need.

## Before a first stable release

- **More audience features.** Rooms of 100 work today (audience mode, scaled games, smaller updates, tested with 100
  simulated phones). Still to do: crowd polls beyond the quiz, a way to choose how many seats each game has from the lobby,
  and checking big rooms on real TVs and phones.
- **Human fact-check of the content.** The first-release bank is written (300 quiz questions, 120 prompts, 250 drawing
  words, 80 Word Builder words and 40 Word Match items per band) but was drafted with AI help, so every quiz answer needs
  checking against a source before 0.1.0. Next: more topics, and community packs.
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
