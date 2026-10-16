// Interactive first-run tour. It highlights the REAL buttons on the REAL screens, using a
// practice game with sample teams (never saved with real games or stats).
import { h, $, modal } from './util.js';
import { store } from './store.js';

export async function shouldAutoStartTour() { return !(await store.getKV('tourSeen', false)); }

const SEVEN = 7;

function slides(T) {
  const P = () => T.practiceId;
  return [
    // ---- Step 1: start a game
    { step: 1, title: 'Start a game', go: '/', target: '[data-tour="tile-new"]', text: 'Everything begins here. Tap New Game to enter the teams, the player numbers, and who starts. We’ll show you each part.' },
    { step: 1, title: 'Enter the teams', go: '/new?practice=1', wait: '[data-tour="team-home"]', target: ['[data-tour="team-home"]', '[data-tour="team-away"]'], text: 'Type each team’s name here. These are sample teams so you can look around — nothing you do in the tour is saved with your real games.' },
    { step: 1, title: 'Add player numbers', go: '/new?practice=1', target: '[data-tour="roster-home"]', text: 'Add each player’s number (a name is optional). Tip: use “Quick add” to type lots of numbers at once, like 1 4 7 9 10 12. Tap a player to change or remove them.', after: () => clickEl('[data-tour="next-lineup"]') },
    { step: 1, title: 'Pick the starting lineup', wait: '[data-tour="lineup-home"]', target: '[data-tour="lineup-home"]', text: 'Tap the six starting players in serving order. The first one you tap is “I” and serves first. The libero is chosen below the numbers.' },
    { step: 1, title: 'Who serves first?', target: '[data-tour="first-serve"]', text: 'Pick the team that serves first (the referee does a coin toss). Then tap Start game.', after: async () => { clickEl('[data-tour="start-game"]'); await waitFor('[data-tour="point-home"]', 6000); T.practiceId = (/^\/game\/(.+)$/.exec(T.ctx.route) || [])[1] || T.practiceId; } },

    // ---- Step 2: keep score
    { step: 2, title: 'Keep score', wait: '[data-tour="point-home"]', target: '[data-tour="points"]', text: 'When a team wins a point, tap their button. We’ll handle the score and serving changes.', tryText: 'Try it: tap a POINT button.', watch: () => T.practiceEvents() },

    // ---- Step 3: record player stats
    { step: 3, title: 'Record player stats', target: ['[data-tour="stats-home"]', '[data-tour="stats-away"]'], text: 'Tap what happened, then tap the player who did it. It’s fast, and you can always skip it.', tryText: 'Try it: tap “Kill”, then tap a player.', watch: () => T.practiceEvents() },
    { step: 3, title: 'Examples', target: ['[data-tour="panel-home"]', '[data-tour="panel-away"]'], text: 'Here is what each button means:', list: [
      ['Ace', 'A serve nobody can return. Tap Ace, then the server (the ★ player).'],
      ['Kill', 'A hard hit that wins the point. Tap Kill, then the hitter. We’ll ask who set it up.'],
      ['Assist', 'The pass or set right before a kill.'],
      ['Dig', 'Saving a hard-hit ball so the rally keeps going.'],
      ['Block', 'Stopping the ball at the net.'],
      ['Error', 'A mistake that gives the other team a point. Tap Error, pick the kind, then the player.'],
    ] },

    // ---- Step 4: serving
    { step: 4, title: 'Track serving', target: '[data-tour="server"]', text: 'We’ll track the serving order and rotations automatically. The yellow label shows who is serving and their serving number (I to VI). The ★ on the court shows the same player.' },

    // ---- Step 5: timeouts and subs
    { step: 5, title: 'Time-outs and substitutions', target: ['[data-tour="tools-home"]', '[data-tour="tools-away"]'], text: 'When a coach calls a time-out, tap ⏱ Time-out. To swap a player, tap ⇄ Sub, then tap who is leaving, then who is coming in. We’ll warn you if the rules might not allow it.', tryText: 'Try it: tap Time-out.', watch: () => T.practiceEvents() },

    // ---- Step 6: undo
    { step: 6, title: 'Correct a mistake', target: '[data-tour="undo"]', text: 'Made a mistake? Tap Undo to correct the last play. Undo fixes the score, the serving order and the scoresheet together.', tryText: 'Try it: tap Undo.', watch: () => T.practiceEvents() },

    // ---- Step 7: scoresheet + download
    { step: 7, title: 'See the scoresheet fill itself in', target: '[data-tour="view-sheet"]', text: 'Tap VIEW SCORESHEET any time to see the real paper form, filled in as you score.', after: async () => { T.ctx.go('/sheet/' + P()); await waitFor('[data-tour="download-pdf"]', 8000); } },
    { step: 7, title: 'Download your scoresheet', go: () => '/sheet/' + P(), wait: '[data-tour="download-pdf"]', target: '[data-tour="download-pdf"]', text: 'When the game is over, download your completed scoresheet and player statistics. You can print it or share it with a referee or coach. Old games are always in Game Reports.' },
  ];
}

const T = { ctx: null, practiceId: null, idx: 0, list: [], cleanup: null, baseline: 0, practiceEvents: () => 0 };

function clickEl(sel) { const el = document.querySelector(sel); if (el && !el.disabled) el.click(); }
function waitFor(sel, ms = 4000) {
  return new Promise((res) => {
    const t0 = Date.now();
    const iv = setInterval(() => {
      const el = visible(sel);
      if (el || Date.now() - t0 > ms) { clearInterval(iv); res(el); }
    }, 80);
  });
}
function visible(sel) {
  const sels = Array.isArray(sel) ? sel : [sel];
  for (const s of sels) {
    let els;
    try { els = [...document.querySelectorAll(s)]; } catch { els = []; }
    for (const el of els) { const r = el.getBoundingClientRect(); if (r.width > 0 && r.height > 0) return el; }
  }
  return null;
}

export async function startTour(ctx, { welcome = false } = {}) {
  endTour(false);
  T.ctx = ctx;
  T.practiceId = null;
  T.practiceEvents = () => {
    const m = /^\/game\/(.+)$/.exec(ctx.route);
    const s = m && ctx.peek ? ctx.peek(m[1]) : null;
    return s ? s.rec.events.length : 0;
  };
  ctx.peek = ctx.peek || ((id) => null);
  if (welcome) await showWelcome(ctx); else begin(ctx);
}

function showWelcome(ctx) {
  return new Promise((resolve) => {
    const m = modal(h('div', { class: 'welcome' },
      h('div', { style: { fontSize: '3rem' } }, '🏐'),
      h('h2', null, 'WELCOME TO VOLLEYBALL GAME DAY'),
      h('p', null, 'Everything you need to keep score and track your team. We’ll show you how in just a few minutes.'),
      h('div', { class: 'stack' },
        h('button', { class: 'btn primary big', onclick: () => { m.close(); begin(ctx); resolve(); } }, 'START QUICK TOUR'),
        h('button', { class: 'btn ghost', onclick: async () => { m.close(); await store.setKV('tourSeen', true); resolve(); } }, 'SKIP TOUR'))), { sticky: true });
  });
}

async function begin(ctx) {
  T.list = slides(T);
  T.idx = 0;
  if (!document.querySelector('.tour-root')) buildDom();
  await show(0);
}

let root, hole, card, blocks = [], poll = null, lastRect = '';

function buildDom() {
  root = h('div', { class: 'tour-root' });
  hole = h('div', { class: 'tour-hole', hidden: true });
  card = h('div', { class: 'tour-card', role: 'dialog', 'aria-live': 'polite' });
  blocks = [0, 1, 2, 3].map(() => h('div', { class: 'tour-block' }));
  root.append(h('div', { class: 'tour-back', id: 'tour-back' }), ...blocks, hole, card);
  document.body.append(root);
  poll = setInterval(reposition, 200);
  globalThis.addEventListener('resize', reposition);
}

async function show(i) {
  const s = T.list[i];
  if (!s) return finish();
  T.idx = i;
  const go = typeof s.go === 'function' ? s.go() : s.go;
  if (go && T.ctx.route !== go) { T.ctx.go(go); await new Promise((r) => setTimeout(r, 60)); }
  if (s.wait) await waitFor(s.wait, 5000);
  T.baseline = T.practiceEvents();
  renderCard();
  const el = visible(s.target);
  if (el) el.scrollIntoView({ block: 'center', behavior: 'instant' });
  lastRect = '';
  reposition();
}

function renderCard() {
  const s = T.list[T.idx];
  const last = T.idx === T.list.length - 1;
  card.replaceChildren(...[
    s.step ? h('div', { class: 'step' }, `Step ${s.step} of ${SEVEN}`) : null,
    h('h3', null, s.title),
    h('p', null, s.text),
    s.list ? h('div', { style: { display: 'grid', gap: '6px', margin: '4px 0 8px' } }, s.list.map(([k, v]) => h('div', null, h('strong', null, k + ': '), v))) : null,
    s.tryText ? h('div', { class: 'try', id: 'tour-try' }, s.tryText) : null,
    h('div', { class: 'tour-actions' },
      h('div', { class: 'tour-dots' }, T.list.map((_, k) => h('i', { class: k === T.idx ? 'on' : '' }))),
      h('button', { class: 'btn ghost', onclick: () => skip() }, 'Skip'),
      T.idx > 0 ? h('button', { class: 'btn', onclick: () => back() }, 'Back') : null,
      h('button', { class: 'btn primary', onclick: () => next() }, last ? 'Finish' : 'Next')),
  ].filter(Boolean));
}

let busy = false;
async function next() {
  if (busy) return; busy = true;
  try {
    const s = T.list[T.idx];
    if (s.after) await s.after();
    await show(T.idx + 1);
  } finally { busy = false; }
}
async function back() {
  if (busy) return; busy = true;
  try {
    let i = T.idx - 1;
    // slides in the setup wizard can't be rewound from the game screen; replay the wizard from its start
    const cur = T.list[T.idx];
    if (cur.step >= 2 && T.list[i] && T.list[i].step === 1) i = 1;
    await show(Math.max(0, i));
  } finally { busy = false; }
}

function reposition() {
  if (!root) return;
  const s = T.list[T.idx];
  if (!s) return;
  const el = visible(s.target);
  // "Nice!" feedback when the user actually tries the thing
  if (s.watch) {
    const t = document.getElementById('tour-try');
    if (t && s.watch() !== T.baseline && !t.dataset.done) { t.dataset.done = '1'; t.textContent = '✔ Nice! You did it. Tap Next to keep going.'; }
  }
  const back = document.getElementById('tour-back');
  if (!el) {
    hole.hidden = true; blocks.forEach((b) => { b.style.display = 'none'; });
    back.style.display = 'block'; back.style.background = 'rgba(8,16,38,.72)';
    place(null);
    return;
  }
  back.style.display = 'none';
  const els = (Array.isArray(s.target) ? s.target : [s.target]).map((t) => { try { return [...document.querySelectorAll(t)].find((e) => { const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0; }); } catch { return null; } }).filter(Boolean);
  // union of all visible targets
  let L = Infinity, Tp = Infinity, R = -Infinity, B = -Infinity;
  for (const e of els) { const r = e.getBoundingClientRect(); L = Math.min(L, r.left); Tp = Math.min(Tp, r.top); R = Math.max(R, r.right); B = Math.max(B, r.bottom); }
  const pad = 6;
  const rect = { left: Math.max(0, L - pad), top: Math.max(0, Tp - pad), right: Math.min(innerWidth, R + pad), bottom: Math.min(innerHeight, B + pad) };
  const key = [rect.left, rect.top, rect.right, rect.bottom].map(Math.round).join(',');
  if (key === lastRect) return;
  lastRect = key;
  hole.hidden = false;
  Object.assign(hole.style, { left: rect.left + 'px', top: rect.top + 'px', width: rect.right - rect.left + 'px', height: rect.bottom - rect.top + 'px' });
  const set = (b, l, t, w, hh) => Object.assign(b.style, { display: 'block', left: l + 'px', top: t + 'px', width: Math.max(0, w) + 'px', height: Math.max(0, hh) + 'px' });
  set(blocks[0], 0, 0, innerWidth, rect.top);
  set(blocks[1], 0, rect.bottom, innerWidth, innerHeight - rect.bottom);
  set(blocks[2], 0, rect.top, rect.left, rect.bottom - rect.top);
  set(blocks[3], rect.right, rect.top, innerWidth - rect.right, rect.bottom - rect.top);
  place(rect);
}

function place(rect) {
  const w = Math.min(440, innerWidth - 24);
  const ch = card.offsetHeight || 220;
  let left = (innerWidth - w) / 2, top;
  if (!rect) top = Math.max(12, (innerHeight - ch) / 2);
  else {
    const below = innerHeight - rect.bottom, above = rect.top;
    if (below >= ch + 14) top = rect.bottom + 12;
    else if (above >= ch + 14) top = rect.top - ch - 12;
    else top = innerHeight - ch - 10; // no room: dock at the bottom edge
    left = Math.min(Math.max(12, rect.left + (rect.right - rect.left) / 2 - w / 2), innerWidth - w - 12);
  }
  Object.assign(card.style, { left: left + 'px', top: Math.max(8, top) + 'px' });
}

async function skip() { await store.setKV('tourSeen', true); endTour(true); }

async function finish() {
  await store.setKV('tourSeen', true);
  await store.setKV('tourDone', true);
  endTour(false);
  const id = T.practiceId;
  const ctx = T.ctx;
  if (id) ctx.go('/game/' + id); else ctx.go('/new?practice=1');
  const m = modal(h('div', { class: 'welcome' }, h('div', { style: { fontSize: '3rem' } }, '🎉'), h('h2', null, 'You’re ready!'),
    h('p', null, 'This is a practice game with sample teams. Try the buttons — nothing here is saved with your real games or stats. Tap Help any time to see this tour again.'),
    h('div', { class: 'stack' }, h('button', { class: 'btn primary big', onclick: () => m.close() }, 'Practice now'), h('button', { class: 'btn', onclick: () => { m.close(); ctx.go('/new'); } }, 'Start a real game'))));
}

export function endTour(goHome) {
  if (poll) clearInterval(poll);
  poll = null;
  globalThis.removeEventListener('resize', reposition);
  const r = document.querySelector('.tour-root');
  if (r) r.remove();
  root = null;
  if (goHome && T.ctx) T.ctx.go('/');
}
void $;
