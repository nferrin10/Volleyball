// Volleyball Game Day server: serves the app and (optionally) syncs games between devices.
// No dependencies — just Node 18+.  Run:  node server/server.js
//
//   PORT          default 8080
//   DATA_DIR      default ./data   (users + games, one JSON file)
//   INVITE_CODE   if set, new accounts must supply it (recommended when hosted publicly)
//
// Conflict protection: every game has a revision number. A device may only save with the
// revision it last saw (otherwise 409), and only while it holds the game's "scorekeeper
// lease" (otherwise 423). Leases expire after 2 minutes without a heartbeat.

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC = path.join(__dirname, '..', 'public');
const PORT = +process.env.PORT || 8080;
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, '..', 'data');
const INVITE = process.env.INVITE_CODE || '';
const LEASE_MS = 120000;
const MAX_BODY = 8 * 1024 * 1024;

fs.mkdirSync(DATA_DIR, { recursive: true });
const DB_FILE = path.join(DATA_DIR, 'db.json');
let db = { users: {}, sessions: {}, games: {} };
try { db = { ...db, ...JSON.parse(fs.readFileSync(DB_FILE, 'utf8')) }; } catch { /* first run */ }
let saveTimer = null;
function save() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(flush, 200);
}
function flush() {
  const tmp = DB_FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(db));
  fs.renameSync(tmp, DB_FILE);
}
process.on('SIGTERM', () => { flush(); process.exit(0); });
process.on('SIGINT', () => { flush(); process.exit(0); });

const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.png': 'image/png', '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.pdf': 'application/pdf' };

const send = (res, code, obj) => {
  const body = JSON.stringify(obj);
  res.writeHead(code, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
  res.end(body);
};
function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0; const chunks = [];
    req.on('data', (c) => { size += c.length; if (size > MAX_BODY) { reject(new Error('too large')); req.destroy(); } else chunks.push(c); });
    req.on('end', () => { try { resolve(chunks.length ? JSON.parse(Buffer.concat(chunks).toString()) : {}); } catch (e) { reject(e); } });
    req.on('error', reject);
  });
}
const hashPw = (pw, salt) => crypto.scryptSync(pw, salt, 32).toString('hex');
const tokenOf = (req) => (req.headers.authorization || '').replace(/^Bearer /, '');
function userOf(req) {
  const s = db.sessions[tokenOf(req)];
  if (!s || s.expires < Date.now()) return null;
  return db.users[s.user] || null;
}
const attempts = new Map();
function throttled(ip) {
  const now = Date.now();
  const a = (attempts.get(ip) || []).filter((t) => now - t < 60000);
  a.push(now); attempts.set(ip, a);
  return a.length > 15;
}
const leaseView = (g) => (g.lease && g.lease.expiresAt > Date.now() ? g.lease : null);
const summary = (g) => ({ id: g.id, rev: g.rev, updatedAt: g.updatedAt, title: g.title, practice: false, lease: leaseView(g) });

async function api(req, res, url) {
  const parts = url.pathname.split('/').filter(Boolean).slice(1); // after "api"
  const method = req.method;
  const ip = req.socket.remoteAddress;
  if (parts[0] === 'ping') return send(res, 200, { ok: true, time: Date.now() });
  if (parts[0] === 'register' && method === 'POST') {
    if (throttled(ip)) return send(res, 429, { error: 'Too many tries. Wait a minute.' });
    const b = await readBody(req);
    const email = String(b.email || '').trim().toLowerCase();
    if (!/^\S+@\S+\.\S+$/.test(email)) return send(res, 400, { error: 'Enter a valid email.' });
    if (String(b.password || '').length < 8) return send(res, 400, { error: 'Password must be at least 8 characters.' });
    if (INVITE && b.invite !== INVITE) return send(res, 403, { error: 'That invite code is not right.' });
    if (db.users[email]) return send(res, 409, { error: 'That email already has an account. Sign in instead.' });
    const salt = crypto.randomBytes(16).toString('hex');
    db.users[email] = { email, name: String(b.name || email).slice(0, 80), salt, hash: hashPw(b.password, salt), created: Date.now() };
    save();
    return send(res, 200, newSession(email));
  }
  if (parts[0] === 'login' && method === 'POST') {
    if (throttled(ip)) return send(res, 429, { error: 'Too many tries. Wait a minute.' });
    const b = await readBody(req);
    const u = db.users[String(b.email || '').trim().toLowerCase()];
    if (!u || !crypto.timingSafeEqual(Buffer.from(hashPw(String(b.password || ''), u.salt), 'hex'), Buffer.from(u.hash, 'hex'))) return send(res, 401, { error: 'Email or password is not right.' });
    return send(res, 200, newSession(u.email));
  }
  const user = userOf(req);
  if (!user) return send(res, 401, { error: 'Please sign in.' });
  if (parts[0] === 'me') return send(res, 200, { user: { email: user.email, name: user.name } });
  if (parts[0] === 'logout' && method === 'POST') { delete db.sessions[tokenOf(req)]; save(); return send(res, 200, { ok: true }); }

  if (parts[0] === 'games') {
    const mine = Object.values(db.games).filter((g) => g.owner === user.email && !g.deleted);
    if (parts.length === 1 && method === 'GET') return send(res, 200, { games: mine.map(summary) });
    const id = parts[1];
    const g = db.games[id];
    if (g && g.owner !== user.email) return send(res, 404, { error: 'Not found' });
    const sub = parts[2];

    if (sub === 'lease') {
      const b = method === 'DELETE' ? {} : await readBody(req);
      if (!g) return send(res, 404, { error: 'Not found' });
      if (method === 'DELETE') {
        if (g.lease && g.lease.deviceId === req.headers['x-device-id']) { g.lease = null; save(); }
        return send(res, 200, { ok: true });
      }
      const held = leaseView(g);
      if (held && held.deviceId !== b.deviceId && !b.force) return send(res, 423, { error: 'Another device is scoring this game.', lease: held });
      g.lease = { deviceId: b.deviceId, name: String(b.deviceName || 'A device').slice(0, 60), expiresAt: Date.now() + LEASE_MS, since: held && held.deviceId === b.deviceId ? held.since : Date.now() };
      save();
      return send(res, 200, { ok: true, lease: g.lease, rev: g.rev });
    }
    if (method === 'GET' && g) return send(res, 200, { id: g.id, rev: g.rev, game: g.game, lease: leaseView(g), updatedAt: g.updatedAt });
    if (method === 'GET') return send(res, 404, { error: 'Not found' });
    if (method === 'PUT') {
      const b = await readBody(req);
      if (!b.game || !b.game.setup || !Array.isArray(b.game.events)) return send(res, 400, { error: 'Bad game' });
      if (!g) {
        db.games[id] = { id, owner: user.email, rev: 1, game: b.game, title: titleOf(b.game), updatedAt: Date.now(), lease: b.deviceId ? { deviceId: b.deviceId, name: String(b.deviceName || 'A device').slice(0, 60), expiresAt: Date.now() + LEASE_MS, since: Date.now() } : null };
        save();
        return send(res, 200, { rev: 1 });
      }
      const held = leaseView(g);
      if (held && held.deviceId !== b.deviceId) return send(res, 423, { error: 'Another device is scoring this game.', lease: held, rev: g.rev });
      if (b.baseRev !== g.rev) return send(res, 409, { error: 'This game changed on another device.', rev: g.rev, game: g.game });
      g.game = b.game; g.rev++; g.title = titleOf(b.game); g.updatedAt = Date.now();
      if (b.deviceId) g.lease = { deviceId: b.deviceId, name: String(b.deviceName || (held && held.name) || 'A device').slice(0, 60), expiresAt: Date.now() + LEASE_MS, since: held ? held.since : Date.now() };
      save();
      return send(res, 200, { rev: g.rev });
    }
    if (method === 'DELETE' && g) { g.deleted = true; g.rev++; save(); return send(res, 200, { ok: true }); }
  }
  return send(res, 404, { error: 'Not found' });
}
const titleOf = (game) => `${game.setup.home.name} vs ${game.setup.away.name} (${game.setup.date || ''})`;
function newSession(email) {
  const token = crypto.randomBytes(32).toString('hex');
  db.sessions[token] = { user: email, expires: Date.now() + 90 * 86400000 };
  save();
  return { token, user: { email, name: db.users[email].name } };
}

function serveStatic(req, res, url) {
  let p = decodeURIComponent(url.pathname);
  if (p.endsWith('/')) p += 'index.html';
  const file = path.normalize(path.join(PUBLIC, p));
  if (!file.startsWith(PUBLIC)) { res.writeHead(403); return res.end(); }
  fs.stat(file, (err, st) => {
    const target = !err && st.isFile() ? file : path.join(PUBLIC, 'index.html');
    fs.readFile(target, (e2, buf) => {
      if (e2) { res.writeHead(404); return res.end('Not found'); }
      const ext = path.extname(target);
      const headers = { 'Content-Type': MIME[ext] || 'application/octet-stream', 'X-Content-Type-Options': 'nosniff' };
      if (target.endsWith('sw.js') || target.endsWith('index.html')) headers['Cache-Control'] = 'no-cache';
      res.writeHead(200, headers);
      res.end(buf);
    });
  });
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  try {
    if (url.pathname.startsWith('/api/')) await api(req, res, url);
    else serveStatic(req, res, url);
  } catch (e) {
    console.error(e);
    if (!res.headersSent) send(res, 500, { error: 'Server error' });
  }
});
server.listen(PORT, () => console.log(`Volleyball Game Day on http://localhost:${PORT}  (data: ${DATA_DIR}${INVITE ? ', invite code required' : ''})`));
export { server };
