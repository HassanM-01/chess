// Copies the Stockfish 18 build files from node_modules into public/engine/ (they are git-ignored).
import { cpSync, existsSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const src = join(root, 'node_modules', 'stockfish', 'bin');
const dst = join(root, 'public', 'engine');
const files = ['stockfish-18-lite-single.js', 'stockfish-18-lite-single.wasm', 'stockfish-18-asm.js'];

mkdirSync(dst, { recursive: true });
for (const f of files) {
  const from = join(src, f);
  if (!existsSync(from)) {
    console.warn(`[copy-engine] missing ${from}; run npm install first`);
    continue;
  }
  cpSync(from, join(dst, f));
}
console.log('[copy-engine] engine files ready in public/engine');
