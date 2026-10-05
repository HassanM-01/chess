import { defineConfig, devices } from '@playwright/test';

const PORT = 4173;

export default defineConfig({
  testDir: './e2e',
  timeout: 180_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['github'], ['html', { open: 'never' }]] : [['list']],
  use: {
    baseURL: `http://localhost:${PORT}`,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    serviceWorkers: 'block', // network mocks must see every request; the PWA spec turns this back on
  },
  projects: [
    {
      // Spec: Playwright with the iPhone 13 device profile, tested at 390x844.
      name: 'iphone',
      testIgnore: /pwa\.spec\.ts/,
      use: { ...devices['iPhone 13'], viewport: { width: 390, height: 844 } },
    },
    {
      name: 'chromium-pwa',
      testMatch: /pwa\.spec\.ts/,
      use: { ...devices['Pixel 7'], serviceWorkers: 'allow' },
    },
  ],
  webServer: {
    // Blank Supabase variables win over .env.local, so the suite always runs in local mode (no real Supabase, no real accounts).
    command: `npm run build && npx vite preview --port ${PORT} --strictPort`,
    env: { VITE_SUPABASE_URL: '', VITE_SUPABASE_ANON_KEY: '', VITE_COACH_ENABLED: '1', VITE_COACH_MOCK: '1' },
    url: `http://localhost:${PORT}`,
    reuseExistingServer: !process.env.CI,
    timeout: 180_000,
  },
});
