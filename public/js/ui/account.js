import { h, toast } from '../util.js';
import { sync } from '../sync.js';

export async function mount(root, p, ctx) {
  const box = h('div');
  let mode = 'login';
  function draw() {
    const st = sync.state;
    box.replaceChildren();
    if (sync.signedIn) {
      box.append(h('div', { class: 'card' },
        h('h2', null, 'Signed in'), h('p', null, st.user ? `${st.user.name || ''} ${st.user.email}` : ''),
        h('p', { class: 'muted' }, st.message || 'Games sync automatically when you are online.'),
        h('label', { class: 'field' }, h('span', null, 'Name of this device (shown to others when scoring)'), (() => { const i = h('input', { class: 'inp', value: sync.deviceName }); i.addEventListener('change', () => sync.setDeviceName(i.value.trim() || 'This device')); return i; })()),
        h('div', { class: 'btnrow' }, h('button', { class: 'btn primary', onclick: async () => { await sync.syncAll(); draw(); toast('Synced'); } }, 'Sync now'), h('button', { class: 'btn ghost', onclick: async () => { await sync.signOut(); draw(); } }, 'Sign out'))),
        h('div', { class: 'card' }, h('h3', null, 'How syncing works'), h('p', { class: 'muted' }, 'Everything is saved on this device first, so it works with no WiFi. When you are online your games are copied to your account so you can open them on another phone, iPad or laptop. Only one device scores a game at a time; the others can watch.')));
      return;
    }
    const email = h('input', { class: 'inp', type: 'email', autocomplete: 'email', placeholder: 'you@example.com' });
    const pw = h('input', { class: 'inp', type: 'password', autocomplete: mode === 'login' ? 'current-password' : 'new-password', placeholder: 'Password (8+ characters)' });
    const nm = h('input', { class: 'inp', type: 'text', placeholder: 'Your name' });
    const inv = h('input', { class: 'inp', type: 'text', placeholder: 'Invite code (if your coach gave you one)' });
    const err = h('div', { class: 'banner bad', hidden: true });
    const go = async () => {
      err.hidden = true;
      try { await sync.auth(mode === 'login' ? 'login' : 'register', { email: email.value, password: pw.value, name: nm.value, invite: inv.value }); toast('Signed in'); draw(); }
      catch (e) { err.textContent = /Failed to fetch|NetworkError/.test(e.message) ? 'No connection to the server. Games are still saved on this device.' : e.message; err.hidden = false; }
    };
    box.append(h('div', { class: 'card' },
      h('h2', { style: { marginBottom: '6px' } }, 'Sync between devices'),
      h('p', { class: 'muted' }, 'Optional. Sign in on each device to open the same games on your phone, iPad and laptop. The app works without it.'),
      h('div', { class: 'seg', style: { margin: '6px 0 12px' } }, h('button', { class: mode === 'login' ? 'on' : '', onclick: () => { mode = 'login'; draw(); } }, 'Sign in'), h('button', { class: mode === 'register' ? 'on' : '', onclick: () => { mode = 'register'; draw(); } }, 'Create account')),
      mode === 'register' ? h('label', { class: 'field' }, h('span', null, 'Name'), nm) : null,
      h('label', { class: 'field' }, h('span', null, 'Email'), email), h('label', { class: 'field' }, h('span', null, 'Password'), pw),
      mode === 'register' ? h('label', { class: 'field' }, h('span', null, 'Invite code'), inv) : null,
      err, h('button', { class: 'btn primary big block', onclick: go }, mode === 'login' ? 'Sign in' : 'Create account')));
  }
  root.append(h('h1', { class: 'page-title' }, 'Sync & account'), box);
  draw();
  const off = sync.on(draw);
  return off;
}
