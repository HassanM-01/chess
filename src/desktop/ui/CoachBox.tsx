import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { askCoach, useCoachKey, type CoachTurn } from '../lib/coach';

/**
 * "Ask the coach": an AI explanation of the position in the facts, in beginner words, with follow-up questions.
 * `facts` is the JSON from review/coachFacts.ts; `resetKey` clears the chat when the position changes.
 */
export function CoachBox({ facts, resetKey }: { facts: string | null; resetKey: string }): JSX.Element | null {
  const hasKey = useCoachKey();
  const [turns, setTurns] = useState<CoachTurn[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [text, setText] = useState('');
  const run = useRef(0);

  useEffect(() => {
    run.current++;
    setTurns([]);
    setBusy(false);
    setError('');
    setText('');
  }, [resetKey]);

  if (!facts || hasKey === null) return null;
  if (!hasKey) {
    return (
      <div className="dk-card small muted" data-testid="coach-off">
        Want an AI coach to explain this like you are brand new? <Link to="/settings">Turn it on in Settings</Link> (it needs your own Anthropic key).
      </div>
    );
  }

  const send = async (history: CoachTurn[]): Promise<void> => {
    const id = ++run.current;
    setBusy(true);
    setError('');
    try {
      const answer = await askCoach(facts, history);
      if (id !== run.current) return;
      setTurns([...history, { role: 'assistant', content: answer }]);
    } catch (e) {
      if (id === run.current) setError(e instanceof Error ? e.message : String(e));
    } finally {
      if (id === run.current) setBusy(false);
    }
  };

  return (
    <div className="dk-card coach-box" data-testid="coach-box">
      <b>Ask the coach</b>
      {!turns.length && !busy && (
        <>
          <p className="small muted">The coach explains this position in simple words, using only what Stockfish has confirmed.</p>
          <button className="btn primary" onClick={() => void send([])} data-testid="coach-ask">Explain it to me like I am new</button>
        </>
      )}
      {turns.map((t, i) => (
        <p key={i} className={`coach-turn small ${t.role}`}>{t.role === 'user' ? `You: ${t.content}` : t.content}</p>
      ))}
      {busy && <p className="small muted">The coach is thinking…</p>}
      {error && <p className="err small">{error}</p>}
      {turns.length > 0 && !busy && (
        <form
          className="row"
          onSubmit={(e) => {
            e.preventDefault();
            const q = text.trim();
            if (!q) return;
            setText('');
            void send([...turns, { role: 'user', content: q }]);
          }}
        >
          <input className="grow" value={text} onChange={(e) => setText(e.target.value)} placeholder="Ask a follow-up, like “why not the knight?”" maxLength={400} data-testid="coach-input" />
          <button className="btn" type="submit" disabled={!text.trim()}>Ask</button>
        </form>
      )}
    </div>
  );
}
