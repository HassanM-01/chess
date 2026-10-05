import type { Color, PieceType, Square, Uci } from '@/chess/types';
import type { Phase } from '@/chess/tactics';

export type MistakeCategory = 'hung' | 'ignored' | 'missed_free' | 'fork' | 'missed_mate' | 'allowed_mate' | 'other';
export type Severity = 'mistake' | 'blunder';
export type Termination = 'checkmate' | 'resignation' | 'time' | 'abandoned' | 'draw' | 'other';
export type Outcome = 'w' | 'l' | 'd';

/** The slice of a game the analysis code needs. */
export interface AnalyzableGame {
  startFen: string;
  movesUci: Uci[];
  movesSan: string[];
  userColor: Color | null;
  outcome?: Outcome | null;
  termination?: Termination | string | null;
}

/** A mistake as produced by findMistakes (before it is given ids / user / game). */
export interface MistakeDraft {
  ply: number;
  fen: string; // position BEFORE the user's move
  playedUci: Uci;
  playedSan: string;
  bestUci: Uci | null;
  bestSan: string;
  replyUci: Uci | null;
  replySan: string;
  category: MistakeCategory;
  severity: Severity;
  phase: Phase;
  piece: PieceType | null;
  square: Square | null;
  winDrop: number;
  explanation: string;
}

export type VerdictKey = 'best' | 'good' | 'inacc' | 'mistake' | 'blunder';
export interface VerdictCounts {
  best: number;
  good: number;
  inacc: number;
  mistake: number;
  blunder: number;
}

/** game_analysis.summary (jsonb, snake_case keys as in the spec) */
export interface GameSummary {
  castled_move: number | null; // the user's Nth move was castling
  early_queen: boolean;
  eval_after_10: number | null; // user's win% after 10 moves each
  how_ended: Termination;
  outcome: Outcome | null;
  counts: VerdictCounts;
}
