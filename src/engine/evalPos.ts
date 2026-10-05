import { Chess } from '@/chess/compat';
import type { Engine } from './engine';
import type { EnginePriority, PosEval } from './types';

/** If the position is checkmate or stalemate, answer without asking the engine. */
export function terminalEval(fen: string): PosEval | null {
  let c: Chess;
  try {
    c = new Chess(fen);
  } catch {
    return null;
  }
  if (c.isCheckmate()) {
    const whiteMated = c.turn() === 'w';
    return { cpWhite: whiteMated ? -10000 : 10000, mateWhite: whiteMated ? -1 : 1, best: null, pv: [], lines: [] };
  }
  if (c.isGameOver()) return { cpWhite: 0, mateWhite: null, best: null, pv: [], lines: [] };
  return null;
}

/** Anything that can evaluate a FEN: the real engine, or a stub in tests. */
export type Evaluator = (fen: string, depth?: number, priority?: EnginePriority, opts?: { newGame?: boolean }) => Promise<PosEval>;

export function makeEvaluator(engine: Pick<Engine, 'run'>): Evaluator {
  return async (fen, depth = 10, priority = 'interactive', opts) => terminalEval(fen) ?? engine.run(fen, { depth, priority, newGame: opts?.newGame });
}
