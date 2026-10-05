import { LESSONS } from '@/content/lessons';
import { THEME_KEYS } from '@/content/themes';
import type { CoachAction } from './types';

export const SIMPLE_ACTIONS = ['trainer', 'mix', 'fix', 'threat', 'judge', 'punish', 'play', 'london', 'review_last', 'pull'] as const;

/** Every action the coach may put in a plan (the AI picks from this list; anything else is dropped). */
export const ALLOWED_ACTIONS: CoachAction[] = [
  ...SIMPLE_ACTIONS,
  ...THEME_KEYS.map((t) => `puzzles:${t}` as const),
  ...LESSONS.map((l) => `lesson:${l.id}` as const),
];

export function isAllowedAction(a: unknown): a is CoachAction {
  return typeof a === 'string' && (ALLOWED_ACTIONS as string[]).includes(a);
}

/** What the model is told each action does, so it can choose well. */
export const ACTION_HELP: Record<string, string> = {
  trainer: 'Game trainer: 15 positions from the player\'s own games (spot threats, judge moves, punish blunders, fix mistakes)',
  mix: 'Daily puzzle mix: puzzles built for this player and weighted toward their weak themes',
  fix: 'Fix your mistakes: re-solve the player\'s own mistakes and mirrored copies of them',
  threat: 'Spot the threat: which of your pieces is in danger after the opponent moves',
  judge: 'Safe or blunder: judge your own move before you play it',
  punish: 'Punish mistakes: the opponent just blundered, take what they gave you',
  play: 'Play one game against the bot with Blunder Check on',
  london: 'Play one London System game with a live coach',
  review_last: 'Walk through the last game move by move',
  pull: 'Pull recent games from chess.com so the report stays current',
};
