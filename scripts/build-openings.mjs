// Compiles the Lichess opening list (https://github.com/lichess-org/chess-openings, CC0) into src/review/data/openings.json.
// Each entry is [eco, name, "e4 e5 Nf3 ..."] (SAN without move numbers).
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const out = [];
for (const f of ['a', 'b', 'c', 'd', 'e']) {
  const lines = readFileSync(join(root, 'scripts/data/openings', `${f}.tsv`), 'utf8').split(/\r?\n/).slice(1);
  for (const l of lines) {
    if (!l.trim()) continue;
    const [eco, name, pgn] = l.split('\t');
    const sans = pgn.replace(/\d+\.(\.\.)?/g, ' ').trim().split(/\s+/);
    out.push([eco, name, sans.join(' ')]);
  }
}
writeFileSync(join(root, 'src/review/data/openings.json'), JSON.stringify(out));
console.log(`${out.length} openings`);
