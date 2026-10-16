// Volleyball Game Day — scoring engine.
//
// The ONLY source of truth is the append-only list of events. Everything the app
// shows (scoreboard, serving order, scoresheet marks, player stats, history) is
// derived by replaying that list with buildState(). Nothing here guesses: a
// stat with no known player is stored with player = null, and rule problems are
// reported as warnings the operator must confirm (override) — never decided
// silently.

export const DEFAULT_RULES = {
  bestOf: 5,              // NFHS high school: best 3 of 5 (use 3 for best 2 of 3)
  setTarget: 25,          // sets 1..bestOf-1
  decidingTarget: 15,     // final possible set
  winBy: 2,
  cap: null,              // NFHS has no cap; some state associations do
  timeoutsPerSet: 2,
  subsPerSet: 18,         // matches the "Subs 1-18" line on the sheet. Check your state association.
  liberoMayServe: true,   // NFHS lets the libero serve, in ONE rotation position only
  alternateSheetSides: false,
};

export const ROMAN = ['I', 'II', 'III', 'IV', 'V', 'VI'];
export const SIDES = ['home', 'away'];
export const other = (s) => (s === 'home' ? 'away' : 'home');

// Stats that explain HOW a rally ended. They never change the score.
export const POINT_KINDS = ['ace', 'kill', 'block', 'err_attack', 'err_serve', 'err_reception', 'err_net', 'err_handling', 'err_other'];
const WINNER_KINDS = new Set(['ace', 'kill', 'block']);
const ERROR_KINDS = new Set(['err_attack', 'err_serve', 'err_reception', 'err_net', 'err_handling', 'err_other']);
export const isPointKind = (k) => WINNER_KINDS.has(k) || ERROR_KINDS.has(k);
export const ALL_STAT_KINDS = [...POINT_KINDS, 'assist', 'dig'];

export const STAT_LABELS = {
  ace: 'Ace', kill: 'Kill', block: 'Block', assist: 'Assist', dig: 'Dig',
  err_attack: 'Hitting error', err_serve: 'Serve error', err_reception: 'Receive error',
  err_net: 'Net', err_handling: 'Ball handling', err_other: 'Other error',
};

let counter = 0;
export function uid() {
  counter = (counter + 1) % 1e6;
  return Date.now().toString(36) + counter.toString(36) + Math.random().toString(36).slice(2, 6);
}
export function nowHHMM(d = new Date()) {
  return String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');
}

export function rulesOf(setup) {
  return { ...DEFAULT_RULES, ...((setup && setup.rules) || {}) };
}

// ---------------------------------------------------------------- state build

function newTeamSet(side, spec) {
  const order = spec.order.slice(0, 6);
  return {
    side,
    order,                 // serve order I..VI as original starters
    start: order.slice(),
    cur: order.slice(),    // who currently holds each serve-order slot (before libero)
    reentered: Array(6).fill(false),
    played: new Set(order),
    libero: spec.libero || null,
    liberoIn: null,        // serve-order index the libero is currently replacing
    liberoServeIdx: null,  // the one slot the libero has served from
    liberoSlots: new Set(),
    captain: spec.captain || null,
    srv: 0,                // serve-order index of the player in position 1 (right back)
    score: 0,
    timeouts: [],          // {score:'own-opp'}
    subs: [],              // {n, idx, out, in, own, opp}
    rows: [[], [], [], [], [], []],
    run: [],               // running score marks, index = point-1
    comments: [],
    notes: [],             // short automatic remarks for the Comments line
  };
}

export function newState(setup) {
  return {
    setup,
    rules: rulesOf(setup),
    sets: [],
    cur: null,            // active (not finished) set, or null
    last: null,           // latest set (finished or not)
    setsWon: { home: 0, away: 0 },
    matchOver: false,
    winner: null,
    pending: [],          // point-type stats waiting for the next rally
    statList: [],         // every accepted stat {id,set,side,kind,pid,rally}
    rallies: [],          // all rallies, all sets
    alerts: [],
    invalid: [],          // events that could not be applied
    stats: { home: {}, away: {} },
    startTime: null,
    endTime: null,
    eventCount: 0,
  };
}

export function activeEvents(events) {
  const voided = new Set();
  for (let i = events.length - 1; i >= 0; i--) {
    const e = events[i];
    if (e.type === 'void' && !voided.has(e.id)) voided.add(e.target);
  }
  return events.filter((e) => e.type !== 'void' && !voided.has(e.id));
}

export function buildState(setup, events) {
  const S = newState(setup);
  const act = activeEvents(events || []);
  for (const ev of act) {
    const res = applyEvent(S, ev);
    if (res && res.error) S.invalid.push({ id: ev.id, type: ev.type, reason: res.error });
  }
  S.eventCount = act.length;
  finalizeStats(S);
  return S;
}

// ------------------------------------------------------------- derived views

export function setTarget(S, n) {
  return n >= S.rules.bestOf ? S.rules.decidingTarget : S.rules.setTarget;
}

export function positionOf(ts, idx) { return ((idx - ts.srv + 6) % 6) + 1; }
export const isBackRow = (pos) => pos === 1 || pos === 5 || pos === 6;

export function playerAt(ts, idx) {
  return ts.liberoIn === idx ? ts.libero : ts.cur[idx];
}

// Six court positions 1..6 for a team in the current set.
export function courtOf(set, side) {
  const ts = set[side];
  const out = [];
  for (let p = 1; p <= 6; p++) {
    const idx = (ts.srv + p - 1) % 6;
    out.push({ pos: p, idx, roman: ROMAN[idx], pid: playerAt(ts, idx), isLibero: ts.liberoIn === idx, replaced: ts.cur[idx], back: isBackRow(p) });
  }
  return out;
}

export function serverOf(set, side) {
  const ts = set[side];
  const idx = side === set.serving ? ts.srv : (ts.srv + 1) % 6;
  return { idx, roman: ROMAN[idx], pid: playerAt(ts, idx), isLibero: ts.liberoIn === idx, serving: side === set.serving };
}

export function benchOf(S, set, side) {
  const ts = set[side];
  const onCourt = new Set(ts.cur);
  return S.setup[side].players.filter((p) => !p.libero && !onCourt.has(p.id));
}

export function playerById(setup, side, pid) {
  return pid ? setup[side].players.find((p) => p.id === pid) || null : null;
}
export function pLabel(setup, side, pid, withName = true) {
  const p = playerById(setup, side, pid);
  if (!p) return 'unknown player';
  return withName && p.name ? `#${p.number} ${p.name}` : `#${p.number}`;
}

// ------------------------------------------------------------------ applying

function alert(S, level, message, ev) {
  S.alerts.push({ level, message, event: ev ? ev.id : null });
}

function addCell(ts, row, cell) { ts.rows[row].push(cell); }
function pointerRow(set, side) {
  const ts = set[side];
  return side === set.serving ? ts.srv : (ts.srv + 1) % 6;
}
function mark(set, side, txt, tag) {
  // Marker for the acting team, and its opponent marker (x) on the other grid.
  addCell(set[side], pointerRow(set, side), { k: 'mk', txt, tag: tag || null });
}

function applyEvent(S, ev) {
  switch (ev.type) {
    case 'set_start': return applySetStart(S, ev);
    case 'rally': return applyRally(S, ev);
    case 'stat': return applyStat(S, ev);
    case 'timeout': return applyTimeout(S, ev);
    case 'sub': return applySub(S, ev);
    case 'libero': return applyLibero(S, ev);
    case 'penalty': return applyPenalty(S, ev);
    case 'replay': return applyReplay(S, ev);
    case 'comment': return applyComment(S, ev);
    case 'switch': if (S.cur) S.cur.switched = true; return null;
    default: return { error: 'unknown event type ' + ev.type };
  }
}

function applySetStart(S, ev) {
  if (S.matchOver) return { error: 'match is already over' };
  if (S.cur) return { error: 'previous set is not finished' };
  const n = S.sets.length + 1;
  const check = checkLineup(S.setup, ev);
  if (check) return { error: check };
  const set = {
    n,
    index: n - 1,
    target: setTarget(S, n),
    firstServe: ev.firstServe,
    serving: ev.firstServe,
    home: newTeamSet('home', ev.home),
    away: newTeamSet('away', ev.away),
    rallies: [],
    over: false,
    winner: null,
    switched: false,
    startTime: ev.time || null,
    endTime: null,
    startEvent: ev.id,
  };
  S.sets.push(set);
  S.cur = set;
  S.last = set;
  S.pending = [];
  if (!S.startTime && ev.time) S.startTime = ev.time;
  return null;
}

export function checkLineup(setup, ev) {
  for (const side of SIDES) {
    const spec = ev[side];
    if (!spec || !Array.isArray(spec.order) || spec.order.length !== 6) return `${side}: pick six starting players`;
    if (new Set(spec.order).size !== 6) return `${side}: a player is listed twice`;
    for (const pid of spec.order) {
      const p = playerById(setup, side, pid);
      if (!p) return `${side}: unknown player`;
      if (p.libero) return `${side}: the libero cannot be in the serve order`;
    }
    if (spec.libero) {
      const l = playerById(setup, side, spec.libero);
      if (!l || !l.libero) return `${side}: libero must be a player marked as libero`;
    }
  }
  if (!SIDES.includes(ev.firstServe)) return 'choose which team serves first';
  return null;
}

function setScore(set) { return { home: set.home.score, away: set.away.score }; }

function awardPoint(S, set, winner, ev, tag) {
  const loser = other(winner);
  const W = set[winner], L = set[loser];
  const sideout = set.serving !== winner;
  const serverSide = set.serving;
  const serverInfo = serverOf(set, serverSide);
  const rally = {
    id: ev.id, set: set.n, num: set.rallies.length + 1, winner, sideout,
    server: { side: serverSide, pid: serverInfo.pid, idx: serverInfo.idx, isLibero: serverInfo.isLibero },
    how: 'point', stats: [], penalty: !!tag, time: ev.time || null,
    scoreBefore: setScore(set),
  };
  if (!sideout) {
    W.score++;
    const lib = W.liberoIn === W.srv;
    if (lib) { W.liberoSlots.add(W.srv); noteLiberoServe(S, W, ev); }
    addCell(W, W.srv, { k: 'pt', n: W.score, box: false, tri: lib, tag: tag || null });
    W.run[W.score - 1] = { box: false };
  } else {
    addCell(L, L.srv, { k: 'loss' });
    W.srv = (W.srv + 1) % 6;
    W.score++;
    // Libero must leave when rotating into the front row.
    if (W.liberoIn !== null && !isBackRow(positionOf(W, W.liberoIn))) {
      W.liberoIn = null;
      alert(S, 'info', `${S.setup[winner].name}: libero left the court because of the rotation to the front row`, ev);
    }
    const lib = W.liberoIn === W.srv;
    if (lib) { W.liberoSlots.add(W.srv); noteLiberoServe(S, W, ev); }
    addCell(W, W.srv, { k: 'pt', n: W.score, box: true, tri: lib, tag: tag || null });
    W.run[W.score - 1] = { box: true };
    set.serving = winner;
  }
  rally.scoreAfter = setScore(set);
  set.rallies.push(rally);
  S.rallies.push(rally);
  checkSetEnd(S, set, ev, winner);
  return rally;
}

function noteLiberoServe(S, ts, ev) {
  if (ts.liberoServeIdx === null) ts.liberoServeIdx = ts.srv;
  else if (ts.liberoServeIdx !== ts.srv) {
    alert(S, 'warn', `${S.setup[ts.side].name}: the libero is serving from a second rotation position. NFHS allows the libero to serve from only one position — check with the referee.`, ev);
  }
}

function checkSetEnd(S, set, ev, winner) {
  const a = set.home.score, b = set.away.score;
  const hi = Math.max(a, b), lo = Math.min(a, b);
  const { winBy, cap } = S.rules;
  const reached = hi >= set.target && hi - lo >= winBy;
  const capped = cap && hi >= cap;
  if (reached || capped) {
    set.over = true;
    set.winner = a > b ? 'home' : 'away';
    set.endTime = ev.time || null;
    S.setsWon[set.winner]++;
    S.cur = null;
    const need = Math.ceil(S.rules.bestOf / 2);
    if (S.setsWon[set.winner] >= need) {
      S.matchOver = true;
      S.winner = set.winner;
      S.endTime = ev.time || S.endTime;
    }
  }
}

function applyRally(S, ev) {
  const set = S.cur;
  if (!set) return { error: 'no set in progress' };
  const pending = S.pending; S.pending = [];
  const rally = awardPoint(S, set, ev.team, ev, null);
  for (const st of pending) attachStat(S, rally, st, true);
  return null;
}

function attachStat(S, rally, st, fromPending) {
  const problem = statProblem(rally, st);
  if (problem) { alert(S, 'warn', `Ignored ${STAT_LABELS[st.kind]}: ${problem}`, st); return false; }
  if (isPointKind(st.kind)) {
    const conflict = rally.stats.find((x) => isPointKind(x.kind) && !(x.kind === 'block' && st.kind === 'block'));
    if (conflict) {
      alert(S, 'warn', `Ignored ${STAT_LABELS[st.kind]}: this point already has a ${STAT_LABELS[conflict.kind]}`, st);
      return false;
    }
  }
  rally.stats.push(st);
  if (WINNER_KINDS.has(st.kind)) rally.how = st.kind;
  else if (ERROR_KINDS.has(st.kind)) { rally.how = 'error'; rally.errKind = st.kind; }
  S.statList.push({ id: st.id, set: rally.set, side: st.team, kind: st.kind, pid: st.player || null, rally: rally.id });
  return true;
}

function statProblem(rally, st) {
  const loser = other(rally.winner);
  if (WINNER_KINDS.has(st.kind) && st.team !== rally.winner) return `${st.team === 'home' ? 'Home' : 'Visitor'} did not win that point`;
  if (st.kind === 'ace' && rally.sideout) return 'an ace needs the serving team to win the point';
  if (ERROR_KINDS.has(st.kind) && st.team !== loser) return 'the error must belong to the team that lost the point';
  if (st.kind === 'err_serve' && rally.server.side !== st.team) return 'a serve error needs the serving team to lose the point';
  if (st.kind === 'err_reception' && rally.server.side === st.team) return 'a receive error belongs to the receiving team';
  return null;
}

function applyStat(S, ev) {
  if (!ALL_STAT_KINDS.includes(ev.kind)) return { error: 'unknown stat' };
  if (!SIDES.includes(ev.team)) return { error: 'stat needs a team' };
  if (ev.rally) {
    const rally = S.rallies.find((r) => r.id === ev.rally);
    if (!rally) return { error: 'rally not found' };
    attachStat(S, rally, ev, false);
    return null;
  }
  if (isPointKind(ev.kind)) { S.pending.push(ev); return null; }
  S.statList.push({ id: ev.id, set: S.cur ? S.cur.n : (S.last ? S.last.n : 0), side: ev.team, kind: ev.kind, pid: ev.player || null, rally: null });
  return null;
}

function applyTimeout(S, ev) {
  const set = S.cur;
  if (!set) return { error: 'no set in progress' };
  const ts = set[ev.team];
  const opp = set[other(ev.team)];
  ts.timeouts.push({ score: `${ts.score}-${opp.score}`, time: ev.time || null, override: !!ev.override });
  mark(set, ev.team, 'T');
  mark(set, other(ev.team), 'Tx');
  return null;
}

function applySub(S, ev) {
  const set = S.cur;
  if (!set) return { error: 'no set in progress' };
  const ts = set[ev.team];
  const idx = ts.cur.indexOf(ev.out);
  if (idx < 0) return { error: 'player leaving is not on the court' };
  if (ts.liberoIn === idx) return { error: 'libero is replacing that player; libero must leave first' };
  if (ts.cur.includes(ev.in) || ts.libero === ev.in) return { error: 'player entering is already on the court' };
  const p = playerById(S.setup, ev.team, ev.in);
  if (!p || p.libero) return { error: 'unknown or libero player entering' };
  const opp = set[other(ev.team)];
  const n = ts.subs.length + 1;
  if (ev.in === ts.start[idx] && ts.cur[idx] !== ts.start[idx]) ts.reentered[idx] = true;
  ts.subs.push({ n, idx, out: ev.out, in: ev.in, own: ts.score, opp: opp.score, override: !!ev.override });
  ts.notes.push(`Sub ${n}: #${p.number} for #${(playerById(S.setup, ev.team, ev.out) || {}).number} at ${ts.score}-${opp.score}${ev.override ? ' (ref OK)' : ''}`);
  ts.cur[idx] = ev.in;
  ts.played.add(ev.in);
  mark(set, ev.team, 'S', n);
  mark(set, other(ev.team), 'Sx');
  return null;
}

function applyLibero(S, ev) {
  const set = S.cur;
  if (!set) return { error: 'no set in progress' };
  const ts = set[ev.team];
  if (!ts.libero) return { error: 'no libero for this team' };
  if (ev.action === 'out') { ts.liberoIn = null; return null; }
  if (ev.action === 'in') {
    const idx = ev.idx;
    if (!(idx >= 0 && idx < 6)) return { error: 'bad position' };
    if (!isBackRow(positionOf(ts, idx))) return { error: 'libero can only replace a back-row player' };
    ts.liberoIn = idx;
    ts.liberoEver = true;
    return null;
  }
  return { error: 'bad libero action' };
}

function applyPenalty(S, ev) {
  const set = S.cur;
  if (!set) return { error: 'no set in progress' };
  const pen = ev.team; // penalized team
  set[pen].notes.push(`Penalty ${ev.kind === 'point' ? 'point against' : 'warning'} at ${set[pen].score}-${set[other(pen)].score}`);
  mark(set, pen, 'P');
  mark(set, other(pen), 'Px');
  if (ev.kind === 'point') {
    const rally = awardPoint(S, set, other(pen), ev, 'P3');
    rally.how = 'penalty';
  }
  return null;
}

function applyReplay(S, ev) {
  const set = S.cur;
  if (!set) return { error: 'no set in progress' };
  const txt = ev.kind === 'RS' ? 'RS' : 'R';
  for (const sd of SIDES) set[sd].notes.push(`${ev.kind === 'RS' ? 'Re-serve' : 'Replay'} at ${set[sd].score}-${set[other(sd)].score}`);
  mark(set, 'home', txt);
  mark(set, 'away', txt);
  S.pending = S.pending.filter((p) => { if (isPointKind(p.kind)) { alert(S, 'info', 'Replay: removed a stat that depended on the replayed point', p); return false; } return true; });
  return null;
}

function applyComment(S, ev) {
  const set = S.cur || S.last;
  if (!set) return { error: 'no set yet' };
  const targets = ev.team ? [ev.team] : SIDES;
  for (const t of targets) set[t].comments.push(ev.text);
  return null;
}

// -------------------------------------------------------------------- stats

const BLANK = () => ({ sets: 0, kills: 0, aces: 0, blocks: 0, blockAssists: 0, assists: 0, digs: 0, serveAtt: 0, servePts: 0, serveErr: 0, attackErr: 0, receptionErr: 0, otherErr: 0, points: 0, unassigned: 0 });
export const STAT_COLUMNS = [
  ['sets', 'Sets'], ['points', 'Pts'], ['kills', 'Kills'], ['aces', 'Aces'], ['blocks', 'Blocks'], ['blockAssists', 'Blk Ast'],
  ['assists', 'Assists'], ['digs', 'Digs'], ['serveAtt', 'Serves'], ['serveErr', 'Svc Err'],
  ['attackErr', 'Hit Err'], ['receptionErr', 'Rec Err'], ['otherErr', 'Other Err'],
];

function finalizeStats(S) {
  const out = { home: {}, away: {} };
  const row = (side, pid) => {
    const key = pid || '_unassigned';
    return (out[side][key] = out[side][key] || BLANK());
  };
  for (const side of SIDES) for (const p of S.setup[side].players) row(side, p.id);
  for (const set of S.sets) for (const side of SIDES) for (const pid of set[side].played) row(side, pid).sets++;
  // libero participation: count a set if the libero was ever in
  for (const set of S.sets) for (const side of SIDES) {
    const l = set[side].libero; if (l && set[side].liberoEver) row(side, l).sets++;
  }
  const blockersByRally = new Map();
  for (const st of S.statList) if (st.kind === 'block') {
    blockersByRally.set(st.rally, (blockersByRally.get(st.rally) || 0) + 1);
  }
  for (const st of S.statList) {
    const r = row(st.side, st.pid);
    if (!st.pid) r.unassigned++;
    switch (st.kind) {
      case 'kill': r.kills++; break;
      case 'ace': r.aces++; break;
      case 'block': if ((blockersByRally.get(st.rally) || 1) > 1) r.blockAssists++; else r.blocks++; break;
      case 'assist': r.assists++; break;
      case 'dig': r.digs++; break;
      case 'err_serve': r.serveErr++; break;
      case 'err_attack': r.attackErr++; break;
      case 'err_reception': r.receptionErr++; break;
      default: r.otherErr++;
    }
  }
  for (const r of S.rallies) {
    const sv = r.server;
    if (sv && sv.pid) {
      const x = row(sv.side, sv.pid);
      x.serveAtt++;
      if (r.winner === sv.side) x.servePts++;
    }
  }
  for (const side of SIDES) for (const k of Object.keys(out[side])) {
    const r = out[side][k];
    r.points = r.kills + r.aces + r.blocks + r.blockAssists;
  }
  S.stats = out;
}

// --------------------------------------------------------------- validation

// Returns {errors:[], warnings:[{code,message}]}. Warnings can be overridden by the
// operator ("the referee approved it"); errors cannot.
export function validate(S, ev) {
  const errors = [], warnings = [];
  const set = S.cur;
  const needSet = () => { if (!set) { errors.push(S.matchOver ? 'The match is over.' : 'Start the next set first.'); return false; } return true; };
  switch (ev.type) {
    case 'set_start': {
      if (S.matchOver) errors.push('The match is over.');
      else if (S.cur) errors.push('The current set is not finished yet.');
      const e = checkLineup(S.setup, ev); if (e) errors.push(e);
      break;
    }
    case 'rally': {
      if (!needSet()) break;
      if (S.pending.some((p) => (WINNER_KINDS.has(p.kind) && p.team !== ev.team) || (ERROR_KINDS.has(p.kind) && p.team === ev.team)))
        warnings.push({ code: 'pending-mismatch', message: 'A stat you already tapped does not match the team getting this point. It will be ignored.' });
      break;
    }
    case 'timeout': {
      if (!needSet()) break;
      const used = set[ev.team].timeouts.length;
      if (used >= S.rules.timeoutsPerSet)
        warnings.push({ code: 'timeout-limit', message: `${S.setup[ev.team].name} already used ${used} time-outs this set (limit ${S.rules.timeoutsPerSet}).` });
      break;
    }
    case 'sub': {
      if (!needSet()) break;
      const ts = set[ev.team];
      const idx = ts.cur.indexOf(ev.out);
      if (idx < 0) { errors.push('That player is not on the court.'); break; }
      if (ts.liberoIn === idx) { errors.push('The libero is in for that player. Send the libero out first.'); break; }
      if (ts.cur.includes(ev.in) || ts.libero === ev.in) { errors.push('That player is already on the court.'); break; }
      const p = playerById(S.setup, ev.team, ev.in);
      if (!p || p.libero) { errors.push('Pick a non-libero player from the bench.'); break; }
      if (ts.subs.length >= S.rules.subsPerSet)
        warnings.push({ code: 'sub-limit', message: `${ts.subs.length} substitutions already used this set (limit ${S.rules.subsPerSet}).` });
      const starter = ts.start[idx];
      if (ts.cur[idx] === starter) {
        if (ts.played.has(ev.in)) warnings.push({ code: 'reentry', message: `#${p.number} already played in this set. A player may only come back in for the player they replaced, in the same spot.` });
      } else if (ev.in !== starter) {
        warnings.push({ code: 'reentry', message: 'A substitute can normally only be replaced by the starter they replaced.' });
      } else if (ts.reentered[idx]) {
        warnings.push({ code: 'reentry', message: 'That starter has already come back in once this set.' });
      }
      break;
    }
    case 'libero': {
      if (!needSet()) break;
      const ts = set[ev.team];
      if (!ts.libero) { errors.push('This team has no libero for this set.'); break; }
      if (ev.action === 'in') {
        if (!(ev.idx >= 0 && ev.idx < 6)) { errors.push('Pick a player.'); break; }
        if (!isBackRow(positionOf(ts, ev.idx))) { errors.push('The libero can only replace a back-row player.'); break; }
        if (ts.liberoIn !== null) { errors.push('The libero is already on the court.'); break; }
        if (positionOf(ts, ev.idx) === 1 && !S.rules.liberoMayServe) warnings.push({ code: 'libero-serve', message: 'Your rules do not let the libero serve.' });
        if (positionOf(ts, ev.idx) === 1 && ts.liberoServeIdx !== null && ts.liberoServeIdx !== ev.idx)
          warnings.push({ code: 'libero-serve', message: 'The libero already served from a different rotation position. NFHS allows only one.' });
      } else if (ev.action === 'out') {
        if (ts.liberoIn === null) errors.push('The libero is not on the court.');
      }
      break;
    }
    case 'penalty': case 'replay': case 'comment': case 'switch': needSet(); break;
    case 'stat': {
      if (!SIDES.includes(ev.team) || !ALL_STAT_KINDS.includes(ev.kind)) errors.push('Bad stat.');
      break;
    }
    default: break;
  }
  return { errors, warnings };
}

// Which rally (if any) would a point-type stat attach to right now?  A stat
// tapped right after a point belongs to that point; otherwise it is held for
// the next point.
export function lastOpenRally(S, events) {
  const act = activeEvents(events);
  for (let i = act.length - 1; i >= 0; i--) {
    const e = act[i];
    if (e.type === 'stat') continue;
    if (e.type === 'rally' || (e.type === 'penalty' && e.kind === 'point')) return S.rallies.find((r) => r.id === e.id) || null;
    return null;
  }
  return null;
}

// Would voiding event `id` make any later event invalid? Used before letting a
// user delete something from the middle of the history.
export function previewVoid(setup, events, id) {
  const before = buildState(setup, events);
  const after = buildState(setup, [...events, { id: 'preview', type: 'void', target: id }]);
  return { newInvalid: after.invalid.filter((i) => !before.invalid.some((b) => b.id === i.id)), state: after };
}

// ----------------------------------------------------------------- history

export function describeEvent(S, ev) {
  const setup = S.setup;
  const nm = (side) => setup[side].name || (side === 'home' ? 'Home' : 'Visitor');
  switch (ev.type) {
    case 'set_start': return `Set started — ${nm(ev.firstServe)} serves first`;
    case 'rally': return `Point: ${nm(ev.team)}`;
    case 'timeout': return `Time-out: ${nm(ev.team)}`;
    case 'sub': return `Sub (${nm(ev.team)}): ${pLabel(setup, ev.team, ev.in, false)} in for ${pLabel(setup, ev.team, ev.out, false)}${ev.override ? ' (ref approved)' : ''}`;
    case 'libero': return `Libero ${ev.action} (${nm(ev.team)})`;
    case 'penalty': return `${ev.kind === 'point' ? 'Penalty point against' : 'Penalty warning for'} ${nm(ev.team)}`;
    case 'replay': return ev.kind === 'RS' ? 'Re-serve' : 'Replay';
    case 'comment': return `Note: ${ev.text}`;
    case 'switch': return 'Teams switched sides';
    case 'stat': return `${STAT_LABELS[ev.kind]} — ${ev.player ? pLabel(setup, ev.team, ev.player) : 'player not recorded'} (${nm(ev.team)})`;
    default: return ev.type;
  }
}

// Convenience used by tests and UI: commands that build events.
export const cmd = {
  setStart(home, away, firstServe) { return { id: uid(), type: 'set_start', home, away, firstServe, time: nowHHMM(), ts: Date.now() }; },
  point(team) { return { id: uid(), type: 'rally', team, time: nowHHMM(), ts: Date.now() }; },
  stat(team, kind, player, rally) { return { id: uid(), type: 'stat', team, kind, player: player || null, rally: rally || null, ts: Date.now() }; },
  timeout(team) { return { id: uid(), type: 'timeout', team, time: nowHHMM(), ts: Date.now() }; },
  sub(team, out, inn, override) { return { id: uid(), type: 'sub', team, out, in: inn, override: !!override, ts: Date.now() }; },
  libero(team, action, idx) { return { id: uid(), type: 'libero', team, action, idx, ts: Date.now() }; },
  penalty(team, kind) { return { id: uid(), type: 'penalty', team, kind, time: nowHHMM(), ts: Date.now() }; },
  replay(kind) { return { id: uid(), type: 'replay', kind: kind || 'R', ts: Date.now() }; },
  comment(text, team) { return { id: uid(), type: 'comment', text, team: team || null, ts: Date.now() }; },
  sw() { return { id: uid(), type: 'switch', ts: Date.now() }; },
  void(target) { return { id: uid(), type: 'void', target, ts: Date.now() }; },
};
