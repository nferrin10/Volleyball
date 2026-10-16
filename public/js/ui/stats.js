import { h, download, toast, prettyDate } from '../util.js';
import { store } from '../store.js';
import { buildState, SIDES, STAT_COLUMNS } from '../engine/engine.js';
import { statRows, teamTotals, statsPDF, statsCSV, seasonRows, fileBase } from '../reports.js';
import { shareOrDownload } from '../util.js';

export async function mount(root, { params }, ctx) {
  const all = (await store.all('games')).filter((g) => !g.practice && !g.deleted).sort((a, b) => b.updatedAt - a.updatedAt);
  const practice = (await store.all('games')).filter((g) => g.practice);
  let gameId = params[0] || (all[0] && all[0].id);
  const rec = (gameId && (all.find((g) => g.id === gameId) || practice.find((g) => g.id === gameId))) || null;
  let mode = 'game';
  const teamNames = [...new Set(all.flatMap((g) => [g.setup.home.name, g.setup.away.name]))];
  let season = teamNames[0] || '';

  const body = h('div');
  function table(rows, withName = true, label = '') {
    const tot = teamTotals(rows);
    return h('div', { class: 'card' }, label ? h('h2', { style: { marginBottom: '8px', color: 'var(--navy)' } }, label) : null,
      h('div', { class: 'scroll-x' }, h('table', { class: 'stats' },
        h('thead', null, h('tr', null, h('th', null, '#'), withName ? h('th', null, 'Player') : null, ...STAT_COLUMNS.map(([, l]) => h('th', null, l)))),
        h('tbody', null, rows.map((r) => h('tr', null, h('td', null, r.number === '-' ? '?' : '#' + r.number), h('td', { class: 'nm' }, r.name + (r.libero ? ' (L)' : '')), ...STAT_COLUMNS.map(([k]) => h('td', null, r[k] || 0)))),
          h('tr', { class: 'tot' }, h('td'), h('td', null, 'Team total'), ...STAT_COLUMNS.map(([k]) => h('td', null, k === 'sets' ? '' : tot[k])))))));
  }
  function draw() {
    body.replaceChildren();
    if (mode === 'game') {
      if (!rec) { body.append(h('div', { class: 'card' }, h('p', null, 'No games yet. Start a game and stats will show up here.'), h('button', { class: 'btn primary', onclick: () => ctx.go('/new') }, 'New Game'))); return; }
      const S = buildState(rec.setup, rec.events);
      body.append(
        h('p', { class: 'sub' }, `${rec.setup.home.name} vs ${rec.setup.away.name} · ${prettyDate(rec.setup.date)} · Sets ${S.setsWon.home}–${S.setsWon.away}`),
        h('div', { class: 'btnrow', style: { marginBottom: '12px' } },
          h('button', { class: 'btn primary', onclick: async () => { try { await shareOrDownload(new Blob([await statsPDF(rec)], { type: 'application/pdf' }), fileBase(rec) + '-player-stats.pdf', 'Player stats'); } catch (e) { toast('Could not make the PDF: ' + e.message); } } }, 'Download stats PDF'),
          h('button', { class: 'btn', onclick: () => download(statsCSV([rec]), fileBase(rec) + '-player-stats.csv') }, 'Download CSV (spreadsheet)')),
        ...SIDES.map((side) => table(statRows(S, side), true, `${rec.setup[side].name} (${side === 'home' ? 'Home' : 'Visitor'})`)),
        h('p', { class: 'muted' }, 'Pts = kills + aces + blocks. “?” row = stats saved without choosing a player. These stats are not on the paper scoresheet, so they have their own PDF.'));
    } else {
      const { rows, games } = seasonRows(all, season);
      body.append(h('div', { class: 'field' }, h('span', null, 'Team'), h('select', { class: 'inp', onchange: (e) => { season = e.target.value; draw(); } }, teamNames.map((n) => h('option', { value: n, selected: n === season }, n)))),
        h('p', { class: 'sub' }, `${games} game${games === 1 ? '' : 's'} (practice games are never counted)`), table(rows, true, `${season} — season totals`),
        h('div', { class: 'btnrow' }, h('button', { class: 'btn', onclick: () => download(statsCSV(all.filter((g) => [g.setup.home.name, g.setup.away.name].includes(season))), `season-${season}.csv`) }, 'Download season CSV (every game)')));
    }
  }
  const seg = h('div', { class: 'seg', style: { margin: '4px 0 12px' } });
  const drawSeg = () => seg.replaceChildren(...[['game', 'This game'], ['season', 'Season totals']].map(([m, l]) => h('button', { class: mode === m ? 'on' : '', onclick: () => { mode = m; drawSeg(); draw(); } }, l)));
  drawSeg();
  const picker = all.length > 1 ? h('select', { class: 'inp', style: { maxWidth: '420px', marginBottom: '8px' }, onchange: (e) => ctx.go('/stats/' + e.target.value) }, all.map((g) => h('option', { value: g.id, selected: g.id === (rec && rec.id) }, `${g.setup.home.name} vs ${g.setup.away.name} — ${prettyDate(g.setup.date)}`))) : null;
  root.append(h('h1', { class: 'page-title' }, 'Player Stats'), seg, picker, body);
  draw();
  return null;
}
