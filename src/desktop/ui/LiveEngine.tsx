// Live, unlimited-depth analysis of the position on the board (top lines, updated as the engine goes deeper).
import { useEffect, useRef, useState } from 'react';
import { pvSan } from '@/chess/helpers';
import type { EngineLine } from '@/engine/types';
import { getEngine, useEngineStatus } from '../lib/desktopEngine';
import { useReviews } from '../state/reviews';
import { useSettings } from '../state/settings';
import { formatEval } from './classInfo';

export interface LiveSnapshot {
  lines: EngineLine[];
  depth: number;
}

export function LiveEngine({
  fen,
  enabled,
  lines: nLines = 3,
  onSnapshot,
}: {
  fen: string;
  enabled: boolean;
  lines?: number;
  onSnapshot?: (s: LiveSnapshot) => void;
}): JSX.Element {
  const [snap, setSnap] = useState<LiveSnapshot | null>(null);
  const [err, setErr] = useState('');
  const busy = useReviews((s) => !!s.job);
  const { status, name } = useEngineStatus();
  const multipv = useSettings((s) => s.multipv);
  const cb = useRef(onSnapshot);
  cb.current = onSnapshot;

  useEffect(() => {
    setSnap(null);
    setErr('');
    if (!enabled || busy) return;
    const ac = new AbortController();
    let last = 0;
    getEngine()
      .run(fen, {
        depth: 99,
        movetimeMs: 30 * 60_000,
        timeoutMs: 31 * 60_000,
        multipv: Math.max(nLines, Math.min(5, multipv)),
        priority: 'interactive',
        interruptible: true,
        signal: ac.signal,
        onInfo: (lines, depth) => {
          const t = performance.now();
          if (t - last < 150) return;
          last = t;
          const s = { lines, depth };
          setSnap(s);
          cb.current?.(s);
        },
      })
      .then((r) => {
        const s = { lines: r.lines, depth: r.depth ?? 0 };
        setSnap(s);
        cb.current?.(s);
      })
      .catch((e: unknown) => {
        if (!ac.signal.aborted) setErr(e instanceof Error ? e.message : String(e));
      });
    return () => ac.abort();
  }, [fen, enabled, busy, nLines, multipv]);

  if (!enabled) return <div className="live muted small">Live analysis is off.</div>;
  if (busy) return <div className="live muted small">A game review is using the engine. Live analysis resumes when it finishes.</div>;
  return (
    <div className="live" data-testid="live-engine">
      <div className="live-head small muted">
        <span>{name || 'Stockfish'}</span>
        <span>{status === 'loading' ? 'starting…' : snap ? `depth ${snap.depth}` : '…'}</span>
      </div>
      {err && <div className="err small">{err}</div>}
      {snap?.lines.slice(0, nLines).map((l, i) => (
        <div className="live-line" key={i}>
          <b className={`live-eval ${l.cpWhite < 0 ? 'neg' : 'pos'}`}>{formatEval(l.cpWhite, l.mateWhite)}</b>
          <span className="live-pv">{pvSan(fen, l.pv, 9).join(' ')}</span>
        </div>
      ))}
    </div>
  );
}
