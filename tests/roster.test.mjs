import test from 'node:test';
import assert from 'node:assert/strict';
import { parseRoster } from '../public/js/roster.js';

const sum = (t, ex) => parseRoster(t, ex).players.map((p) => `${p.number}|${p.name}|${p.libero ? 'L' : ''}`);

test('a plain list of numbers, with liberos', () => {
  assert.deepEqual(sum('1 4 7 9 10 12'), ['1||', '4||', '7||', '9||', '10||', '12||']);
  assert.deepEqual(sum('1 4 7L 9'), ['1||', '4||', '7||L', '9||']);
  assert.deepEqual(sum('3, 5, L12'), ['3||', '5||', '12||L']);
});
test('one player per line, number first or last', () => {
  assert.deepEqual(sum('12 Mia Lopez\n#7 - Lucy\n4. Ana\nSofia Reyes 9'), ['12|Mia Lopez|', '7|Lucy|', '4|Ana|', '9|Sofia Reyes|']);
});
test('spreadsheet rows (tab separated) and a libero word', () => {
  assert.deepEqual(sum('12\tMia Lopez\n7\tLucy\tLibero'), ['12|Mia Lopez|', '7|Lucy|L']);
  assert.deepEqual(sum('5 Ana (libero)'), ['5|Ana|L']);
});
test('duplicates and junk are skipped, not added', () => {
  const r = parseRoster('4 Ana\n4 Bea\nhello\n9', ['9']);
  assert.deepEqual(r.players.map((p) => p.number), ['4']);
  assert.equal(r.skipped.length, 3);
});
test('numbers over three digits are not players', () => {
  assert.equal(parseRoster('1234').players.length, 0);
});
