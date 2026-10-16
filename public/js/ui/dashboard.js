import { h, prettyDate } from '../util.js';
import { listGames } from '../session.js';
import { buildState } from '../engine/engine.js';
import { resultLine } from '../reports.js';

const I = {
  plus: '<svg viewBox="0 0 32 32" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round"><path d="M16 6v20M6 16h20"/></svg>',
  sheet: '<svg viewBox="0 0 32 32" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linejoin="round"><rect x="4" y="5" width="24" height="22" rx="3"/><path d="M4 12h24M12 12v15M20 12v15"/></svg>',
  stats: '<svg viewBox="0 0 32 32" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round"><path d="M7 26V14M16 26V6M25 26V18"/></svg>',
  report: '<svg viewBox="0 0 32 32" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M9 3h10l6 6v20H9z"/><path d="M19 3v6h6M16 14v9M12 19l4 4 4-4"/></svg>',
};

export async function mount(root, { shell }, ctx) {
  const games = await listGames();
  const active = games.find((g) => { const S = buildState(g.setup, g.events); return !S.matchOver; });
  const latest = games[0];
  const tile = (cls, ic, title, text, on, tour) => h('button', { class: 'tile ' + cls, onclick: on, 'data-tour': tour }, h('span', { class: 'ic', html: ic }), h('h2', null, title), h('p', null, text));

  const sections = [
    h('h1', { class: 'page-title' }, 'Volleyball Game Day'),
    h('p', { class: 'sub' }, 'Your game day dashboard'),
  ];
  if (active) {
    const S = buildState(active.setup, active.events);
    const cur = S.cur || S.last;
    sections.push(h('div', { class: 'resume' },
      h('div', { style: { flex: 1, minWidth: '220px' } }, h('div', { class: 'pill live' }, 'Game in progress'),
        h('div', null, h('strong', null, `${active.setup.home.name} vs ${active.setup.away.name}`)),
        h('div', { class: 'muted' }, cur ? `Set ${cur.n}: ${cur.home.score}–${cur.away.score}  ·  Sets ${S.setsWon.home}–${S.setsWon.away}` : 'Not started')),
      h('button', { class: 'btn green big', onclick: () => ctx.go('/game/' + active.id) }, 'Resume scoring')));
  }
  sections.push(h('div', { class: 'tiles' },
    tile('hero', I.plus, 'New Game', 'Enter teams and start scoring', () => ctx.go('/new'), 'tile-new'),
    tile('', I.sheet, 'Live Scoresheet', 'See the form fill itself out', () => (latest ? ctx.go('/sheet/' + (active || latest).id) : ctx.go('/new')), 'tile-sheet'),
    tile('', I.stats, 'Player Stats', 'Track each player’s performance', () => ctx.go('/stats' + (latest ? '/' + (active || latest).id : '')), 'tile-stats'),
    tile('', I.report, 'Game Reports', 'Download scoresheet and stats', () => ctx.go('/reports'), 'tile-reports')));

  sections.push(h('div', { class: 'learn', 'data-tour': 'learn' },
    h('div', { class: 'grow' }, h('h2', null, 'New to scorekeeping?'),
      h('p', null, 'Learn to run a game in five minutes with a guided tour and a practice match.')),
    h('button', { class: 'btn big', onclick: () => ctx.startTour() }, 'Take the 5 Minute Tour')));

  if (games.length) {
    sections.push(h('h2', { style: { margin: '22px 0 8px', color: 'var(--navy)' } }, 'Recent games'));
    sections.push(h('div', { class: 'gamerow' }, games.slice(0, 4).map((g) => {
      const S = buildState(g.setup, g.events);
      return h('button', { class: 'card', style: { textAlign: 'left' }, onclick: () => ctx.go(S.matchOver ? '/sheet/' + g.id : '/game/' + g.id) },
        h('div', { class: 'top' }, h('h3', null, `${g.setup.home.name} vs ${g.setup.away.name}`), h('span', { class: 'pill' + (S.matchOver ? '' : ' live') }, S.matchOver ? 'Final' : 'In progress')),
        h('div', { class: 'muted' }, `${prettyDate(g.setup.date)} · ${g.setup.site || ''}  ·  ${S.setsWon.home}–${S.setsWon.away}${resultLine(S) ? '  (' + resultLine(S) + ')' : ''}`));
    })));
  }
  root.append(...sections);
  return null;
}
