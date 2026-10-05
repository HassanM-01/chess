import type { Color } from '@/chess/types';
import type { PosEval } from './types';

/** White's win probability (0..100). Mate means 100 or 0. */
export function wpWhite(e: Pick<PosEval, 'cpWhite' | 'mateWhite'>): number {
  if (e.mateWhite != null) return e.mateWhite > 0 ? 100 : 0;
  const cp = Math.max(-2000, Math.min(2000, e.cpWhite || 0));
  return 50 + 50 * (2 / (1 + Math.exp(-0.00368208 * cp)) - 1);
}

/** Win probability from `color`'s point of view. */
export const wpFor = (e: Pick<PosEval, 'cpWhite' | 'mateWhite'>, color: Color): number => (color === 'w' ? wpWhite(e) : 100 - wpWhite(e));
