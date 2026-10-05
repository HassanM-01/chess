import { useCallback, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import type { ThemeKey } from '@/db/types';
import { useStartSession } from '@/features/train/useStartSession';
import { useRepo } from '@/state/auth';
import { useAttempts, useGames, useMistakes, useProfile, useProgress, useProgressUpdater, useSkillProfile, useThemeSkill, useTrainingItems } from '@/state/queries';
import { useSyncController } from '@/state/sync';
import { toast } from '@/state/toast';
import { CoachError, requestReport } from './client';
import { buildFacts, factsToText } from './facts';
import type { CoachAction, StoredCoachReport } from './types';

/** The facts packet for the signed-in user, rebuilt from live data. `text` is null until the data has loaded. */
export function useFactsText(): string | null {
  const { data: profile } = useProfile();
  const { data: skill } = useSkillProfile();
  const { data: games } = useGames();
  const { data: mistakes } = useMistakes();
  const { data: attempts } = useAttempts();
  const { data: themeSkill } = useThemeSkill();
  const { data: training } = useTrainingItems();
  const { data: progress } = useProgress();
  return useMemo(() => {
    if (!skill || !games || !mistakes || !attempts || !themeSkill || !training) return null;
    return factsToText(buildFacts({ profile: skill, username: profile?.chesscomUsername ?? null, games, mistakes, attempts, themeSkill, training, progress }));
  }, [skill, profile, games, mistakes, attempts, themeSkill, training, progress]);
}

const LOCAL_KEY = (userId: string): string => `bc-coach-report:${userId}`;

function readLocal(userId: string): StoredCoachReport | undefined {
  try {
    const raw = localStorage.getItem(LOCAL_KEY(userId));
    return raw ? (JSON.parse(raw) as StoredCoachReport) : undefined;
  } catch {
    return undefined;
  }
}

/** The stored coach plan plus a way to write a new one. Saved with the account; falls back to this browser if that fails. */
export function useCoachReport() {
  const repo = useRepo();
  const { data: progress } = useProgress();
  const { data: skill } = useSkillProfile();
  const update = useProgressUpdater();
  const factsText = useFactsText();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [local, setLocal] = useState<StoredCoachReport | undefined>(undefined);

  const stored = progress?.coach?.report ?? readLocal(repo.userId);

  const generate = useCallback(async (): Promise<void> => {
    if (!factsText || busy) return;
    setBusy(true);
    setError(null);
    try {
      const report = await requestReport(factsText);
      const next: StoredCoachReport = { generatedAt: new Date().toISOString(), forGames: skill?.gamesAnalyzed ?? 0, report };
      try {
        await update(() => ({ coach: { report: next } }));
      } catch {
        // The account has no place to keep it yet (migration 0005), so keep it in this browser.
        try {
          localStorage.setItem(LOCAL_KEY(repo.userId), JSON.stringify(next));
        } catch {
          /* storage unavailable: the plan still shows for this visit */
        }
      }
      // make it visible even if saving failed
      setLocal(next);
    } catch (e) {
      setError(e instanceof CoachError ? e.message : 'The coach is not available right now. Try again in a minute.');
    } finally {
      setBusy(false);
    }
  }, [factsText, busy, skill, update, repo.userId]);

  return { report: local ?? stored, generate, busy, error, ready: factsText !== null };
}

/** True when a plan exists but the player has since analyzed several more games, or it is over a week old. */
export function isStale(r: StoredCoachReport | undefined, gamesNow: number, now: Date = new Date()): boolean {
  if (!r) return false;
  return gamesNow - r.forGames >= 3 || now.getTime() - new Date(r.generatedAt).getTime() > 7 * 86_400_000;
}

/** Turns a plan item's action into what the app does. */
export function useRunAction() {
  const nav = useNavigate();
  const { startTrainer, startFix, startPuzzles } = useStartSession();
  const { data: games = [] } = useGames();
  const controller = useSyncController();

  return useCallback(
    (action: CoachAction): void => {
      if (action === 'trainer') startTrainer('mix', { dailyKey: 'trainer' });
      else if (action === 'mix') void startPuzzles({ theme: 'mix', n: 10 });
      else if (action === 'fix') startFix();
      else if (action === 'threat' || action === 'judge' || action === 'punish') startTrainer(action);
      else if (action === 'play') nav('/play');
      else if (action === 'london') nav('/london');
      else if (action === 'pull') {
        void controller.pull();
        nav('/games');
      } else if (action === 'review_last') {
        const last = games
          .filter((g) => g.analysisStatus === 'done' && g.userColor && (g.source === 'chesscom' || g.source === 'pgn'))
          .sort((a, b) => (b.playedAt ?? b.createdAt).localeCompare(a.playedAt ?? a.createdAt))[0];
        if (last) nav(`/games/${last.id}/walk`);
        else toast('Pull and analyze some games first.');
      } else if (action.startsWith('puzzles:')) void startPuzzles({ theme: action.slice(8) as ThemeKey, n: 8 });
      else if (action.startsWith('lesson:')) nav(`/learn/lesson/${action.slice(7)}`);
    },
    [nav, startTrainer, startFix, startPuzzles, games, controller],
  );
}

