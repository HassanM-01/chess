import { Chess, type Move, uciMove, tryChess } from './compat';
import type { Color, Uci } from './types';

export const moveInfo = (fen: string, u: Uci | null | undefined): Move | null => {
  if (!u) return null;
  const c = tryChess(fen);
  return c ? uciMove(c, u) : null;
};

export const sanOf = (fen: string, u: Uci | null | undefined): string => moveInfo(fen, u)?.san ?? '';

/** SAN for the first n moves of a principal variation. */
export function pvSan(fen: string, pv: Uci[], n = 6): string[] {
  const c = tryChess(fen);
  const out: string[] = [];
  if (!c) return out;
  for (const u of pv.slice(0, n)) {
    const m = uciMove(c, u);
    if (!m) break;
    out.push(m.san);
  }
  return out;
}

export const moveToUci = (m: Pick<Move, 'from' | 'to' | 'promotion'>): Uci => m.from + m.to + (m.promotion ?? '');

/** All FENs of a game: index i is the position before ply i. Length = moves + 1. */
export function gameFens(startFen: string, movesUci: Uci[]): string[] {
  const c = new Chess(startFen);
  const out = [c.fen()];
  for (const u of movesUci) {
    uciMove(c, u);
    out.push(c.fen());
  }
  return out;
}

export const sideToMove = (fen: string): Color => (fen.split(' ')[1] === 'b' ? 'b' : 'w');

/** "12." or "12..." label for a ply (0-based), honouring custom start positions. */
export function moveNumberLabel(startFen: string, ply: number): string {
  const startBlack = sideToMove(startFen) === 'b';
  const full = +startFen.split(' ')[5] || 1;
  const n = full + Math.floor((ply + (startBlack ? 1 : 0)) / 2);
  const white = startBlack ? ply % 2 === 1 : ply % 2 === 0;
  return n + (white ? '.' : '...');
}
