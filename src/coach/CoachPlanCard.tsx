import { Link } from 'react-router-dom';
import { Pill } from '@/components/ui';
import { timeAgo } from '@/lib/util';
import { useSkillProfile } from '@/state/queries';
import { coachEnabled } from './client';
import type { CoachAction } from './types';
import { isStale, useCoachReport, useRunAction } from './useCoach';

const MIN_GAMES = 3;

/** The coach's written diagnosis and plan, with a button that starts each item. */
export function CoachPlanCard(): JSX.Element | null {
  const { report, generate, busy, error, ready } = useCoachReport();
  const { data: skill } = useSkillProfile();
  const run = useRunAction();
  if (!coachEnabled) return null;
  const games = skill?.gamesAnalyzed ?? 0;

  if (!report) {
    return (
      <div className="card stack-s" data-testid="coach-plan">
        <div className="spread">
          <h3>Your coach</h3>
          <Pill tone="acc">AI</Pill>
        </div>
        {games < MIN_GAMES ? (
          <p className="muted small">Pull and analyze at least {MIN_GAMES} of your games and your coach will write you a personal plan.</p>
        ) : (
          <>
            <p className="muted small">Your coach reads what the engine found in your games and writes a plan around your actual habits.</p>
            {error && (
              <p className="err" role="alert">
                {error}
              </p>
            )}
            <button className="btn primary" disabled={busy || !ready} onClick={() => void generate()} data-testid="coach-generate">
              {busy ? 'Your coach is thinking…' : 'Get my coach’s plan'}
            </button>
          </>
        )}
        <Link className="btn ghost" to="/coach/chat">
          Chat with your coach
        </Link>
      </div>
    );
  }

  const r = report.report;
  const stale = isStale(report, games);
  return (
    <div className="card stack" data-testid="coach-plan">
      <div className="spread">
        <h3>Your coach</h3>
        <Pill tone="acc">AI</Pill>
      </div>
      <p>
        <b>{r.headline}</b>
      </p>
      <p className="small">{r.diagnosis}</p>
      {r.strengths && (
        <p className="small">
          <b>Going well: </b>
          {r.strengths}
        </p>
      )}

      {r.habits.length > 0 && (
        <div className="stack-s">
          <div className="eyebrow">Habits to break</div>
          {r.habits.map((h, i) => (
            <div className="feedback" key={i}>
              <b>{h.title}</b>
              {h.why && <p className="small">{h.why}</p>}
              <p className="small">
                <b>At the board: </b>
                {h.fix}
              </p>
            </div>
          ))}
        </div>
      )}

      <div className="stack-s">
        <div className="eyebrow">Your plan</div>
        {r.plan.map((p, i) => (
          <div className="plan-item" key={i}>
            <div className="tick" aria-hidden="true">
              {i + 1}
            </div>
            <div>
              <b>{p.title}</b>
              <div className="small muted">{`${p.day} · ${p.minutes} min`}</div>
            </div>
            <button className="btn" onClick={() => run(p.action as CoachAction)} data-testid={`plan-go-${i}`}>
              Go
            </button>
          </div>
        ))}
      </div>
      {r.encouragement && <p className="small muted">{r.encouragement}</p>}

      {error && (
        <p className="err" role="alert">
          {error}
        </p>
      )}
      <div className="row">
        <button className="btn" disabled={busy || !ready} onClick={() => void generate()}>
          {busy ? 'Updating…' : stale ? 'Update my plan (new games)' : 'Refresh my plan'}
        </button>
        <Link className="btn ghost" to="/coach/chat">
          Chat with your coach
        </Link>
      </div>
      <p className="small muted">{`Written ${timeAgo(report.generatedAt)}, from ${report.forGames} analyzed games.${stale ? ' You have new games since then.' : ''}`}</p>
    </div>
  );
}
