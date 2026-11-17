const BAD = ['fuck', 'shit', 'bitch', 'cunt', 'dick', 'piss', 'asshole', 'bastard', 'slut', 'whore', 'nigg', 'fag', 'porn'];

// Trim, collapse whitespace, cap length, and mask a short list of bad words.
function clean(input, max = 140) {
  let s = String(input == null ? '' : input).replace(/\s+/g, ' ').trim().slice(0, max);
  for (const w of BAD) s = s.replace(new RegExp(w, 'gi'), (m) => '*'.repeat(m.length));
  return s;
}

function shuffle(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

module.exports = { clean, shuffle };
