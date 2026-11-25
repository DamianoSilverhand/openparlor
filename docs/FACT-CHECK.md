# Fact-checking the built-in content

The built-in bank was drafted with AI help. Before 0.1.0 a person should check it.

## How

1. `npm run review > review.csv` and open it in a spreadsheet (one row per quiz question).
2. For each row, confirm the right answer against a reliable source (an encyclopaedia, an official site, a dictionary), and
   confirm the three wrong answers are really wrong. Write the source and `y`, `n` or `fix` in the last two columns.
3. Fix problems in `content/questions.json`. When a question has been checked you can add `"reviewed": true` and, if you
   like, `"src": "https://…"` to it. The loader ignores both, so they are only a record.
4. Run `npm run validate` and `npm test`.

Also skim `content/literacy.json` (spellings and meanings) and `content/scramble.json` (clues) in the same way.

## First pass already done

A read-through of all 300 questions found and fixed: a repeated pattern question, a violin question given away by another
question, a "wrong" answer to the affect/effect question that is valid in psychology, and a marathon distance option that
was too close to the true value. Nothing else looked wrong, but this was a reviewer reading, not a source check.

Things a human reviewer should look at closely: record-style facts that can change (largest, longest, most), "about"
figures, and questions that assume one country's customs (for example Halloween, the four seasons).
