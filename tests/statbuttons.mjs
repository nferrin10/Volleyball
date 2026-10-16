// Checks that no stat button label is clipped on phones and tablets.
import { launch, BASE, DEVICES } from './lib.mjs';
const SP = process.argv[2];
const browser = await launch();
for (const [name, dev] of [['iphone', DEVICES.iphone], ['small', { ...DEVICES.iphone, viewport: { width: 320, height: 640 } }], ['ipadP', DEVICES.ipadP], ['ipadL', DEVICES.ipadL]]) {
  const ctx = await browser.newContext(dev); const page = await ctx.newPage();
  await page.goto(BASE + '/#/'); await page.getByText('SKIP TOUR').click();
  await page.goto(BASE + '/#/new?practice=1');
  await page.getByText('Next: lineup').click();
  await page.locator('[data-tour="start-game"]').click();
  await page.waitForSelector('[data-tour="point-home"]');
  await page.locator('[data-tour="panel-home"] .sbtn', { hasText: 'Error' }).click();
  const clipped = await page.evaluate(() => [...document.querySelectorAll('.sbtn')].filter((b) => b.offsetParent && b.scrollWidth > b.clientWidth + 1).map((b) => b.textContent));
  console.log(name, 'clipped labels:', clipped.length ? clipped : 'none');
  await page.locator('[data-tour="panel-home"]').screenshot({ path: `${SP}/shots/stat-${name}.png` });
  await ctx.close();
}
await browser.close();
