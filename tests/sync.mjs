import { launch, BASE, DEVICES, track } from './lib.mjs';
const SP = process.argv[2];
const assert = (c, m) => { if (!c) { console.error('FAIL:', m); process.exitCode = 1; } else console.log('• ok:', m); };
const browser = await launch();
const errs = [];
const email = `coach${Date.now()}@example.com`;

async function setupGame(page) {
  await page.getByText('New Game').first().click();
  for (const [side, name, nums] of [['home', 'Wolves', '1 2 3 4 5 6 7'], ['away', 'Hawks', '21 22 23 24 25 26 27']]) {
    const card = page.locator(`[data-tour="team-${side}"]`);
    await card.locator('input[placeholder*="team name"]').fill(name);
    await card.locator('input[placeholder^="Quick add"]').fill(nums);
    await card.getByText('Add all').click();
  }
  await page.getByText('Next: lineup').click();
  for (const side of ['home', 'away']) { const c = page.locator(`[data-tour="lineup-${side}"]`); for (let i = 0; i < 6; i++) await c.locator('.chips .pchip:not(.used)').first().click(); }
  await page.locator('[data-tour="first-serve"] .serve-pick button.home').click();
  await page.locator('[data-tour="start-game"]').click();
  await page.waitForSelector('[data-tour="point-home"]');
}
const pt = async (page, t) => { await page.locator(`[data-tour="point-${t}"]`).click(); await page.waitForTimeout(340); };
const token = (page) => page.evaluate(async () => (await window.vb.store.getKV('sync')).token);
const api = (page, path) => page.evaluate(async (p) => { const t = (await window.vb.store.getKV('sync')).token; const r = await fetch(p, { headers: { Authorization: 'Bearer ' + t } }); return r.json(); }, path);

// ---- device A: iPad
const ctxA = await browser.newContext({ ...DEVICES.ipadL, serviceWorkers: 'allow' });
const A = await ctxA.newPage(); track(A, errs);
await A.goto(BASE + '/');
await A.getByText('SKIP TOUR').click();
await A.locator('#sync-chip').click();
await A.getByRole('button', { name: 'Create account' }).first().click();
await A.locator('input[type=email]').fill(email);
await A.locator('input[type=password]').fill('hunter2hunter2');
await A.getByPlaceholder('Your name').fill('Coach');
await A.getByRole('button', { name: 'Create account' }).last().click();
await A.getByText('Signed in').first().waitFor();
await A.goto(BASE + '/#/');
await setupGame(A);
await pt(A, 'home'); await pt(A, 'home'); await pt(A, 'away');
await A.waitForTimeout(2500);
let list = await api(A, '/api/games');
assert(list.games.length === 1, 'game synced to the server after scoring');
const gid = list.games[0].id;
assert(!!list.games[0].lease, 'iPad holds the scorekeeper lease');

// ---- offline: service worker serves the app, scoring keeps working
await A.evaluate(() => navigator.serviceWorker.ready);
await A.waitForTimeout(1500);
await ctxA.setOffline(true);
await A.reload();
await A.waitForSelector('[data-tour="point-home"]', { timeout: 15000 }).catch(async () => { await A.goto(BASE + '/#/game/' + gid); });
await A.waitForSelector('[data-tour="point-home"]');
assert(true, 'app reloaded with no network (service worker)');
await pt(A, 'home'); await pt(A, 'home');
const offScore = await A.locator('.tcard.home .sc').innerText();
assert(offScore === '4', 'scored offline (Wolves 4)');
const stored = await A.evaluate(async (id) => { const g = await window.vb.store.get('games', id); return { dirty: g.dirty, n: g.events.length }; }, gid);
assert(stored.dirty === true, 'offline plays are queued as unsynced');
await ctxA.setOffline(false);
await A.evaluate(() => window.vb.sync.syncAll());
await A.waitForTimeout(1500);
const srv = await api(A, '/api/games/' + gid);
assert(srv.game.events.length === stored.n, 'offline plays synced when WiFi returned');

// ---- device B: iPhone, signs in, sees the game, is read-only while iPad is scoring
const ctxB = await browser.newContext({ ...DEVICES.iphone });
const B = await ctxB.newPage(); track(B, errs);
await B.goto(BASE + '/');
await B.getByText('SKIP TOUR').click();
await B.locator('#sync-chip').click();
await B.locator('input[type=email]').fill(email);
await B.locator('input[type=password]').fill('hunter2hunter2');
await B.getByRole('button', { name: 'Sign in' }).last().click();
await B.getByText('Signed in').first().waitFor();
await B.waitForTimeout(2500);
await B.goto(BASE + '/#/');
await B.waitForSelector('.resume');
assert(await B.getByText('Wolves vs Hawks').count() > 0, 'game opened on a second device after signing in');
await B.locator('.resume .btn').click();
await B.waitForSelector('.banner.bad');
assert(await B.locator('[data-tour="point-home"]').isDisabled(), 'second device is view-only while the iPad is scoring');
await B.screenshot({ path: SP + '/shots/sync-B-readonly.png' });
assert((await B.locator('.tcard.home .sc').innerText()) === '4', 'second device shows the same score (4)');

// ---- takeover prevents conflicting edits
await B.getByText('Take over scoring').click();
await B.waitForTimeout(500);
assert(!(await B.locator('[data-tour="point-home"]').isDisabled()), 'iPhone can score after taking over');
await pt(B, 'away');
await B.waitForTimeout(2500);
const lease = await A.evaluate((id) => window.vb.sync.acquireLease(id, false), gid);
assert(lease.ok === false, 'iPad can no longer edit (lease now held by the iPhone)');
// iPad scores offline-ish while locked -> becomes a saved copy instead of overwriting
await A.evaluate(async (id) => { const s = await window.vb.ctx.session(id); s.readOnly = false; const { cmd } = await import('/js/engine/engine.js'); await s.add(cmd.point('home')); }, gid);
await A.evaluate(() => window.vb.sync.syncAll());
await A.waitForTimeout(2000);
const gamesA = await A.evaluate(async () => (await window.vb.store.all('games')).map((g) => ({ id: g.id, conflict: !!g.conflictOf, ev: g.events.length })));
console.log(JSON.stringify(gamesA));
assert(gamesA.some((g) => g.conflict), 'conflicting offline edits kept as a separate copy, nothing lost');
const srv2 = await api(A, '/api/games/' + gid);
assert(srv2.game.events.some((e) => e.type === 'rally' && e.team === 'away'), 'server keeps the iPhone version');
console.log(errs.join('\n') || 'no console errors');
await browser.close();
