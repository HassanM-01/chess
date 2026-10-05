// Board helpers ported from reference/prototype/logic.js. No chess.js dependency: works on a FEN-parsed map.
import type { BoardMap, BoardPiece, Color, PieceType, Square } from './types';
import { FILES } from './types';

export const VAL: Record<PieceType, number> = { p: 1, n: 3, b: 3, r: 5, q: 9, k: 100 };
export const NAME: Record<PieceType, string> = { p: 'pawn', n: 'knight', b: 'bishop', r: 'rook', q: 'queen', k: 'king' };
export const pieceName = (t: PieceType): string => NAME[t];

export function parseFen(fen: string): BoardMap {
  const rows = fen.split(' ')[0].split('/');
  const b: BoardMap = {};
  for (let r = 0; r < 8; r++) {
    let f = 0;
    for (const ch of rows[r]) {
      if (/\d/.test(ch)) {
        f += +ch;
        continue;
      }
      const sq = FILES[f] + (8 - r);
      b[sq] = { type: ch.toLowerCase() as PieceType, color: ch === ch.toLowerCase() ? 'b' : 'w' };
      f++;
    }
  }
  return b;
}

const fx = (s: Square): number => FILES.indexOf(s[0]);
const fy = (s: Square): number => +s[1] - 1;
const sq = (x: number, y: number): Square | null => (x >= 0 && x < 8 && y >= 0 && y < 8 ? FILES[x] + (y + 1) : null);

/** Squares attacked by the piece on `from`. */
export function attacksFrom(b: BoardMap, from: Square): Square[] {
  const p = b[from];
  if (!p) return [];
  const x = fx(from);
  const y = fy(from);
  const out: Square[] = [];
  const ray = (dx: number, dy: number): void => {
    let cx = x + dx;
    let cy = y + dy;
    for (;;) {
      const s = sq(cx, cy);
      if (!s) break;
      out.push(s);
      if (b[s]) break;
      cx += dx;
      cy += dy;
    }
  };
  const step = (dx: number, dy: number): void => {
    const s = sq(x + dx, y + dy);
    if (s) out.push(s);
  };
  switch (p.type) {
    case 'p': {
      const d = p.color === 'w' ? 1 : -1;
      step(-1, d);
      step(1, d);
      break;
    }
    case 'n':
      for (const [a, c] of [[1, 2], [2, 1], [-1, 2], [-2, 1], [1, -2], [2, -1], [-1, -2], [-2, -1]]) step(a, c);
      break;
    case 'k':
      for (const [a, c] of [[1, 1], [1, 0], [1, -1], [0, 1], [0, -1], [-1, 1], [-1, 0], [-1, -1]]) step(a, c);
      break;
    case 'b':
      for (const [a, c] of [[1, 1], [1, -1], [-1, 1], [-1, -1]]) ray(a, c);
      break;
    case 'r':
      for (const [a, c] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) ray(a, c);
      break;
    case 'q':
      for (const [a, c] of [[1, 1], [1, -1], [-1, 1], [-1, -1], [1, 0], [-1, 0], [0, 1], [0, -1]]) ray(a, c);
      break;
  }
  return out;
}

/** Squares holding pieces of `color` that attack `target`. */
export function attackers(b: BoardMap, target: Square, color: Color): Square[] {
  const out: Square[] = [];
  for (const s of Object.keys(b)) if (b[s].color === color && attacksFrom(b, s).includes(target)) out.push(s);
  return out;
}

export interface HangingInfo {
  square: Square;
  piece: BoardPiece;
  reason: 'undefended' | 'cheaper';
  by: Square[];
}

/** A piece is "loose/hanging" if attacked and (undefended, or attacked by something cheaper). */
export function hangingInfo(b: BoardMap, s: Square): HangingInfo | null {
  const p = b[s];
  if (!p || p.type === 'k') return null;
  const opp: Color = p.color === 'w' ? 'b' : 'w';
  const att = attackers(b, s, opp);
  if (!att.length) return null;
  const def = attackers(b, s, p.color);
  const cheapest = Math.min(...att.map((a) => VAL[b[a].type]));
  if (!def.length) return { square: s, piece: p, reason: 'undefended', by: att };
  if (cheapest < VAL[p.type]) return { square: s, piece: p, reason: 'cheaper', by: att.filter((a) => VAL[b[a].type] === cheapest) };
  return null;
}

export function hangingPieces(b: BoardMap, color: Color): HangingInfo[] {
  const out: HangingInfo[] = [];
  for (const s of Object.keys(b)) {
    if (b[s].color === color) {
      const h = hangingInfo(b, s);
      if (h) out.push(h);
    }
  }
  return out;
}

export function material(b: BoardMap): { w: number; b: number } {
  let w = 0;
  let bl = 0;
  for (const s of Object.keys(b)) {
    const p = b[s];
    if (p.type === 'k') continue;
    if (p.color === 'w') w += VAL[p.type];
    else bl += VAL[p.type];
  }
  return { w, b: bl };
}

/** Targets worth >= 3 (or the king) attacked by the piece on `s` that it genuinely threatens. */
export function forkTargets(b: BoardMap, s: Square): Square[] {
  const p = b[s];
  if (!p) return [];
  return attacksFrom(b, s).filter((t) => {
    const tp = b[t];
    return (
      tp &&
      tp.color !== p.color &&
      (tp.type === 'k' || (VAL[tp.type] >= 3 && (VAL[tp.type] > VAL[p.type] || attackers(b, t, tp.color).length === 0)))
    );
  });
}

export type Phase = 'opening' | 'middlegame' | 'endgame';

/** Opening if ply <= 20; endgame if 6 or fewer non-pawn pieces or total material <= 26; else middlegame. */
export function phaseOf(b: BoardMap, ply: number): Phase {
  const m = material(b);
  const nonPawn = Object.values(b).filter((p) => p.type !== 'p' && p.type !== 'k').length;
  if (ply <= 20) return 'opening';
  if (nonPawn <= 6 || m.w + m.b <= 26) return 'endgame';
  return 'middlegame';
}
