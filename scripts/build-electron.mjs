// Bundles the Electron main + preload scripts into electron-dist/ (CommonJS, so the sandboxed preload can load).
import { build } from 'esbuild';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
await build({
  entryPoints: { main: join(root, 'electron/main.ts'), preload: join(root, 'electron/preload.ts') },
  outdir: join(root, 'electron-dist'),
  outExtension: { '.js': '.cjs' },
  bundle: true,
  platform: 'node',
  format: 'cjs',
  target: 'node24',
  external: ['electron'],
  sourcemap: true,
  logLevel: 'info',
});
