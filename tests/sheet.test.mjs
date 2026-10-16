import test from 'node:test';
import assert from 'node:assert/strict';
import * as PDFLib from '../public/vendor/pdf-lib.mjs';
import { buildSheet, PAGE_W, PAGE_H } from '../public/js/sheet/layout.js';
import { makeMeasurer, renderPDF, pageToSVG } from '../public/js/sheet/render.js';
import { simulateMatch } from './sim.mjs';
import { buildState, cmd } from '../public/js/engine/engine.js';
import { mkSetup, startSet } from './helpers.mjs';

const measure = await makeMeasurer(PDFLib);

test('every mark stays on the page and text is never wider than 760pt', () => {
  const m = simulateMatch(3);
  const sheet = buildSheet(m.state, { practice: false }, measure);
  assert.equal(sheet.pages.length, 2);
  for (const pg of sheet.pages) for (const op of pg.ops) {
    if (op.t === 't') {
      const w = measure(op.s, op.size, op.font);
      const x0 = op.align === 'c' ? op.x - w / 2 : op.align === 'r' ? op.x - w : op.x;
      if (op.rot) continue;
      assert.ok(x0 >= 14 && x0 + w <= PAGE_W - 14, `text off page: ${op.s}`);
      assert.ok(op.y > 0 && op.y < PAGE_H - 10, `text y off page: ${op.s}`);
    }
    if (op.t === 'l') assert.ok(op.x1 >= 0 && op.x2 <= PAGE_W && op.y1 >= 0 && op.y2 <= PAGE_H);
  }
});

test('one page for a 3-set match, two for 4-5 sets, notes page only when comments overflow', () => {
  const m3 = simulateMatch(1, { plan: [['home', 25, 10], ['home', 25, 12], ['home', 25, 9]] });
  assert.equal(buildSheet(m3.state, {}, measure).pages.length, 1);
  assert.equal(buildSheet(simulateMatch(2).state, {}, measure).pages.length, 2);
  const setup = mkSetup();
  const ev = [startSet('home')];
  for (let i = 0; i < 60; i++) ev.push(cmd.comment('A very long note about the match that keeps going and going '.repeat(2), 'home'));
  const s = buildSheet(buildState(setup, ev), {}, measure);
  assert.equal(s.continued, true);
});

test('sets that run long (win by 2 past 30) still draw: no thrown errors', () => {
  const m = simulateMatch(5, { plan: [['home', 36, 34], ['away', 25, 20], ['home', 25, 20]] });
  const sheet = buildSheet(m.state, {}, measure);
  assert.ok(sheet.pages.length >= 1);
});

test('PDF is valid, US Letter landscape, SVG preview renders from same ops', async () => {
  const m = simulateMatch(9);
  const sheet = buildSheet(m.state, { practice: true }, measure);
  const bytes = await renderPDF(PDFLib, sheet);
  const doc = await PDFLib.PDFDocument.load(bytes);
  assert.equal(doc.getPageCount(), 2);
  assert.deepEqual([doc.getPage(0).getWidth(), doc.getPage(0).getHeight()], [792, 612]);
  assert.match(pageToSVG(sheet.pages[0]), /^<svg/);
});

test('international / odd characters in names cannot break the PDF', async () => {
  const setup = mkSetup();
  setup.home.name = 'Équipe Ñandú ✨ 日本';
  const sheet = buildSheet(buildState(setup, [startSet('home'), cmd.point('home')]), {}, measure);
  await renderPDF(PDFLib, sheet);
});
