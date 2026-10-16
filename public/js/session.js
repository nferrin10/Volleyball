// A GameSession wraps one stored game: it owns the event list, derives the
// state, saves after every change, and tells the UI to redraw.
import { buildState, validate, activeEvents, cmd, lastOpenRally, isPointKind, previewVoid, uid } from './engine/engine.js';
import { store } from './store.js';

export async function createGame(setup, { practice = false } = {}) {
  const rec = { id: (practice ? 'practice-' : 'g-') + uid(), practice, createdAt: Date.now(), updatedAt: Date.now(), setup, events: [], rev: 0, dirty: !practice };
  await store.put('games', rec);
  return rec;
}
export async function listGames({ practice = false } = {}) {
  const all = await store.all('games');
  return all.filter((g) => !!g.practice === practice && !g.deleted).sort((a, b) => b.updatedAt - a.updatedAt);
}

export class Session {
  constructor(rec) {
    this.rec = rec;
    this.listeners = new Set();
    this.redoStack = [];
    this.readOnly = false;
    this.rebuild();
  }
  rebuild() { this.S = buildState(this.rec.setup, this.rec.events); }
  subscribe(fn) { this.listeners.add(fn); return () => this.listeners.delete(fn); }
  emit() { for (const fn of this.listeners) fn(this); }
  get events() { return this.rec.events; }

  async persist(touchDirty = true) {
    this.rec.updatedAt = Date.now();
    if (touchDirty && !this.rec.practice) this.rec.dirty = true;
    await store.put('games', this.rec);
    if (!this.rec.practice) globalThis.dispatchEvent(new CustomEvent('vb-game-changed', { detail: { id: this.rec.id } }));
  }

  check(ev) { return validate(this.S, ev); }

  // Adds an event after validation. Returns {ok, errors, warnings}. Warnings need override.
  async add(ev, { override = false } = {}) {
    if (this.readOnly) return { ok: false, errors: ['This game is open for viewing only. Tap "Take over" to score it here.'], warnings: [] };
    const v = validate(this.S, ev);
    if (v.errors.length) return { ok: false, ...v };
    if (v.warnings.length && !override) return { ok: false, needsConfirm: true, ...v };
    if (v.warnings.length && override) ev.override = true;
    this.rec.events.push(ev);
    this.redoStack = [];
    this.rebuild();
    await this.persist();
    this.emit();
    return { ok: true, errors: [], warnings: v.warnings };
  }

  async updateSetup(patch) {
    Object.assign(this.rec.setup, patch);
    this.rebuild();
    await this.persist();
    this.emit();
  }

  lastActive() {
    const act = activeEvents(this.rec.events);
    return act.length ? act[act.length - 1] : null;
  }

  async undo() {
    if (this.readOnly) return null;
    const last = this.lastActive();
    if (!last) return null;
    const v = cmd.void(last.id);
    this.rec.events.push(v);
    this.redoStack.push(v.id);
    this.rebuild();
    await this.persist();
    this.emit();
    return last;
  }
  canRedo() { return this.redoStack.length > 0; }
  async redo() {
    if (this.readOnly) return null;
    const vid = this.redoStack.pop();
    if (!vid) return null;
    this.rec.events.push(cmd.void(vid)); // voiding the void brings the event back
    this.rebuild();
    await this.persist();
    this.emit();
    return true;
  }

  // Remove one event from the middle of the history, only if nothing later depends on it.
  async removeEvent(id) {
    const r = previewVoid(this.rec.setup, this.rec.events, id);
    if (r.newInvalid.length) return { ok: false, reason: 'Later plays depend on this one. Undo those first, then try again.' };
    this.rec.events.push(cmd.void(id));
    this.redoStack = [];
    this.rebuild();
    await this.persist();
    this.emit();
    return { ok: true };
  }

  // Point-type stats tapped right after a point belong to that point; otherwise they wait for the next one.
  statTarget(kind, team) {
    if (!isPointKind(kind)) return null;
    const r = lastOpenRally(this.S, this.rec.events);
    if (!r) return null;
    const primary = r.stats.find((x) => isPointKind(x.kind));
    const winnerKind = kind === 'ace' || kind === 'kill' || kind === 'block';
    if (winnerKind && team !== r.winner) return null;
    if (!winnerKind && team === r.winner) return null;
    if (kind === 'ace' && r.sideout) return null;
    if (primary && !(primary.kind === 'block' && kind === 'block')) return null;
    return r.id;
  }
  async addStat(team, kind, player) {
    const rally = this.statTarget(kind, team);
    return this.add(cmd.stat(team, kind, player, rally));
  }
}
