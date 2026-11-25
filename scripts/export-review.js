// Writes a spreadsheet (CSV) of every built-in quiz question for a person to fact-check: `npm run review > review.csv`.
// Fill in the last two columns (source, ok?) while checking, then record the result with "reviewed": true in the JSON.
const { questions } = require('../server/content');
const q = (s) => `"${String(s).replace(/"/g, '""')}"`;
console.log(['id', 'topic', 'level', 'question', 'right answer', 'wrong answers', 'source you used', 'ok? (y/n/fix)'].join(','));
for (const [topic, cat] of Object.entries(questions)) {
  cat.questions.forEach((x, i) => console.log([`${topic}-${i + 1}`, topic, x.d, q(x.q), q(x.a), q(x.w.join(' | ')), '', ''].join(',')));
}
