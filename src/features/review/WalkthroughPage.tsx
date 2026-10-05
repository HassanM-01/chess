import { useEffect } from 'react';
import { Navigate, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { ProgressBar, SessTop, Spinner } from '@/components/ui';
import { useProfile, useUpdateProfile } from '@/state/queries';
import { WalkthroughView } from './WalkthroughView';
import { useGameReview } from './useGameReview';

export function WalkthroughPage(): JSX.Element {
  const { id } = useParams();
  const nav = useNavigate();
  const [sp] = useSearchParams();
  const { game, analysis, mistakes, progress, failed, needsAnalysis, analyzeNow, autoStarted } = useGameReview(id);
  const { data: profile } = useProfile();
  const update = useUpdateProfile();
  const g = game.data;

  // Analyze first if this game has not been analyzed yet.
  useEffect(() => {
    if (needsAnalysis && autoStarted.current !== id) {
      autoStarted.current = id ?? null;
      void analyzeNow();
    }
  }, [needsAnalysis, id, analyzeNow, autoStarted]);

  const back = (): void => void nav(`/games/${id}`, { replace: true });

  if (game.isLoading || analysis.isLoading) return <Spinner label="Loading the game…" />;
  if (!g) return <Navigate to="/games" replace />;
  if (!g.userColor) return <Navigate to={`/games/${g.id}`} replace state={{ pickSide: true }} />;
  if (!analysis.data) {
    return (
      <div className="stack">
        <SessTop title="Walkthrough" onBack={back} />
        <div className="card stack-s">
          <p>{failed ? 'The engine could not analyze this game.' : 'Analyzing this game first…'}</p>
          {failed ? (
            <button className="btn primary" onClick={() => void analyzeNow()}>
              Try again
            </button>
          ) : (
            <ProgressBar value={progress ?? 0} />
          )}
        </div>
      </div>
    );
  }
  return (
    <WalkthroughView
      game={g}
      analysis={analysis.data}
      mistakes={mistakes}
      startPly={Number(sp.get('ply') ?? 0) || 0}
      onBack={back}
      quiz={!!profile?.settings.wtQuiz}
      onQuizChange={(v) => update.mutate({ settings: { wtQuiz: v } })}
    />
  );
}
