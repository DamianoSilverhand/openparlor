# Family Game Night

Local-network party games. One computer runs the server, a TV shows the big screen, and everyone plays on their phone.

## Run it

    npm install
    npm start

Then open the "On your network" address it prints (for example `http://192.168.1.190:3100`) on the TV, tap **Put it on the big screen**, and scan the QR code with phones. Use `PORT=4000 npm start` to change the port.

## Games

- **Who Said That?**: answer a prompt, then guess who wrote each answer. Anyone can pass on a prompt, and the host can hide an answer that is awkward.
- **Draw & Guess**: one person draws on their phone, the TV shows it live, everyone else guesses. Words live in `content/words.json`.
- **Family Quiz Show**: teams of mixed ages, a double-points question each round, and a final wager. The question timer defaults to 30 seconds, and the host can have the TV read questions aloud. Questions live in `content/questions.json`.
- **Family Mini-Games**: a set of quick rounds (Memory Match, Word Scramble, Quick Tap, Copy Cat, Colour Clash, Number Dash). Play as a ranked race, or play together and add everyone's scores into a family total with a saved family record.

The host picks the game and its settings in the lobby on their phone. For the Quiz and Mini-Games, everyone must choose **Kid, Teen or Grown-up** on their phone first. Think of these as challenge levels rather than strict ages: anyone can choose the one that is most fun for them.

## Your own content

Everything is plain JSON in `content/`. Restart the server after editing.

- **Our Family quiz topic**: add at least four questions to `content/family-questions.json` (the file explains the format) and an "Our Family" topic appears. It is used in every mode, so it is a good place for questions only your family can answer.
- **Zambian content** (optional): the Quiz, Draw & Guess, Who Said That? and Word Scramble each have a "Zambian content" setting: *Off*, *Mixed in* or *Only Zambian*. It is off by default, so it never appears unless the host chooses it. The Zambian packs are marked `"local": true` in `questions.json`, `words.json` and `prompts.json`, and Word Scramble has its own short list near the top of `public/play/mg/scramble.js`. Please have someone in the family check the answers and wording, and add or remove whatever fits.
- **Other languages**: the games do not assume any language. To add words in the languages your family uses, add them to the Zambian packs the same way as any other entry. In Word Scramble a word can list other accepted spellings, for example `['nshima', ['nsima', 'sima']]`.

Play-together records are saved in `data/records.json`, which is not committed.

## Sound

Sound effects are generated in the browser (no audio files). The big screen plays the shared moments (countdown ticks, reveals, scores, fanfares) and each phone plays small private feedback. Browsers only allow sound after a tap, so click anywhere on the TV page once. Use the speaker button, or press M on the TV, to mute.
