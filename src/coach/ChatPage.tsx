import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Navigate } from 'react-router-dom';
import { SessTop } from '@/components/ui';
import { coachEnabled, CoachError, streamChat } from './client';
import type { ChatMessage } from './types';
import { useFactsText } from './useCoach';

const SUGGESTIONS = ['What should I work on this week?', 'Why do I keep losing pieces?', 'What am I doing better lately?', 'Explain my biggest weakness in simple terms'];

/** Chat with the coach about your own games. Every answer is grounded in the engine-computed facts packet. */
export function ChatPage(): JSX.Element {
  const facts = useFactsText();
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const abort = useRef<AbortController | null>(null);
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => () => abort.current?.abort(), []);
  useEffect(() => {
    endRef.current?.scrollIntoView({ block: 'end' });
  }, [messages]);

  if (!coachEnabled) return <Navigate to="/" replace />;

  const send = async (text: string): Promise<void> => {
    const q = text.trim();
    if (!q || busy || !facts) return;
    setError(null);
    setInput('');
    const history: ChatMessage[] = [...messages, { role: 'user', content: q }];
    setMessages([...history, { role: 'assistant', content: '' }]);
    setBusy(true);
    const ctl = new AbortController();
    abort.current = ctl;
    try {
      const full = await streamChat(facts, history, (t) => setMessages([...history, { role: 'assistant', content: t }]), ctl.signal);
      if (!full.trim()) throw new CoachError('The coach did not reply. Try again.');
    } catch (e) {
      if (ctl.signal.aborted) return;
      setMessages(history);
      setError(e instanceof CoachError ? e.message : 'The coach is not available right now. Try again in a minute.');
    } finally {
      setBusy(false);
    }
  };

  const onSubmit = (e: FormEvent): void => {
    e.preventDefault();
    void send(input);
  };

  return (
    <div className="stack chat" data-testid="chat">
      <SessTop title="Your coach" sub="Answers come from what the engine found in your games" to="/" />
      <div className="chat-log" aria-live="polite">
        {messages.length === 0 && (
          <div className="stack-s">
            <p className="muted small">Ask anything about your chess. Try one of these:</p>
            <div className="chips">
              {SUGGESTIONS.map((s) => (
                <button key={s} className="btn" disabled={!facts || busy} onClick={() => void send(s)}>
                  {s}
                </button>
              ))}
            </div>
          </div>
        )}
        {messages.map((m, i) => (
          <div key={i} className={`bubble ${m.role}`} data-testid={`bubble-${m.role}`}>
            {m.content || <span className="muted">Thinking…</span>}
          </div>
        ))}
        {error && (
          <p className="err" role="alert">
            {error}
          </p>
        )}
        <div ref={endRef} />
      </div>
      <form className="chat-input sticky-bar" onSubmit={onSubmit}>
        <input type="text" value={input} onChange={(e) => setInput(e.target.value)} placeholder={facts ? 'Ask your coach…' : 'Loading your games…'} aria-label="Message your coach" maxLength={600} disabled={!facts} />
        <button className="btn primary" type="submit" disabled={busy || !input.trim() || !facts}>
          Send
        </button>
      </form>
    </div>
  );
}
