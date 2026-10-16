import { launch, BASE, DEVICES, track } from './lib.mjs';
const SP = process.argv[2]; const dev = process.argv[3] || 'iphone';
const browser = await launch();
const ctx = await browser.newContext(DEVICES[dev]);
const page = await ctx.newPage();
const errs = []; track(page, errs);
await page.goto(BASE + '/');
await page.getByText('START QUICK TOUR').click();
let i = 0; const titles = [];
for (;;) {
  await page.waitForTimeout(450);
  const title = await page.locator('.tour-card h3').innerText();
  const step = await page.locator('.tour-card .step').count() ? await page.locator('.tour-card .step').innerText() : '';
  const holeVisible = await page.locator('.tour-hole:not([hidden])').count();
  titles.push(`${step} | ${title} | highlight=${holeVisible}`);
  await page.screenshot({ path: `${SP}/shots/tour-${dev}-${String(i).padStart(2, '0')}.png` });
  // the tour must be interactive: try the highlighted buttons
  if (title === 'Keep score') await page.locator('[data-tour="point-home"]').click();
  if (title === 'Correct a mistake') { await page.locator('[data-tour="undo"]').click(); await page.waitForTimeout(300); }
  const nxt = page.locator('.tour-card .btn.primary');
  const label = await nxt.innerText();
  await nxt.click();
  i++;
  if (label === 'Finish') break;
  if (i > 30) throw new Error('tour did not end');
}
await page.waitForTimeout(600);
console.log(titles.join('\n'));
console.log('route after tour:', await page.evaluate(() => location.hash));
console.log('modal:', (await page.locator('.modal h2').innerText().catch(() => 'none')));
await page.screenshot({ path: `${SP}/shots/tour-${dev}-end.png` });
await page.locator('.modal .btn.primary').click();
const games = await page.evaluate(async () => (await window.vb.store.all('games')).map((g) => ({ practice: g.practice, events: g.events.length })));
console.log('stored games:', JSON.stringify(games));
// reload: tour must not return
await page.goto(BASE + '/'); await page.waitForTimeout(600);
console.log('welcome shown again after reload:', await page.getByText('START QUICK TOUR').count());
await page.locator('.help-btn').click();
console.log('help has restart:', await page.getByText('Restart the quick tour').count());
console.log(errs.join('\n') || 'no console errors');
await browser.close();
