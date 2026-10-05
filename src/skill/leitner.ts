// Leitner spaced repetition (spec 6.5) and theme-rating Elo (spec 6.4).

/** Days until due for boxes 0..6. */
export const LEITNER_DAYS = [0, 1, 3, 7, 14, 30, 60] as const;
export const WRONG_RETRY_MS = 10 * 60_000;
const DAY_MS = 86_400_000;

export interface ScheduleState {
  box: number;
  dueAt: Date;
}

/**
 * Correct on the first try with no hint -> box + 1 (due in that box's days).
 * Anything else -> box 0, due again in 10 minutes.
 * (A "Try again" retry never calls this: it must not change the schedule or score.)
 */
export function nextSchedule(box: number, firstTryCorrect: boolean, now: Date = new Date()): ScheduleState {
  if (firstTryCorrect) {
    const b = Math.min(box + 1, LEITNER_DAYS.length - 1);
    return { box: b, dueAt: new Date(now.getTime() + LEITNER_DAYS[b] * DAY_MS) };
  }
  return { box: 0, dueAt: new Date(now.getTime() + WRONG_RETRY_MS) };
}

export const isDue = (dueAt: string | Date, now: Date = new Date()): boolean => new Date(dueAt).getTime() <= now.getTime();

export const DEFAULT_THEME_RATING = 800;
export const ELO_K = 32;

/**
 * Elo update with the puzzle rating as the opponent. A hint counts as a loss for rating purposes
 * (the solve is still recorded as an attempt).
 */
export function updateThemeRating(rating: number, puzzleRating: number, correct: boolean, usedHint: boolean): number {
  const expected = 1 / (1 + Math.pow(10, (puzzleRating - rating) / 400));
  const score = correct && !usedHint ? 1 : 0;
  return rating + ELO_K * (score - expected);
}
