// The list of files the service worker stores so the app shell and Solo Practice work offline, with a version that
// changes whenever any of them changes (so installed copies are refreshed).
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { config } = require('./config');
const minigames = require('./sdk/minigames');

const PUBLIC = path.join(__dirname, '..', 'public');

const PAGES = ['/', '/home.js', '/solo', '/solo/solo.js', '/stats', '/stats/stats.js'];
const SHARED = ['ui.js', 'sound.js', 'config.js', 'i18n.js', 'net.js', 'wake.js', 'pwa.js', 'offline.js', 'store.js', 'style.css'];
const OTHER = ['/play/play.css', '/sdk/minigame.js', '/manifest.webmanifest', '/icons/icon-192.png', '/icons/icon-512.png', '/icons/icon.svg', '/icons/favicon-32.png', '/icons/apple-touch-icon.png'];
const API = ['/api/config', '/api/minigames', '/api/content/scramble', '/api/content/literacy'];

const fileFor = (url) => path.join(PUBLIC, url === '/' ? 'index.html' : url.endsWith('/') ? `${url}index.html` : /\.\w+$/.test(url) ? url : `${url}/index.html`);

function build() {
  const urls = [...PAGES, ...SHARED.map((f) => `/shared/${f}`), ...OTHER, `/locales/${config.language || 'en'}.json`, ...API];
  if (config.language && config.language !== 'en') urls.push('/locales/en.json');
  else urls.push('/locales/en.json');
  for (const m of minigames.list) urls.push(m.url);
  const unique = [...new Set(urls)];
  // The version hashes the files that exist on disk (static files and each mini-game's folder).
  const h = crypto.createHash('sha1');
  for (const u of unique) {
    try {
      const f = u.startsWith('/mini/') ? path.join(minigames.byId[u.split('/')[2]].dir, u.split('/').slice(3).join('/')) : fileFor(u);
      const st = fs.statSync(f);
      h.update(`${u}:${st.size}:${Math.round(st.mtimeMs)}`);
    } catch {
      h.update(u); // API routes and generated files have no file; their content changes only with a restart
    }
  }
  h.update(JSON.stringify([config.brand, config.bands]));
  return { version: h.digest('hex').slice(0, 12), urls: unique };
}

module.exports = { build };
