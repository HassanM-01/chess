// Public, read-only walkthrough for a single shared game (spec phase 7). Works signed out thanks to the is_public RLS policy.
import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Spinner } from '@/components/ui';
import { fetchPublicGame } from '@/db/supabaseRepo';
import { getSupabase, isSupabaseConfigured } from '@/lib/supabase';
import { WalkthroughView } from '@/features/review/WalkthroughView';

export function SharePage(): JSX.Element {
  const { gameId } = useParams();
  const [quiz, setQuiz] = useState(false);
  const q = useQuery({
    queryKey: ['public-game', gameId],
    queryFn: () => fetchPublicGame(getSupabase(), gameId as string),
    enabled: !!gameId && isSupabaseConfigured,
    retry: 0,
  });

  if (!isSupabaseConfigured) {
    return (
      <div className="app stack" style={{ paddingTop: 40 }}>
        <h1>Shared walkthroughs need an account</h1>
        <p className="muted">This build of Blunder Check runs in local mode, so there is nothing to share.</p>
        <Link className="btn" to="/">
          Back
        </Link>
      </div>
    );
  }
  if (q.isLoading) return <Spinner label="Loading the shared game…" />;
  if (q.isError || !q.data) {
    return (
      <div className="app stack" style={{ paddingTop: 40 }}>
        <h1>This walkthrough isn't available</h1>
        <p className="muted">The link may be wrong, or the owner turned sharing off.</p>
        <Link className="btn primary" to="/">
          Go to Blunder Check
        </Link>
      </div>
    );
  }
  const { game, analysis } = q.data;
  return (
    <div className="app" data-testid="share-page">
      <div className="banner" style={{ marginTop: 12 }}>
        <span>Shared walkthrough · read only</span>
        <Link to="/" className="small">
          Try Blunder Check
        </Link>
      </div>
      <WalkthroughView
        game={game}
        analysis={analysis}
        mistakes={[]}
        onBack={() => {
          window.location.assign('/');
        }}
        quiz={quiz}
        onQuizChange={setQuiz}
        footer={
          <p className="small muted">
            Analysed with Blunder Check. <Link to="/login">Link your own chess.com account</Link> to find your own habits.
          </p>
        }
      />
    </div>
  );
}
