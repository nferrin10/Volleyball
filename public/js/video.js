// YouTube link helpers (pure, no DOM). A channel's /live address always opens whatever that
// channel is streaming right now, so families only ever need one link per channel.

const bad = () => ({ ok: false });
const channel = (path) => ({ ok: true, kind: 'channel', url: `https://www.youtube.com/${path}/live`, label: path.startsWith('@') ? path : '' });
const video = (id) => ({ ok: true, kind: 'video', url: `https://www.youtube.com/watch?v=${id}`, label: '' });

// Accepts @handle, a channel link, or a link to one specific video.
export function parseYouTube(input) {
  const raw = String(input || '').trim();
  if (!raw) return bad();
  let m = /^@([\w.-]{3,})$/.exec(raw);
  if (m) return channel('@' + m[1]);
  let u;
  try { u = new URL(/^https?:\/\//i.test(raw) ? raw : 'https://' + raw); } catch { return bad(); }
  const host = u.hostname.toLowerCase();
  if (host === 'youtu.be') {
    const id = u.pathname.slice(1).split('/')[0];
    return id ? video(id) : bad();
  }
  if (!/^(?:www\.|m\.)?youtube\.com$/.test(host)) return bad();
  const p = u.pathname.replace(/\/+$/, '');
  if (p === '/watch') { const v = u.searchParams.get('v'); return v ? video(v) : bad(); }
  if ((m = /^\/(?:live|shorts|embed)\/([\w-]{6,})/.exec(p))) return video(m[1]);
  if ((m = /^\/(@[\w.-]+)/.exec(p))) return channel(m[1]);
  if ((m = /^\/(channel\/[\w-]+|c\/[^/]+|user\/[^/]+)/.exec(p))) return channel(m[1]);
  return bad();
}

export function shareText(setup) {
  const s = setup && setup.home && setup.away && setup.home.name && setup.away.name;
  return s ? `Watch ${setup.home.name} vs ${setup.away.name} live:` : 'Watch our game live:';
}
