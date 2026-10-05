// Imports puzzles from the Lichess puzzle database (CC0) into Supabase.
//
//   npm run seed:lichess -- --file path/to/lichess_db_puzzle.csv.zst     (or an already decompressed .csv)
//   npm run seed:lichess -- --download                                    (downloads ~270 MB first)
//
// Filters: Rating 400..1400, Popularity >= 80, at most 3000 per theme. Needs SUPABASE_SERVICE_ROLE_KEY (run locally only).
//
// IMPORTANT (Lichess format): the FEN is the position BEFORE the opponent's move and Moves[0] is that opponent move.
// We apply Moves[0] to get our `fen` (solver to move), set moves = Moves.slice(1), and keep lastMove = Moves[0].
import { createReadStream, createWriteStream, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createInterface } from 'node:readline';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { createZstdDecompress } from 'node:zlib';
import { createClient } from '@supabase/supabase-js';
import { Chess } from 'chess.js';

const THEME_MAP: Record<string, string[]> = {
  hangingPiece: ['free'],
  fork: ['fork'],
  mateIn1: ['mate1'],
  mateIn2: ['mate2'],
  defensiveMove: ['save'],
};
const MIN_RATING = 400;
const MAX_RATING = 1400;
const MIN_POPULARITY = 80;
const PER_THEME = 3000;
const URL_DB = 'https://database.lichess.org/lichess_db_puzzle.csv.zst';

interface Row {
  id: string;
  fen: string;
  moves: string[];
  themes: string[];
  rating: number;
  popularity: number;
  last_move: string;
}

export function mapThemes(lichessThemes: string[]): string[] {
  const out = new Set<string>();
  for (const t of lichessThemes) for (const m of THEME_MAP[t] ?? []) out.add(m);
  return [...out];
}

/** Convert one CSV record. Returns null when the puzzle is filtered out or its line is not legal. */
export function convertRow(cols: string[]): Row | null {
  const [id, fen, movesStr, ratingStr, , popStr, , themesStr] = cols;
  const rating = +ratingStr;
  const popularity = +popStr;
  if (!(rating >= MIN_RATING && rating <= MAX_RATING) || !(popularity >= MIN_POPULARITY)) return null;
  const themes = mapThemes(themesStr.split(' '));
  if (!themes.length) return null;
  const all = movesStr.split(' ');
  if (all.length < 2) return null;
  let c: Chess;
  try {
    c = new Chess(fen);
    const first = c.move({ from: all[0].slice(0, 2), to: all[0].slice(2, 4), promotion: all[0][4] });
    if (!first) return null;
    const ourFen = c.fen();
    const rest = all.slice(1);
    for (const u of rest) c.move({ from: u.slice(0, 2), to: u.slice(2, 4), promotion: u[4] });
    return { id: `li_${id}`, fen: ourFen, moves: rest, themes, rating, popularity, last_move: all[0] };
  } catch {
    return null; // illegal line: skip
  }
}

async function open(file: string): Promise<Readable> {
  const src = createReadStream(file);
  return file.endsWith('.zst') ? src.pipe(createZstdDecompress()) : src;
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  let file = args[args.indexOf('--file') + 1];
  if (args.includes('--download')) {
    file = join(tmpdir(), 'lichess_db_puzzle.csv.zst');
    if (!existsSync(file)) {
      console.log(`Downloading ${URL_DB} ...`);
      const res = await fetch(URL_DB);
      if (!res.ok || !res.body) throw new Error(`download failed: ${res.status}`);
      await pipeline(Readable.fromWeb(res.body as never), createWriteStream(file));
    }
  }
  if (!file || file.startsWith('--')) {
    console.error('Usage: npm run seed:lichess -- --file <lichess_db_puzzle.csv[.zst]>  |  --download');
    process.exit(1);
  }
  const url = process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    console.error('Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env.local first.');
    process.exit(1);
  }

  const rl = createInterface({ input: await open(file), crlfDelay: Infinity });
  const byTheme = new Map<string, Row[]>();
  let first = true;
  for await (const line of rl) {
    if (first) {
      first = false; // header row
      continue;
    }
    const row = convertRow(line.split(','));
    if (!row) continue;
    for (const t of row.themes) {
      const list = byTheme.get(t) ?? [];
      list.push(row);
      byTheme.set(t, list);
    }
  }
  // keep the most popular PER_THEME for each theme
  const keep = new Map<string, Row>();
  for (const [theme, list] of byTheme) {
    list.sort((a, b) => b.popularity - a.popularity);
    for (const r of list.slice(0, PER_THEME)) keep.set(r.id, r);
    console.log(`${theme}: ${Math.min(list.length, PER_THEME)} of ${list.length}`);
  }
  const rows = [...keep.values()].map((r) => ({
    id: r.id,
    fen: r.fen,
    moves: r.moves,
    themes: r.themes,
    rating: r.rating,
    explanation: null,
    source: 'lichess',
    last_move: r.last_move,
    alts: null,
  }));

  const sb = createClient(url, key, { auth: { persistSession: false } });
  for (let i = 0; i < rows.length; i += 500) {
    const { error } = await sb.from('puzzles').upsert(rows.slice(i, i + 500), { onConflict: 'id' });
    if (error) throw new Error(error.message);
    process.stdout.write(`\rimported ${Math.min(i + 500, rows.length)} / ${rows.length}`);
  }
  console.log('\nDone.');
}

if (import.meta.url === `file://${process.argv[1].replace(/\\/g, '/')}` || process.argv[1]?.endsWith('import-lichess-puzzles.ts')) {
  main().catch((e: unknown) => {
    console.error(e);
    process.exit(1);
  });
}
