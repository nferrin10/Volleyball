// PDF / CSV / preview generation for a stored game. pdf-lib is loaded on first use
// (and cached by the service worker, so it works offline).
import { buildState, SIDES, STAT_COLUMNS, other } from './engine/engine.js';
import { buildSheet, clean, PAGE_W, PAGE_H } from './sheet/layout.js';
import { makeMeasurer, renderPDF, pageToSVG } from './sheet/render.js';
import { slug } from './util.js';

let libP = null, measureP = null;
export const loadPDFLib = () => (libP ||= import('../vendor/pdf-lib.mjs'));
async function measurer() { return (measureP ||= loadPDFLib().then((L) => makeMeasurer(L))); }

export async function sheetModel(rec, S = null) {
  const state = S || buildState(rec.setup, rec.events);
  const measure = await measurer();
  return { S: state, sheet: buildSheet(state, rec, measure) };
}
export async function sheetSVGs(rec, S = null) {
  const { sheet } = await sheetModel(rec, S);
  return sheet.pages.map((p, i) => pageToSVG(p, { label: `Scoresheet page ${i + 1}` }));
}
export async function sheetPDF(rec) {
  const { sheet, S } = await sheetModel(rec);
  const L = await loadPDFLib();
  return renderPDF(L, sheet, { title: `${S.setup.home.name} vs ${S.setup.away.name} - ${S.setup.date}` });
}
export function fileBase(rec) {
  const s = rec.setup;
  return `${slug(s.home.name)}-vs-${slug(s.away.name)}-${s.date || 'game'}`;
}
export function resultLine(S) {
  return S.sets.filter((s) => s.over).map((s) => `${s.home.score}-${s.away.score}`).join(', ');
}

// ---------------------------------------------------------------- stats

export function statRows(S, side) {
  const rows = [];
  for (const p of S.setup[side].players) {
    const st = S.stats[side][p.id];
    if (!st) continue;
    rows.push({ number: p.number, name: p.name || '', libero: !!p.libero, ...st });
  }
  const un = S.stats[side]._unassigned;
  if (un) {
    const any = STAT_COLUMNS.some(([k]) => k !== 'sets' && un[k]);
    if (any) rows.push({ number: '-', name: 'Player not recorded', libero: false, ...un });
  }
  rows.sort((a, b) => (parseInt(a.number, 10) || 999) - (parseInt(b.number, 10) || 999));
  return rows;
}

export function teamTotals(rows) {
  const t = {};
  for (const [k] of STAT_COLUMNS) if (k !== 'sets') t[k] = rows.reduce((a, r) => a + (r[k] || 0), 0);
  return t;
}

export function statsCSV(recs, label) {
  const lines = [['Game', 'Team', 'Number', 'Name', ...STAT_COLUMNS.map(([, l]) => l)].join(',')];
  const q = (v) => '"' + String(v ?? '').replace(/"/g, '""') + '"';
  for (const rec of recs) {
    const S = buildState(rec.setup, rec.events);
    for (const side of SIDES) for (const r of statRows(S, side)) {
      lines.push([q(`${rec.setup.home.name} vs ${rec.setup.away.name} ${rec.setup.date}`), q(rec.setup[side].name), q(r.number), q(r.name), ...STAT_COLUMNS.map(([k]) => r[k] || 0)].join(','));
    }
  }
  return new Blob([lines.join('\r\n')], { type: 'text/csv' });
}

// Combine non-practice games for one team (matched by team name) into season totals.
export function seasonRows(recs, teamName) {
  const key = teamName.trim().toLowerCase();
  const byNum = new Map();
  let games = 0;
  for (const rec of recs) {
    if (rec.practice) continue;
    const S = buildState(rec.setup, rec.events);
    for (const side of SIDES) {
      if (rec.setup[side].name.trim().toLowerCase() !== key) continue;
      games++;
      for (const r of statRows(S, side)) {
        const k = r.number;
        const cur = byNum.get(k) || { number: r.number, name: r.name, libero: r.libero, games: 0 };
        cur.games++;
        if (r.name) cur.name = r.name;
        for (const [c] of STAT_COLUMNS) cur[c] = (cur[c] || 0) + (r[c] || 0);
        byNum.set(k, cur);
      }
    }
  }
  const rows = [...byNum.values()].sort((a, b) => (parseInt(a.number, 10) || 999) - (parseInt(b.number, 10) || 999));
  return { rows, games };
}

export async function statsPDF(rec) {
  const L = await loadPDFLib();
  const S = buildState(rec.setup, rec.events);
  const doc = await L.PDFDocument.create();
  doc.setTitle(`Player statistics - ${S.setup.home.name} vs ${S.setup.away.name}`);
  const f = await doc.embedFont(L.StandardFonts.Helvetica);
  const fb = await doc.embedFont(L.StandardFonts.HelveticaBold);
  const ink = L.rgb(0.08, 0.17, 0.5), grey = L.rgb(0.4, 0.4, 0.4), line = L.rgb(0.75, 0.75, 0.75);
  const W = 792, H = 612, M = 36;
  const cols = [['number', '#', 28], ['name', 'Player', 120], ...STAT_COLUMNS.map(([k, l]) => [k, l, 46])];
  let page = doc.addPage([W, H]);
  let y = H - M;
  const text = (s, x, yy, size, font = f, color = L.rgb(0, 0, 0), align = 'l', w = 0) => {
    const t = clean(s);
    const tw = font.widthOfTextAtSize(t, size);
    page.drawText(t, { x: align === 'r' ? x + w - tw : align === 'c' ? x + (w - tw) / 2 : x, y: yy, size, font, color });
  };
  const newPage = () => { page = doc.addPage([W, H]); y = H - M; };
  text('Player Statistics', M, y - 14, 18, fb); y -= 24;
  text(`${S.setup.home.name} vs ${S.setup.away.name}  |  ${S.setup.date || ''}  |  ${S.setup.site || ''}`, M, y - 8, 9, f, grey); y -= 14;
  text(`Final: ${resultLine(S) || 'in progress'}   (sets: ${S.setsWon.home} - ${S.setsWon.away})`, M, y - 8, 9, f, grey); y -= 20;
  for (const side of SIDES) {
    const rows = statRows(S, side);
    const needed = 40 + (rows.length + 2) * 15;
    if (y - needed < M) newPage();
    text(S.setup[side].name + (side === 'home' ? '  (Home)' : '  (Visitor)'), M, y - 12, 12, fb, ink); y -= 20;
    let x = M;
    for (const [, label, w] of cols) { text(label, x, y - 9, 7.5, fb, grey, label === 'Player' ? 'l' : 'r', w - 4); x += w; }
    y -= 13;
    page.drawLine({ start: { x: M, y }, end: { x: M + cols.reduce((a, c) => a + c[2], 0), y }, thickness: 0.8, color: grey });
    for (const r of rows) {
      if (y - 15 < M) { newPage(); }
      x = M;
      for (const [k, , w] of cols) {
        const v = k === 'name' ? (r.name + (r.libero ? ' (L)' : '')) : (r[k] ?? 0);
        text(String(v), x, y - 11, 8.5, f, r.number === '-' ? grey : L.rgb(0, 0, 0), k === 'name' ? 'l' : 'r', w - 4);
        x += w;
      }
      y -= 15;
      page.drawLine({ start: { x: M, y }, end: { x: M + cols.reduce((a, c) => a + c[2], 0), y }, thickness: 0.3, color: line });
    }
    const t = teamTotals(rows);
    x = M;
    for (const [k, , w] of cols) {
      const v = k === 'number' ? '' : k === 'name' ? 'Team total' : k === 'sets' ? '' : t[k];
      text(String(v), x, y - 11, 8.5, fb, L.rgb(0, 0, 0), k === 'name' ? 'l' : 'r', w - 4);
      x += w;
    }
    y -= 30;
  }
  const notes = 'Pts = kills + aces + blocks. Blocks = solo blocks; Blk Ast = shared blocks. Serves = serve attempts (from the serving order). "Player not recorded" holds stats entered without choosing a player.';
  if (y - 20 < M) newPage();
  text(notes, M, M - 4 + 10, 7, f, grey);
  if (rec.practice) text('PRACTICE GAME - not real statistics', M, H - 14, 8, fb, L.rgb(0.75, 0.2, 0.15));
  return doc.save();
}
