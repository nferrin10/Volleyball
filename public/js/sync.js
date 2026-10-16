// Client side of syncing. Everything works offline; when signed in and online, games are
// pushed/pulled in the background. A device must hold the game's scorekeeper "lease" to
// save changes, which is what prevents two people from editing the same game at once.
import { store } from './store.js';
import { activeEvents, uid } from './engine/engine.js';

const state = { status: 'signed-out', message: '', user: null, listeners: new Set() };
let cfg = { token: null, user: null, deviceId: null, deviceName: null, base: '' };
let timer = null, pushTimer = null, busy = false;

export const sync = {
  get state() { return state; },
  on(fn) { state.listeners.add(fn); return () => state.listeners.delete(fn); },
  get deviceId() { return cfg.deviceId; },
  get signedIn() { return !!cfg.token; },

  async init() {
    cfg = { ...cfg, ...(await store.getKV('sync', {})) };
    if (!cfg.deviceId) { cfg.deviceId = 'dev-' + uid(); cfg.deviceName = guessDeviceName(); await store.setKV('sync', cfg); }
    set(cfg.token ? 'idle' : 'signed-out', '', cfg.user);
    globalThis.addEventListener('online', () => this.schedule(300));
    globalThis.addEventListener('offline', () => set(cfg.token ? 'offline' : 'signed-out', 'Offline — saved on this device'));
    globalThis.addEventListener('vb-game-changed', () => this.schedule(1500));
    clearInterval(timer);
    timer = setInterval(() => this.syncAll().catch(() => {}), 30000);
    if (cfg.token) this.schedule(800);
  },

  async api(method, url, body) {
    const res = await fetch((cfg.base || '') + url, {
      method, headers: { 'Content-Type': 'application/json', ...(cfg.token ? { Authorization: 'Bearer ' + cfg.token } : {}), 'X-Device-Id': cfg.deviceId },
      body: body ? JSON.stringify(body) : undefined,
    });
    let data = {};
    try { data = await res.json(); } catch { /* empty */ }
    return { status: res.status, ok: res.ok, data };
  },

  async auth(kind, fields) {
    const r = await this.api('POST', '/api/' + kind, fields);
    if (!r.ok) throw new Error(r.data.error || 'Could not sign in');
    cfg.token = r.data.token; cfg.user = r.data.user;
    await store.setKV('sync', cfg);
    set('idle', '', cfg.user);
    this.schedule(200);
    return r.data.user;
  },
  async signOut() {
    try { await this.api('POST', '/api/logout'); } catch { /* offline */ }
    cfg.token = null; cfg.user = null;
    await store.setKV('sync', cfg);
    set('signed-out', '', null);
  },
  async setDeviceName(n) { cfg.deviceName = n; await store.setKV('sync', cfg); },
  get deviceName() { return cfg.deviceName; },

  schedule(ms = 1500) {
    if (!cfg.token) return;
    clearTimeout(pushTimer);
    pushTimer = setTimeout(() => this.syncAll().catch(() => {}), ms);
  },

  async syncAll() {
    if (!cfg.token || busy) return;
    if (!navigator.onLine) { set('offline', 'Offline — saved on this device'); return; }
    busy = true; set('syncing', 'Syncing…');
    try {
      const list = await this.api('GET', '/api/games');
      if (list.status === 401) { cfg.token = null; await store.setKV('sync', cfg); set('signed-out', 'Please sign in again'); return; }
      if (!list.ok) throw new Error('server');
      const remote = new Map(list.data.games.map((g) => [g.id, g]));
      const locals = (await store.all('games')).filter((g) => !g.practice);
      for (const g of locals) {
        const r = remote.get(g.id);
        if (g.deleted) { if (r) await this.api('DELETE', '/api/games/' + g.id); await store.del('games', g.id); continue; }
        if (!r) { if (g.dirty || !g.rev) await this.push(g); continue; }
        if (g.dirty) await this.push(g);
        else if (r.rev > g.rev) await this.pull(g.id);
      }
      for (const [id] of remote) if (!locals.some((g) => g.id === id)) await this.pull(id);
      set('idle', 'All changes saved', cfg.user);
      globalThis.dispatchEvent(new CustomEvent('vb-synced'));
    } catch (e) {
      set('error', 'Could not reach the server — will retry');
    } finally { busy = false; }
  },

  payload(g) { return { setup: g.setup, events: g.events, createdAt: g.createdAt }; },

  async push(g) {
    const r = await this.api('PUT', '/api/games/' + g.id, { baseRev: g.rev || 0, game: this.payload(g), deviceId: cfg.deviceId, deviceName: cfg.deviceName });
    if (r.ok) {
      const cur = (await store.get('games', g.id)) || g;
      cur.rev = r.data.rev;
      // events added while the request was in flight keep the game dirty
      cur.dirty = cur.events.length !== g.events.length;
      await store.put('games', cur);
      return 'pushed';
    }
    if (r.status === 409 || r.status === 423) return this.resolve(g, r);
    throw new Error('push failed');
  },

  async resolve(local, r) {
    const server = r.data.game;
    if (!server) { // locked, no payload: fetch current to compare
      const cur = await this.api('GET', '/api/games/' + local.id);
      if (!cur.ok) return 'locked';
      r.data.game = cur.data.game; r.data.rev = cur.data.rev;
    }
    const sIds = r.data.game.events.map((e) => e.id);
    const lIds = local.events.map((e) => e.id);
    const isPrefix = (a, b) => a.length <= b.length && a.every((id, i) => id === b[i]);
    if (isPrefix(sIds, lIds) && r.status === 409) { local.rev = r.data.rev; await store.put('games', local); return this.push(local); }
    if (isPrefix(lIds, sIds)) { await this.adopt(local.id, r.data); return 'adopted'; }
    // diverged: keep both. The other device's version wins; this device's version is saved as a copy.
    const copy = { ...local, id: 'g-' + uid(), rev: 0, dirty: true, setup: { ...local.setup, site: (local.setup.site || '') }, conflictOf: local.id, createdAt: Date.now(), updatedAt: Date.now() };
    copy.setup = { ...copy.setup };
    copy.title = 'Copy from this device';
    await store.put('games', copy);
    await this.adopt(local.id, r.data);
    globalThis.dispatchEvent(new CustomEvent('vb-conflict', { detail: { id: local.id, copy: copy.id } }));
    return 'conflict';
  },

  async adopt(id, data) {
    const cur = (await store.get('games', id)) || {};
    const g = data.game;
    await store.put('games', { ...cur, id, practice: false, setup: g.setup, events: g.events, createdAt: g.createdAt || cur.createdAt || Date.now(), updatedAt: Date.now(), rev: data.rev, dirty: false });
    globalThis.dispatchEvent(new CustomEvent('vb-game-pulled', { detail: { id } }));
  },

  async pull(id) {
    const r = await this.api('GET', '/api/games/' + id);
    if (!r.ok) return;
    await this.adopt(id, r.data);
  },

  // ----- scorekeeper lease -----
  async acquireLease(id, force = false) {
    if (!cfg.token || !navigator.onLine) return { ok: true, offline: true };
    try {
      const r = await this.api('POST', `/api/games/${id}/lease`, { deviceId: cfg.deviceId, deviceName: cfg.deviceName, force });
      if (r.status === 404) return { ok: true, unsynced: true };
      if (r.status === 423) return { ok: false, lease: r.data.lease };
      return { ok: r.ok, lease: r.data.lease };
    } catch { return { ok: true, offline: true }; }
  },
  async releaseLease(id) { if (cfg.token && navigator.onLine) { try { await this.api('DELETE', `/api/games/${id}/lease`); } catch { /* ignore */ } } },
  async remoteRev(id) {
    if (!cfg.token || !navigator.onLine) return null;
    try { const r = await this.api('GET', '/api/games/' + id); return r.ok ? r.data : null; } catch { return null; }
  },
};

function set(status, message, user) {
  state.status = status; state.message = message || ''; if (user !== undefined) state.user = user;
  for (const fn of state.listeners) fn(state);
}
function guessDeviceName() {
  const ua = navigator.userAgent || '';
  if (/iPad/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1)) return 'iPad';
  if (/iPhone/.test(ua)) return 'iPhone';
  if (/Android/.test(ua)) return 'Android';
  if (/Macintosh/.test(ua)) return 'Mac';
  if (/Windows/.test(ua)) return 'Windows PC';
  return 'This device';
}
void activeEvents;
