// "Ask Coach why" (spec 10): plain-English explanation streamed from /api/explain. Hidden unless the build enables it.
import { useState } from 'react';
import type { MistakeDraft } from '@/analysis/types';
import { pvSan } from '@/chess/helpers';
import { getSupabase } from '@/lib/supabase';
import { coachEnabled } from '@/coach/client';
import { evalPos } from '@/state/engine';

type Mistake = Pick<MistakeDraft, 'fen' | 'playedSan' | 'bestSan' | 'replySan' | 'category' | 'explanation' | 'winDrop' | 'ply'> & { replyFen?: string };

export function AskCoach({ mistake, color }: { mistake: Mistake; color: 'w' | 'b' }): JSX.Element | null {
  const [text, setText] = useState('');
  const [state, setState] = useState<'idle' | 'loading' | 'error'>('idle');
  if (!coachEnabled) return null;

  const ask = async (): Promise<void> => {
    setState('loading');
    setText('');
    try {
      let line: string[] = [];
      if (mistake.replyFen) {
        try {
          const r = await evalPos(mistake.replyFen, 12);
          line = pvSan(mistake.replyFen, r.pv, 5);
        } catch {
          /* the engine line is optional */
        }
      }
      const { data } = await getSupabase().auth.getSession();
      const res = await fetch('/api/explain', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${data.session?.access_token ?? ''}` },
        body: JSON.stringify({
          fen: mistake.fen,
          color,
          played: mistake.playedSan,
          best: mistake.bestSan,
          reply: mistake.replySan,
          line: line.join(' '),
          category: mistake.category,
          summary: mistake.explanation,
          drop: mistake.winDrop,
        }),
      });
      if (res.status === 429) {
        setText("You've used today's coach questions. Try again tomorrow.");
        setState('idle');
        return;
      }
      if (!res.ok || !res.body) throw new Error(`coach ${res.status}`);
      const reader = res.body.getReader();
      const dec = new TextDecoder();
      let acc = '';
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        acc += dec.decode(value, { stream: true });
        setText(acc);
      }
      setState('idle');
    } catch (e) {
      console.warn(e);
      setText("The coach isn't available right now. The explanation above comes from the engine.");
      setState('error');
    }
  };

  return (
    <div className="stack-s">
      <button className="btn ghost" onClick={() => void ask()} disabled={state === 'loading'}>
        {state === 'loading' ? 'Thinking…' : 'Ask Coach why'}
      </button>
      {text && <div className="small coach-out">{text}</div>}
    </div>
  );
}
