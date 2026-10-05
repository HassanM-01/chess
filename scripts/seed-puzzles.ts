// Seeds the bundled beginner puzzles (data/puzzles.json, 275 verified puzzles, rating 600) into Supabase.
// Run locally with the service role key:  npm run seed:puzzles   (reads .env.local)
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createClient } from '@supabase/supabase-js';
import { toPuzzleRows } from '../src/data/bundledPuzzles';

const url = process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error('Set SUPABASE_URL (or VITE_SUPABASE_URL) and SUPABASE_SERVICE_ROLE_KEY in .env.local first.');
  process.exit(1);
}

const raw = JSON.parse(readFileSync(join(import.meta.dirname, '..', 'data', 'puzzles.json'), 'utf8')) as Parameters<typeof toPuzzleRows>[0];
const rows = toPuzzleRows(raw).map((p) => ({
  id: p.id,
  fen: p.fen,
  moves: p.moves,
  themes: p.themes,
  rating: p.rating,
  explanation: p.explanation,
  source: p.source,
  last_move: p.lastMove ?? null,
  alts: p.alts ?? null,
}));

const sb = createClient(url, key, { auth: { persistSession: false } });
for (let i = 0; i < rows.length; i += 200) {
  const { error } = await sb.from('puzzles').upsert(rows.slice(i, i + 200), { onConflict: 'id' });
  if (error) {
    console.error('Seeding failed:', error.message);
    process.exit(1);
  }
}
console.log(`Seeded ${rows.length} bundled puzzles.`);
