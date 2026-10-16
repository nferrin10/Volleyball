// Local storage. IndexedDB when available, in-memory + localStorage fallback otherwise.
// Everything the app needs works with no network.

const DB_NAME = 'vb-gameday';
const STORES = ['games', 'teams', 'kv'];
let dbp = null;
let mem = null;

function openDB() {
  if (dbp) return dbp;
  dbp = new Promise((resolve, reject) => {
    if (!('indexedDB' in globalThis)) return reject(new Error('no idb'));
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      for (const s of STORES) if (!db.objectStoreNames.contains(s)) db.createObjectStore(s, { keyPath: s === 'kv' ? 'key' : 'id' });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
    req.onblocked = () => reject(new Error('blocked'));
  }).catch((e) => { console.warn('IndexedDB unavailable, using localStorage fallback', e); return null; });
  return dbp;
}

function lsLoad() {
  if (mem) return mem;
  try { mem = JSON.parse(localStorage.getItem('vb-fallback') || 'null'); } catch { mem = null; }
  mem = mem || { games: {}, teams: {}, kv: {} };
  return mem;
}
function lsSave() { try { localStorage.setItem('vb-fallback', JSON.stringify(mem)); } catch (e) { console.warn('save failed', e); } }

function tx(db, store, mode, fn) {
  return new Promise((resolve, reject) => {
    const t = db.transaction(store, mode);
    const s = t.objectStore(store);
    let out;
    const r = fn(s);
    if (r) r.onsuccess = () => { out = r.result; };
    t.oncomplete = () => resolve(out);
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error);
  });
}

export const store = {
  async put(kind, rec) {
    const db = await openDB();
    if (!db) { lsLoad()[kind][rec.id ?? rec.key] = JSON.parse(JSON.stringify(rec)); lsSave(); return; }
    await tx(db, kind, 'readwrite', (s) => s.put(JSON.parse(JSON.stringify(rec))));
  },
  async get(kind, id) {
    const db = await openDB();
    if (!db) return lsLoad()[kind][id] || null;
    return (await tx(db, kind, 'readonly', (s) => s.get(id))) || null;
  },
  async all(kind) {
    const db = await openDB();
    if (!db) return Object.values(lsLoad()[kind]);
    return (await tx(db, kind, 'readonly', (s) => s.getAll())) || [];
  },
  async del(kind, id) {
    const db = await openDB();
    if (!db) { delete lsLoad()[kind][id]; lsSave(); return; }
    await tx(db, kind, 'readwrite', (s) => s.delete(id));
  },
  async getKV(key, dflt = null) {
    const r = await this.get('kv', key);
    return r ? r.value : dflt;
  },
  async setKV(key, value) { await this.put('kv', { key, value }); },
};
