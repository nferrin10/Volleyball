import { launch, BASE, DEVICES, track } from './lib.mjs';
const SP = process.argv[2]; const dev = process.argv[3] || 'ipadL';
const browser = await launch();
const ctx = await browser.newContext(DEVICES[dev]);
const page = await ctx.newPage();
const errs = []; track(page, errs);
await page.goto(BASE + '/');
await page.getByText('SKIP TOUR').click();
await page.getByText('New Game').first().click();
await page.waitForSelector('[data-tour="team-home"]');
for (const [side, name, nums] of [['home','Wolves','1 2 3 4 5 6 7 8 9 10'],['away','Hawks','21 22 23 24 25 26 27 28']]) {
  const card = page.locator(`[data-tour="team-${side}"]`);
  await card.locator('input[placeholder*="team name"]').fill(name);
  await card.locator('[placeholder^="Quick add"]').fill(nums);
  await card.getByText('Add all').click();
}
await page.getByText('Next: lineup').click();
for (const side of ['home','away']) { const c = page.locator(`[data-tour="lineup-${side}"]`); for (let i=0;i<6;i++) await c.locator('.chips .pchip:not(.used)').first().click(); }
await page.locator('[data-tour="first-serve"] .serve-pick button').first().click();
await page.locator('[data-tour="start-game"]').click();
await page.waitForSelector('[data-tour="point-home"]');
for (const t of ['home','home','away','home']) { await page.locator(`[data-tour="point-${t}"]`).click(); await page.waitForTimeout(350); }
await page.locator('[data-tour="panel-home"] .sbtn', { hasText: 'Kill' }).click();
await page.screenshot({ path: SP + `/shots/05-live-${dev}.png` });
console.log(errs.join('\n') || 'no errors');
await browser.close();
