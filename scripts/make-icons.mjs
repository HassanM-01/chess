// Renders the app icon (public/icon.svg) to the PNG sizes the PWA manifest and iOS need, using Playwright's Chromium.
// Run once after changing the icon:  node scripts/make-icons.mjs
import { mkdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const svg = readFileSync(join(root, 'public', 'icon.svg'), 'utf8');
// Maskable icons are cropped to a circle/squircle by the OS: full-bleed background, glyph kept inside the central 80%.
const maskable = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512"><rect width="512" height="512" fill="#1F5F4A"/><g transform="translate(51.2 51.2) scale(.8)"><path d="M160 420h192M200 420c0-80 20-120 20-160-20-8-40-28-40-60 0-40 32-70 76-70s76 30 76 70c0 32-20 52-40 60 0 40 20 80 20 160" fill="none" stroke="#fff" stroke-width="30" stroke-linecap="round" stroke-linejoin="round"/></g></svg>`;

const jobs = [
  { svg, size: 192, file: 'icons/icon-192.png' },
  { svg, size: 512, file: 'icons/icon-512.png' },
  { svg: maskable, size: 512, file: 'icons/icon-maskable-512.png' },
  { svg: maskable, size: 180, file: 'apple-touch-icon.png' },
];

mkdirSync(join(root, 'public', 'icons'), { recursive: true });
const browser = await chromium.launch();
for (const j of jobs) {
  const page = await browser.newPage({ viewport: { width: j.size, height: j.size } });
  await page.setContent(`<html><body style="margin:0;background:transparent"><img style="width:${j.size}px;height:${j.size}px;display:block" src="data:image/svg+xml;base64,${Buffer.from(j.svg).toString('base64')}"></body></html>`);
  await page.screenshot({ path: join(root, 'public', j.file), omitBackground: true });
  await page.close();
  console.log('wrote', j.file);
}
await browser.close();
