import { useMemo, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useRepo } from '@/state/auth';
import { invalidateAll, useAnalysis, useGame, useMistakes } from '@/state/queries';
import { useSyncController } from '@/state/sync';

/** Loads a game with its analysis + mistakes, and analyzes it on demand if it has not been analyzed yet. */
export function useGameReview(id: string | undefined) {
  const repo = useRepo();
  const qc = useQueryClient();
  const controller = useSyncController();
  const game = useGame(id);
  const analysis = useAnalysis(id);
  const allMistakes = useMistakes();
  const mistakes = useMemo(() => (allMistakes.data ?? []).filter((m) => m.gameId === id).sort((a, b) => a.ply - b.ply), [allMistakes.data, id]);
  const [progress, setProgress] = useState<number | null>(null);
  const [failed, setFailed] = useState(false);
  const started = useRef<string | null>(null);

  const g = game.data;
  const needsAnalysis = !!g && !!g.userColor && !analysis.isLoading && !analysis.data && g.analysisStatus !== 'skipped';

  const analyzeNow = async (): Promise<void> => {
    if (!g) return;
    setFailed(false);
    setProgress(0);
    try {
      await controller.queue.analyzeOne(g, (f) => setProgress(f));
      await invalidateAll(qc, repo.userId);
    } catch (e) {
      console.warn(e);
      setFailed(true);
    } finally {
      setProgress(null);
    }
  };

  return { game, analysis, mistakes, progress, failed, needsAnalysis, analyzeNow, autoStarted: started };
}
