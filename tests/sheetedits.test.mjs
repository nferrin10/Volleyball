import test from 'node:test';
import assert from 'node:assert/strict';
import * as PDFLib from '../public/vendor/pdf-lib.mjs';
import { buildSheet } from '../public/js/sheet/layout.js';
import { makeMeasurer, renderPDF, pageToSVG } from '../public/js/sheet/render.js';
import { hitTest, editBox, normalizeEdit } from '../public/js/sheet/edits.js';
import { simulateMatch } from './sim.mjs';
import { buildState } from '../public/js/engine/engine.js';

const measure = await makeMeasurer(PDFLib);
const base = () => simulateMatch(1, { plan: [['home', 25, 10], ['home', 25, 12], ['home', 25, 9]] });

test('edits appear on the right page, on top, as a white patch plus text', () => {
  const m = base();
  m.state.setup.sheetEdits = [normalizeEdit({ id: 'a', page: 0, x: 300, y: 100, text: 'Fix', size: 9, cover: { w: 40, h: 14 } })];
  const ops = buildSheet(m.state, { practice: false }, measure).pages[0].ops;
  const n = ops.length;
  assert.equal(ops[n - 2].t, 'r'); assert.equal(ops[n - 2].fill, '#ffffff');
  assert.equal(ops[n - 1].s, 'Fix');
  const none = buildSheet(base().state, { practice: false }, measure).pages[0].ops;
  assert.equal(none.length, n - 2);
});

test('edits on another page do not leak onto page 1', () => {
  const m = base();
  m.state.setup.sheetEdits = [normalizeEdit({ id: 'a', page: 1, x: 300, y: 100, text: 'Hidden' })];
  const ops = buildSheet(m.state, { practice: false }, measure).pages[0].ops;
  assert.ok(!ops.some((o) => o.s === 'Hidden'));
});

test('edits render in both the SVG preview and the PDF without errors', async () => {
  const m = base();
  m.state.setup.sheetEdits = [normalizeEdit({ id: 'a', page: 0, x: 300, y: 100, text: 'Número é', size: 12, cover: { w: 30, h: 12 } }), normalizeEdit({ id: 'b', page: 0, x: 200, y: 200, text: '', cover: { w: 20, h: 10 } })];
  const sheet = buildSheet(m.state, { practice: false }, measure);
  assert.ok(pageToSVG(sheet.pages[0]).includes('Numero e'));
  const pdf = await renderPDF(PDFLib, sheet);
  assert.ok(pdf.length > 1000);
});

test('tapping finds the topmost edit and ignores empty space', () => {
  const edits = [normalizeEdit({ id: 'a', page: 0, x: 100, y: 100, text: 'One' }), normalizeEdit({ id: 'b', page: 0, x: 104, y: 100, text: 'Two' }), normalizeEdit({ id: 'c', page: 1, x: 100, y: 100, text: 'P2' })];
  assert.equal(hitTest(edits, 0, 102, 100).id, 'b');
  assert.equal(hitTest(edits, 1, 100, 100).id, 'c');
  assert.equal(hitTest(edits, 0, 500, 500), null);
  const b = editBox(edits[0]); assert.ok(b.w > 0 && b.h > 0);
});

test('normalizing clamps sizes and patch dimensions', () => {
  const e = normalizeEdit({ id: 'x', page: 0, x: 1.234, y: 2.345, text: 'a'.repeat(100), size: 99, cover: { w: 9999, h: 0 } });
  assert.equal(e.text.length, 60); assert.equal(e.size, 9); assert.equal(e.cover.w, 400); assert.ok(e.cover.h >= 6);
});
