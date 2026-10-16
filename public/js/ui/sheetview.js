// VIEW SCORESHEET: the actual form, filling itself in. Zoomable. Download / print / share the PDF.
import { h, toast, shareOrDownload, download } from '../util.js';
import { sheetModel, sheetPDF, fileBase } from '../reports.js';
import { pageToSVG } from '../sheet/render.js';

export async function mount(root, { params }, ctx) {
  const id = params[0];
  const session = await ctx.session(id);
  if (!session) { ctx.go('/'); return null; }
  const rec = session.rec;
  document.body.classList.add('live-mode');
  let zoom = 1, pageCount = 1, token = 0;
  const scroll = h('div', { class: 'sheetscroll' });
  const tabs = h('div', { class: 'pagetabs' });
  const status = h('div', { class: 'muted', style: { color: '#cfd6e6', padding: '0 12px 6px', fontSize: '.85rem' } });

  const baseWidth = () => Math.max(320, Math.min(scroll.clientWidth - 24, 1400));
  function applyZoom() {
    for (const el of scroll.querySelectorAll('.sheetpage')) el.style.width = Math.round(baseWidth() * zoom) + 'px';
    zoomLabel.textContent = Math.round(zoom * 100) + '%';
  }
  async function draw() {
    const t = ++token;
    const { sheet, S } = await sheetModel(rec, session.S);
    if (t !== token) return;
    pageCount = sheet.pages.length;
    scroll.replaceChildren(...sheet.pages.map((p, i) => h('div', { class: 'sheetpage', id: 'sheet-page-' + i, html: pageToSVG(p, { label: `Scoresheet page ${i + 1} of ${sheet.pages.length}` }) })));
    tabs.replaceChildren(...sheet.pages.map((p, i) => h('button', { class: 'btn small', onclick: () => document.getElementById('sheet-page-' + i).scrollIntoView({ behavior: 'smooth', block: 'start' }) }, sheet.pages.length > 1 ? (i + 1 > Math.ceil(S.sets.length / 3) && sheet.continued ? 'Notes' : `Page ${i + 1}`) : 'Page 1')));
    status.textContent = S.matchOver ? `Final — ${S.setsWon.home}–${S.setsWon.away}` : 'Game in progress — the sheet updates as you score.';
    applyZoom();
  }
  const zoomLabel = h('span', { style: { minWidth: '48px', textAlign: 'center', fontWeight: 700 } }, '100%');
  const setZoom = (z) => { zoom = Math.max(0.5, Math.min(4, z)); applyZoom(); };

  async function makePDF() { return new Blob([await sheetPDF(rec)], { type: 'application/pdf' }); }
  async function dl() {
    try { toast('Making your PDF…', { ms: 1200 }); download(await makePDF(), fileBase(rec) + '-scoresheet.pdf'); }
    catch (e) { console.error(e); toast('Could not make the PDF: ' + e.message, { ms: 6000 }); }
  }
  async function share() {
    try { const r = await shareOrDownload(await makePDF(), fileBase(rec) + '-scoresheet.pdf', 'Volleyball scoresheet'); if (r === 'downloaded') toast('PDF saved. Open it to print.'); }
    catch (e) { toast('Could not share: ' + e.message, { ms: 6000 }); }
  }
  async function printPreview() {
    const w = window.open('', '_blank');
    try {
      const blob = await makePDF();
      const url = URL.createObjectURL(blob);
      if (w) w.location.href = url; else { download(blob, fileBase(rec) + '-scoresheet.pdf'); toast('Pop-ups are blocked, so the PDF was downloaded instead.'); }
    } catch (e) { if (w) w.close(); toast('Could not open the PDF: ' + e.message, { ms: 6000 }); }
  }

  const bar = h('div', { class: 'sheetbar' },
    h('button', { class: 'btn small', onclick: () => ctx.go(session.S.matchOver ? '/' : '/game/' + id) }, session.S.matchOver ? '‹ Done' : '‹ Back to game'),
    h('div', { class: 'title' }, `${rec.setup.home.name} vs ${rec.setup.away.name}`),
    tabs,
    h('div', { class: 'row', style: { gap: '4px' } }, h('button', { class: 'btn small', 'aria-label': 'Zoom out', onclick: () => setZoom(zoom - 0.25) }, '−'), zoomLabel, h('button', { class: 'btn small', 'aria-label': 'Zoom in', onclick: () => setZoom(zoom + 0.25) }, '+'), h('button', { class: 'btn small', onclick: () => setZoom(1) }, 'Fit')));
  const foot = h('div', { class: 'sheetfoot' },
    h('button', { class: 'btn dl', 'data-tour': 'download-pdf', onclick: dl }, 'DOWNLOAD COMPLETED SCORESHEET'),
    h('button', { class: 'btn', 'data-tour': 'share-pdf', onclick: share }, 'Share / Print'),
    h('button', { class: 'btn', onclick: printPreview }, 'Open PDF'),
    h('button', { class: 'btn', onclick: () => { ctx.openHistory = true; ctx.go('/game/' + id); } }, 'Fix a mistake'),
    h('button', { class: 'btn', onclick: () => ctx.go('/stats/' + id) }, 'Player stats'));
  root.append(h('div', { class: 'sheetview' }, bar, status, scroll, foot));

  // pinch / double-tap zoom on touch, ctrl+wheel on laptops
  let lastTap = 0;
  scroll.addEventListener('touchend', (e) => { const n = Date.now(); if (n - lastTap < 300 && e.touches.length === 0) { setZoom(zoom >= 2 ? 1 : 2); } lastTap = n; });
  scroll.addEventListener('wheel', (e) => { if (e.ctrlKey) { e.preventDefault(); setZoom(zoom * (e.deltaY < 0 ? 1.1 : 0.9)); } }, { passive: false });
  const onResize = () => applyZoom();
  globalThis.addEventListener('resize', onResize);

  let t = null;
  const unsub = session.subscribe(() => { clearTimeout(t); t = setTimeout(draw, 120); });
  await draw();
  void pageCount;
  return () => { unsub(); clearTimeout(t); globalThis.removeEventListener('resize', onResize); document.body.classList.remove('live-mode'); };
}
