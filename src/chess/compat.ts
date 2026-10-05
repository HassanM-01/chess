// chess.js 1.x throws on illegal input; the prototype was written for 0.10 (returns null/false).
// These helpers keep the ported code simple (spec section 13.3).
import { Chess, type Move } from 'chess.js';
import type { Uci } from './types';

export { Chess };
export type { Move };

/** Make a move; returns null instead of throwing when it is illegal. */
export function tryMove(chess: Chess, move: string | { from: string; to: string; promotion?: string }): Move | null {
  try {
    return chess.move(move);
  } catch {
    return null;
  }
}

/** Play a UCI move ("e2e4", "e7e8q"). A bare 4-char promotion defaults to a queen. */
export function uciMove(chess: Chess, uci: Uci): Move | null {
  return tryMove(chess, { from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci[4] || 'q' });
}

/** Build a Chess from a FEN, or null if the FEN is invalid. */
export function tryChess(fen?: string): Chess | null {
  try {
    return fen ? new Chess(fen) : new Chess();
  } catch {
    return null;
  }
}

export interface LoadedPgn {
  chess: Chess;
  headers: Record<string, string>;
  history: Move[];
}

/** Lenient PGN loader (strict:false). Returns null when the text can't be parsed. */
export function loadPgnSafe(pgn: string): LoadedPgn | null {
  const attempt = (text: string): LoadedPgn | null => {
    try {
      const chess = new Chess();
      chess.loadPgn(text, { strict: false });
      const headers = chess.getHeaders() as Record<string, string>;
      const history = chess.history({ verbose: true });
      return { chess, headers: { ...headers }, history };
    } catch {
      return null;
    }
  };
  const first = attempt(pgn);
  if (first && first.history.length) return first;
  // Retry with comments, NAGs and "12..." markers stripped.
  const cleaned = pgn.replace(/\{[^}]*\}/g, ' ').replace(/\$\d+/g, ' ').replace(/\d+\.\.\./g, ' ');
  return attempt(cleaned);
}

// Boolean helpers named like the 0.10 API so ported code reads the same.
export const inCheck = (c: Chess): boolean => c.inCheck();
export const inCheckmate = (c: Chess): boolean => c.isCheckmate();
export const inStalemate = (c: Chess): boolean => c.isStalemate();
export const gameOver = (c: Chess): boolean => c.isGameOver();
