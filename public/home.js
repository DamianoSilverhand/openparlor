import { config } from '/shared/config.js';
import { t } from '/shared/i18n.js';

// Brand: the last word goes on its own line in the accent colour (a single word stays on one line).
const brand = document.getElementById('brand');
const words = config.brand.name.split(' ');
const last = words.pop();
brand.replaceChildren(...(words.length ? [words.join(' '), Object.assign(document.createElement('span'), { textContent: last })] : [Object.assign(document.createElement('span'), { textContent: last })]));
document.querySelectorAll('[data-i18n]').forEach((el) => (el.textContent = t(el.dataset.i18n)));
if (!config.profiles.enabled) document.querySelectorAll('a[href="/solo"]').forEach((a) => (a.hidden = true));

const note = document.getElementById('addr');

document.getElementById('host').onclick = async () => {
  try {
    const r = await fetch('/api/room', { method: 'POST' });
    const data = await r.json();
    if (!r.ok || !data.code) {
      note.textContent = data.error || 'Could not start a room. Try again.';
      return;
    }
    location.href = '/tv?room=' + data.code;
  } catch {
    note.textContent = 'Could not reach the server. Check your connection.';
  }
};

fetch('/api/info').then((r) => r.json()).then((i) => {
  note.textContent = 'Phones can find this at ' + i.base.replace('http://', '');
}).catch(() => {});
