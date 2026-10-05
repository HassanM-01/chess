// "Why is this checkmate?" — pure analysis of a final position. Names the check, then accounts for EVERY square the king
// might run to (blocked by its own piece, or covered by which enemy piece), and why the check can't be answered.
import { Chess } from '@/chess/compat';
import { NAME, attackers, parseFen } from '@/chess/tactics';
import type { BoardMap, Color, PieceType, Square } from '@/chess/types';
import { FILES } from '@/chess/types';

export interface Escape {
  square: Square;
  why: 'own-piece' | 'covered';
  /** squares of the pieces covering it (covered), or the blocking piece (own-piece) */
  by: Square[];
  text: string;
}

export interface MateAnatomy {
  kingSquare: Square;
  kingColor: Color;
  checkers: { square: Square; piece: PieceType }[];
  escapes: Escape[];
  /** can the check be answered by capturing or blocking? (always false in a real mate) */
  answerable: boolean;
  /** why the check cannot be blocked or captured */
  noAnswer: string;
  /** one readable paragraph */
  summary: string;
  /** squares to highlight on the board: covered = bad (red), blocked by own = sel (yellow), the king itself */
  marks: Record<Square, 'bad' | 'good' | 'sel'>;
  /** arrows from the pieces that cover escape squares / give check */
  arrows: { from: Square; to: Square; color: 'good' | 'bad' | 'warn' | 'info' }[];
}

const nameOf = (b: BoardMap, sq: Square): string => `${NAME[b[sq].type]} on ${sq}`;
const join = (parts: string[]): string => (parts.length <= 1 ? (parts[0] ?? '') : `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}`);

/** Analyse a position that is checkmate. Returns null if it is not. */
export function analyzeMate(fen: string): MateAnatomy | null {
  let chess: Chess;
  try {
    chess = new Chess(fen);
  } catch {
    return null;
  }
  if (!chess.isCheckmate()) return null;
  const kingColor: Color = chess.turn();
  const mover: Color = kingColor === 'w' ? 'b' : 'w';
  const board = parseFen(fen);
  const kingSquare = Object.keys(board).find((s) => board[s].type === 'k' && board[s].color === kingColor) as Square;

  const checkers = attackers(board, kingSquare, mover).map((sq) => ({ square: sq, piece: board[sq].type }));

  // Squares the king could step to, judged with the king lifted off the board so a rook's ray still "covers" the square behind it.
  const without = { ...board };
  delete without[kingSquare];
  const f = FILES.indexOf(kingSquare[0]);
  const r = +kingSquare[1];
  const escapes: Escape[] = [];
  for (let df = -1; df <= 1; df++) {
    for (let dr = -1; dr <= 1; dr++) {
      if (!df && !dr) continue;
      const nf = f + df;
      const nr = r + dr;
      if (nf < 0 || nf > 7 || nr < 1 || nr > 8) continue;
      const sq = FILES[nf] + nr;
      if (board[sq] && board[sq].color === kingColor) {
        escapes.push({ square: sq, why: 'own-piece', by: [sq], text: `${sq} is taken by its own ${NAME[board[sq].type]}` });
        continue;
      }
      // Covered if an enemy piece attacks it (with the king lifted off, so a rook's ray also covers the square behind the king).
      // If an enemy piece stands there, the king can only take it when nothing protects it, which is the same test.
      const by = attackers(without, sq, mover);
      if (by.length) escapes.push({ square: sq, why: 'covered', by, text: `${sq} is covered by the ${by.map((c) => nameOf(board, c)).join(' and the ')}` });
    }
  }

  // Why the check cannot be answered.
  const reasons: string[] = [];
  if (checkers.length > 1) reasons.push('it is a double check, so the only answer is to move the king');
  else if (checkers.length === 1) {
    const c = checkers[0];
    if (c.piece === 'n') reasons.push('a knight check cannot be blocked');
    else if (c.piece === 'p') reasons.push('a pawn check cannot be blocked');
    else if (Math.abs(FILES.indexOf(c.square[0]) - f) <= 1 && Math.abs(+c.square[1] - r) <= 1) reasons.push(`the ${NAME[c.piece]} is touching the king, so there is no square to block on`);
    else reasons.push(`nothing can step between the ${NAME[c.piece]} and the king`);
    const defenders = attackers(board, c.square, kingColor).filter((s) => s !== kingSquare);
    reasons.push(defenders.length ? `and none of the pieces that can reach the ${NAME[c.piece]} are able to take it legally` : `and nothing of theirs can capture the ${NAME[c.piece]}`);
  }
  const noAnswer = reasons.join(', ');

  const checkText = join(checkers.map((c) => `the ${NAME[c.piece]} on ${c.square}`));
  const covered = escapes.filter((e) => e.why === 'covered');
  const blocked = escapes.filter((e) => e.why === 'own-piece');
  const parts = [`The king on ${kingSquare} is in check from ${checkText}.`];
  if (covered.length) {
    parts.push(`It has nowhere to run: ${join(covered.map((e) => `${e.square} is covered by the ${join(e.by.map((c) => nameOf(board, c)))}`))}.`);
  }
  if (blocked.length) parts.push(`${join(blocked.map((e) => e.square))} ${blocked.length === 1 ? 'is' : 'are'} blocked by its own ${blocked.length === 1 ? 'piece' : 'pieces'}.`);
  parts.push(`And ${noAnswer || 'the check cannot be answered'}. That is checkmate.`);

  const marks: MateAnatomy['marks'] = {};
  const arrows: MateAnatomy['arrows'] = [];
  for (const e of escapes) {
    marks[e.square] = e.why === 'covered' ? 'bad' : 'sel';
    if (e.why === 'covered') for (const from of e.by) arrows.push({ from, to: e.square, color: 'warn' });
  }
  marks[kingSquare] = 'bad';
  for (const c of checkers) arrows.push({ from: c.square, to: kingSquare, color: 'bad' });

  return { kingSquare, kingColor, checkers, escapes, answerable: false, noAnswer, summary: parts.join(' '), marks, arrows };
}

