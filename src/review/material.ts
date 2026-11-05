// Material counting on FEN strings, used to spot sacrifices.
import { Chess, uciMove } from '@/chess/compat';
import type { Color, Uci } from '@/chess/types';

const VALUE: Record<string, number> = { p: 1, n: 3, b: 3, r: 5, q: 9, k: 0 };

/** Material of `color` minus material of the other side (pawn = 1, minor = 3, rook = 5, queen = 9). */
export function materialBalance(fen: string, color: Color): number {
  let w = 0;
  let b = 0;
  for (const ch of fen.split(' ')[0]) {
    const v = VALUE[ch.toLowerCase()];
    if (v === undefined) continue;
    if (ch === ch.toUpperCase()) w += v;
    else b += v;
  }
  return color === 'w' ? w - b : b - w;
}

/** Play a line of UCI moves from `fen`; stops (and returns what it has) at the first illegal move. */
export function playLine(fen: string, line: Uci[]): string[] {
  const out: string[] = [];
  let c: Chess;
  try {
    c = new Chess(fen);
  } catch {
    return out;
  }
  for (const u of line) {
    if (!uciMove(c, u)) break;
    out.push(c.fen());
  }
  return out;
}
