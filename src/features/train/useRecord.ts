// Persists the outcome of a solved training item: attempt log, Leitner schedule, theme Elo, daily-plan counters.
import { useCallback } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import type { PuzzleRow, TrainingItem } from '@/db/types';
import { DEFAULT_THEME_RATING, nextSchedule, updateThemeRating } from '@/skill/leitner';
import { useRepo } from '@/state/auth';
import { dailyFor, qk, useProgressUpdater } from '@/state/queries';
import { localDateKey } from '@/lib/util';

/** attempts.theme for game-trainer items: one key per trainer mode */
export const modeKey = (pool: TrainingItem['payload']['pool']): string =>
  pool === 'threat' || pool === 'calm' ? 'g_threat' : pool === 'blunder' || pool === 'safe' ? 'g_judge' : pool === 'punish' ? 'g_punish' : 'g_own';

export interface Outcome {
  /** solved without a wrong try and without peeking at the answer */
  firstTry: boolean;
  usedHint: boolean;
  ms: number;
}

export function useRecordAnswer() {
  const repo = useRepo();
  const qc = useQueryClient();
  const updateProgress = useProgressUpdater();

  const bumpDaily = useCallback(
    (field: 'puzzles' | 'drills') =>
      updateProgress((p) => {
        const d = dailyFor(p, localDateKey());
        return { daily: { ...d, [field]: (d[field] ?? 0) + 1 } };
      }),
    [updateProgress],
  );

  const recordPuzzle = useCallback(
    async (puzzle: PuzzleRow, o: Outcome): Promise<void> => {
      const theme = puzzle.themes[0] ?? 'mix';
      await repo.insertAttempt({ puzzleId: puzzle.id, trainingItemId: null, theme, correct: o.firstTry, usedHint: o.usedHint, ms: o.ms });
      const cur = (await repo.listThemeSkill()).find((t) => t.theme === theme);
      const rating = updateThemeRating(cur?.rating ?? DEFAULT_THEME_RATING, puzzle.rating, o.firstTry, o.usedHint);
      await repo.upsertThemeSkill({ theme, rating, attempts: (cur?.attempts ?? 0) + 1 });
      await bumpDaily('puzzles');
      void qc.invalidateQueries({ queryKey: [repo.userId, 'attempts'] });
      void qc.invalidateQueries({ queryKey: qk.themeSkill(repo.userId) });
      void qc.invalidateQueries({ queryKey: qk.skill(repo.userId) });
    },
    [repo, qc, bumpDaily],
  );

  const recordItem = useCallback(
    async (item: TrainingItem, o: Outcome, field: 'puzzles' | 'drills'): Promise<void> => {
      const ok = o.firstTry && !o.usedHint;
      const sched = nextSchedule(item.box, ok);
      await repo.updateTrainingItem(item.id, {
        box: sched.box,
        dueAt: sched.dueAt.toISOString(),
        attempts: item.attempts + 1,
        correct: item.correct + (ok ? 1 : 0),
        lastResult: ok,
      });
      await repo.insertAttempt({ puzzleId: null, trainingItemId: item.id, theme: modeKey(item.payload.pool), correct: o.firstTry, usedHint: o.usedHint, ms: o.ms });
      await bumpDaily(field);
      void qc.invalidateQueries({ queryKey: qk.training(repo.userId) });
      void qc.invalidateQueries({ queryKey: [repo.userId, 'attempts'] });
    },
    [repo, qc, bumpDaily],
  );

  const markTrainerDone = useCallback(
    () => updateProgress((p) => ({ daily: { ...dailyFor(p, localDateKey()), trainer: true } })),
    [updateProgress],
  );

  return { recordPuzzle, recordItem, markTrainerDone };
}
