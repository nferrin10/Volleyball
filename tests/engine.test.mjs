import test from 'node:test';
import assert from 'node:assert/strict';
import { buildState, cmd, validate, courtOf, serverOf, previewVoid, other } from '../public/js/engine/engine.js';
import { mkSetup, startSet } from './helpers.mjs';

const setup = mkSetup();
const run = (events, s = setup) => buildState(s, events);

test('serving team scores: server stays, cell goes on server row', () => {
  const ev = [startSet('home'), cmd.point('home'), cmd.point('home'), cmd.point('home')];
  const S = run(ev);
  const set = S.cur;
  assert.equal(set.home.score, 3);
  assert.equal(set.serving, 'home');
  assert.equal(set.home.srv, 0);
  assert.deepEqual(set.home.rows[0].map((c) => c.n), [1, 2, 3]);
  assert.ok(set.home.rows[0].every((c) => !c.box));
});

test('side-out: loss mark on old server row, boxed point on NEXT server row, rotation', () => {
  const ev = [startSet('home'), cmd.point('home'), cmd.point('away')];
  const S = run(ev);
  const set = S.cur;
  assert.deepEqual(set.home.rows[0].map((c) => c.k), ['pt', 'loss']);
  assert.equal(set.away.srv, 1);           // away rotated I -> II
  assert.equal(set.serving, 'away');
  assert.deepEqual(set.away.rows[1].map((c) => [c.k, c.n, c.box]), [['pt', 1, true]]);
  assert.equal(set.away.run[0].box, true);
  assert.equal(serverOf(set, 'away').pid, 'a2');
  assert.equal(serverOf(set, 'home').idx, 1); // home's next server is II
});

test('first server loses without scoring: only a loss mark', () => {
  const S = run([startSet('away'), cmd.point('home')]);
  assert.deepEqual(S.cur.away.rows[0].map((c) => c.k), ['loss']);
  assert.equal(S.cur.home.srv, 1);
});

test('full rotation returns to server I after six side-outs', () => {
  const ev = [startSet('home')];
  let t = 'away';
  for (let i = 0; i < 12; i++) { ev.push(cmd.point(t)); t = other(t); }
  const S = run(ev);
  assert.equal(S.cur.home.srv, 6 % 6);
  assert.equal(S.cur.away.srv, 0);
});

test('set ends at 25 win by 2, and not before', () => {
  const ev = [startSet('home')];
  for (let i = 0; i < 24; i++) ev.push(cmd.point('home'));
  for (let i = 0; i < 24; i++) ev.push(cmd.point('away'));
  assert.equal(run(ev).cur.n, 1);          // 24-24, still going
  ev.push(cmd.point('home'));               // 25-24
  assert.equal(run(ev).cur.over ?? false, false);
  ev.push(cmd.point('home'));               // 26-24
  const S = run(ev);
  assert.equal(S.cur, null);
  assert.equal(S.sets[0].over, true);
  assert.equal(S.sets[0].winner, 'home');
  assert.equal(S.setsWon.home, 1);
});

test('match over after three set wins, deciding set goes to 15', () => {
  const ev = [];
  const win = (side, to) => { for (let i = 0; i < to; i++) ev.push(cmd.point(side)); };
  ev.push(startSet('home')); win('home', 25);
  ev.push(startSet('away')); win('away', 25);
  ev.push(startSet('home')); win('home', 25);
  ev.push(startSet('away')); win('away', 25);
  let S = run(ev);
  assert.equal(S.setsWon.home, 2); assert.equal(S.matchOver, false);
  ev.push(startSet('home')); win('away', 14); win('home', 14);
  assert.equal(run(ev).cur.target, 15);
  win('home', 1);  assert.equal(run(ev).cur.over ?? false, false); // 15-14 not enough
  win('home', 1);
  S = run(ev);
  assert.equal(S.matchOver, true); assert.equal(S.winner, 'home');
  assert.equal(validate(S, cmd.point('home')).errors.length, 1);
});

test('undo is an appended void; redo is a void of the void', () => {
  const p1 = cmd.point('home'), p2 = cmd.point('away');
  const ev = [startSet('home'), p1, p2];
  assert.equal(run(ev).cur.away.score, 1);
  const u = cmd.void(p2.id);
  ev.push(u);
  assert.equal(run(ev).cur.away.score, 0);
  assert.equal(run(ev).cur.serving, 'home');
  ev.push(cmd.void(u.id));
  assert.equal(run(ev).cur.away.score, 1);
});

test('stats attach to the rally, never add points; pending stats resolve at next point', () => {
  const kill = cmd.stat('home', 'kill', 'h4');
  const ast = cmd.stat('home', 'assist', 'h2');
  const dig = cmd.stat('away', 'dig', 'a5');
  const ev = [startSet('home'), dig, kill, ast, cmd.point('home')];
  let S = run(ev);
  assert.equal(S.cur.home.score, 1);
  assert.equal(S.rallies[0].how, 'kill');
  assert.equal(S.stats.home.h4.kills, 1);
  assert.equal(S.stats.home.h2.assists, 1);
  assert.equal(S.stats.away.a5.digs, 1);
  // after the point: stat that names the rally
  const ev2 = [startSet('home'), cmd.point('home')];
  const rid = ev2[1].id;
  ev2.push(cmd.stat('home', 'ace', 'h1', rid));
  S = run(ev2);
  assert.equal(S.rallies[0].how, 'ace');
  assert.equal(S.cur.home.score, 1);
  assert.equal(S.stats.home.h1.aces, 1);
  assert.equal(S.stats.home.h1.serveAtt, 1);
});

test('inconsistent stats are ignored with an alert (kill for team that lost the point)', () => {
  const ev = [startSet('home'), cmd.stat('home', 'kill', 'h4'), cmd.point('away')];
  const S = run(ev);
  assert.equal(S.stats.home.h4.kills, 0);
  assert.ok(S.alerts.some((a) => /Ignored Kill/.test(a.message)));
});

test('unknown player is stored as unassigned, never guessed', () => {
  const S = run([startSet('home'), cmd.stat('home', 'dig', null)]);
  assert.equal(S.stats.home._unassigned.digs, 1);
});

test('error stat belongs to losing team and tags how=error', () => {
  const pt = cmd.point('home');
  const S = run([startSet('home'), pt, cmd.stat('away', 'err_attack', 'a3', pt.id)]);
  assert.equal(S.rallies[0].how, 'error');
  assert.equal(S.stats.away.a3.attackErr, 1);
});

test('blocks: one blocker = solo, two = assists', () => {
  const pt = cmd.point('home');
  const S = run([startSet('home'), pt, cmd.stat('home', 'block', 'h3', pt.id), cmd.stat('home', 'block', 'h4', pt.id)]);
  assert.equal(S.stats.home.h3.blockAssists, 1);
  assert.equal(S.stats.home.h4.blockAssists, 1);
  assert.equal(S.stats.home.h3.blocks, 0);
});

test('timeouts: recorded with score; limit is a warning, not a block', () => {
  let ev = [startSet('home'), cmd.point('home'), cmd.timeout('away')];
  let S = run(ev);
  assert.equal(S.cur.away.timeouts[0].score, '0-1');
  ev.push(cmd.timeout('away'));
  S = run(ev);
  const v = validate(S, cmd.timeout('away'));
  assert.equal(v.errors.length, 0);
  assert.equal(v.warnings[0].code, 'timeout-limit');
});

test('substitution: legal, illegal re-entry warns, starter may return', () => {
  let ev = [startSet('home')];
  let S = run(ev);
  assert.equal(validate(S, cmd.sub('home', 'h1', 'h7')).warnings.length, 0);
  ev.push(cmd.sub('home', 'h1', 'h7'));
  S = run(ev);
  assert.equal(S.cur.home.cur[0], 'h7');
  assert.equal(S.cur.home.subs[0].n, 1);
  // another sub replacing h7 with h8: not the starter -> warning
  assert.equal(validate(S, cmd.sub('home', 'h7', 'h8')).warnings[0].code, 'reentry');
  // starter returns: fine
  assert.equal(validate(S, cmd.sub('home', 'h7', 'h1')).warnings.length, 0);
  ev.push(cmd.sub('home', 'h7', 'h1'));
  S = run(ev);
  assert.equal(S.cur.home.reentered[0], true);
  // h7 trying to enter for h2 -> already played
  assert.equal(validate(S, cmd.sub('home', 'h2', 'h7')).warnings[0].code, 'reentry');
  // player on court can't be subbed in
  assert.ok(validate(S, cmd.sub('home', 'h2', 'h3')).errors.length > 0);
});

test('libero: back row only, leaves automatically when rotated to the front', () => {
  let ev = [startSet('home')];
  let S = run(ev);
  // positions: idx0=1(back),idx1=2(front),idx2=3,idx3=4,idx4=5(back),idx5=6(back)
  assert.ok(validate(S, cmd.libero('home', 'in', 1)).errors.length > 0);
  ev.push(cmd.libero('home', 'in', 4)); // idx4 is at position 5
  S = run(ev);
  assert.equal(courtOf(S.cur, 'home')[4].pid, 'hL');
  // home loses serve then wins it back: rotation 1 step -> idx4 moves from pos 5 to pos 4 (front)
  ev.push(cmd.point('away'), cmd.point('home'));
  S = run(ev);
  assert.equal(S.cur.home.srv, 1);
  assert.equal(S.cur.home.liberoIn, null);
  assert.ok(S.alerts.some((a) => /libero left/.test(a.message)));
});

test('libero serving: triangle on cells and flagged slot', () => {
  let ev = [startSet('home'), cmd.libero('home', 'in', 0), cmd.point('home')];
  const S = run(ev);
  assert.equal(S.cur.home.rows[0][0].tri, true);
  assert.ok(S.cur.home.liberoSlots.has(0));
  assert.equal(S.rallies[0].server.pid, 'hL');
});

test('penalty point and replay markers', () => {
  const S = run([startSet('home'), cmd.penalty('home', 'point'), cmd.replay('R')]);
  assert.equal(S.cur.away.score, 1);
  assert.equal(S.cur.serving, 'away');
  const homeRow0 = S.cur.home.rows[0].map((c) => c.txt || c.k);
  assert.deepEqual(homeRow0, ['P', 'loss']);
  assert.deepEqual(S.cur.home.rows[1].map((c) => c.txt), ['R']); // home is now receiving: next server is II
  const awayRow = S.cur.away.rows[1].map((c) => c.txt || (c.k + (c.tag || '')));
  assert.deepEqual(awayRow, ['Px', 'ptP3', 'R']);
});

test('previewVoid detects dependent events', () => {
  const sub = cmd.sub('home', 'h1', 'h7');
  const ev = [startSet('home'), sub, cmd.sub('home', 'h7', 'h1')];
  const r = previewVoid(setup, ev, sub.id);
  assert.ok(r.newInvalid.length > 0);
});

test('events are plain JSON (sync safe)', () => {
  const ev = [startSet('home'), cmd.point('home')];
  assert.deepEqual(JSON.parse(JSON.stringify(ev)), ev);
});
