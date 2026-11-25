// A small string table. `t('key', { name: 'x' })` returns the text for the configured language, falling back to
// English and then to the key itself, so a missing translation never breaks a screen.
import { config } from '/shared/config.js';

const load = (lang) => fetch(`/locales/${encodeURIComponent(lang)}.json`).then((r) => (r.ok ? r.json() : {})).catch(() => ({}));
const english = await load('en');
const table = config.language && config.language !== 'en' ? { ...english, ...(await load(config.language)) } : english;

export function t(key, vars = {}) {
  const text = table[key] !== undefined ? table[key] : key;
  return text.replace(/\{(\w+)\}/g, (m, name) => (vars[name] !== undefined ? String(vars[name]) : m));
}
