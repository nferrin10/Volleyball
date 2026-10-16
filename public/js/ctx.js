// Shared app context: routing + cached game sessions.
import { store } from './store.js';
import { Session } from './session.js';

const sessions = new Map();
export const ctx = {
  go(path) { if (location.hash === '#' + path) globalThis.dispatchEvent(new HashChangeEvent('hashchange')); else location.hash = '#' + path; },
  get route() { return (location.hash || '#/').slice(1) || '/'; },
  async session(id) {
    let s = sessions.get(id);
    if (!s) {
      const rec = await store.get('games', id);
      if (!rec) return null;
      s = new Session(rec);
      sessions.set(id, s);
    }
    return s;
  },
  drop(id) { sessions.delete(id); },
  peek(id) { return sessions.get(id) || null; },
  tour: null,
};

// When a game is updated by a sync pull, refresh the cached session.
globalThis.addEventListener('vb-game-pulled', async (e) => {
  const s = sessions.get(e.detail.id);
  if (!s) return;
  const rec = await store.get('games', e.detail.id);
  if (!rec) return;
  s.rec = rec; s.rebuild(); s.emit();
});
