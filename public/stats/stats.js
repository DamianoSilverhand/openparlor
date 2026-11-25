import { h, avatar } from '/shared/ui.js';
import '/shared/pwa.js';
import { config, bandLabel } from '/shared/config.js';
import { t } from '/shared/i18n.js';

const GAMES = [
  ['scramble', 'Word Builder'], ['literacy', 'Word Match'], ['math', 'Number Dash'], ['logic', 'Logic Chain'],
  ['memory', 'Memory Match'], ['pattern', 'Copy Cat'], ['clash', 'Colour Clash'], ['reaction', 'Quick Tap'],
];
const app = document.getElementById('app');
const getJson = (url) => fetch(url).then((r) => (r.ok ? r.json() : null)).catch(() => null);
const when = (iso) => new Date(iso).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' });

async function render() {
  if (!config.profiles.enabled) {
    app.replaceChildren(h('div', { class: 'screen' }, h('h1', { class: 'title' }, t('stats.title')), h('p', { class: 'lead' }, t('stats.off')), h('a', { class: 'link', href: '/' }, t('stats.home'))));
    return;
  }
  const [boards, recent, recs] = await Promise.all([
    Promise.all(GAMES.map(([id]) => getJson(`/api/leaderboard?game=${id}&limit=5`))),
    getJson('/api/history?limit=10'),
    getJson('/api/records'),
  ]);
  const boardCards = GAMES.map(([id, name], i) => {
    const rows = (boards[i] && boards[i].entries) || [];
    return h('div', { class: 'card pad stat-card' },
      h('h2', null, name),
      rows.length
        ? rows.map((e, n) => h('div', { class: 'stat-row' }, h('span', null, `${n + 1}. `, avatar(e), ` ${e.name}`, bands(e.level)), h('b', null, e.best)))
        : h('p', { class: 'lead' }, t('stats.none')),
    );
  });
  const games = (recent && recent.games) || [];
  app.replaceChildren(
    h('div', { class: 'screen' },
      h('div', { class: 'me' }, h('a', { class: 'link', href: '/' }, t('stats.home'))),
      h('h1', { class: 'title' }, t('stats.title')),
      h('h2', null, t('stats.best')),
      ...boardCards,
      h('h2', null, t('stats.recent')),
      games.length
        ? games.map((g) => h('div', { class: 'card pad stat-card' },
            h('h3', null, `${g.game} · ${when(g.endedAt)}`),
            g.results.slice(0, 5).map((r) => h('div', { class: 'stat-row' }, h('span', null, `${r.rank + 1}. ${r.name}`), h('b', null, r.score))),
          ))
        : h('p', { class: 'lead' }, t('stats.noGames')),
      ((recs && recs.records) || []).length > 0 && h('h2', null, t('stats.records')),
      ...((recs && recs.records) || []).map((r) => h('div', { class: 'stat-row' }, h('span', null, `${r.game_id}, ${r.players} players`), h('b', null, r.total))),
    ),
  );
}

function bands(level) {
  return config.bands.length > 1 && bandLabel(level) ? h('small', { style: { color: 'var(--soft)', marginLeft: '6px' } }, bandLabel(level)) : null;
}

render();
