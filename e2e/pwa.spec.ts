// Phase 7 acceptance (the part that can run in CI): the app is an installable PWA and the engine works offline.
import { expect, test } from '@playwright/test';

test('installable PWA: manifest, icons, service worker, engine cached for offline use', async ({ page, context }) => {
  await page.goto('/login');
  const href = await page.locator('link[rel=manifest]').getAttribute('href');
  expect(href).toBeTruthy();
  const res = await page.request.get(href as string);
  expect(res.ok()).toBe(true);
  const manifest = (await res.json()) as {
    name: string;
    short_name: string;
    start_url: string;
    display: string;
    theme_color: string;
    icons: { sizes: string; purpose?: string; src: string }[];
  };
  expect(manifest.name).toBe('Blunder Check');
  expect(manifest.display).toBe('standalone');
  expect(manifest.start_url).toBe('/');
  const sizes = manifest.icons.map((i) => i.sizes);
  expect(sizes).toContain('192x192');
  expect(sizes).toContain('512x512');
  expect(manifest.icons.some((i) => i.purpose === 'maskable')).toBe(true);
  for (const icon of manifest.icons) expect((await page.request.get(icon.src)).ok()).toBe(true);

  // Service worker takes control, and the 7 MB engine is in the precache so analysis and bot play work offline.
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
  });
  await page.reload();
  await expect.poll(() => page.evaluate(() => !!navigator.serviceWorker.controller)).toBe(true);
  const cached = await page.evaluate(async () => {
    const names = await caches.keys();
    const hits: string[] = [];
    for (const n of names) {
      const c = await caches.open(n);
      for (const req of await c.keys()) if (req.url.includes('/engine/')) hits.push(req.url);
    }
    return hits;
  });
  expect(cached.some((u) => u.includes('stockfish-18-lite-single.wasm'))).toBe(true);
  expect(cached.some((u) => u.includes('stockfish-18-lite-single.js'))).toBe(true);

  // The app shell loads with the network off.
  await context.setOffline(true);
  await page.reload();
  await expect(page.locator('#root')).not.toBeEmpty();
  await expect(page.getByText(/Blunder Check|chess\.com username|Local mode/i).first()).toBeVisible();
});

test('meta tags for home-screen install on iOS', async ({ page }) => {
  await page.goto('/login');
  await expect(page.locator('meta[name=viewport]')).toHaveAttribute('content', /viewport-fit=cover/);
  await expect(page.locator('link[rel=apple-touch-icon]')).toHaveAttribute('href', '/apple-touch-icon.png');
  await expect(page.locator('meta[name=theme-color]')).toHaveAttribute('content', '#1F5F4A');
});
