// Judge any move a person tries, using the engine: is it as good as the best move ("also good"), or not, and why?
import { Chess } from '@/chess/compat';
import type { Uci } from '@/chess/types';
import type { Engine } from '@/engine/engine';
import { reviewMoves } from './classify';
import { explainMove, mateIn, type Explanation } from './explain';
import { terminalAnalysis, toPosAnalysis } from './runReview';
import type { MoveClass, MoveReview, PosAnalysis } from './types';

export interface Judgement {
  move: MoveReview;
  /** plain-English reasons (why it works, or why it does not) */
  explanation: Explanation | null;
  /** as good as the best move for practical purposes */
  good: boolean;
  /** still a forced checkmate after this move (for mate puzzles) */
  keepsMate: boolean;
  before: PosAnalysis;
  after: PosAnalysis;
}

/** Classes that count as "also a good move". */
export const GOOD_ENOUGH: MoveClass[] = ['best', 'excellent', 'good', 'great', 'brilliant', 'book', 'forced'];

export interface JudgeOptions {
  depth?: number;
  movetimeMs?: number;
  /** the analysis of the position before the move, if the caller already has it */
  before?: PosAnalysis;
}

const cache = new Map<string, PosAnalysis>();

async function analyse(engine: Pick<Engine, 'run'>, fen: string, multipv: number, o: JudgeOptions): Promise<PosAnalysis> {
  const term = terminalAnalysis(fen);
  if (term) return term;
  const key = `${fen}|${multipv}|${o.depth ?? 20}|${o.movetimeMs ?? 1500}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const legal = new Chess(fen).moves().length;
  const e = await engine.run(fen, { depth: o.depth ?? 20, movetimeMs: o.movetimeMs ?? 1500, multipv: Math.min(multipv, legal), priority: 'interactive', interruptible: false });
  const pos = toPosAnalysis(e, legal);
  if (cache.size > 40) cache.clear();
  cache.set(key, pos);
  return pos;
}

/**
 * Rate `uci` in `fen`. The side to move is the one trying the move ("you").
 * Returns null when the move is illegal or the engine gives no answer.
 */
export async function judgeMove(engine: Pick<Engine, 'run'>, fen: string, uci: Uci, o: JudgeOptions = {}): Promise<Judgement | null> {
  let c: Chess;
  try {
    c = new Chess(fen);
  } catch {
    return null;
  }
  const mover = c.turn();
  try {
    c.move({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci[4] || 'q' });
  } catch {
    return null;
  }
  const fenAfter = c.fen();
  const before = o.before ?? (await analyse(engine, fen, 3, o));
  const after = await analyse(engine, fenAfter, 2, { ...o, movetimeMs: Math.min(o.movetimeMs ?? 1500, 1200) });
  if (!before.lines[0] || !after.lines[0]) return null;
  const [move] = reviewMoves(fen, [uci], [before, after]);
  if (!move) return null;
  const explanation = explainMove({ fenBefore: fen, move, before, after, userColor: mover });
  const keepsMate = after.terminal === 'mate' || mateIn(after.lines[0], mover) != null;
  return { move, explanation, good: GOOD_ENOUGH.includes(move.cls), keepsMate, before, after };
}
