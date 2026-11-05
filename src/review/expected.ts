// "Expected points": the chance of winning plus half the chance of drawing, 0..1, from the centipawn score.
//
// Why not use Stockfish's own win/draw/loss numbers? They are calibrated on engine-vs-engine games, where +2.7 is already a 99.9% win.
// People are far less precise, so a +2.7 position is nowhere near certain for them, and an engine-calibrated curve would call almost every
// mistake in a winning position "fine". This is the logistic curve Lichess fitted to millions of human games instead.
import type { Color } from '@/chess/types';
import type { StoredLine } from './types';

const K = 0.00368208;

export function epWhite(l: Pick<StoredLine, 'cp' | 'mate'>): number {
  if (l.mate != null) return l.mate > 0 ? 1 : l.mate < 0 ? 0 : 0.5;
  return 1 / (1 + Math.exp(-K * Math.max(-3000, Math.min(3000, l.cp))));
}

export const epFor = (l: Pick<StoredLine, 'cp' | 'mate'>, color: Color): number => (color === 'w' ? epWhite(l) : 1 - epWhite(l));
