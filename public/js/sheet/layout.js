// Scoresheet layout — recreates the paper volleyball scoresheet (3 sets per US-Letter
// landscape page). It turns the derived game state into a list of drawing ops that
// are rendered identically by the SVG preview and by the PDF writer.
//
// Coordinates are PDF points, origin top-left, page 792 x 612 (landscape Letter).
//
// Marking conventions (taken from the legend printed on the form):
//   number            point scored while serving, written in the server's row
//   boxed number      point scored off a loss of rally (side-out) — recorded on the
//                     NEXT server's row, and boxed again in the running score
//   triangle          libero point (and the serve-order numeral is triangled)
//   -|                loss of rally, written in the row of the server who lost it
//   T / Tx            time-out (this team / opponent);  S / Sx substitution
//   P / Px / P3       penalty, penalty opponent, penalty point
//   R / RS            replay, re-serve

import { ROMAN } from '../engine/engine.js';

export const PAGE_W = 792;
export const PAGE_H = 612;
const X_L0 = 18, X_LGRID = 80, X_CL = 368, X_CR = 424, X_RGRID = 486, X_END = 774;
const GRID_W = 288;
const BLOCK_Y0 = 38, BLOCK_H = 160;
const Y_TITLE = 0, Y_HDR = 22, Y_ROWS = 36, ROW_H = 16, Y_SUBS = 132, Y_CMT = 145;
const MIN_COLS = 16;
const INK = '#14307f';        // filled-in marks (prints as dark grey in black & white)
const FORM = '#1a1a1a';       // printed form
const FAINT = '#8a8a8a';

const o = {
  line: (x1, y1, x2, y2, lw = 0.6, x = {}) => ({ t: 'l', x1, y1, x2, y2, lw, color: FORM, ...x }),
  rect: (x, y, w, h, lw = 0.6, x2 = {}) => ({ t: 'r', x, y, w, h, lw, color: FORM, ...x2 }),
  text: (s, x, y, size = 8, x2 = {}) => ({ t: 't', s, x, y, size, font: 'r', align: 'l', color: FORM, ...x2 }),
  poly: (pts, lw = 0.7, x = {}) => ({ t: 'p', pts, lw, color: FORM, ...x }),
  circle: (cx, cy, r, lw = 0.7, x = {}) => ({ t: 'c', cx, cy, r, lw, color: FORM, ...x }),
};

// WinAnsi-safe text (the PDF uses the standard Helvetica font).
export function clean(s) {
  return String(s == null ? '' : s)
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[‘’]/g, "'").replace(/[“”]/g, '"').replace(/[–—]/g, '-')
    .replace(/[^\x20-\x7e]/g, '?');
}

function fitSize(measure, text, font, maxW, start, min) {
  let size = start;
  while (size > min && measure(text, size, font) > maxW) size -= 0.25;
  return size;
}
function ellipsize(measure, text, font, size, maxW) {
  if (measure(text, size, font) <= maxW) return text;
  let t = text;
  while (t.length > 1 && measure(t + '...', size, font) > maxW) t = t.slice(0, -1);
  return t + '...';
}
function wrap(measure, text, font, size, maxW) {
  const words = text.split(/\s+/).filter(Boolean);
  const lines = []; let cur = '';
  for (const w of words) {
    const t = cur ? cur + ' ' + w : w;
    if (measure(t, size, font) <= maxW || !cur) cur = t;
    else { lines.push(cur); cur = w; }
  }
  if (cur) lines.push(cur);
  return lines;
}

function fmtDate(d) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(d || '');
  return m ? `${m[2]}/${m[3]}/${m[1]}` : clean(d || '');
}
function fmtTime(t) {
  const m = /^(\d{1,2}):(\d{2})/.exec(t || '');
  if (!m) return clean(t || '');
  let h = +m[1]; const ap = h >= 12 ? 'PM' : 'AM'; h = h % 12 || 12;
  return `${h}:${m[2]} ${ap}`;
}

// ---------------------------------------------------------------- the sheet

export function buildSheet(S, game, measure, opts = {}) {
  const setup = S.setup;
  const rules = S.rules;
  const pages = [];
  const cont = [];   // overflow comment text -> continuation page
  const nPages = Math.max(1, Math.ceil(Math.max(S.sets.length, 1) / 3));
  const total = Math.max(rules.bestOf > 3 && S.sets.length > 3 ? 2 : 1, nPages);
  for (let pg = 0; pg < total; pg++) {
    const ops = [];
    drawFrame(ops, S, game, measure, pg, total);
    for (let b = 0; b < 3; b++) {
      const setNo = pg * 3 + b + 1;
      const set = S.sets[setNo - 1] || null;
      drawBlock(ops, BLOCK_Y0 + b * BLOCK_H, set, setNo, S, measure, cont, pages.length + 1);
    }
    if (game.practice || opts.watermark) {
      ops.push(o.text(clean(opts.watermark || 'PRACTICE GAME'), PAGE_W / 2, PAGE_H / 2 + 40, 90, { font: 'b', align: 'c', color: '#c0392b', opacity: 0.13, rot: 28 }));
    }
    pages.push({ ops });
  }
  if (cont.length) pages.push({ ops: drawContinuation(cont, S, game, measure, pages.length + 1) });
  return { pages, width: PAGE_W, height: PAGE_H, continued: cont.length > 0 };
}

function drawFrame(ops, S, game, measure, pg, total) {
  const setup = S.setup;
  // header line
  const y = 26;
  const fields = [
    ['DATE:', 70, fmtDate(setup.date)],
    ['HOME:', 112, setup.home.name],
    ['VISITOR:', 112, setup.away.name],
    ['SITE:', 112, setup.site],
    ['START TIME:', 62, fmtTime(setup.startTime || S.startTime)],
    ['END TIME:', 62, fmtTime(setup.endTime || (S.matchOver ? S.endTime : ''))],
  ];
  let x = X_L0;
  const gaps = 8;
  for (const [label, w, val] of fields) {
    ops.push(o.text(label, x, y, 7.5, { font: 'b' }));
    const lw = measure(label, 7.5, 'b');
    ops.push(o.line(x + lw + 3, y + 1.5, x + lw + 3 + w, y + 1.5, 0.6));
    const v = clean(val);
    if (v) {
      const sz = fitSize(measure, v, 'b', w - 2, 8.5, 5);
      ops.push(o.text(v, x + lw + 5, y - 0.5, sz, { font: 'b', color: INK }));
    }
    x += lw + 3 + w + gaps;
  }
  if (total > 1) ops.push(o.text(`Page ${pg + 1} of ${total}`, X_END, 12, 6, { align: 'r', color: FAINT }));

  // rule note + legend + referees (bottom)
  const ny = BLOCK_Y0 + 3 * BLOCK_H + 3;
  ops.push(o.rect(X_L0, ny, X_END - X_L0, 23, 0.8));
  const note = 'If the receiving team wins the rally, it receives a point which is recorded on the line of the next server\'s number and a square is drawn around it. Also, draw a square around the same point on the team\'s running score. Draw a triangle around serve order position if libero serves and points scored by libero.';
  const lines = wrap(measure, note, 'i', 6, X_END - X_L0 - 8);
  lines.slice(0, 2).forEach((ln, i) => ops.push(o.text(ln, X_L0 + 4, ny + 9 + i * 8, 6, { font: 'i' })));
  drawLegend(ops, ny + 29, measure);
}

function legendIcon(ops, x, y, kind) {
  const s = 11;
  const box = (heavy) => ops.push(o.rect(x, y, s, s, heavy ? 1.1 : 0.5, heavy ? {} : { color: FAINT }));
  const mid = y + s / 2;
  switch (kind) {
    case 'pt': box(false); ops.push(o.text('1', x + s / 2, y + 8.6, 7.5, { align: 'c', font: 'b' })); break;
    case 'loss': box(true); ops.push(o.line(x + 2, mid, x + s - 3.5, mid, 1)); ops.push(o.line(x + s - 3.5, y + 2.5, x + s - 3.5, y + s - 2.5, 1)); break;
    case 'so': box(true); ops.push(o.text('2', x + s / 2, y + 8.6, 7.5, { align: 'c', font: 'b' })); break;
    case 'lib': ops.push(o.poly([[x + s / 2, y - 0.5], [x + s + 0.5, y + s], [x - 0.5, y + s]], 1)); ops.push(o.text('1', x + s / 2, y + 9, 6.5, { align: 'c', font: 'b' })); break;
    default: box(true); ops.push(o.text(kind, x + s / 2, y + 8.3, kind.length > 1 ? 6 : 7.5, { align: 'c', font: 'b' }));
  }
}

function drawLegend(ops, y0, measure) {
  const cols = [20, 94, 176, 290, 368, 450, 530];
  const r1 = [['pt', 'Point'], ['loss', 'Loss of Rally'], ['so', 'Point Scored off Loss of Rally'], ['P3', 'Penalty Point'], ['P', 'Penalty'], ['R', 'Replay'], ['RS', 'Re-serve']];
  const r2 = [['T', 'Time-out'], ['Tx', 'Time-Out Opponent'], ['lib', 'Libero Point'], ['Px', 'Penalty Opponent'], ['S', 'Substitution Serving Team'], ['Sx', 'Substitution Opponent'], ['C', 'Playing Captain']];
  [r1, r2].forEach((row, ri) => {
    const y = y0 + ri * 17;
    row.forEach(([icon, label], i) => {
      const x = cols[i];
      if (icon === 'C') ops.push(o.text('C', x + 3, y + 8.5, 8, { font: 'b' }));
      else legendIcon(ops, x, y, icon);
      const lw = (i + 1 < cols.length ? cols[i + 1] : 606) - x - 19;
      const ls = wrap(measure, label, 'r', 6, lw);
      if (ls.length === 1) ops.push(o.text(ls[0], x + 16, y + 8, 6));
      else ls.slice(0, 2).forEach((l, k) => ops.push(o.text(l, x + 16, y + 5 + k * 6.5, 6)));
    });
  });
  ['First Referee:', 'Second Referee:'].forEach((lab, i) => {
    const y = y0 + i * 17 + 9;
    ops.push(o.text(lab, 610, y, 8, { font: 'b' }));
    const lw = measure(lab, 8, 'b');
    ops.push(o.line(610 + lw + 3, y + 1, X_END, y + 1, 0.7));
  });
}

// ----------------------------------------------------------------- one set

function drawBlock(ops, y0, set, setNo, S, measure, cont, pageNo) {
  const setup = S.setup;
  const sides = S.rules.alternateSheetSides && setNo % 2 === 0 ? ['away', 'home'] : ['home', 'away'];
  // outer frame + dividers
  ops.push(o.rect(X_L0, y0, X_END - X_L0, BLOCK_H - 2, 1.1));
  ops.push(o.line(X_L0, y0 + Y_HDR, X_CL, y0 + Y_HDR, 0.6));
  ops.push(o.line(X_CR, y0 + Y_HDR, X_END, y0 + Y_HDR, 0.6));
  ops.push(o.line(X_L0, y0 + Y_SUBS, X_CL, y0 + Y_SUBS, 0.6));
  ops.push(o.line(X_CR, y0 + Y_SUBS, X_END, y0 + Y_SUBS, 0.6));
  ops.push(o.line(X_CL, y0, X_CL, y0 + BLOCK_H - 2, 1.1));
  ops.push(o.line(X_CR, y0, X_CR, y0 + BLOCK_H - 2, 1.1));
  ops.push(o.line(X_L0, y0 + Y_CMT, X_CL, y0 + Y_CMT, 0.4, { color: FAINT }));
  ops.push(o.line(X_CR, y0 + Y_CMT, 690, y0 + Y_CMT, 0.4, { color: FAINT }));

  drawTeam(ops, y0, set, setNo, sides[0], 0, S, measure, cont, pageNo);
  drawTeam(ops, y0, set, setNo, sides[1], 1, S, measure, cont, pageNo);
  drawCenter(ops, y0, set, sides, S, measure);
}

function drawTeam(ops, y0, set, setNo, side, col, S, measure, cont, pageNo) {
  const setup = S.setup;
  const ts = set ? set[side] : null;
  const left = col === 0;
  const lx = left ? X_L0 : X_CR;                 // label column start
  const gx = left ? X_LGRID : X_RGRID;           // grid start
  const ex = left ? X_CL : X_END;                // right edge of this half
  const name = clean(setup[side].name);

  // ---- title row ----
  if (left) {
    ops.push(o.rect(X_L0, y0, X_LGRID - X_L0, Y_HDR, 0.6));
    ops.push(o.text('Set', X_L0 + 3, y0 + 8, 6, { font: 'b' }));
    ops.push(o.text('No.', X_L0 + 3, y0 + 15, 6, { font: 'b' }));
    if (set) ops.push(o.text(String(setNo), X_L0 + 42, y0 + 17, 13, { font: 'b', align: 'c', color: INK }));
  } else {
    ops.push(o.rect(X_END - 50, y0, 50, Y_HDR, 0.6));
    ops.push(o.text('Set', X_END - 47, y0 + 8, 6, { font: 'b' }));
    ops.push(o.text('No.', X_END - 47, y0 + 15, 6, { font: 'b' }));
    if (set) ops.push(o.text(String(setNo), X_END - 17, y0 + 17, 13, { font: 'b', align: 'c', color: INK }));
  }
  const toX = left ? X_LGRID : X_RGRID;
  ops.push(o.rect(toX, y0, 70, 8, 0.6));
  ops.push(o.text('TIME-OUTS', toX + 35, y0 + 6.2, 5.5, { font: 'b', align: 'c' }));
  for (let i = 0; i < 2; i++) {
    ops.push(o.rect(toX + i * 35, y0 + 8, 35, Y_HDR - 8, 0.6));
    const t = ts && ts.timeouts[i];
    if (t) ops.push(o.text(t.score, toX + i * 35 + 17.5, y0 + 18.5, fitSize(measure, t.score, 'b', 31, 7.5, 5), { font: 'b', align: 'c', color: INK }));
  }
  const tx = toX + 70;
  const teamEnd = left ? X_CL - 18 : X_END - 50;
  ops.push(o.rect(tx, y0, teamEnd - tx, Y_HDR, 0.6));
  ops.push(o.text('Team:', tx + 4, y0 + 14, 7.5, { font: 'b' }));
  if (set) {
    const nm = ellipsize(measure, name, 'b', 10, teamEnd - tx - 38);
    ops.push(o.text(nm, tx + 36, y0 + 15, fitSize(measure, nm, 'b', teamEnd - tx - 38, 10.5, 6), { font: 'b', color: INK }));
  }
  // first-serve check box
  const cbx = left ? X_CL - 15 : X_CR + 5;
  ops.push(o.rect(cbx, y0 + 6, 10, 10, 0.8));
  if (set && set.firstServe === side) {
    ops.push(o.line(cbx + 1.8, y0 + 7.8, cbx + 8.2, y0 + 14.2, 1.2, { color: INK }));
    ops.push(o.line(cbx + 8.2, y0 + 7.8, cbx + 1.8, y0 + 14.2, 1.2, { color: INK }));
  }

  // ---- header row: Serve Order | Player No. | L: ----
  ops.push(o.text('Serve', lx + 10, y0 + Y_HDR + 6, 4.6, { font: 'b', align: 'c' }));
  ops.push(o.text('Order', lx + 10, y0 + Y_HDR + 11.5, 4.6, { font: 'b', align: 'c' }));
  ops.push(o.text('Player No.', lx + 20 + 21, y0 + Y_HDR + 9.5, 6.5, { font: 'b', align: 'c' }));
  ops.push(o.text('L:', gx + 14, y0 + Y_HDR + 10.5, 7.5, { font: 'b' }));
  ops.push(o.line(gx + 25, y0 + Y_HDR + 11.8, gx + 60, y0 + Y_HDR + 11.8, 0.6));
  if (ts && ts.libero) {
    const l = setup[side].players.find((p) => p.id === ts.libero);
    if (l) ops.push(o.text(clean(l.number), gx + 42, y0 + Y_HDR + 10.4, 8.5, { font: 'b', align: 'c', color: INK }));
  }

  // ---- rows ----
  const maxUnits = ts ? Math.max(...ts.rows.map(unitsOf)) : 0;
  let nCols = Math.max(MIN_COLS, maxUnits);
  const dropOptional = nCols > 30;
  if (dropOptional) nCols = 30;
  const cw = GRID_W / nCols;
  const sc = Math.min(1, cw / 18);
  for (let r = 0; r < 6; r++) {
    const ry = y0 + Y_ROWS + r * ROW_H;
    ops.push(o.line(lx, ry, gx + GRID_W, ry, 0.6));
    ops.push(o.line(lx + 20, ry, lx + 20, ry + ROW_H, 0.5));
    ops.push(o.line(gx, ry, gx, ry + ROW_H, 0.8));
    const romanX = lx + 10;
    ops.push(o.text(ROMAN[r], romanX, ry + 11.3, 9, { font: 'b', align: 'c' }));
    if (ts && ts.liberoSlots.has(r)) ops.push(o.poly([[romanX, ry + 0.8], [romanX + 9.5, ry + ROW_H - 0.8], [romanX - 9.5, ry + ROW_H - 0.8]], 0.8, { color: INK }));
    // player number cell
    if (ts) drawPlayerCell(ops, setup, ts, side, r, lx + 20, ry, 42, ROW_H, measure);
    // grid cells
    for (let c = 1; c < nCols; c++) ops.push(o.line(gx + c * cw, ry, gx + c * cw, ry + ROW_H, 0.35, { color: '#666' }));
    if (ts) {
      let c = 0;
      for (const cell of ts.rows[r]) {
        if (dropOptional && cell.k === 'mk') continue;
        if (c >= nCols) break;
        drawCell(ops, gx + c * cw, ry, cw, ROW_H, cell, measure, sc);
        c++;
      }
    }
  }
  const gy = y0 + Y_ROWS + 6 * ROW_H;
  ops.push(o.line(lx, gy, gx + GRID_W, gy, 0.8));
  ops.push(o.line(lx + 20, y0 + Y_HDR, lx + 20, y0 + Y_ROWS, 0.5));

  // ---- subs line ----
  const subsEnd = left ? ex - 2 : 688;
  ops.push(o.text('Subs:', lx + 3, y0 + Y_SUBS + 9.5, 7, { font: 'b' }));
  const sx0 = lx + 30, span = (subsEnd - sx0 - 6) / 18;
  const used = ts ? ts.subs.length : 0;
  for (let i = 0; i < 18; i++) {
    const cx = sx0 + span * i + span / 2;
    ops.push(o.text(String(i + 1), cx, y0 + Y_SUBS + 9.5, 6.5, { font: 'b', align: 'c' }));
    if (i < used) ops.push(o.circle(cx, y0 + Y_SUBS + 7.3, Math.min(5.2, span / 2 - 0.6), 0.9, { color: INK }));
  }
  // ---- comments ----
  ops.push(o.text('Comments:', lx + 3, y0 + Y_CMT + 6.8, 6, { font: 'b' }));
  if (ts) drawComments(ops, ts, side, lx + 39, y0 + Y_CMT, (left ? ex - 2 : 688) - (lx + 39) - 2, set, setNo, S, measure, cont, pageNo);

  // referee verification box on the right team
  if (!left) {
    const rx = 692, rw = X_END - rx - 2, ry = y0 + Y_SUBS + 2;
    ops.push(o.rect(rx, ry, rw, BLOCK_H - 2 - Y_SUBS - 4, 0.7, { dash: [2, 1.5] }));
    ops.push(o.text("Referee's Verification", rx + rw / 2, ry + 7, 5.2, { font: 'b', align: 'c' }));
    ops.push(o.line(rx + 6, ry + 21, rx + rw - 6, ry + 21, 0.6));
  }
}

function unitsOf(cells) { return cells.length; }

function drawPlayerCell(ops, setup, ts, side, r, x, y, w, h, measure) {
  const pl = (pid) => { const p = setup[side].players.find((q) => q.id === pid); return p ? clean(p.number) : '?'; };
  const start = pl(ts.start[r]);
  const chain = ts.subs.filter((s) => s.idx === r).map((s) => pl(s.in));
  const cap = ts.captain && ts.captain === ts.start[r];
  const capW = cap ? 8 : 0;
  ops.push(o.text(start, x + 4, y + 11.4, start.length > 2 ? 8 : 9.5, { font: 'b', color: INK }));
  let nx = x + 4 + measure(start, start.length > 2 ? 8 : 9.5, 'b');
  if (cap) {
    ops.push(o.circle(x + w - 6, y + 5.5, 3.4, 0.6, { color: INK }));
    ops.push(o.text('C', x + w - 6, y + 7.2, 4.8, { font: 'b', align: 'c', color: INK }));
  }
  if (chain.length) {
    const avail = x + w - capW - 2 - nx - 2;
    let txt = ' > ' + chain.join(' > ');
    let size = 6.5;
    while (size > 4 && measure(txt, size, 'b') > avail) size -= 0.25;
    if (measure(txt, size, 'b') > avail) txt = '>' + chain.join('>');
    size = Math.min(size, fitSize(measure, txt, 'b', avail, 6.5, 3.4));
    ops.push(o.text(txt, nx + 1, y + 10.6, size, { font: 'b', color: INK }));
  }
}

function drawCell(ops, x, y, w, h, cell, measure, sc) {
  const cx = x + w / 2;
  if (cell.k === 'loss') {
    ops.push(o.line(x + 2.5 * sc + 0.5, y + h / 2, x + w - 4.5 * sc, y + h / 2, 1.1, { color: INK }));
    ops.push(o.line(x + w - 4.5 * sc, y + 3.2, x + w - 4.5 * sc, y + h - 3.2, 1.1, { color: INK }));
    return;
  }
  if (cell.k === 'mk') {
    ops.push(o.rect(x + 1.6, y + 1.6, w - 3.2, h - 3.2, 0.8, { color: INK }));
    const txt = cell.txt;
    const size = Math.min(txt.length > 1 ? 6.8 : 8, fitSize(measure, txt, 'b', w - 5, 8, 4));
    ops.push(o.text(txt, cx, y + h / 2 + size * 0.35, size, { font: 'b', align: 'c', color: INK }));
    if (cell.tag != null) ops.push(o.text(String(cell.tag), x + 2.8, y + 6.2, 4.2, { font: 'b', color: INK }));
    return;
  }
  // point cell
  const txt = String(cell.n);
  if (cell.box) ops.push(o.rect(x + 1.6, y + 1.6, w - 3.2, h - 3.2, 0.9, { color: INK }));
  if (cell.tri) ops.push(o.poly([[cx, y + 0.9], [x + w - 0.9, y + h - 0.9], [x + 0.9, y + h - 0.9]], 0.9, { color: INK }));
  let size = (cell.tri ? 6.6 : 8.6) * Math.max(0.7, sc);
  size = fitSize(measure, txt, 'b', w - (cell.tri ? 6 : 3.5), size, 4);
  const base = cell.tri ? y + h - 3.2 : y + h / 2 + size * 0.36 + (cell.tag ? 1.4 : 0);
  ops.push(o.text(txt, cx, base, size, { font: 'b', align: 'c', color: INK }));
  if (cell.tag) ops.push(o.text(cell.tag, x + 2.8, y + 6.2, 4.2, { font: 'b', color: INK }));
}

function drawComments(ops, ts, side, x, y, w, set, setNo, S, measure, cont, pageNo) {
  const parts = [];
  ts.notes && parts.push(...ts.notes);
  parts.push(...ts.comments.map(clean));
  if (ts.run.length > 30) parts.push(`Points past 30 are not in the running score (final ${ts.score}).`);
  if (!parts.length) return;
  const text = clean(parts.join('; '));
  for (const size of [5.6, 5.2, 4.8, 4.5, 4.2]) {
    const lines = wrap(measure, text, 'r', size, w);
    if (lines.length <= 2) {
      lines.forEach((ln, i) => ops.push(o.text(ln, x, y + 6.4 + i * 6.2, size, { color: INK })));
      return;
    }
  }
  // does not fit: show the beginning, continue on the extra page
  const size = 4.4;
  const lines = wrap(measure, text, 'r', size, w);
  const keep = [lines[0], ellipsize(measure, lines[1] + ' ' + (lines[2] || ''), 'r', size, w - measure(' (cont. p.N)', size, 'r'))];
  keep[1] += ' (cont.)';
  keep.forEach((ln, i) => ops.push(o.text(ln, x, y + 6.4 + i * 6.2, size, { color: INK })));
  cont.push({ set: setNo, side, text });
}

function drawCenter(ops, y0, set, sides, S, measure) {
  const setup = S.setup;
  ops.push(o.rect(X_CL, y0, X_CR - X_CL, Y_HDR, 0.6));
  ops.push(o.text('First Serve', (X_CL + X_CR) / 2, y0 + 8.5, 6.2, { font: 'b', align: 'c' }));
  ops.push(o.text('(< check box >)', (X_CL + X_CR) / 2, y0 + 16, 4.8, { align: 'c' }));
  const rowH = 7.6, top = y0 + Y_HDR;
  for (let p = 0; p < 2; p++) {
    const px = X_CL + p * 28;
    const side = sides[p];
    const ts = set ? set[side] : null;
    for (let i = 0; i < 15; i++) {
      const y = top + i * rowH;
      for (let c = 0; c < 2; c++) {
        const n = i + 1 + c * 15;
        const x = px + c * 14;
        ops.push(o.text(String(n), x + 7, y + 6, 5.8, { align: 'c', font: 'b' }));
        const m = ts && ts.run[n - 1];
        if (m) {
          if (m.box) ops.push(o.rect(x + 1.2, y + 0.6, 11.6, rowH - 1.0, 0.7, { color: INK }));
          ops.push(o.line(x + 1.6, y + rowH - 0.8, x + 12.4, y + 0.9, 0.9, { color: INK }));
        }
      }
    }
    ops.push(o.line(px + 14, top, px + 14, top + 15 * rowH, 0.3, { color: FAINT }));
  }
  ops.push(o.line(X_CL + 28, top, X_CL + 28, top + 15 * rowH, 0.8));
  ops.push(o.line(X_CL, top + 15 * rowH, X_CR, top + 15 * rowH, 0.6));
  // final score
  const fy = top + 15 * rowH;
  ops.push(o.text('FINAL SCORE', (X_CL + X_CR) / 2, fy + 7, 5.6, { font: 'b', align: 'c' }));
  if (set && set.over) {
    const a = set[sides[0]].score, b = set[sides[1]].score;
    const s = `${a} - ${b}`;
    ops.push(o.text(s, (X_CL + X_CR) / 2, y0 + BLOCK_H - 7, fitSize(measure, s, 'b', 50, 10.5, 6), { font: 'b', align: 'c', color: INK }));
  } else {
    ops.push(o.text('-', (X_CL + X_CR) / 2, y0 + BLOCK_H - 7, 9, { font: 'b', align: 'c' }));
  }
}

function drawContinuation(items, S, game, measure, pageNo) {
  const ops = [];
  const setup = S.setup;
  ops.push(o.text('Comments - continued', X_L0, 34, 14, { font: 'b' }));
  ops.push(o.text(`${clean(setup.home.name)} vs ${clean(setup.away.name)}  -  ${fmtDate(setup.date)}  -  ${clean(setup.site)}`, X_L0, 50, 8.5, { color: FAINT }));
  let y = 76;
  for (const it of items) {
    ops.push(o.text(`Set ${it.set} - ${clean(setup[it.side].name)}`, X_L0, y, 9, { font: 'b' }));
    y += 12;
    for (const ln of wrap(measure, it.text, 'r', 8.5, X_END - X_L0 - 12)) {
      ops.push(o.text(ln, X_L0 + 8, y, 8.5, { color: INK }));
      y += 11;
    }
    y += 8;
    if (y > PAGE_H - 40) break;
  }
  if (game.practice) ops.push(o.text('PRACTICE GAME', PAGE_W / 2, PAGE_H / 2 + 40, 90, { font: 'b', align: 'c', color: '#c0392b', opacity: 0.13, rot: 28 }));
  return ops;
}
