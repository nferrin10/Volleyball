// Generates PNG app icons by rendering an SVG with the preinstalled Chromium (via playwright-core).
import { chromium } from 'playwright-core';
import fs from 'node:fs';
const svg = (size, pad) => `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 512 512">
<rect width="512" height="512" fill="#0f2a5f"/>
<g transform="translate(256 256) scale(${1 - pad}) translate(-256 -256)">
<circle cx="256" cy="256" r="170" fill="#ffd24a" stroke="#fff" stroke-width="14"/>
<g fill="none" stroke="#0f2a5f" stroke-width="16" stroke-linecap="round">
<path d="M256 86c0 100 70 170 170 170M256 86c0 100-70 170-170 170M86 256c100 0 170 70 170 170M426 256c-100 0-170 70-170 170"/>
</g></g></svg>`;
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
const page = await browser.newPage();
for (const [file, size, pad] of [['icon-192.png', 192, 0.08], ['icon-512.png', 512, 0.08], ['apple-touch-icon.png', 180, 0.08], ['icon-maskable-512.png', 512, 0.28]]) {
  await page.setViewportSize({ width: size, height: size });
  await page.setContent(`<html><body style="margin:0">${svg(size, pad)}</body></html>`);
  await page.screenshot({ path: `public/icons/${file}`, clip: { x: 0, y: 0, width: size, height: size } });
}
await browser.close();
console.log('icons ok');
