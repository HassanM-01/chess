import type { Uci } from '@/chess/types';

/** One principal variation. Scores are ALWAYS from White's point of view. */
export interface EngineLine {
  cpWhite: number;
  mateWhite: number | null;
  pv: Uci[];
  /** search depth this line was reported at (UCI "depth") */
  depth?: number;
  /** win/draw/loss in per mille from White's point of view, when the engine reports it (UCI_ShowWDL) */
  wdl?: [number, number, number];
}

export interface PosEval {
  /** centipawns, White's POV (mate scores become +-10000) */
  cpWhite: number;
  /** mate in N, White's POV: > 0 means White mates, < 0 means Black mates */
  mateWhite: number | null;
  best: Uci | null;
  pv: Uci[];
  lines: EngineLine[];
  /** depth of the deepest completed iteration */
  depth?: number;
  wdl?: [number, number, number];
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
  /** hard time cap for this search in ms (UCI "go ... movetime"); the search ends at depth OR time, whichever comes first */
  movetimeMs?: number;
  /** give up and reset the engine if there is no answer after this long (default 45 s, or the time cap + 30 s) */
  timeoutMs?: number;
  /** may a later interactive request stop this search and re-queue it? Default: only background jobs. */
  interruptible?: boolean;
  /** called with the improved lines every time the engine finishes a deeper iteration */
  onInfo?: (lines: EngineLine[], depth: number) => void;
  /** stop the search early; the result is whatever the engine has found so far */
  signal?: AbortSignal;
}

export type EngineStatus = 'idle' | 'loading' | 'ready' | 'failed';

/** The compact per-ply tuple stored in game_analysis.evals: [cp_white, mate_white | null, best_uci | null] */
export type StoredEval = [number, number | null, string | null];

export const toStored = (e: PosEval): StoredEval => [Math.round(e.cpWhite), e.mateWhite, e.best];
export const fromStored = (a: StoredEval): PosEval => ({ cpWhite: a[0], mateWhite: a[1], best: a[2], pv: [], lines: [] });
