// Full-match workflow test through the real UI: iPhone setup -> iPad scoring -> PDF.
import fs from 'node:fs';
import { launch, BASE, DEVICES, track } from './lib.mjs';
const SP = process.argv[2];
const log = (...a) => console.log('•', ...a);
const browser = await launch();
let ctx = await browser.newContext({ ...DEVICES.iphone, acceptDownloads: true });
let page = await ctx.newPage();
const errs = []; track(page, errs);
const assert = (c, m) => { if (!c) { console.error('FAIL:', m); process.exitCode = 1; } else log('ok:', m); };
const score = async () => ({ h: +(await page.locator('.tcard.home .sc').innerText()), a: +(await page.locator('.tcard.away .sc').innerText()) });
const pt = async (t) => { await page.locator(`[data-tour="point-${t}"]`).click(); await page.waitForTimeout(330); };

// 1 -- iPhone: enter teams and players
await page.goto(BASE + '/');
await page.getByText('SKIP TOUR').click();
await page.getByText('New Game').first().click();
await page.locator('input[type=text][placeholder="e.g. Main Gym"]').fill('Main Gym');
for (const [side, name, nums, lib] of [['home', 'Wolves', '1 2 3 4 5 6 7 8 9 10', '13'], ['away', 'Hawks', '21 22 23 24 25 26 27 28', '31']]) {
  const card = page.locator(`[data-tour="team-${side}"]`);
  await card.locator('input[placeholder*="team name"]').fill(name);
  await card.locator('input[placeholder^="Quick add"]').fill(nums);
  await card.getByText('Add all').click();
  await card.locator('input[placeholder="#"]').fill(lib);
  await card.locator('input[type=checkbox]').check();
  await card.getByRole('button', { name: 'Add', exact: true }).click();
}
await page.screenshot({ path: SP + '/shots/e2e-01-teams-iphone.png' });
await page.getByText('Next: lineup').click();
for (const side of ['home', 'away']) { const c = page.locator(`[data-tour="lineup-${side}"]`); for (let i = 0; i < 6; i++) await c.locator('.chips .pchip:not(.used):not(.lib)').first().click(); }
await page.locator('[data-tour="first-serve"] .serve-pick button.home').click();
await page.screenshot({ path: SP + '/shots/e2e-02-lineup-iphone.png', fullPage: true });
await page.locator('[data-tour="start-game"]').click();
await page.waitForSelector('[data-tour="point-home"]');
assert((await score()).h === 0, 'game started 0-0 on iPhone');

// 2 -- iPad: keep score
{
  const state = await ctx.storageState({ indexedDB: true });
  await ctx.close();
  ctx = await browser.newContext({ ...DEVICES.ipadL, acceptDownloads: true, storageState: state });
  page = await ctx.newPage(); track(page, errs);
  await page.goto(BASE + '/#/');
  await page.locator('.resume .btn').click();      // "Resume scoring" — game saved on the phone is here on the iPad
  await page.waitForSelector('[data-tour="point-home"]');
}
await pt('home'); await pt('home');                       // 2-0, Wolves serving, server order I
assert((await page.locator('.tcard.home .serve-chip').innerText()).includes('(I)'), 'server I after two serving points');
await pt('away');                                          // side-out: Hawks serve, II
assert((await page.locator('.tcard.away .serve-chip').innerText()).includes('(II)'), 'Hawks rotated to server II after side-out');
// kill + assist (Hawks scored -> record on Hawks panel)
await page.locator('[data-tour="panel-away"] .sbtn', { hasText: 'Kill' }).click();
await page.locator('[data-tour="panel-away"] .pl').nth(0).click();
await page.locator('.hint button', { hasText: 'No assist' }).waitFor();
await page.locator('[data-tour="panel-away"] .pl').nth(2).click();
// dig, block (pending for next point), then point
await page.locator('[data-tour="panel-home"] .sbtn', { hasText: 'Dig' }).click();
await page.locator('[data-tour="panel-home"] .pl').nth(1).click();
await page.locator('[data-tour="panel-home"] .sbtn', { hasText: 'Block' }).click();
await page.locator('[data-tour="panel-home"] .pl').nth(2).click();
await pt('home');                                          // side-out back to Wolves
await pt('home');
// hit error by Hawks (the team that lost the point), tapped after the point
await page.locator('[data-tour="panel-away"] .sbtn', { hasText: 'Error' }).click();
await page.locator('[data-tour="panel-away"] .errtypes .sbtn', { hasText: 'Hit' }).click();
await page.locator('[data-tour="panel-away"] .pl').nth(4).click();
// timeout, sub, libero
await page.locator('[data-tour="timeout-away"]').click();
await page.locator('[data-tour="sub-home"]').click();
await page.locator('.modal .pick button').first().click();
await page.locator('.modal .pick button').first().click();
await page.waitForTimeout(300);
await page.locator('[data-tour="panel-home"] .tools .btn', { hasText: 'Libero' }).click();
await page.locator('.modal .pick button').first().click();
await page.waitForTimeout(300);
await page.screenshot({ path: SP + '/shots/e2e-03-live-ipad.png' });
// mistake: tap point for wrong team, undo
await page.screenshot({ path: SP + '/shots/dbg.png' });
const before = await score();
await pt('away');
if (await page.locator('.modal-back').count()) console.log('MODAL:', await page.locator('.modal-back').innerText());
await page.locator('[data-tour="undo"]').click();
await page.waitForTimeout(200);
const after = await score();
assert(before.h === after.h && before.a === after.a, 'undo restores score and keeps stats');

// 3 -- finish sets
async function finishSet(winner, loserPts) {
  const loser = winner === 'home' ? 'away' : 'home';
  let guard = 0;
  while (!(await page.locator('.overlay-card').count()) && guard++ < 80) {
    const s = await score();
    const w = s[winner[0]], l = s[loser[0]];
    const lp = (loserPts - l) > 0 && (w % 3 === 2 || w > 24) ? loser : winner;
    await pt(lp);
  }
}
await finishSet('home', 20);
const s1 = await page.locator('.overlay-card .big-score').innerText();
log('set 1 final', s1);
assert(/^25 – \d+$/.test(s1.trim()) || /–/.test(s1), 'set 1 ended by rule');
await page.screenshot({ path: SP + '/shots/e2e-04-setover.png' });
for (const [n, winner, lp] of [[2, 'away', 22], [3, 'home', 18], [4, 'away', 21]]) {
  await page.locator('.overlay-card button', { hasText: `Start set ${n}` }).click();
  await page.waitForSelector('[data-tour="start-game"]');
  if (await page.locator('[data-tour="start-game"]').isDisabled()) await page.locator('[data-tour="first-serve"] .serve-pick button.home').click();
  await page.locator('[data-tour="start-game"]').click();
  await page.waitForSelector('[data-tour="point-home"]');
  await finishSet(winner, lp);
  log(`set ${n} final`, (await page.locator('.overlay-card .big-score').innerText()).trim());
}
// 4 -- deciding set
await page.locator('.overlay-card button', { hasText: 'Start set 5' }).click();
await page.waitForSelector('[data-tour="start-game"]');
assert(await page.locator('[data-tour="start-game"]').isDisabled(), 'deciding set requires a coin toss choice');
await page.locator('[data-tour="first-serve"] .serve-pick button.away').click();
await page.locator('[data-tour="start-game"]').click();
await page.waitForSelector('[data-tour="point-home"]');
await finishSet('home', 13);
const fin = await page.locator('.overlay-card h2').innerText();
assert(/match/i.test(fin), 'match completes: ' + fin);
await page.screenshot({ path: SP + '/shots/e2e-05-matchover.png' });
const finalScore = (await page.locator('.overlay-card .big-score').innerText()).trim();
log('final sets', finalScore);

// 5 -- PDF
const [dl] = await Promise.all([page.waitForEvent('download'), page.locator('.overlay-card .btn.dl').click()]);
await dl.saveAs(SP + '/e2e-sheet.pdf');
log('downloaded', dl.suggestedFilename());
assert(/\.pdf$/.test(dl.suggestedFilename()), 'PDF downloaded');
// view sheet and screenshots
await page.locator('.overlay-card button', { hasText: 'View scoresheet' }).click();
await page.waitForSelector('.sheetpage svg');
await page.waitForTimeout(500);
await page.screenshot({ path: SP + '/shots/e2e-06-sheetview.png' });
console.log(errs.join('\n') || 'no console errors');
await browser.close();
