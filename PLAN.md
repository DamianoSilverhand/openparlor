# Family Game Night: Project Plan

A local-network web game hub. One laptop runs the server; a TV or laptop shows the **big screen**; everyone else plays on their **phone** by scanning a QR code. No accounts, no internet needed.

## The 4 games (and why)

| # | Game | Why it made the cut |
|---|------|---------------------|
| 1 | **Who Said That?** | Zero knowledge needed, so every age is on equal footing. It produces the biggest laughs. |
| 2 | **Family Quiz Show** | The classic. Teams plus handicaps make it fair for kids and adults. |
| 3 | **Draw & Guess** | Very visual and chaotic in a good way. Kids love it, and it uses the phone as a canvas. |
| 4 | **Family Mini-Games** | Quick rounds, so everyone gets to win at something. It also works as a warm-up or filler between the others. |

**Left out for now:** *Home Treasure Hunt* is a great idea but depends on the layout of your house, and it needs a clue-authoring tool to be good, so it's a strong "phase 2". *Build-a-Story* overlaps with Who Said That? and has less replay value. Items 7 to 10 are genres rather than games, and they are covered by the four above.

---

## Shared foundation (build first)

**Stack:** Node.js, Express and `ws` (WebSockets), vanilla HTML/CSS/JS front end, no build step. Run with `npm start`.

**Pages**
- `/` is the hub. Pick a game and create a room.
- `/tv` is the big-screen view (host display).
- `/play` is the phone controller.

**Core concepts**
- **Room** with a 4-letter code, a QR code on the TV (`http://<LAN-IP>:3000/play?room=ABCD`), and a printed LAN IP at startup.
- **Player** has a name, an avatar (emoji + colour), a score and a connected flag. Reconnect by a token in `localStorage`, so a locked phone or a refresh doesn't kick anyone out.
- **Game module interface:** `{ id, minPlayers, onJoin, onMessage, onTick, tvView, phoneView }`. Each game is a self-contained folder, so adding games later is easy.
- **Host controls** (a "grown-up" phone or the TV keyboard): start, skip, pause, kick, change settings.
- **Shared polish:** a consistent scoreboard, an end-of-game podium with confetti, sound effects (mutable), large touch targets, a dark mode for the evening, and a "family-safe" content filter on free text.
- **Persistence:** a JSON file for scores (all-time leaderboard) and the custom question/prompt packs. No database.

**Folder layout**
```
family-games/
  server/ index.js, room.js, games/{whosaidthat,quiz,draw,minigames}/
  public/ hub, tv, play, shared css/js/sounds
  content/ prompts.json, questions.json, words.json
```

**Milestones:** M0 lobby, join and QR (end-to-end with a trivial "tap counter" game) → M1 Who Said That? → M2 Draw & Guess → M3 Quiz → M4 Mini-Games → M5 polish and hub leaderboard.

---

## Game 1: Who Said That?

**Players:** 3 to 12 · **Length:** ~15 min · **Devices:** phones + TV

**Flow (per round)**
1. TV shows a prompt, for example "What would you bring to a deserted island?".
2. Everyone types an answer on their phone (30 to 60 s, adjustable). Prompts can be "answer as yourself", or the twist round "answer as someone else in the room".
3. Answers appear one at a time on the TV, anonymously and in random order.
4. Each player secretly votes on their phone for who wrote it (you can't vote on your own).
5. Reveal: the author is shown with a drumroll, plus who guessed right.
6. After all answers, show the round scoreboard.

**Scoring:** +100 for a correct guess. +50 to the author for each player they *fooled*. A bonus for the answer that got the most laughs (everyone gives a 😂 tap, so the bonus is voted rather than judged).

**Make it exciting**
- Round types: *Classic*, *Two Truths and a Lie* (one of the three is made up), *Hot Take* (rate-it prompts), *Finish the Sentence*.
- Prompt packs: Silly, Family memories, Would-you-rather, Kids, Spicy-but-clean. You can add your own prompts in `content/prompts.json`.
- Kid mode: a "draw instead of type" fallback and voice-to-text via the phone keyboard mic.
- Anti-dupe: if two answers match, they merge ("2 people wrote this").

**Edge cases:** blank or too-short answers are replaced with "…" and the player loses the round's author points. A disconnected player's answer stays in. Profanity is masked.

**Build tasks:** prompt loader, answer collection and timer, shuffle and anonymise, vote handler, reveal animation, scoring, round-type plug-ins.

---

## Game 2: Family Quiz Show

**Players:** 2 to 12, in teams · **Length:** 20 to 30 min · **Devices:** phones + TV

**Setup**
- Auto-balance or hand-pick teams (**mixed-age by default**: each kid is paired with an adult).
- Pick categories: Animals, Sports, Music, Puzzles, Movies, Food, General Knowledge, Family Trivia (custom questions about your own family).
- Choose difficulty per player (**Kid / Teen / Grown-up**). Each player's phone only gets questions at their level.

**Flow**
1. A round has a category, with 5 questions of rising difficulty (100 to 500 points, Jeopardy-style).
2. Question on the TV; the answering team is decided by a **buzz-in** on phones (fastest finger) or by simultaneous multiple choice. Host selects the mode.
3. Teammates can confer. One phone is the "captain" and locks the answer.
4. Reveal with a fun fact, then scores.
5. **Final round:** each team wagers any amount of its points on one last question.

**Fairness mechanics:** kids get a smaller option set (2 or 3 choices) and a longer timer. A "Phone a Parent" lifeline can be used once per team. Wrong answers don't deduct points by default (an optional setting).

**Question types:** multiple choice, true/false, *Guess the animal sound / song clip* (audio), *Picture round* (image), *Order it* (arrange 4 items), *Closest number* (estimation).

**Make it exciting:** a TV game-show theme with music stings, a streak bonus, a "double points" hidden question, and a comeback mechanic where the last-place team gets a free steal.

**Content:** start with ~300 hand-written questions in `content/questions.json` (id, category, difficulty, type, answer, fun fact). I can generate a first batch, and you review and add family-specific questions.

**Build tasks:** question schema and loader, team manager, buzz-in arbitration (server timestamps), per-player difficulty routing, lifeline logic, wager final.

---

## Game 3: Draw & Guess

**Players:** 3 to 10 · **Length:** 15 to 20 min · **Devices:** phones (drawing) + TV (canvas and guesses)

**Flow**
1. The drawer is chosen in rotation. Their phone shows 3 word choices (easy, medium, hard, with more points for harder words).
2. The drawer sketches on the phone's touch canvas. Strokes stream live to the TV.
3. Others type guesses on their phones (a guess is shown on the TV as a chat feed). Close guesses get a "so close!" nudge.
4. The word is revealed progressively as letter blanks, with a hint letter every N seconds.
5. Round ends when everyone has guessed or the timer runs out. Show the finished drawing, then scores.
6. Everyone draws once (or twice, or three times), and then there's a podium.

**Scoring:** the guesser gets points based on speed (fast = more). The drawer gets points for each player who guessed it, plus a bonus if everyone got it.

**Make it exciting:** drawing tools are pen, 6 colours, eraser, undo, fill, and brush size. Modes: *Classic*, *Team Draw* (two teams race on the same word), *Speed Draw* (30 s), *Telephone* (draw, then others describe, then draw that description, with a funny reveal at the end), and *Mystery Pictionary* (the drawer can't see their own canvas).

**Settings:** timer (30 / 60 / 90 / 120 s), rounds per player, word difficulty (Little Kids, Kids, Everyone), word packs (Animals, Food, Actions, Movies, Family inside-jokes). Custom word list from `content/words.json`.

**Technical notes:** send stroke segments (not full images) over WebSocket, with batching at ~30 ms. The canvas is normalised (0 to 1 coordinates) so any screen size works. Keep stroke history for late joiners and the end-of-round gallery. Prevent scrolling and zoom on the phone canvas (`touch-action: none`). Guess-matching is case/spacing/plural-insensitive with light fuzzy matching.

**Extra:** a gallery of every drawing at the end, with a "save to the family fridge" PNG download.

---

## Game 4: Family Mini-Games

**Players:** 1 to 12 · **Length:** 10 to 20 min (a "set" of 4 to 6 quick rounds) · **Devices:** phones, with a TV scoreboard

**The games** (each 30 to 60 s)
1. **Memory Match:** the same card grid for everyone on their phone, with scoring by fewest moves and time. Grid size scales by age.
2. **Word Scramble:** the same scrambled word for all, with points by speed. Kid and adult word lists, so each gets their own level.
3. **Reaction Tap:** wait for the screen to turn green, then tap. A false start costs you. Also a *Whack-a-Mole* variant.
4. **Pattern Puzzle:** a Simon-style sequence to repeat, which grows each level. Also *odd one out* and *what comes next*.
5. **Stretch ideas:** Math Dash, Colour Clash (the Stroop test, hilarious for adults), Tilt Maze using the phone's accelerometer.

**Flow:** the host picks "Random set" or chooses games. Each mini-game has a 3-2-1 intro with instructions, the round, a live mini-leaderboard on the TV, and then points (1st = 10, 2nd = 7, 3rd = 5, others = 3). Totals are shown at the end of the set.

**Fairness:** handicap sliders per player (for example a kid gets a bigger reaction window, easier word lists and a longer memory time). The handicap is invisible to the other players.

**Technical notes:** the server owns the seed and the clock, and phones play locally and report results. Reaction timing is measured on the phone and validated against server timestamps. Each mini-game is a plug-in with `{ setup(seed), render, score }`, so adding one is cheap.

---

## Build order and effort (rough)

| Phase | Deliverable | Size |
|-------|-------------|------|
| M0 | Server, rooms, lobby, QR join, reconnect, hub | Medium |
| M1 | Who Said That? | Medium |
| M2 | Draw & Guess | Medium-Large |
| M3 | Family Quiz Show + 300 questions | Large |
| M4 | Mini-Games (4 games) | Medium |
| M5 | Polish: sounds, themes, all-time leaderboard, podium | Small-Medium |

## Decisions needed from you
1. **Room to run it:** is a TV with a browser (or a laptop plugged into one) available for the big screen?
2. **Family-specific content:** names, in-jokes and trivia about the family for the custom packs.
3. **Network:** any router client-isolation ("AP isolation") would block phones from reaching the laptop, so we'll test this early at M0.
4. **Start with:** M0 plus Who Said That? is my suggestion, since it's the quickest win.
