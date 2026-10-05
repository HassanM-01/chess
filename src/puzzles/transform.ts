// "Same pattern, new look": exact symmetries of chess that turn one of the user's mistakes into extra practice positions.
//  - mirror: reflect the board left-right (a-file <-> h-file)
//  - swap:   reflect top-bottom and swap the colours (the side to move flips too)
//  - both:   the two combined
// Chess is symmetric under all of these (castling rights aside, which we drop), so the engine's verdict carries over:
// the best move maps to the best move, and the win chance for "the mistaken side" is unchanged.
import { Chess } from '@/chess/compat';
import type { Uci } from '@/chess/types';
import type { StoredEval } from '@/engine/types';

export type VariantKind = 'mirror' | 'swap' | 'both';
export const VARIANT_KINDS: VariantKind[] = ['mirror', 'swap', 'both'];

const flipsFiles = (k: VariantKind): boolean => k === 'mirror' || k === 'both';
const swapsColors = (k: VariantKind): boolean => k === 'swap' || k === 'both';

const swapCase = (ch: string): string => (ch === ch.toLowerCase() ? ch.toUpperCase() : ch.toLowerCase());

/** FEN under a transform. Castling rights and en passant are dropped (they do not survive the mirror cleanly). */
export function transformFen(fen: string, kind: VariantKind): string {
  const [placement, turn, , , half, full] = fen.split(' ');
  let rows = placement.split('/').map((row) => {
    // expand digits so rows can be reversed character by character
    let r = '';
    for (const ch of row) r += /\d/.test(ch) ? '.'.repeat(+ch) : ch;
    if (flipsFiles(kind)) r = r.split('').reverse().join('');
    if (swapsColors(kind)) r = r.split('').map((c) => (c === '.' ? c : swapCase(c))).join('');
    return r;
  });
  if (swapsColors(kind)) rows = rows.reverse();
  const packed = rows.map((r) => r.replace(/\.+/g, (d) => String(d.length))).join('/');
  const nextTurn = swapsColors(kind) ? (turn === 'w' ? 'b' : 'w') : turn;
  return `${packed} ${nextTurn} - - ${half ?? 0} ${full ?? 1}`;
}

export function transformSquare(sq: string, kind: VariantKind): string {
  let f = sq.charCodeAt(0) - 97;
  let r = +sq[1];
  if (flipsFiles(kind)) f = 7 - f;
  if (swapsColors(kind)) r = 9 - r;
  return String.fromCharCode(97 + f) + r;
}

export function transformUci(u: Uci | null | undefined, kind: VariantKind): Uci | null {
  if (!u) return null;
  return transformSquare(u.slice(0, 2), kind) + transformSquare(u.slice(2, 4), kind) + (u[4] ?? '');
}

/** Engine eval under a transform: swapping colours flips the sign of the score; the best move is mapped across. */
export function transformEval(e: StoredEval, kind: VariantKind): StoredEval {
  const sign = swapsColors(kind) ? -1 : 1;
  return [e[0] === 0 ? 0 : sign * e[0], e[1] == null ? null : sign * e[1], transformUci(e[2], kind)];
}

/** Castling moves are the one thing a mirror breaks (king/rook geometry), so positions involving them are skipped. */
export const involvesCastling = (...sans: (string | null | undefined)[]): boolean => sans.some((s) => !!s && s.startsWith('O-O'));

/** True if the FEN loads and the given move is legal there. */
export function legalIn(fen: string, u: Uci): boolean {
  try {
    const c = new Chess(fen);
    return !!c.move({ from: u.slice(0, 2), to: u.slice(2, 4), promotion: u[4] || 'q' });
  } catch {
    return false;
  }
}
