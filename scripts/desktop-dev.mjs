// Dev loop for the desktop app: Vite dev server for the UI + Electron pointed at it.
import { spawn } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const run = (cmd, args, env = {}) => spawn(cmd, args, { cwd: root, stdio: 'inherit', shell: process.platform === 'win32', env: { ...process.env, ...env } });

await new Promise((res, rej) => run('node', ['scripts/build-electron.mjs']).on('exit', (c) => (c === 0 ? res() : rej(new Error('main build failed')))));
const vite = run('npx', ['vite', '--config', 'vite.desktop.config.ts']);
const url = 'http://localhost:5199';
for (let i = 0; i < 100; i++) {
  try {
    if ((await fetch(url)).ok) break;
  } catch {
    /* not up yet */
  }
  await new Promise((r) => setTimeout(r, 300));
}
const electron = run('npx', ['electron', '.'], { DESKTOP_DEV_URL: url });
electron.on('exit', () => {
  vite.kill();
  process.exit(0);
});
