import { useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import type { ThemeKey } from '@/db/types';
import { THEMES } from '@/content/themes';
import { pickPuzzles } from '@/skill/pickPuzzles';
import { buildTrainerSession, dueOwn, type TrainerMode } from '@/skill/sessionBuilder';
import { useRepo } from '@/state/auth';
import { useSkillProfile, useTrainingItems } from '@/state/queries';
import { toast } from '@/state/toast';
import { useSessionStore } from './sessionStore';
import { puzzleItem, toSessionItem, type SessionOptions } from './types';

const TRAINER_TITLES: Record<TrainerMode, string> = {
  threat: 'Spot the threat',
  judge: 'Safe or blunder?',
  punish: 'Punish their mistakes',
  fix: 'Fix your mistakes',
  mix: 'Your game trainer',
};

/** Launchers for training sessions, shared by the Coach, Train, Learn and Games screens. */
export function useStartSession() {
  const nav = useNavigate();
  const repo = useRepo();
  const start = useSessionStore((s) => s.start);
  const { data: training = [] } = useTrainingItems();
  const { data: skill } = useSkillProfile();

  const startPuzzles = useCallback(
    async (o: { theme: ThemeKey | 'mix'; n: number; title?: string; onDone?: SessionOptions['onDone']; returnTo?: string }): Promise<void> => {
      const puzzles = await pickPuzzles(repo, { theme: o.theme, n: o.n, themeWeights: skill?.themeWeights ?? null });
      if (!puzzles.length) {
        toast('No puzzles for that theme yet.');
        return;
      }
      start(puzzles.map(puzzleItem), {
        title: o.title ?? (o.theme === 'mix' ? 'Daily mix' : THEMES[o.theme].name),
        hideTheme: o.theme === 'mix',
        onDone: o.onDone,
        returnTo: o.returnTo,
      });
      nav('/train/session');
    },
    [repo, skill, start, nav],
  );

  const startTrainer = useCallback(
    (mode: TrainerMode, extra: Partial<SessionOptions> = {}): void => {
      const items = buildTrainerSession(training, mode);
      if (!items.length) {
        toast(mode === 'fix' ? 'No mistakes to review yet.' : 'Pull and analyze a few games first.');
        return;
      }
      start(items.map(toSessionItem), { title: TRAINER_TITLES[mode], ...extra });
      nav('/train/session');
    },
    [training, start, nav],
  );

  const startFix = useCallback((): void => {
    if (!dueOwn(training).length && !training.some((t) => t.payload.pool === 'own')) {
      toast('No mistakes to review yet.');
      return;
    }
    startTrainer('fix');
  }, [training, startTrainer]);

  /** Re-run a custom list (redo the ones you missed / do the whole set again). */
  const startItems = useCallback(
    (items: Parameters<typeof start>[0], options: SessionOptions): void => {
      start(items, options);
    },
    [start],
  );

  return { startPuzzles, startTrainer, startFix, startItems };
}
