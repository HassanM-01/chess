// Data model for a chess.com-style game review. Only the raw engine output is stored; every label is
// recomputed from it (see classify.ts), so improving the rules upgrades old reviews for free.
import type { Color, Uci } from '@/chess/types';

/** One engine line. Scores are from White's point of view. */
export interface StoredLine {
  cp: number;
  /** mate in N plies-for-the-side-that-mates (positive: White mates) */
  mate: number | null;
  /** win/draw/loss per mille from White's point of view */
  wdl?: [number, number, number];
  pv: Uci[];
  depth: number;
}

export interface PosAnalysis {
  lines: StoredLine[];
  depth: number;
  /** the position has no moves: checkmate (side to move lost), stalemate or another draw */
  terminal?: 'mate' | 'draw';
  /** number of legal moves (1 = forced) */
  legal: number;
}

export type MoveClass = 'brilliant' | 'great' | 'best' | 'excellent' | 'good' | 'book' | 'inaccuracy' | 'mistake' | 'miss' | 'blunder' | 'forced';

export interface MoveReview {
  ply: number; // index into movesUci (0 = White's first move in a normal game)
  color: Color;
  san: string;
  uci: Uci;
  cls: MoveClass;
  /** expected points (0..1) for the mover: with the engine's best move / after the move actually played */
  epBest: number;
  epAfter: number;
  /** expected points given up (>= 0) */
  loss: number;
  /** accuracy of this single move, 0..100 */
  accuracy: number;
  bestUci: Uci | null;
  bestSan: string;
  /** the best line's moves in SAN (up to 6), for "Best was ..." and the lines panel */
  bestLineSan: string[];
  /** evaluation after the move, White's POV */
  evalCp: number;
  evalMate: number | null;
  /** short reason, e.g. "Sacrifices the bishop for a winning attack" */
  note?: string;
  /** opening name when the move is a book move */
  bookName?: string;
}

export interface SideSummary {
  accuracy: number;
  counts: Record<MoveClass, number>;
  /** average expected-points loss per move, in percent */
  avgLossPct: number;
}

export interface ReviewSummary {
  white: SideSummary;
  black: SideSummary;
  /** White's win probability after each ply (index 0 = start), for the graph */
  graph: number[];
}

export interface ReviewSettings {
  depth: number;
  movetimeMs: number;
  multipv: number;
}

export interface StoredReview {
  version: 1;
  gameId: string;
  engine: string;
  threads: number;
  hashMb: number;
  settings: ReviewSettings;
  positions: PosAnalysis[];
  /** false while the analysis is still running or was cancelled */
  complete: boolean;
  createdAt: string;
  updatedAt: string;
}

export const MOVE_CLASSES: MoveClass[] = ['brilliant', 'great', 'best', 'excellent', 'good', 'book', 'inaccuracy', 'mistake', 'miss', 'blunder'];

export const emptyCounts = (): Record<MoveClass, number> => ({
  brilliant: 0,
  great: 0,
  best: 0,
  excellent: 0,
  good: 0,
  book: 0,
  inaccuracy: 0,
  mistake: 0,
  miss: 0,
  blunder: 0,
  forced: 0,
});
