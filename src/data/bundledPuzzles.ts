import type { PuzzleRow, ThemeKey } from '@/db/types';

interface RawPuzzle {
  id: string;
  theme: ThemeKey;
  fen: string;
  moves: string[];
  explain: string;
  lastMove?: string;
  alts?: string[];
}

/** The 275 verified beginner puzzles shipped with the app (rating 600). Used in local mode and by `npm run seed:puzzles`. */
export function toPuzzleRows(raw: RawPuzzle[]): PuzzleRow[] {
  return raw.map((p) => ({
    id: `bc_${p.id}`,
    fen: p.fen,
    moves: p.moves,
    themes: [p.theme],
    rating: 600,
    explanation: p.explain,
    source: 'bundled',
    lastMove: p.lastMove ?? null,
    alts: p.alts,
  }));
}

export async function loadBundledPuzzles(): Promise<PuzzleRow[]> {
  const mod = (await import('../../data/puzzles.json')) as { default: RawPuzzle[] };
  return toPuzzleRows(mod.default);
}
