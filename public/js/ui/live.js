// The live game screen: scoreboard, big point buttons, stat buttons + court, tools.
// Designed around three questions: WHO got the point, HOW, and WHICH PLAYER.
import { h, toast, modal, confirmDialog, $ } from '../util.js';
import { store } from '../store.js';
import { sync } from '../sync.js';
import {
  cmd, courtOf, serverOf, benchOf, playerById, pLabel, describeEvent, activeEvents, other, ROMAN,
  STAT_LABELS, STAT_COLUMNS, setTarget,
} from '../engine/engine.js';
import { sheetModel, statRows, resultLine, sheetPDF, fileBase } from '../reports.js';
import { pageToSVG } from '../sheet/render.js';
import { shareOrDownload } from '../util.js';

const SIDES = ['home', 'away'];
const STAT_BTNS = [['ace', 'Ace'], ['kill', 'Kill'], ['assist', 'Assist'], ['dig', 'Dig'], ['block', 'Block'], ['err', 'Error']];
const ERR_TYPES = [['err_attack', 'Hit'], ['err_serve', 'Serve'], ['err_reception', 'Receive'], ['err_net', 'Net'], ['err_handling', 'Handling'], ['err_other', 'Other']];

export async function mount(root, { params }, ctx) {
  const id = params[0];
  const session = await ctx.session(id);
  if (!session) { ctx.go('/'); return null; }
  document.body.classList.add('live-mode');
  const rec = session.rec;
  const V = { arm: null, tab: 'home', lock: false, alertsSeen: session.S.alerts.length, wide: matchMedia('(min-width:1280px)').matches, miniToken: 0, overlayHidden: null, leaseMsg: null };
  const wideMq = matchMedia('(min-width:1280px)');
  const onWide = () => { V.wide = wideMq.matches; render(); };
  wideMq.addEventListener('change', onWide);

  // ---- scorekeeper lease (only one device scores a game at a time)
  let leaseTimer = null, pollTimer = null;
  async function claim(force = false) {
    if (rec.practice) return;
    const r = await sync.acquireLease(id, force);
    if (r.ok) { session.readOnly = false; V.leaseMsg = null; startHeartbeat(); stopPoll(); }
    else { session.readOnly = true; V.leaseMsg = r.lease ? r.lease.name : 'another device'; startPoll(); }
    render();
  }
  function startHeartbeat() {
    clearInterval(leaseTimer);
    leaseTimer = setInterval(async () => {
      const r = await sync.acquireLease(id, false);
      if (!r.ok) { session.readOnly = true; V.leaseMsg = r.lease ? r.lease.name : 'another device'; startPoll(); render(); }
    }, 40000);
  }
  function startPoll() {
    clearInterval(pollTimer);
    pollTimer = setInterval(async () => {
      const remote = await sync.remoteRev(id);
      if (!remote) return;
      if (remote.rev > (session.rec.rev || 0) && !session.rec.dirty) await sync.pull(id);
      if (!remote.lease) claim(false); // other device let go
    }, 5000);
  }
  function stopPoll() { clearInterval(pollTimer); }
  claim(false);

  const unsub = session.subscribe(() => render());

  // -------------------------------------------------------------- helpers
  const S = () => session.S;
  const name = (side) => rec.setup[side].name;
  const col = (side) => (side === 'home' ? 'var(--home)' : 'var(--away)');
  function cur() { return S().cur || S().last; }

  async function guarded(ev, { confirmTitle = 'Please check', confirmYes = 'Record it anyway' } = {}) {
    let r = await session.add(ev);
    if (r.needsConfirm) {
      const ok = await confirmDialog(confirmTitle, r.warnings.map((w) => w.message).join('\n\n'), { yes: confirmYes, no: 'Cancel' });
      if (!ok) return r;
      r = await session.add(ev, { override: true });
    }
    if (!r.ok && r.errors.length) toast(r.errors[0]);
    return r;
  }

  async function point(side) {
    if (V.lock) return;
    V.lock = true; setTimeout(() => { V.lock = false; }, 300);
    V.arm = null; V.tab = side;
    const r = await guarded(cmd.point(side), { confirmTitle: 'Check the stats', confirmYes: 'Give the point' });
    if (r.ok) { navigator.vibrate && navigator.vibrate(12); }
  }

  async function undo() {
    const last = session.lastActive();
    if (!last) { toast('Nothing to undo'); return; }
    const label = describeEvent(S(), last);
    const done = await session.undo();
    V.arm = null; V.overlayHidden = null;
    if (done) toast(`Undid: ${label}`, { action: { label: 'Redo', fn: () => session.redo() } });
  }

  // -------------------------------------------------------------- stats
  function press(side, kind) {
    if (session.readOnly) return;
    const a = V.arm;
    V.arm = a && a.side === side && a.kind === kind ? null : { side, kind, step: kind === 'err' ? 'errtype' : 'player' };
    V.tab = side;
    render();
  }
  async function chooseErr(side, errKind) { V.arm = { side, kind: 'err', errKind, step: 'player' }; render(); }

  async function pickPlayer(side, pid) {
    const a = V.arm;
    if (!a || a.side !== side) { if (pid) quickMenu(side, pid); return; }
    if (a.step === 'errtype') { toast('Pick the kind of error first'); return; }
    const kind = a.kind === 'err' ? a.errKind : a.kind;
    if (a.afterKill && pid === a.exclude) { toast('The player who hit it cannot assist'); return; }
    const r = await session.addStat(side, kind, pid);
    if (!r.ok) { if (r.errors && r.errors[0]) toast(r.errors[0]); V.arm = null; render(); return; }
    toast(`${STAT_LABELS[kind]} — ${pid ? pLabel(rec.setup, side, pid) : 'player not recorded'}`, { ms: 1800 });
    if (kind === 'kill' && pid) V.arm = { side, kind: 'assist', step: 'player', afterKill: true, exclude: pid };
    else V.arm = null;
    render();
  }

  function quickMenu(side, pid) {
    if (session.readOnly) return;
    const set = cur();
    const serving = set && set.serving === side && !set.over;
    const body = h('div', { class: 'menu' },
      STAT_BTNS.filter(([k]) => k !== 'ace' || serving).map(([k, l]) => h('button', { class: 'btn', onclick: () => { m.close(); if (k === 'err') errMenu(side, pid); else { V.arm = { side, kind: k, step: 'player' }; pickPlayer(side, pid); } } }, l)));
    const m = modal(body, { title: `What did ${pLabel(rec.setup, side, pid)} do?` });
  }
  function errMenu(side, pid) {
    const set = cur();
    const serving = set && set.serving === side;
    const m = modal(h('div', { class: 'menu' }, ERR_TYPES.filter(([k]) => (k !== 'err_serve' || serving) && (k !== 'err_reception' || !serving)).map(([k, l]) => h('button', { class: 'btn', onclick: () => { m.close(); V.arm = { side, kind: 'err', errKind: k, step: 'player' }; pickPlayer(side, pid); } }, l))), { title: 'What kind of error?' });
  }

  // -------------------------------------------------------------- tools
  async function timeout(side) {
    const r = await guarded(cmd.timeout(side), { confirmTitle: 'Time-out', confirmYes: 'Record it anyway' });
    if (r.ok) toast(`Time-out: ${name(side)} (${cur()[side].score}–${cur()[other(side)].score})`, { action: { label: 'Undo', fn: undo } });
  }

  function subDialog(side) {
    const set = S().cur;
    if (!set) return;
    const ts = set[side];
    let out = null;
    const body = h('div');
    const draw = () => {
      body.replaceChildren();
      if (!out) {
        body.append(h('p', { class: 'modal-text' }, 'Who is leaving the court?'),
          h('div', { class: 'pick' }, courtOf(set, side).filter((c) => !c.isLibero).map((c) => {
            const p = playerById(rec.setup, side, c.replaced);
            return h('button', { onclick: () => { out = c.replaced; draw(); } }, '#' + p.number, h('small', null, p.name || ROMAN[c.idx] + ' · pos ' + c.pos));
          })));
      } else {
        const bench = benchOf(S(), set, side).sort((a, b) => +a.number - +b.number);
        body.append(h('p', { class: 'modal-text' }, `Who is coming in for ${pLabel(rec.setup, side, out)}?`),
          bench.length ? h('div', { class: 'pick' }, bench.map((p) => h('button', { onclick: async () => {
            const r = await guarded(cmd.sub(side, out, p.id), { confirmTitle: 'Check this substitution', confirmYes: 'Referee approved — record it' });
            if (r.ok) { m.close(); toast(`Sub: ${pLabel(rec.setup, side, p.id, false)} in for ${pLabel(rec.setup, side, out, false)}`, { action: { label: 'Undo', fn: undo } }); }
            else if (r.errors && r.errors.length) m.close();
          } }, '#' + p.number, h('small', null, p.name || (ts.played.has(p.id) ? 'played' : 'bench'))))) : h('p', { class: 'muted' }, 'No players on the bench.'),
          h('button', { class: 'btn ghost', onclick: () => { out = null; draw(); } }, '← Back'));
      }
    };
    const m = modal(body, { title: `Substitution — ${name(side)}` });
    draw();
  }

  function liberoDialog(side) {
    const set = S().cur;
    if (!set) return;
    const ts = set[side];
    if (!ts.libero) { toast('This team has no libero in this set'); return; }
    const lp = playerById(rec.setup, side, ts.libero);
    if (ts.liberoIn !== null) {
      const back = playerById(rec.setup, side, ts.cur[ts.liberoIn]);
      const m = modal(h('div', null, h('p', { class: 'modal-text' }, `Libero #${lp.number} is in for #${back.number}.`),
        h('div', { class: 'modal-actions' }, h('button', { class: 'btn ghost', onclick: () => m.close() }, 'Cancel'),
          h('button', { class: 'btn primary', onclick: async () => { const r = await guarded(cmd.libero(side, 'out')); if (r.ok) m.close(); } }, `Libero out — #${back.number} returns`))), { title: 'Libero' });
      return;
    }
    const back = courtOf(set, side).filter((c) => c.back);
    const m = modal(h('div', null, h('p', { class: 'modal-text' }, `Libero #${lp.number} goes in for which back-row player?`),
      h('div', { class: 'pick' }, back.map((c) => { const p = playerById(rec.setup, side, c.replaced); return h('button', { onclick: async () => { const r = await guarded(cmd.libero(side, 'in', c.idx), { confirmTitle: 'Check the libero', confirmYes: 'Referee approved' }); if (r.ok) m.close(); } }, '#' + p.number, h('small', null, c.pos === 1 ? 'serving spot' : 'back row')); }))), { title: 'Libero in' });
  }

  function moreMenu() {
    const items = [
      ['Replay (rally played again)', () => guarded(cmd.replay('R'))],
      ['Re-serve', () => guarded(cmd.replay('RS'))],
      ['Penalty warning…', () => penaltyDialog('warning')],
      ['Penalty point…', () => penaltyDialog('point')],
      ['Add a note to the scoresheet', noteDialog],
      ['Game info (date, place, times)', infoDialog],
      ['History / fix something older', historyDialog],
    ];
    const m = modal(h('div', { class: 'menu' }, items.map(([l, fn]) => h('button', { class: 'btn', onclick: () => { m.close(); fn(); } }, l))), { title: 'More' });
  }
  function penaltyDialog(kind) {
    const m = modal(h('div', null, h('p', { class: 'modal-text' }, kind === 'point' ? 'Which team was penalized? The other team gets the point.' : 'Which team got the warning?'),
      h('div', { class: 'serve-pick' }, SIDES.map((s) => h('button', { class: s, onclick: async () => { m.close(); await guarded(cmd.penalty(s, kind)); } }, name(s))))), { title: kind === 'point' ? 'Penalty point' : 'Penalty warning' });
  }
  function noteDialog() {
    const t = h('textarea', { class: 'inp', placeholder: 'Type a short note (shows in Comments on the scoresheet)' });
    let team = null;
    const seg = h('div', { class: 'seg', style: { margin: '8px 0 12px' } });
    const drawSeg = () => seg.replaceChildren(...[[null, 'Both'], ['home', name('home')], ['away', name('away')]].map(([v, l]) => h('button', { class: team === v ? 'on' : '', onclick: () => { team = v; drawSeg(); } }, l)));
    drawSeg();
    const m = modal(h('div', null, t, seg, h('div', { class: 'modal-actions' }, h('button', { class: 'btn ghost', onclick: () => m.close() }, 'Cancel'),
      h('button', { class: 'btn primary', onclick: async () => { if (!t.value.trim()) return; const r = await guarded(cmd.comment(t.value.trim(), team)); if (r.ok) m.close(); } }, 'Save note'))), { title: 'Add a note' });
  }
  function infoDialog() {
    const s = rec.setup;
    const inp = (v, o = {}) => h('input', { class: 'inp', value: v || '', ...o });
    const date = inp(s.date, { type: 'date' }), site = inp(s.site), st = inp(s.startTime || S().startTime, { type: 'time' }), en = inp(s.endTime || S().endTime, { type: 'time' });
    const hn = inp(s.home.name), an = inp(s.away.name);
    const row = (l, i) => h('label', { class: 'field' }, h('span', null, l), i);
    const m = modal(h('div', null, row('Date', date), row('Location', site), row('Home team name', hn), row('Visiting team name', an), row('Start time', st), row('End time', en),
      h('div', { class: 'modal-actions' }, h('button', { class: 'btn ghost', onclick: () => m.close() }, 'Cancel'),
        h('button', { class: 'btn primary', onclick: async () => {
          rec.setup.home = { ...rec.setup.home, name: hn.value.trim() || rec.setup.home.name };
          rec.setup.away = { ...rec.setup.away, name: an.value.trim() || rec.setup.away.name };
          await session.updateSetup({ date: date.value, site: site.value.trim(), startTime: st.value || undefined, endTime: en.value || undefined });
          m.close();
        } }, 'Save'))), { title: 'Game info' });
  }

  function historyDialog() {
    const body = h('div');
    const drawH = () => {
      const act = activeEvents(session.rec.events);
      const rows = [...act].reverse().map((ev) => {
        const set = ev.type === 'set_start' ? null : null; void set;
        const isStat = ev.type === 'stat';
        return h('div', { class: 'row between', style: { padding: '8px 0', borderBottom: '1px solid var(--line)' } },
          h('div', { style: { flex: 1, minWidth: '180px' } }, describeEvent(S(), ev)),
          h('div', { class: 'btnrow' },
            isStat ? h('button', { class: 'btn small', onclick: () => changePlayer(ev) }, 'Change player') : null,
            ev.type === 'set_start' ? null : h('button', { class: 'btn small danger', onclick: async () => { const r = await session.removeEvent(ev.id); if (!r.ok) toast(r.reason, { ms: 5000 }); else { toast('Removed'); drawH(); } } }, 'Remove')));
      });
      body.replaceChildren(h('p', { class: 'muted' }, 'Newest first. Removing a play fixes the scoreboard, serving order, scoresheet and stats together. If later plays depend on it, undo those first.'), h('div', null, rows.length ? rows : h('p', null, 'Nothing recorded yet.')),
        h('div', { class: 'modal-actions', style: { marginTop: '12px' } }, h('button', { class: 'btn', onclick: () => m.close() }, 'Close')));
    };
    const m = modal(body, { title: 'History', class: 'wide' });
    drawH();
    function changePlayer(ev) {
      const side = ev.team;
      const entry = S().statList.find((x) => x.id === ev.id);
      const set = entry ? S().sets.find((x) => x.n === entry.set) : cur();
      const pick = h('div', { class: 'pick' }, [...(set ? set[side].played : [])].map((pid) => { const p = playerById(rec.setup, side, pid); return p ? h('button', { onclick: async () => {
        await session.removeEvent(ev.id);
        await session.add(cmd.stat(side, ev.kind, pid, entry ? entry.rally : null));
        mm.close(); drawH(); toast('Player changed');
      } }, '#' + p.number, h('small', null, p.name || '')) : null; }));
      const mm = modal(h('div', null, pick, h('button', { class: 'btn ghost', onclick: () => mm.close() }, 'Cancel')), { title: 'Which player?' });
    }
  }

  // -------------------------------------------------------------- views
  function topbar() {
    const last = session.lastActive();
    return h('div', { class: 'topbar' },
      h('button', { class: 'btn', onclick: () => ctx.go('/'), 'aria-label': 'Back to dashboard' }, '‹ ', h('span', { class: 'long' }, 'Home')),
      h('div', { class: 'title' }, rec.practice ? 'Practice · ' : '', (() => { const c = cur(); return c ? `Set ${c.n} · ` : ''; })(), `${name('home')} vs ${name('away')}`),
      h('button', { class: 'btn', 'data-tour': 'undo', disabled: !last || session.readOnly, onclick: undo, title: last ? 'Undo: ' + describeEvent(S(), last) : '' }, '↶ Undo'),
      session.canRedo() ? h('button', { class: 'btn', onclick: () => session.redo(), 'aria-label': 'Redo' }, '↷') : null,
      h('button', { class: 'btn hide-phone', onclick: historyDialog }, 'History'),
      h('button', { class: 'btn sheet', 'data-tour': 'view-sheet', onclick: () => ctx.go('/sheet/' + id) }, 'VIEW SCORESHEET'),
      h('button', { class: 'btn help', 'data-tour': 'help', onclick: () => ctx.help() }, '? Help'));
  }

  function banners() {
    const out = [];
    const s = S();
    if (rec.practice) out.push(h('div', { class: 'banner practice' }, h('span', { class: 'grow' }, 'PRACTICE GAME — sample teams. Nothing here changes your real games or stats.'),
      h('button', { class: 'btn small', onclick: async () => { await store.del('games', id); ctx.drop(id); ctx.go('/'); } }, 'Finish practice')));
    if (session.readOnly) out.push(h('div', { class: 'banner bad' }, h('span', { class: 'grow' }, `${V.leaseMsg || 'Another device'} is scoring this game. You are watching — changes appear here automatically.`),
      h('button', { class: 'btn small', onclick: () => claim(true) }, 'Take over scoring')));
    const c = s.cur;
    if (c && c.target === s.rules.decidingTarget && s.rules.bestOf === c.n && !c.switched && Math.max(c.home.score, c.away.score) >= 8)
      out.push(h('div', { class: 'banner info' }, h('span', { class: 'grow' }, 'Deciding set: the teams switch sides now (at 8 points).'), h('button', { class: 'btn small', onclick: () => session.add(cmd.sw()) }, 'Done')));
    if (s.alerts.length > V.alertsSeen) {
      const a = s.alerts[s.alerts.length - 1];
      out.push(h('div', { class: 'banner ' + (a.level === 'warn' ? 'warn' : 'info') }, h('span', { class: 'grow' }, a.message), h('button', { class: 'btn small', onclick: () => { V.alertsSeen = s.alerts.length; render(); } }, 'OK')));
    }
    return out;
  }

  function teamCard(side) {
    const set = cur();
    const ts = set[side];
    const serving = set.serving === side && !set.over;
    const sv = serverOf(set, side);
    const sp = playerById(rec.setup, side, sv.pid);
    const used = ts.timeouts.length, lim = S().rules.timeoutsPerSet;
    return h('div', { class: `tcard ${side}${serving ? ' serving' : ''}`, 'data-tour': 'score-' + side },
      h('div', { class: 'tn' }, h('span', null, name(side)), h('small', null, `Sets ${S().setsWon[side]}`)),
      h('div', { class: 'sc', 'aria-live': 'polite' }, ts.score),
      h('div', { class: 'meta' },
        serving ? h('span', { class: 'serve-chip', 'data-tour': 'server' }, `SERVING · #${sp ? sp.number : '?'} (${sv.roman})${sv.isLibero ? ' L' : ''}`)
          : h('span', { class: 'recv-chip' }, set.over ? 'Set over' : `Next server #${sp ? sp.number : '?'} (${sv.roman})`),
        h('span', { class: 'tdots', title: 'Time-outs used' }, Array.from({ length: Math.max(lim, used) }, (_, i) => h('i', { class: i < used ? 'used' : '' })), h('span', { style: { marginLeft: '6px' } }, `Subs ${ts.subs.length}`))));
  }

  function panel(side) {
    const set = cur();
    const ts = set[side];
    const court = courtOf(set, side);
    const byPos = (p) => court.find((c) => c.pos === p);
    const a = V.arm && V.arm.side === side ? V.arm : null;
    const serving = set.serving === side;
    const sv = serverOf(set, side);
    const chip = (c) => {
      const p = playerById(rec.setup, side, c.pid);
      const isServer = serving && c.pos === 1;
      const dis = a && a.afterKill && c.pid === a.exclude;
      return h('button', { class: 'pl' + (isServer ? ' server' : '') + (a && a.kind === 'ace' && isServer ? ' ace' : ''), disabled: !!dis, style: dis ? { opacity: .35 } : null, onclick: () => pickPlayer(side, c.pid), 'aria-label': `Player ${p ? p.number : ''}` },
        h('span', { class: 'ro' }, ROMAN[c.idx]), isServer ? h('span', { class: 'star' }, '★') : null,
        h('span', { class: 'num' }, p ? p.number : '?'), h('span', { class: 'nm' }, p && p.name ? p.name : ' '),
        c.isLibero ? h('span', { class: 'lb' }, 'L') : null);
    };
    const hint = a ? (a.step === 'errtype' ? 'What kind of error?' : a.afterKill ? 'Who made the assist?' : `${a.kind === 'err' ? STAT_LABELS[a.errKind] : STAT_LABELS[a.kind]} — tap the player`) : null;
    return h('section', { class: `panel ${side}${a ? ' armed' : ''}${V.tab !== side ? ' hidden-tab' : ''}`, 'data-tour': 'panel-' + side },
      h('h3', null, h('span', null, name(side)), h('small', null, 'Tap what happened, then the player')),
      h('div', { class: 'statbtns', 'data-tour': 'stats-' + side }, STAT_BTNS.map(([k, l]) => {
        const off = (k === 'ace' && !(serving && !set.over)) || session.readOnly;
        return h('button', { class: 'sbtn' + (a && a.kind === k ? ' on' : ''), disabled: off, style: off ? { opacity: .4 } : null, onclick: () => press(side, k) }, l);
      })),
      a && a.step === 'errtype' ? h('div', { class: 'errtypes' }, ERR_TYPES.filter(([k]) => (k !== 'err_serve' || serving) && (k !== 'err_reception' || !serving)).map(([k, l]) => h('button', { class: 'sbtn', onclick: () => chooseErr(side, k) }, l))) : null,
      hint ? h('div', { class: 'hint' }, h('span', { class: 'grow' }, hint),
        a.step === 'player' ? h('button', { class: 'btn small', onclick: () => pickPlayer(side, null) }, a.afterKill ? 'No assist' : 'Not sure') : null,
        h('button', { class: 'btn small ghost', onclick: () => { V.arm = null; render(); } }, 'Cancel')) : null,
      h('div', { class: 'court', 'data-tour': 'court-' + side },
        [4, 3, 2].map((p) => chip(byPos(p))), h('div', { class: 'net' }, '— NET —'), [5, 6, 1].map((p) => chip(byPos(p)))),
      h('div', { class: 'tools', 'data-tour': 'tools-' + side },
        h('button', { class: 'btn', 'data-tour': 'timeout-' + side, disabled: session.readOnly || set.over, onclick: () => timeout(side) }, '⏱ Time-out'),
        h('button', { class: 'btn', 'data-tour': 'sub-' + side, disabled: session.readOnly || set.over, onclick: () => subDialog(side) }, '⇄ Sub'),
        h('button', { class: 'btn', disabled: session.readOnly || set.over || !ts.libero, onclick: () => liberoDialog(side) }, 'Libero' + (ts.liberoIn !== null ? ' ●' : ''))));
  }

  function mainCol() {
    const set = cur();
    const s = S();
    const last = session.lastActive();
    return h('div', { class: 'main-col' },
      h('div', { class: 'scoreboard' }, teamCard('home'), teamCard('away')),
      h('div', { class: 'pointbtns', 'data-tour': 'points' }, SIDES.map((side) => h('button', { class: 'pbtn ' + side, 'data-tour': 'point-' + side, disabled: !s.cur || session.readOnly, onclick: () => point(side) }, `POINT`, h('span', null, name(side)), h('small', null, 'Tap when they win the rally')))),
      h('div', { class: 'laststrip' }, h('span', { class: 'grow' }, last ? 'Last: ' + describeEvent(s, last) : 'No plays yet — tap a POINT button when a team wins a rally'),
        h('button', { class: 'btn small', onclick: moreMenu }, 'More ⋯')),
      h('div', { class: 'tabs' }, SIDES.map((side) => h('button', { class: `tab ${side}${V.tab === side ? ' on' : ''}`, onclick: () => { V.tab = side; render(); } }, name(side)))),
      h('div', { class: 'panels' }, panel('home'), panel('away')));
  }

  function aside() {
    const wrap = h('aside', { class: 'aside' });
    if (!V.wide) return wrap;
    const s = S();
    const tbl = (side) => {
      const rows = statRows(s, side).filter((r) => r.number === '-' || r.points || r.assists || r.digs || r.serveErr || r.attackErr || r.receptionErr || r.otherErr || r.serveAtt);
      return h('div', { class: 'card' }, h('h3', { style: { color: side === 'home' ? 'var(--home)' : 'var(--away)', marginBottom: '6px' } }, name(side), ' — live stats'),
        h('div', { class: 'scroll-x' }, h('table', { class: 'stats' },
          h('thead', null, h('tr', null, ['#', 'Pts', 'K', 'Ace', 'Blk', 'Ast', 'Dig', 'Err'].map((t) => h('th', null, t)))),
          h('tbody', null, rows.length ? rows.map((r) => h('tr', null, h('td', null, r.number === '-' ? '?' : '#' + r.number), h('td', null, r.points), h('td', null, r.kills), h('td', null, r.aces), h('td', null, r.blocks + r.blockAssists), h('td', null, r.assists), h('td', null, r.digs), h('td', null, r.serveErr + r.attackErr + r.receptionErr + r.otherErr))) : h('tr', null, h('td', { colspan: 8, class: 'muted' }, 'Stats appear here as you record them'))))));
    };
    const mini = h('div', { class: 'mini-sheet', id: 'mini-sheet' }, h('div', { class: 'muted' }, 'Loading scoresheet…'));
    wrap.append(tbl('home'), tbl('away'), h('div', { class: 'card' }, h('div', { class: 'row between', style: { marginBottom: '6px' } }, h('h3', { style: { color: 'var(--navy)' } }, 'Scoresheet (live)'), h('button', { class: 'btn small', onclick: () => ctx.go('/sheet/' + id) }, 'Open full size')), mini));
    updateMini();
    return wrap;
  }
  async function updateMini() {
    const token = ++V.miniToken;
    try {
      const { sheet } = await sheetModel(rec, S());
      if (token !== V.miniToken) return;
      const c = cur();
      const n = c ? c.n : 1;
      const page = sheet.pages[Math.floor((n - 1) / 3)] || sheet.pages[0];
      const b = (n - 1) % 3;
      const svg = pageToSVG(page, { viewBox: `14 ${36 + b * 160} 764 162`, label: `Scoresheet set ${n}` });
      const el = $('#mini-sheet');
      if (el) el.innerHTML = svg;
    } catch (e) { console.warn('mini sheet', e); }
  }

  function overlay() {
    const s = S();
    const set = s.last;
    if (!set || !set.over || V.overlayHidden === set.n + ':' + s.eventCount) return null;
    const w = set.winner;
    if (s.matchOver) {
      return h('div', { class: 'overlay-card' }, h('div', { class: 'box' },
        h('h2', null, `${name(s.winner)} win the match!`),
        h('div', { class: 'big-score' }, `${s.setsWon.home} – ${s.setsWon.away}`),
        h('p', { class: 'muted' }, resultLine(s)),
        h('div', { class: 'stack' },
          h('button', { class: 'btn dl block', onclick: () => downloadPDF() }, 'DOWNLOAD COMPLETED SCORESHEET'),
          h('button', { class: 'btn big block', 'data-tour': 'view-sheet-2', onclick: () => ctx.go('/sheet/' + id) }, 'View scoresheet'),
          h('button', { class: 'btn block', onclick: () => ctx.go('/stats/' + id) }, 'Player stats'),
          h('button', { class: 'btn ghost block', onclick: undo }, 'Oops — undo the last play'),
          h('button', { class: 'btn ghost block', onclick: () => ctx.go('/') }, 'Back to dashboard'))));
    }
    return h('div', { class: 'overlay-card' }, h('div', { class: 'box' },
      h('h2', null, `Set ${set.n} is over`), h('div', { class: 'big-score' }, `${set.home.score} – ${set.away.score}`),
      h('p', null, `${name(w)} win the set. Sets: ${s.setsWon.home}–${s.setsWon.away}.`),
      h('div', { class: 'stack' },
        h('button', { class: 'btn primary big block', onclick: () => ctx.go('/lineup/' + id) }, `Start set ${set.n + 1}`),
        h('button', { class: 'btn block', onclick: () => ctx.go('/sheet/' + id) }, 'View scoresheet'),
        h('button', { class: 'btn ghost block', onclick: undo }, 'Oops — undo the last point'))));
  }

  async function downloadPDF() {
    try {
      toast('Making your PDF…', { ms: 1500 });
      const bytes = await sheetPDF(rec);
      await shareOrDownload(new Blob([bytes], { type: 'application/pdf' }), fileBase(rec) + '-scoresheet.pdf', 'Volleyball scoresheet');
    } catch (e) { console.error(e); toast('Could not make the PDF: ' + e.message, { ms: 6000 }); }
  }

  function render() {
    const s = S();
    const children = [topbar(), ...banners()];
    if (!cur()) {
      children.push(h('div', { class: 'card span-all' }, h('h2', null, 'Ready to start'), h('p', null, 'Choose the starting lineups to begin set 1.'), h('button', { class: 'btn primary big', onclick: () => ctx.go('/lineup/' + id) }, 'Choose lineups')));
    } else {
      if (!s.cur && !s.matchOver) { /* between sets: overlay handles it */ }
      children.push(mainCol(), aside());
    }
    const ov = overlay();
    const prevScroll = globalThis.scrollY;
    root.replaceChildren(h('div', { class: 'live' }, ...children), ...(ov ? [ov] : []));
    globalThis.scrollTo(0, prevScroll);
    V.alertsSeen = Math.max(V.alertsSeen, 0);
    globalThis.dispatchEvent(new CustomEvent('vb-rendered'));
  }
  // dismiss overlay by remembering state
  root.addEventListener('click', (e) => { const set = S().last; if (e.target.classList && e.target.classList.contains('overlay-card') && set) { V.overlayHidden = set.n + ':' + S().eventCount; render(); } });

  render();
  if (ctx.openHistory) { ctx.openHistory = false; setTimeout(historyDialog, 80); }
  return () => {
    unsub(); clearInterval(leaseTimer); clearInterval(pollTimer);
    wideMq.removeEventListener('change', onWide);
    document.body.classList.remove('live-mode');
    session.readOnly = false;
    sync.releaseLease(id);
  };
}
void STAT_COLUMNS; void setTarget;
