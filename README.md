# Family Game Night

Local-network party games. One computer runs the server, a TV shows the big screen, and everyone plays on their phone.

## Run it

    npm install
    npm start

Then open the "On your network" address it prints (for example `http://192.168.1.190:3100`) on the TV, tap **Put it on the big screen**, and scan the QR code with phones. Use `PORT=4000 npm start` to change the port.

## Games

- **Who Said That?** (done): answer a prompt, guess who wrote each answer.
- **Draw & Guess** (done): one person draws on their phone, the TV shows it live, everyone else guesses. Words live in `content/words.json`.
- **Family Quiz Show** (done): teams of mixed ages, 8 topics, a double-points question each round, and a final wager. Questions live in `content/questions.json`. Add your own family questions in `content/family-questions.json` (at least 4) and an "Our Family" topic appears.
- **Family Mini-Games** (done): a set of quick rounds (Memory Match, Word Scramble, Quick Tap, Copy Cat, Colour Clash, Number Dash). Everyone plays on their phone, the TV shows a live race, and each round awards points for 1st, 2nd, 3rd and so on. Fair-play handicaps by age are on by default.

The host picks the game and its settings in the lobby on their phone.

## Sound

Sound effects are generated in the browser (no audio files). The big screen plays the shared moments (countdown ticks, reveals, scores, fanfares) and each phone plays small private feedback. Browsers only allow sound after a tap, so click anywhere on the TV page once. Use the speaker button, or press M on the TV, to mute.

## Adding content

Prompts for Who Said That? live in `content/prompts.json`. Add a prompt to any pack, or add a new pack, and restart the server.
