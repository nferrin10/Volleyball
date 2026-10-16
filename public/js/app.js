import { h, $, toast } from './util.js';
import { ctx } from './ctx.js';
import { store } from './store.js';
import { sync } from './sync.js';
import { showHelp } from './help.js';
import { startTour, shouldAutoStartTour } from './tour.js';

import * as dashboard from './ui/dashboard.js';
import * as newgame from './ui/newgame.js';
import * as live from './ui/live.js';
import * as sheetview from './ui/sheetview.js';
import * as stats from './ui/stats.js';
import * as reports from './ui/reports.js';
import * as account from './ui/account.js';

const routes = [
  [/^\/$/, dashboard],
  [/^\/new$/, newgame, 'teams'],
  [/^\/lineup\/(.+)$/, newgame, 'lineup'],
  [/^\/game\/(.+)$/, live],
  [/^\/sheet\/(.+)$/, sheetview],
  [/^\/stats(?:\/(.+))?$/, stats],
  [/^\/reports$/, reports],
  [/^\/account$/, account],
];

ctx.startTour = () => startTour(ctx);
ctx.help = () => showHelp(ctx);

const icon = (p) => h('span', { html: p });
const ball = '<svg viewBox="0 0 32 32" fill="none" stroke="currentColor" stroke-width="2"><circle cx="16" cy="16" r="13"/><path d="M16 3c0 8 4 13 13 13M16 3c0 8-4 13-13 13M3 16c8 0 13 4 13 13M29 16c-8 0-13 4-13 13"/></svg>';

const app = $('#app');
let header, view, cleanup = null, mountToken = 0;

function buildShell() {
  const chip = h('button', { class: 'chip', id: 'sync-chip', onclick: () => ctx.go('/account'), 'aria-label': 'Sync and account' }, h('i', { class: 'dot', id: 'sync-dot' }), h('span', { id: 'sync-text' }, 'Saved on this device'));
  header = h('header', { class: 'appbar' },
    h('button', { class: 'brand', onclick: () => ctx.go('/'), 'aria-label': 'Home' }, icon(ball), h('span', { class: 'b-long' }, 'Volleyball Game Day'), h('span', { class: 'b-short' }, 'Game Day')),
    h('span', { class: 'spacer' }), chip,
    h('button', { class: 'help-btn', 'data-tour': 'help', onclick: () => ctx.help(), 'aria-label': 'Help' }, '? Help'));
  view = h('main', { id: 'view' });
  app.replaceChildren(header, view);
  sync.on(updateChip); updateChip(sync.state);
  globalThis.addEventListener('online', () => updateChip(sync.state));
  globalThis.addEventListener('resize', () => updateChip(sync.state));
  globalThis.addEventListener('offline', () => updateChip(sync.state));
}
function updateChip(st) {
  const dot = $('#sync-dot'), txt = $('#sync-text');
  if (!dot) return;
  const online = navigator.onLine;
  const short = matchMedia('(max-width: 520px)').matches;
  let cls = 'dot', t;
  if (!sync.signedIn) { t = online ? (short ? 'Saved' : 'Saved on this device') : (short ? 'Offline' : 'Offline · saved here'); }
  else if (st.status === 'syncing') { cls += ' busy'; t = 'Syncing…'; }
  else if (!online || st.status === 'offline') { cls += ' bad'; t = short ? 'Offline' : 'Offline · will sync later'; }
  else if (st.status === 'error') { cls += ' bad'; t = short ? 'Sync issue' : 'Sync problem'; }
  else { cls += ' ok'; t = 'Synced'; }
  dot.className = cls; txt.textContent = t;
}
async function render() {
  const token = ++mountToken;
  if (cleanup) { try { cleanup(); } catch (e) { console.error(e); } cleanup = null; }
  const path = ctx.route.split('?')[0];
  document.body.classList.remove('live-mode');
  let matched = null;
  for (const [re, mod, mode] of routes) {
    const m = re.exec(path);
    if (m) { matched = { mod, mode, params: m.slice(1) }; break; }
  }
  if (!matched) { ctx.go('/'); return; }
  view.replaceChildren();
  view.className = '';
  header.hidden = false;
  try {
    const c = await matched.mod.mount(view, { params: matched.params, mode: matched.mode, query: new URLSearchParams((ctx.route.split('?')[1]) || ''), shell: { header } }, ctx);
    if (token !== mountToken) { if (c) c(); return; }
    cleanup = c || null;
  } catch (e) {
    console.error(e);
    view.replaceChildren(h('div', { class: 'card' }, h('h2', null, 'Something went wrong'), h('p', null, String(e && e.message || e)), h('button', { class: 'btn primary', onclick: () => ctx.go('/') }, 'Back to dashboard')));
  }
  globalThis.scrollTo(0, 0);
  globalThis.dispatchEvent(new CustomEvent('vb-rendered'));
}

async function boot() {
  buildShell();
  await sync.init();
  globalThis.addEventListener('hashchange', render);
  await render();
  if ('serviceWorker' in navigator && location.protocol !== 'file:') {
    navigator.serviceWorker.register('sw.js').catch((e) => console.warn('SW failed', e));
  }
  if (await shouldAutoStartTour() && ctx.route === '/') startTour(ctx, { welcome: true });
  globalThis.addEventListener('vb-conflict', () => toast('This game was changed on another device. A copy of your offline changes was saved in Game Reports.', { ms: 7000 }));
}
globalThis.vb = { ctx, store, sync };
boot();
