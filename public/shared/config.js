// The server's public configuration: brand name, bands (the groups players choose from) and feature switches.
// Top-level await keeps every page simple: `import { config } from '/shared/config.js'` is ready to use.
const FALLBACK = {
  brand: { name: 'OpenParlor', tagline: '' },
  language: 'en',
  bands: [{ id: 'everyone', label: 'Everyone', hint: '', tier: 2 }],
  host: { allowClaim: true },
  profiles: { enabled: true },
};

export const config = await fetch('/api/config').then((r) => (r.ok ? r.json() : FALLBACK)).catch(() => FALLBACK);

export const bands = config.bands && config.bands.length ? config.bands : FALLBACK.bands;
const TIERS = ['easy', 'medium', 'hard'];
const LEGACY = { kid: 1, teen: 2, grownup: 3 };

// Saved data from older versions used kid, teen or grownup. Map those onto this server's bands.
export function bandId(id) {
  if (bands.some((b) => b.id === id)) return id;
  const hit = LEGACY[id] && bands.find((b) => b.tier === LEGACY[id]);
  return hit ? hit.id : null;
}
export const bandById = (id) => bands.find((b) => b.id === bandId(id)) || null;
export const bandLabel = (id) => (bandById(id) || { label: '' }).label;
export const bandHint = (id) => (bandById(id) || { hint: '' }).hint;
// 'easy', 'medium' or 'hard': what the mini-games use to pick their difficulty.
export const tierOfBand = (id) => TIERS[((bandById(id) || { tier: 3 }).tier) - 1];
// The text for a tier, for example "Kid" or "Kid / Teen" when two bands share it.
export function tierLabel(tier) {
  const n = TIERS.indexOf(tier) + 1;
  const names = bands.filter((b) => b.tier === n).map((b) => b.label);
  return names.length ? names.join(' / ') : tier;
}

// Brand name in the page title and any element marked data-brand.
export function applyBrand() {
  const name = config.brand.name;
  document.title = document.title.replace(/OpenParlor/g, name);
  document.querySelectorAll('[data-brand]').forEach((el) => (el.textContent = name));
  document.querySelectorAll('[data-tagline]').forEach((el) => (el.textContent = config.brand.tagline || ''));
  if (config.brand.accent) document.documentElement.style.setProperty('--tomato', config.brand.accent);
}
applyBrand();
