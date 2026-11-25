# Content packs

Add your own questions, prompts and words without touching any code. Put one JSON file per pack in `content/packs/`, restart the server, and the new content appears in the game settings. Run `npm run validate` to check your files. Anything invalid is skipped with a message that names the file and the item, and the server still starts.

Common fields:

- `type`: `quiz`, `prompts`, `words`, `scramble` or `literacy`.
- `id`: lowercase letters, numbers, `-` or `_` (up to 40). Must be unique within its type.
- `name`: shown to players.
- `mixIn`: optional, default `true`. Set `false` to keep the pack out of the "Mix" choice, so it is used only when someone picks it.
- `license`: optional, for example `"CC0-1.0"`. A good habit if you share the pack.

Difficulty uses three tiers: `easy`, `medium` and `hard` (quiz questions use `d`: 1, 2 or 3). Each player's band maps to a tier (see [CONFIG.md](CONFIG.md)).

## Quiz topic

    {
      "type": "quiz",
      "id": "club-trivia",
      "name": "Club trivia",
      "questions": [
        { "q": "Which planet is closest to the Sun?", "a": "Mercury", "w": ["Venus", "Mars", "Earth"], "d": 1, "f": "A year on Mercury lasts 88 Earth days." }
      ]
    }

Each question needs `q` (the question), `a` (the right answer), exactly three wrong answers in `w`, and a difficulty `d`. `f` is an optional fun fact shown after the answer. The right answer must not be repeated in `w`.

Aim for at least 10 questions per difficulty so a game does not run out.

## Who Said That? prompts

    { "type": "prompts", "id": "office", "name": "At the office", "prompts": ["What is the worst meeting snack?"] }

## Draw & Guess words

    { "type": "words", "id": "tools", "name": "Tools", "easy": ["hammer"], "medium": ["wrench"], "hard": ["spirit level"] }

## Word Builder (Mini-Games)

Extra words are added to the existing lists. Each needs the word `w` and a clue `c` that does not contain the word. `ok` lists optional alternative spellings.

    { "type": "scramble", "words": { "easy": [{ "w": "kettle", "c": "Boils water" }], "medium": [], "hard": [] } }

## Word Match (Mini-Games)

    { "type": "literacy", "questions": { "easy": [{ "q": "Pick the correct spelling:", "a": "because", "w": ["becuase", "becos"] }] } }

## Core content

The built-in content is in `content/questions.json`, `prompts.json`, `words.json`, `scramble.json` and `literacy.json`. Do not edit those if you want to keep upgrading: add a pack instead.
