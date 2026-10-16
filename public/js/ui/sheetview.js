// VIEW SCORESHEET: the actual form, filling itself in. Zoomable. Download / print / share the PDF.
import { h, toast, shareOrDownload, download } from '../util.js';
import { sheetModel, sheetPDF, fileBase } from '../reports.js';
import { pageToSVG } from '../sheet/render.js';
import { PAGE_W, PAGE_H } from '../sheet/layout.js';
import { editBox, hitTest } from '../sheet/edits.js';
import { editDialog } from './sheetedit.js';

export async function mount(root, { params }, ctx) {
  const id = params[0];
  const session = await ctx.session(id);
  if (!session) { ctx.go('/'); return null; }
  const rec = session.rec;
  document.body.classList.add('live-mode');
  let zoom = 1, pageCount = 1, token = 0, editMode = false;
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
    scroll.replaceChildren(...sheet.pages.map((p, i) => h('div', { class: 'sheetpage' + (editMode ? ' editing' : ''), id: 'sheet-page-' + i, dataset: { page: i }, html: withOutlines(pageToSVG(p, { label: `Scoresheet page ${i + 1} of ${sheet.pages.length}` }), i) })));
    tabs.replaceChildren(...sheet.pages.map((p, i) => h('button', { class: 'btn small', onclick: () => document.getElementById('sheet-page-' + i).scrollIntoView({ behavior: 'smooth', block: 'start' }) }, sheet.pages.length > 1 ? (i + 1 > Math.ceil(S.sets.length / 3) && sheet.continued ? 'Notes' : `Page ${i + 1}`) : 'Page 1')));
    status.textContent = editMode ? 'Editing: tap the sheet where you want to write or white out. Tap a red box to change it.' : S.matchOver ? `Final — ${S.setsWon.home}–${S.setsWon.away}` : 'Game in progress — the sheet updates as you score.';
    applyZoom();
  }
  // In edit mode, existing edits get a dashed red outline so they are easy to find and tap.
  function withOutlines(svg, page) {
    if (!editMode) return svg;
    const boxes = (rec.setup.sheetEdits || []).filter((e) => e.page === page).map((e) => { const b = editBox(e); return `<rect x="${b.x - 1}" y="${b.y - 1}" width="${b.w + 2}" height="${b.h + 2}" fill="none" stroke="#d92d20" stroke-width="0.8" stroke-dasharray="3 2"/>`; });
    return svg.replace(/<\/svg>$/, boxes.join('') + '</svg>');
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
  const editBtn = h('button', { class: 'btn', 'data-tour': 'edit-sheet', onclick: () => {
    if (session.readOnly) { toast('This game is open for viewing only. Tap "Take over" to edit it here.'); return; }
    editMode = !editMode; editBtn.textContent = editMode ? 'Done editing' : 'Edit the sheet'; editBtn.classList.toggle('primary', editMode); draw();
  } }, 'Edit the sheet');
  const foot = h('div', { class: 'sheetfoot' },
    h('button', { class: 'btn dl', 'data-tour': 'download-pdf', onclick: dl }, 'DOWNLOAD COMPLETED SCORESHEET'),
    h('button', { class: 'btn', 'data-tour': 'share-pdf', onclick: share }, 'Share / Print'),
    h('button', { class: 'btn', onclick: printPreview }, 'Open PDF'),
    editBtn,
    h('button', { class: 'btn', onclick: () => { ctx.openHistory = true; ctx.go('/game/' + id); } }, 'Fix a mistake'),
    h('button', { class: 'btn', onclick: () => ctx.go('/stats/' + id) }, 'Player stats'));
  root.append(h('div', { class: 'sheetview' }, bar, status, scroll, foot));

  // pinch / double-tap zoom on touch, ctrl+wheel on laptops
  let lastTap = 0;
  scroll.addEventListener('touchend', (e) => { const n = Date.now(); if (!editMode && n - lastTap < 300 && e.touches.length === 0) { setZoom(zoom >= 2 ? 1 : 2); } lastTap = n; });
  scroll.addEventListener('click', (e) => {
    if (!editMode) return;
    const pg = e.target.closest && e.target.closest('.sheetpage');
    const svg = pg && pg.querySelector('svg');
    if (!svg) return;
    const r = svg.getBoundingClientRect();
    const x = (e.clientX - r.left) / r.width * PAGE_W, y = (e.clientY - r.top) / r.height * PAGE_H;
    const page = +pg.dataset.page;
    editDialog(session, { page, x, y, existing: hitTest(rec.setup.sheetEdits, page, x, y) });
  });
  scroll.addEventListener('wheel', (e) => { if (e.ctrlKey) { e.preventDefault(); setZoom(zoom * (e.deltaY < 0 ? 1.1 : 0.9)); } }, { passive: false });
  const onResize = () => applyZoom();
  globalThis.addEventListener('resize', onResize);

  let t = null;
  const unsub = session.subscribe(() => { clearTimeout(t); t = setTimeout(draw, 120); });
  await draw();
  void pageCount;
  return () => { unsub(); clearTimeout(t); globalThis.removeEventListener('resize', onResize); document.body.classList.remove('live-mode'); };
}
