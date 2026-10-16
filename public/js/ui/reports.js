import { h, toast, prettyDate, confirmDialog, download, shareOrDownload } from '../util.js';
import { store } from '../store.js';
import { buildState } from '../engine/engine.js';
import { sheetPDF, statsPDF, statsCSV, fileBase, resultLine } from '../reports.js';

export async function mount(root, p, ctx) {
  const list = h('div', { class: 'gamerow' });
  async function draw() {
    const games = (await store.all('games')).filter((g) => !g.practice && !g.deleted).sort((a, b) => b.updatedAt - a.updatedAt);
    list.replaceChildren();
    if (!games.length) list.append(h('div', { class: 'card' }, h('p', null, 'No games yet. Your finished games and their PDFs will show up here.'), h('button', { class: 'btn primary', onclick: () => ctx.go('/new') }, 'Start a game')));
    for (const g of games) {
      const S = buildState(g.setup, g.events);
      const run = async (fn) => { try { await fn(); } catch (e) { console.error(e); toast('Something went wrong: ' + e.message, { ms: 6000 }); } };
      list.append(h('div', { class: 'card' }, h('div', { class: 'gamerow' },
        h('div', { class: 'top' }, h('div', null, h('h3', null, `${g.setup.home.name} vs ${g.setup.away.name}`),
          h('div', { class: 'muted' }, `${prettyDate(g.setup.date)}${g.setup.site ? ' · ' + g.setup.site : ''}`)),
          h('span', { class: 'pill' + (S.matchOver ? '' : ' live') }, S.matchOver ? 'Final' : 'In progress')),
        h('div', null, h('strong', null, `Sets ${S.setsWon.home}–${S.setsWon.away}`), resultLine(S) ? '   (' + resultLine(S) + ')' : '', g.conflictOf ? h('span', { class: 'pill practice', style: { marginLeft: '8px' } }, 'copy from another device') : null),
        h('div', { class: 'btnrow' },
          h('button', { class: 'btn primary', onclick: () => run(async () => { toast('Making your PDF…', { ms: 1200 }); await shareOrDownload(new Blob([await sheetPDF(g)], { type: 'application/pdf' }), fileBase(g) + '-scoresheet.pdf', 'Volleyball scoresheet'); }) }, 'Scoresheet PDF'),
          h('button', { class: 'btn', onclick: () => run(async () => download(new Blob([await statsPDF(g)], { type: 'application/pdf' }), fileBase(g) + '-player-stats.pdf')) }, 'Stats PDF'),
          h('button', { class: 'btn', onclick: () => download(statsCSV([g]), fileBase(g) + '-player-stats.csv') }, 'Stats CSV'),
          h('button', { class: 'btn', onclick: () => ctx.go('/sheet/' + g.id) }, 'View sheet'),
          S.matchOver ? null : h('button', { class: 'btn green', onclick: () => ctx.go('/game/' + g.id) }, 'Resume'),
          S.matchOver ? h('button', { class: 'btn ghost', onclick: () => ctx.go('/game/' + g.id) }, 'Reopen') : null,
          h('button', { class: 'btn ghost', onclick: async () => { if (await confirmDialog('Delete this game?', `${g.setup.home.name} vs ${g.setup.away.name} will be removed from this device${g.rev ? ' and your account' : ''}. This cannot be undone.`, { yes: 'Delete', danger: true })) { g.deleted = true; g.dirty = true; await store.put('games', g); if (!g.rev) await store.del('games', g.id); ctx.drop(g.id); window.dispatchEvent(new CustomEvent('vb-game-changed')); draw(); } } }, 'Delete')))));
    }
  }
  root.append(h('h1', { class: 'page-title' }, 'Game Reports'), h('p', { class: 'sub' }, 'Download the completed scoresheet and player stats for any game — new or old.'), list);
  await draw();
  const on = () => draw();
  globalThis.addEventListener('vb-synced', on);
  return () => globalThis.removeEventListener('vb-synced', on);
}
