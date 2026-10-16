// New game wizard (teams → starting lineup) and the between-sets lineup screen.
import { h, modal, toast, todayISO } from '../util.js';
import { store } from '../store.js';
import { createGame } from '../session.js';
import { cmd, uid, DEFAULT_RULES, other, rulesOf } from '../engine/engine.js';
import { sampleSetup, sampleLineup } from '../sample.js';
import { parseRoster } from '../roster.js';

const SIDE_LABEL = { home: 'Home team', away: 'Visiting team' };

function blankDraft() {
  return { date: todayISO(), site: '', home: { name: '', players: [] }, away: { name: '', players: [] }, rules: {}, step: 1, lineup: null, practice: false };
}

export async function mount(root, { mode, params, query }, ctx) {
  if (mode === 'lineup') return mountLineupOnly(root, params[0], ctx);
  const practice = query.get('practice') === '1';
  let draft;
  if (practice) {
    const s = sampleSetup(todayISO());
    draft = { ...blankDraft(), practice: true, site: s.site, home: s.home, away: s.away };
  } else {
    draft = (await store.getKV('draft')) || blankDraft();
    if (draft.practice) draft = blankDraft();
    draft.step = 1; draft.lineup = null;
  }
  const saved = (await store.all('teams')).sort((a, b) => a.name.localeCompare(b.name));
  const persist = () => { if (!practice) store.setKV('draft', { ...draft, step: 1, lineup: null }); };
  const rerender = () => { persist(); draw(); };

  function draw() {
    root.replaceChildren(draft.step === 1 ? teamsStep() : lineupStep());
    globalThis.dispatchEvent(new CustomEvent('vb-rendered'));
  }

  // ------------------------------------------------------------- step 1
  function teamsStep() {
    const valid = (side) => draft[side].name.trim() && draft[side].players.filter((p) => !p.libero).length >= 6;
    const ok = valid('home') && valid('away');
    return h('div', null,
      h('div', { class: 'steps' }, h('span', { class: 'on' }), h('span')),
      h('h1', { class: 'page-title' }, practice ? 'Practice game: teams' : 'New game: teams & players'),
      practice ? h('div', { class: 'banner practice', style: { marginBottom: '12px' } }, 'This is a practice game with sample teams. Nothing here touches your real games or stats.') : null,
      h('p', { class: 'sub' }, 'Type the team names and add each player’s number. You need at least 6 players per team (plus an optional libero).'),
      h('div', { class: 'card', 'data-tour': 'game-info' },
        h('div', { class: 'grid2' },
          field('Date', h('input', { class: 'inp', type: 'date', value: draft.date, oninput: (e) => { draft.date = e.target.value; persist(); } })),
          field('Game location', h('input', { class: 'inp', type: 'text', placeholder: 'e.g. Main Gym', value: draft.site, oninput: (e) => { draft.site = e.target.value; persist(); } })))),
      h('div', { class: 'grid2', style: { marginTop: '14px' } }, teamCard('home'), teamCard('away')),
      rulesCard(),
      h('div', { class: 'footbar' },
        h('button', { class: 'btn ghost', onclick: () => ctx.go('/') }, 'Cancel'),
        h('button', { class: 'btn primary big', 'data-tour': 'next-lineup', disabled: !ok, onclick: () => { draft.step = 2; draft.lineup = initialLineup(draft); draw(); globalThis.scrollTo(0, 0); } }, 'Next: lineup →')));
  }

  function teamCard(side) {
    const t = draft[side];
    const nameInp = h('input', { class: 'inp', type: 'text', placeholder: side === 'home' ? 'Home team name' : 'Visiting team name', value: t.name, autocomplete: 'off', oninput: (e) => { t.name = e.target.value; persist(); } });
    const savedSel = saved.length ? h('select', { class: 'inp', 'aria-label': 'Use a saved team', onchange: (e) => {
      const s = saved.find((x) => x.id === e.target.value);
      if (s) { t.name = s.name; t.players = JSON.parse(JSON.stringify(s.players)); t.teamId = s.id; rerender(); }
    } }, h('option', { value: '' }, 'Use a saved team…'), saved.map((s) => h('option', { value: s.id }, s.name))) : null;
    const nInp = h('input', { class: 'inp', type: 'text', inputmode: 'numeric', pattern: '[0-9]*', placeholder: '#', maxlength: 3, 'aria-label': 'Player number' });
    const nameP = h('input', { class: 'inp', type: 'text', placeholder: 'Name (optional)', 'aria-label': 'Player name', autocomplete: 'off' });
    const lib = h('input', { type: 'checkbox', id: side + '-lib' });
    const add = () => {
      const n = nInp.value.trim().replace(/\D/g, '');
      if (!n) { nInp.focus(); return; }
      if (t.players.some((p) => p.number === String(+n)) ) { toast(`#${+n} is already on this team`); return; }
      t.players.push({ id: uid(), number: String(+n), name: nameP.value.trim(), libero: lib.checked });
      nInp.value = ''; nameP.value = ''; lib.checked = false;
      rerender(); setTimeout(() => { const el = root.querySelector(`[data-nin="${side}"]`); el && el.focus(); }, 0);
    };
    nInp.dataset.nin = side;
    nInp.addEventListener('keydown', (e) => { if (e.key === 'Enter') add(); });
    nameP.addEventListener('keydown', (e) => { if (e.key === 'Enter') add(); });
    const bulk = h('textarea', { class: 'inp', rows: 5, placeholder: 'Quick add or paste a roster:\n1 4 7 9 10 12\n12 Mia Lopez\n7L (libero)', 'aria-label': 'Add many numbers at once', autocapitalize: 'off', spellcheck: 'false' });
    const bulkAdd = () => {
      const { players: found, skipped } = parseRoster(bulk.value, t.players.map((p) => p.number));
      for (const p of found) t.players.push({ id: uid(), number: p.number, name: p.name, libero: p.libero });
      if (found.length) { bulk.value = ''; rerender(); }
      if (found.length) toast(`Added ${found.length} player${found.length > 1 ? 's' : ''}` + (skipped.length ? `. Skipped: ${skipped.slice(0, 3).join(', ')}` : ''), { ms: skipped.length ? 5500 : 3200 });
      else if (skipped.length) toast(`Could not read: ${skipped.slice(0, 3).join(', ')}`, { ms: 5000 });
    };
    bulk.addEventListener('keydown', (e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) bulkAdd(); });
    const players = [...t.players].sort((a, b) => (+a.number) - (+b.number));
    return h('div', { class: 'card team-edit ' + side, 'data-tour': 'team-' + side },
      h('h2', { style: { marginBottom: '10px', color: 'var(--navy)' } }, SIDE_LABEL[side]),
      h('label', { class: 'field' }, h('span', null, 'Team name'), nameInp),
      savedSel ? h('div', { class: 'field' }, savedSel) : null,
      h('div', { class: 'field', 'data-tour': 'roster-' + side }, h('span', null, `Players (${t.players.filter((p) => !p.libero).length}${t.players.some((p) => p.libero) ? ' + libero' : ''})`),
        h('div', { class: 'chips' }, players.length ? players.map((p) => h('button', { class: 'pchip' + (p.libero ? ' lib' : ''), onclick: () => editPlayer(t, p, rerender) }, h('b', { class: 'pn' }, p.number), p.name ? h('small', null, p.name) : null, p.libero ? h('small', null, 'Libero') : null)) : h('span', { class: 'muted' }, 'No players yet — add numbers below.')),
        h('div', { class: 'addrow' }, nInp, nameP, h('label', { class: 'check', title: 'Libero' }, lib, 'Libero'), h('button', { class: 'btn primary', onclick: add }, 'Add')),
        h('div', { class: 'addrow', style: { gridTemplateColumns: '1fr auto', marginTop: '8px', alignItems: 'start' } }, bulk, h('button', { class: 'btn', onclick: bulkAdd }, 'Add all'))));
  }

  function rulesCard() {
    const r = { ...DEFAULT_RULES, ...draft.rules };
    const set = (k, v) => { draft.rules[k] = v; persist(); };
    const num = (k, label, min, max) => field(label, h('input', { class: 'inp', type: 'number', min, max, value: r[k], onchange: (e) => set(k, +e.target.value) }));
    return h('details', { class: 'adv card', style: { marginTop: '14px' } },
      h('summary', null, 'Game rules (already set for NFHS high school volleyball)'),
      h('p', { class: 'muted' }, 'Only change these if your league plays differently. Your state association may differ from the defaults — check with your athletic director.'),
      h('div', { class: 'grid2' },
        field('Match length', h('select', { class: 'inp', onchange: (e) => set('bestOf', +e.target.value) }, [[5, 'Best 3 of 5 sets'], [3, 'Best 2 of 3 sets']].map(([v, l]) => h('option', { value: v, selected: r.bestOf === v }, l)))),
        num('setTarget', 'Points to win a set', 15, 50), num('decidingTarget', 'Points in the deciding set', 10, 30),
        num('timeoutsPerSet', 'Time-outs per team per set', 0, 6), num('subsPerSet', 'Substitutions per team per set', 0, 30)),
      h('label', { class: 'check' }, h('input', { type: 'checkbox', checked: !!r.alternateSheetSides, onchange: (e) => set('alternateSheetSides', e.target.checked) }), 'Swap teams left/right on the scoresheet every set'));
  }

  // ------------------------------------------------------------- step 2
  function lineupStep() {
    const setup = setupFrom(draft);
    const L = draft.lineup;
    const ed = lineupEditor(setup, L, () => { const b = root.querySelector('[data-start]'); if (b) b.disabled = !ed.valid(); }, { first: true });
    return h('div', null,
      h('div', { class: 'steps' }, h('span', { class: 'on' }), h('span', { class: 'on' })),
      h('h1', { class: 'page-title' }, 'Set 1: starting lineup'),
      h('p', { class: 'sub' }, 'Tap the players in serving order. The first player you tap is “I” — they serve first for their team.'),
      ed.el,
      h('div', { class: 'footbar' },
        h('button', { class: 'btn ghost', onclick: () => { draft.step = 1; draw(); } }, '← Back'),
        h('button', { class: 'btn green big', 'data-start': '1', 'data-tour': 'start-game', disabled: !ed.valid(), onclick: start }, 'Start game')));
  }

  async function start() {
    const setup = setupFrom(draft);
    const L = draft.lineup;
    // remember teams for next time
    if (!practice) {
      for (const side of ['home', 'away']) {
        const t = draft[side];
        const existing = saved.find((s) => s.name.trim().toLowerCase() === t.name.trim().toLowerCase());
        await store.put('teams', { id: existing ? existing.id : 't-' + uid(), name: t.name.trim(), players: t.players });
      }
    }
    if (practice) for (const g of await store.all('games')) if (g.practice) { await store.del('games', g.id); ctx.drop(g.id); }
    const rec = await createGame(setup, { practice });
    rec.events.push(cmd.setStart(L.home, L.away, L.firstServe));
    await store.put('games', rec);
    if (!practice) { await store.setKV('draft', null); globalThis.dispatchEvent(new CustomEvent('vb-game-changed', { detail: { id: rec.id } })); }
    ctx.drop(rec.id);
    ctx.go('/game/' + rec.id);
  }

  draw();
  return null;
}

function setupFrom(d) {
  const clean = (t, fallback) => ({ name: t.name.trim() || fallback, players: t.players.map((p) => ({ id: p.id, number: p.number, name: p.name, libero: !!p.libero })) });
  return { date: d.date, site: d.site.trim(), home: clean(d.home, 'Home'), away: clean(d.away, 'Visitor'), rules: { ...d.rules } };
}

function initialLineup(d) {
  const make = (side) => {
    const pl = d[side].players;
    const libs = pl.filter((p) => p.libero);
    return { order: Array(6).fill(null), libero: libs.length === 1 ? libs[0].id : null, captain: null };
  };
  const L = { home: make('home'), away: make('away'), firstServe: null };
  if (d.practice) { const s = setupFrom(d); L.home = sampleLineup(s, 'home'); L.away = sampleLineup(s, 'away'); L.firstServe = 'home'; }
  return L;
}

function field(label, input) { return h('label', { class: 'field' }, h('span', null, label), input); }

function editPlayer(team, p, done) {
  const num = h('input', { class: 'inp', type: 'text', inputmode: 'numeric', value: p.number, maxlength: 3 });
  const name = h('input', { class: 'inp', type: 'text', value: p.name || '', placeholder: 'Name (optional)' });
  const lib = h('input', { type: 'checkbox', checked: !!p.libero });
  const m = modal(h('div', null,
    field('Number', num), field('Name', name),
    h('label', { class: 'check' }, lib, 'This player is a libero'),
    h('div', { class: 'modal-actions', style: { marginTop: '14px' } },
      h('button', { class: 'btn danger', onclick: () => { team.players = team.players.filter((x) => x !== p); m.close(); done(); } }, 'Remove'),
      h('button', { class: 'btn ghost', onclick: () => m.close() }, 'Cancel'),
      h('button', { class: 'btn primary', onclick: () => {
        const n = String(+num.value.replace(/\D/g, ''));
        if (!num.value.trim()) return;
        if (team.players.some((x) => x !== p && x.number === n)) { toast(`#${n} is already used`); return; }
        p.number = n; p.name = name.value.trim(); p.libero = lib.checked; m.close(); done();
      } }, 'Save'))), { title: 'Edit player' });
}

// ------------------------------------------------------------------ lineup editor
// state L = {home:{order:[ids],libero,captain}, away:{...}, firstServe}
export function lineupEditor(setup, L, onChange, { first = false, suggestFirst = null, note = null } = {}) {
  const el = h('div');
  const romans = ['I', 'II', 'III', 'IV', 'V', 'VI'];
  const draw = () => {
    el.replaceChildren(
      h('div', { class: 'grid2' }, ['home', 'away'].map((side) => teamLineup(side))),
      h('div', { class: 'card', style: { marginTop: '14px' }, 'data-tour': 'first-serve' },
        h('h2', { style: { marginBottom: '8px', color: 'var(--navy)' } }, 'Who serves first?'),
        note ? h('p', { class: 'muted', style: { margin: '0 0 8px' } }, note) : null,
        h('div', { class: 'serve-pick' }, ['home', 'away'].map((side) => h('button', { class: side + (L.firstServe === side ? ' sel' : ''), onclick: () => { L.firstServe = side; onChange(); draw(); } }, setup[side].name, h('div', { style: { fontSize: '.85rem', fontWeight: 600 } }, L.firstServe === side ? '✔ serves first' : suggestFirst === side ? 'suggested' : 'tap to choose'))))));
    onChange();
  };
  function teamLineup(side) {
    const T = L[side];
    const roster = setup[side].players;
    const libs = roster.filter((p) => p.libero);
    const next = T.order.indexOf(null);
    return h('div', { class: 'card team-edit ' + side, 'data-tour': 'lineup-' + side },
      h('h2', { style: { marginBottom: '8px', color: 'var(--navy)' } }, setup[side].name),
      h('div', { class: 'slots' }, romans.map((r, i) => {
        const p = roster.find((x) => x.id === T.order[i]);
        return h('button', { class: 'slot' + (p ? ' filled' : '') + (i === next ? ' next' : ''), onclick: () => { if (p) { T.order[i] = null; draw(); } } },
          h('b', null, r), p ? h('span', null, h('strong', null, '#' + p.number), p.name ? ' ' + p.name : '', T.captain === p.id ? ' (C)' : '') : h('span', { class: 'muted' }, i === next ? 'Tap a player below' : '—'));
      })),
      h('div', { class: 'chips' }, roster.filter((p) => !p.libero).sort((a, b) => +a.number - +b.number).map((p) => h('button', { class: 'pchip' + (T.order.includes(p.id) ? ' used' : ''), onclick: () => { const k = T.order.indexOf(null); if (k >= 0 && !T.order.includes(p.id)) { T.order[k] = p.id; draw(); } } }, '#' + p.number, p.name ? h('small', null, p.name) : null))),
      libs.length ? h('div', null, h('div', { class: 'muted', style: { fontWeight: 700, margin: '6px 0 2px' } }, 'Libero for this set'),
        h('div', { class: 'chips' }, h('button', { class: 'pchip' + (!T.libero ? ' sel' : ''), onclick: () => { T.libero = null; draw(); } }, 'None'),
          libs.map((p) => h('button', { class: 'pchip lib' + (T.libero === p.id ? ' sel' : ''), onclick: () => { T.libero = p.id; draw(); } }, '#' + p.number, p.name ? h('small', null, p.name) : null)))) : null,
      h('details', { class: 'adv' }, h('summary', null, 'Playing captain (optional)'),
        h('div', { class: 'chips' }, h('button', { class: 'pchip' + (!T.captain ? ' sel' : ''), onclick: () => { T.captain = null; draw(); } }, 'None'),
          T.order.filter(Boolean).map((id) => { const p = roster.find((x) => x.id === id); return h('button', { class: 'pchip' + (T.captain === id ? ' sel' : ''), onclick: () => { T.captain = id; draw(); } }, '#' + p.number); }))));
  }
  draw();
  return {
    el,
    valid: () => ['home', 'away'].every((s) => L[s].order.every(Boolean)) && !!L.firstServe,
  };
}

// ------------------------------------------------------------------ next-set lineup
async function mountLineupOnly(root, id, ctx) {
  const session = await ctx.session(id);
  if (!session) { ctx.go('/'); return null; }
  const S = session.S;
  if (S.matchOver) { ctx.go('/sheet/' + id); return null; }
  if (S.cur) { ctx.go('/game/' + id); return null; }
  const n = S.sets.length + 1;
  const prev = S.sets[S.sets.length - 1];
  const mk = (side) => {
    if (!prev) return { order: Array(6).fill(null), libero: null, captain: null };
    const ts = prev[side];
    return { order: ts.start.slice(), libero: ts.libero, captain: ts.captain };
  };
  const L = { home: mk('home'), away: mk('away'), firstServe: null };
  const rules = rulesOf(session.rec.setup);
  const deciding = n >= rules.bestOf;
  let suggest = null, note = null;
  if (deciding) note = `Set ${n} is the deciding set — the referee does a new coin toss. Pick the team that won it.`;
  else if (prev) {
    // NFHS: the team that did not serve first in set 1 serves first in set 2, then they alternate.
    const firstOfSet1 = S.sets[0].firstServe;
    suggest = n % 2 === 1 ? firstOfSet1 : other(firstOfSet1);
    note = `Sets alternate who serves first. Suggested: ${session.rec.setup[suggest].name}.`;
    L.firstServe = suggest;
  }
  const ed = lineupEditor(session.rec.setup, L, () => { const b = root.querySelector('[data-start]'); if (b) b.disabled = !ed.valid(); }, { suggestFirst: suggest, note });
  const startBtn = h('button', { class: 'btn green big', 'data-start': '1', 'data-tour': 'start-game', disabled: !ed.valid(), onclick: async () => {
    const r = await session.add(cmd.setStart(L.home, L.away, L.firstServe));
    if (!r.ok) { toast(r.errors[0] || 'Could not start the set'); return; }
    ctx.go('/game/' + id);
  } }, `Start set ${n}`);
  root.append(
    h('h1', { class: 'page-title' }, `Set ${n}: lineup`),
    h('p', { class: 'sub' }, `${session.rec.setup.home.name} ${S.setsWon.home} – ${S.setsWon.away} ${session.rec.setup.away.name}. Change the serving order if the coach switched players.`),
    ed.el,
    h('div', { class: 'footbar' }, h('button', { class: 'btn ghost', onclick: () => ctx.go('/game/' + id) }, '← Back'), startBtn));
  return null;
}
