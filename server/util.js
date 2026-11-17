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

// Pick which content packs to use for the "Zambian content" setting: off, mixed or only.
// Packs marked local are the Zambian ones. Packs marked always (the family's own) are kept in every mode.
function filterLocal(map, local) {
  const keep = Object.entries(map).filter(([, v]) => (local === 'mixed' ? true : local === 'only' ? v.local || v.always : !v.local));
  return Object.fromEntries(keep.length ? keep : Object.entries(map));
}

const LOCAL_OPTION = {
  key: 'local',
  label: 'Zambian content',
  values: [['off', 'Off'], ['mixed', 'Mixed in'], ['only', 'Only Zambian']],
};

module.exports = { clean, shuffle, filterLocal, LOCAL_OPTION };
