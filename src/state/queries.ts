// TanStack Query hooks over the Repo. Keys are namespaced by user id so cached data never crosses accounts.
import { useCallback } from 'react';
import { useMutation, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query';
import type { Repo, ProfilePatch } from '@/db/repo';
import type { DailyState, GameRow, Profile, ProgressRow } from '@/db/types';
import { localDateKey } from '@/lib/util';
import { loadSkillProfile } from '@/skill/profileData';
import { useRepo } from './auth';

export const qk = {
  profile: (u: string) => [u, 'profile'] as const,
  games: (u: string) => [u, 'games'] as const,
  game: (u: string, id: string) => [u, 'game', id] as const,
  analysis: (u: string, id: string) => [u, 'analysis', id] as const,
  analyses: (u: string) => [u, 'analyses'] as const,
  mistakes: (u: string) => [u, 'mistakes'] as const,
  training: (u: string) => [u, 'training'] as const,
  attempts: (u: string) => [u, 'attempts'] as const,
  themeSkill: (u: string) => [u, 'themeSkill'] as const,
  snapshots: (u: string) => [u, 'snapshots'] as const,
  progress: (u: string) => [u, 'progress'] as const,
  skill: (u: string) => [u, 'skill'] as const,
  puzzleCounts: (u: string) => [u, 'puzzleCounts'] as const,
};

/** Invalidate everything derived from games/analysis (after a sync, an analysis or a training answer). */
export function invalidateAll(qc: QueryClient, userId: string): Promise<void> {
  return qc.invalidateQueries({ queryKey: [userId] });
}

export const useProfile = () => {
  const repo = useRepo();
  return useQuery({ queryKey: qk.profile(repo.userId), queryFn: () => repo.getProfile(), staleTime: 60_000 });
};
export const useGames = () => {
  const repo = useRepo();
  return useQuery({ queryKey: qk.games(repo.userId), queryFn: () => repo.listGames() });
};
export const useGame = (id: string | undefined) => {
  const repo = useRepo();
  return useQuery({ queryKey: qk.game(repo.userId, id ?? ''), queryFn: () => repo.getGame(id as string), enabled: !!id });
};
export const useAnalysis = (id: string | undefined) => {
  const repo = useRepo();
  return useQuery({ queryKey: qk.analysis(repo.userId, id ?? ''), queryFn: () => repo.getAnalysis(id as string), enabled: !!id });
};
export const useAnalyses = () => {
  const repo = useRepo();
  return useQuery({ queryKey: qk.analyses(repo.userId), queryFn: () => repo.listAnalyses() });
};
export const useMistakes = () => {
  const repo = useRepo();
  return useQuery({ queryKey: qk.mistakes(repo.userId), queryFn: () => repo.listMistakes() });
};
export const useTrainingItems = () => {
  const repo = useRepo();
  return useQuery({ queryKey: qk.training(repo.userId), queryFn: () => repo.listTrainingItems() });
};
export const useAttempts = () => {
  const repo = useRepo();
  return useQuery({ queryKey: qk.attempts(repo.userId), queryFn: () => repo.listAttempts({ limit: 1000 }) });
};
export const useThemeSkill = () => {
  const repo = useRepo();
  return useQuery({ queryKey: qk.themeSkill(repo.userId), queryFn: () => repo.listThemeSkill() });
};
export const useSnapshots = () => {
  const repo = useRepo();
  return useQuery({ queryKey: qk.snapshots(repo.userId), queryFn: () => repo.listSnapshots(30) });
};
export const useSkillProfile = () => {
  const repo = useRepo();
  return useQuery({ queryKey: qk.skill(repo.userId), queryFn: () => loadSkillProfile(repo) });
};
export const usePuzzleCounts = () => {
  const repo = useRepo();
  return useQuery({ queryKey: qk.puzzleCounts(repo.userId), queryFn: () => repo.countPuzzlesByTheme(), staleTime: 10 * 60_000 });
};

export const useProgress = () => {
  const repo = useRepo();
  return useQuery({ queryKey: qk.progress(repo.userId), queryFn: () => repo.getProgress() });
};

/** Today's daily-plan state, reset whenever the (local) date changes. */
export function dailyFor(p: ProgressRow | undefined, today: string = localDateKey()): DailyState {
  const d = p?.daily;
  if (!d || d.date !== today) return { date: today, trainer: false, puzzles: 0, lesson: 0, played: false, drills: 0 };
  return d;
}

export function useUpdateProfile() {
  const repo = useRepo();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (patch: ProfilePatch) => repo.updateProfile(patch),
    onSuccess: (p: Profile) => {
      qc.setQueryData(qk.profile(repo.userId), p);
    },
  });
}

/** Read-modify-write on the progress row (lessons, openings, daily, play), with an optimistic cache update. */
export function useProgressUpdater(): (fn: (p: ProgressRow) => Partial<Pick<ProgressRow, 'lessons' | 'openings' | 'daily' | 'play'>>) => Promise<ProgressRow> {
  const repo = useRepo();
  const qc = useQueryClient();
  return useCallback(
    async (fn) => {
      const cur = qc.getQueryData<ProgressRow>(qk.progress(repo.userId)) ?? (await repo.getProgress());
      const patch = fn(cur);
      const optimistic = { ...cur, ...patch };
      qc.setQueryData(qk.progress(repo.userId), optimistic);
      const saved = await repo.updateProgress(patch);
      qc.setQueryData(qk.progress(repo.userId), saved);
      return saved;
    },
    [repo, qc],
  );
}

/** Settings live in profiles.settings. */
export function useSettings() {
  const { data } = useProfile();
  const update = useUpdateProfile();
  return { settings: data?.settings ?? {}, set: (s: Profile['settings']) => update.mutate({ settings: s }) };
}

export type { GameRow, Repo };
