import { useEffect, useRef, useState } from 'react';
import { buildSessionDebrief, type SessionResult } from './facts';
import { coachEnabled, CoachError, streamDebrief } from './client';
import { useFactsText } from './useCoach';

/** After a session: the coach reads how it went (against your known weaknesses) and says what to focus on next. */
export function SessionDebrief({ title, score, results }: { title: string; score: number; results: SessionResult[] }): JSX.Element | null {
  const facts = useFactsText();
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const abort = useRef<AbortController | null>(null);
  useEffect(() => () => abort.current?.abort(), []);
  if (!coachEnabled || results.length === 0) return null;

  const ask = async (): Promise<void> => {
    if (!facts || busy) return;
    setBusy(true);
    setError(null);
    setText('');
    const ctl = new AbortController();
    abort.current = ctl;
    try {
      const full = await streamDebrief(facts, JSON.stringify(buildSessionDebrief(title, score, results)), setText, ctl.signal);
      if (!full.trim()) throw new CoachError('The coach did not reply. Try again.');
    } catch (e) {
      if (ctl.signal.aborted) return;
      setError(e instanceof CoachError ? e.message : 'The coach is not available right now. Try again in a minute.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="card stack-s" data-testid="debrief">
      <h3>What does this tell your coach?</h3>
      {text && <p className="small debrief">{text}</p>}
      {error && (
        <p className="err" role="alert">
          {error}
        </p>
      )}
      {!text && (
        <button className="btn" disabled={busy || !facts} onClick={() => void ask()} data-testid="debrief-ask">
          {busy ? 'Your coach is thinking…' : 'Get my coach’s take'}
        </button>
      )}
    </div>
  );
}
