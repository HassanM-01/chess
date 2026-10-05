import type { Uci } from '@/chess/types';

/** One principal variation. Scores are ALWAYS from White's point of view. */
export interface EngineLine {
  cpWhite: number;
  mateWhite: number | null;
  pv: Uci[];
}

export interface PosEval {
  /** centipawns, White's POV (mate scores become +-10000) */
  cpWhite: number;
  /** mate in N, White's POV: > 0 means White mates, < 0 means Black mates */
  mateWhite: number | null;
  best: Uci | null;
  pv: Uci[];
  lines: EngineLine[];
}

export type EnginePriority = 'interactive' | 'background';

export interface RunOptions {
  depth?: number;
  /** Stockfish "Skill Level" 0..20 */
  skill?: number;
  multipv?: number;
  /** interactive requests (bot moves, hints, Blunder Check) always jump ahead of background analysis */
  priority?: EnginePriority;
  /** clear the hash table first (UCI ucinewgame): analysis does this per game so results do not depend on what ran before */
  newGame?: boolean;
}

export type EngineStatus = 'idle' | 'loading' | 'ready' | 'failed';

/** The compact per-ply tuple stored in game_analysis.evals: [cp_white, mate_white | null, best_uci | null] */
export type StoredEval = [number, number | null, string | null];

export const toStored = (e: PosEval): StoredEval => [Math.round(e.cpWhite), e.mateWhite, e.best];
export const fromStored = (a: StoredEval): PosEval => ({ cpWhite: a[0], mateWhite: a[1], best: a[2], pv: [], lines: [] });
