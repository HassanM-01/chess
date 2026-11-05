import { defineConfig } from '@playwright/test';

// Drives the real Electron app (native Stockfish included). Run `npm run desktop:build` first, then `npm run e2e:desktop`.
export default defineConfig({
  testDir: './e2e-desktop',
  timeout: 240_000,
  workers: 1,
  reporter: [['list']],
  use: { trace: 'off' },
});
