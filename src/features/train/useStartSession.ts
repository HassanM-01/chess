import { useCallback, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import type { ThemeKey } from '@/db/types';
import { THEMES } from '@/content/themes';
import { pickPuzzles } from '@/skill/pickPuzzles';
import { buildTrainerSession, dueOwn, pickGenerated, type TrainerMode } from '@/skill/sessionBuilder';
import { useRepo } from '@/state/auth';
import { useSkillProfile, useThemeSkill, useTrainingItems } from '@/state/queries';
import { toast } from '@/state/toast';
import { useSessionStore } from './sessionStore';
import { genToSessionItem, puzzleItem, toSessionItem, type SessionOptions } from './types';

const TRAINER_TITLES: Record<TrainerMode, string> = {
  threat: 'Spot the threat',
  judge: 'Safe or blunder?',
  punish: 'Punish their mistakes',
  fix: 'Fix your mistakes',
  mix: 'Your game trainer',
};

const PICK_TIMEOUT_MS = 20_000;

/** Reject if `p` has not settled in `ms`, so a hung request cannot leave the Start button stuck. */
function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout>;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error('this is taking too long, check your connection and try again')), ms);
  });
  return Promise.race([p, timeout]).finally(() => clearTimeout(timer));
}

/** Launchers for training sessions, shared by the Coach, Train, Learn and Games screens. */
export function useStartSession() {
  const nav = useNavigate();
  const repo = useRepo();
  const start = useSessionStore((s) => s.start);
  const { data: training = [] } = useTrainingItems();
  const { data: skill } = useSkillProfile();
  const { data: themeSkill = [] } = useThemeSkill();

  /** true while a puzzle session is being assembled (the bank lookup is a series of network calls) */
  const [startingPuzzles, setStartingPuzzles] = useState(false);
  const inFlight = useRef(false);

  const startPuzzles = useCallback(
    async (o: { theme: ThemeKey | 'mix'; n: number; title?: string; onDone?: SessionOptions['onDone']; returnTo?: string }): Promise<void> => {
      if (inFlight.current) return; // ignore repeat taps while the first one is still loading
      inFlight.current = true;
      setStartingPuzzles(true);
      try {
        // Personal puzzles first (about 70% of the set when there are enough); the shared bank fills the rest.
        const ratings = Object.fromEntries(themeSkill.map((t) => [t.theme, t.rating]));
        const mine = pickGenerated(training, o.theme, Math.ceil(o.n * 0.7), { weights: skill?.themeWeights ?? null, ratings });
        const bank = o.n - mine.length > 0 ? await withTimeout(pickPuzzles(repo, { theme: o.theme, n: o.n - mine.length, themeWeights: skill?.themeWeights ?? null }), PICK_TIMEOUT_MS) : [];
        const items = [...mine.map(genToSessionItem), ...bank.map(puzzleItem)]; // personal first
        if (!items.length) {
          toast('No puzzles for that theme yet.');
          return;
        }
        start(items, {
          title: o.title ?? (o.theme === 'mix' ? 'Daily mix' : THEMES[o.theme].name),
          hideTheme: o.theme === 'mix',
          onDone: o.onDone,
          returnTo: o.returnTo,
        });
        nav('/train/session');
      } catch (e) {
        // No silent taps: say why the session did not start.
        console.error('could not start puzzles', e);
        toast(`Couldn't load puzzles: ${e instanceof Error && e.message ? e.message : 'unknown error'}`);
      } finally {
        inFlight.current = false;
        setStartingPuzzles(false);
      }
    },
    [repo, skill, training, themeSkill, start, nav],
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

  return { startPuzzles, startingPuzzles, startTrainer, startFix, startItems };
}
