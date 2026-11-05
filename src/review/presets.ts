import type { ReviewSettings } from './types';

export type PresetKey = 'quick' | 'standard' | 'deep' | 'maximum';

/**
 * Every position of the game is searched until the depth is reached or the time cap runs out, whichever comes first.
 * Measured on a 16-thread Ryzen 9 with 14 threads and 7 GB hash, three lines: 15 s reaches depth ~28, 40 s reaches depth ~33-34.
 * Depth 30+ is rarely reached inside the cap in a middlegame, so in practice the time cap is what sets the quality.
 */
export const PRESETS: Record<PresetKey, ReviewSettings & { label: string; blurb: string }> = {
  quick: { label: 'Quick', blurb: 'Up to 2 s per move. Minutes per game; good for a first look.', depth: 18, movetimeMs: 2_000, multipv: 2 },
  standard: { label: 'Standard', blurb: 'Up to 6 s per move (depth ~24). Under 10 minutes for a typical game.', depth: 24, movetimeMs: 6_000, multipv: 3 },
  deep: { label: 'Deep', blurb: 'Up to 15 s per move (depth ~28 on a fast PC). About 20 minutes for a 40-move game.', depth: 30, movetimeMs: 15_000, multipv: 3 },
  maximum: { label: 'Maximum', blurb: 'Up to 40 s per move (depth 33+ on a fast PC), three lines. Roughly an hour for a 40-move game; you can read the review while it runs.', depth: 40, movetimeMs: 40_000, multipv: 3 },
};

export const DEFAULT_PRESET: PresetKey = 'maximum';
