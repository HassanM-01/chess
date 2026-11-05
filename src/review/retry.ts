import type { Color, Uci } from '@/chess/types';
import { epFor } from './expected';
import type { PosAnalysis } from './types';

/**
 * Judge a move tried in "Retry" mode using the lines already saved with the review.
 * best: the engine's top move; good: another saved line within 3 points of expected score; wrong: anything else.
 */
export function retryVerdict(pos: PosAnalysis | undefined, color: Color, uci: Uci): 'best' | 'good' | 'wrong' {
  const lines = pos?.lines ?? [];
  if (!lines.length) return 'wrong';
  if (lines[0].pv[0] === uci) return 'best';
  const best = epFor(lines[0], color);
  const hit = lines.slice(1).find((l) => l.pv[0] === uci);
  return hit && best - epFor(hit, color) <= 0.03 ? 'good' : 'wrong';
}
