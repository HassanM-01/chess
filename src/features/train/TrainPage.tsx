import { useMemo } from 'react';
import { Hero, Pill } from '@/components/ui';
import { THEMES, THEME_KEYS } from '@/content/themes';
import { trainerCounts } from '@/skill/sessionBuilder';
import { useFactoryState, useSyncController } from '@/state/sync';
import { THEMES as THEME_INFO } from '@/content/themes';
import type { GeneratedPayload } from '@/db/types';
import { useAttempts, useGames, usePuzzleCounts, useTrainingItems } from '@/state/queries';
import { useStartSession } from './useStartSession';

export function TrainPage(): JSX.Element {
  const { data: games = [] } = useGames();
  const { data: training = [] } = useTrainingItems();
  const { data: attempts = [] } = useAttempts();
  const { data: counts = {} } = usePuzzleCounts();
  const { startPuzzles, startingPuzzles, startTrainer, startFix } = useStartSession();
  const controller = useSyncController();
  const factory = useFactoryState();

  const personal = useMemo(() => {
    const byTheme = new Map<string, number>();
    let ready = 0;
    let variants = 0;
    for (const t of training) {
      if (t.payload.pool === 'gen') {
        if (t.attempts === 0) {
          ready++;
          const th = (t.payload as GeneratedPayload).theme;
          byTheme.set(th, (byTheme.get(th) ?? 0) + 1);
        }
      } else if (t.kind === 'variant') variants++;
    }
    return { ready, variants, byTheme };
  }, [training]);

  const analyzed = games.filter((g) => g.analysisStatus === 'done' && g.userColor).length;
  const tc = useMemo(() => trainerCounts(training), [training]);

  /** accuracy per mode / theme from the attempt log (first try, no hint) */
  const acc = useMemo(() => {
    const by = new Map<string, { n: number; ok: number }>();
    for (const a of attempts) {
      const key = a.theme ?? '';
      if (!key) continue;
      const e = by.get(key) ?? { n: 0, ok: 0 };
      e.n++;
      if (a.correct && !a.usedHint) e.ok++;
      by.set(key, e);
    }
    return (k: string): { pct: number; n: number } | null => {
      const e = by.get(k);
      return e && e.n ? { pct: Math.round((100 * e.ok) / e.n), n: e.n } : null;
    };
  }, [attempts]);

  const mode = (key: 'threat' | 'judge' | 'punish', name: string, desc: string, n: number, accKey: string): JSX.Element => {
    const a = acc(accKey);
    return (
      <button className="theme-btn" disabled={!n} onClick={() => startTrainer(key)} data-testid={`mode-${key}`}>
        <b>{name}</b>
        <span className="small muted">{desc}</span>
        <span className="small">{a ? `${a.pct}% right · ${n} positions` : `${n} positions`}</span>
      </button>
    );
  };

  return (
    <div className="stack">
      <Hero eyebrow="Train" title="Practice the positions you get wrong." />

      <div className="card stack">
        <div className="spread">
          <h2>Your game trainer</h2>
          <Pill tone="acc">{analyzed} games</Pill>
        </div>
        <p className="muted small">
          {analyzed ? 'Every position here comes from a game you played. It trains the exact habits your games show you need.' : 'Pull and analyze your games and every drill here gets built from positions you actually played.'}
        </p>
        <button className="btn primary" disabled={!analyzed} onClick={() => startTrainer('mix', { dailyKey: 'trainer' })} data-testid="start-trainer">
          Start today's session (15 positions)
        </button>
        <div className="theme-grid">
          {mode('threat', 'Spot the threat', 'They just moved. What of yours is in danger?', tc.threat, 'g_threat')}
          {mode('judge', 'Safe or blunder?', 'Judge your own move before you play it.', tc.judge, 'g_judge')}
          {mode('punish', 'Punish mistakes', 'Your opponent blundered. Take what they gave you.', tc.punish, 'g_punish')}
          <button className="theme-btn" disabled={!tc.fix} onClick={startFix} data-testid="mode-fix">
            <b>Fix your mistakes</b>
            <span className="small muted">Find the move you should have played.</span>
            <span className="small">{`${tc.fixDue} due · ${tc.fix} total`}</span>
          </button>
        </div>
      </div>

      <div className="card stack" data-testid="factory">
        <div className="spread">
          <h2>Built for you</h2>
          <Pill tone="acc">{`${personal.ready} ready`}</Pill>
        </div>
        <p className="muted small">
          These puzzles are made from your own games and aimed at your weak spots, not taken from a list.
          {personal.variants > 0 ? ` Plus ${personal.variants} mirrored copies of your own mistakes, so you learn the pattern and not the board.` : ''}
        </p>
        {personal.byTheme.size > 0 && (
          <div className="row">
            {[...personal.byTheme.entries()].map(([k, n]) => (
              <Pill key={k}>{`${THEME_INFO[k as keyof typeof THEME_INFO]?.name ?? k} · ${n}`}</Pill>
            ))}
          </div>
        )}
        {factory.phase === 'running' ? (
          <div className="stack-s">
            <div className="small" data-testid="factory-label">{factory.label || 'Working…'}</div>
            <p className="small muted">The engine is working on your device. You can keep using the app.</p>
            <button className="btn" onClick={() => controller.factory.cancel()}>
              Stop
            </button>
          </div>
        ) : (
          <>
            {factory.phase === 'error' && factory.error && <p className="err" role="alert">{factory.error}</p>}
            {factory.phase === 'done' && factory.label && <p className="small">{factory.label}</p>}
            <button className="btn" disabled={!analyzed} onClick={() => void controller.factory.build({ maxMs: 240_000 })} data-testid="build-puzzles">
              {analyzed ? 'Build more puzzles for me' : 'Pull and analyze games first'}
            </button>
          </>
        )}
      </div>

      <div className="card stack-s">
        <h2>Daily mix</h2>
        <p className="muted small">Ten puzzles weighted toward your weakest themes. The theme is hidden, like in a real game.</p>
        <button className="btn primary" disabled={startingPuzzles} onClick={() => void startPuzzles({ theme: 'mix', n: 10 })} data-testid="start-mix">
          {startingPuzzles ? 'Loading puzzles…' : 'Start 10 puzzles'}
        </button>
      </div>

      <div className="stack-s">
        <h3>Pick a theme</h3>
        <div className="theme-grid">
          {THEME_KEYS.map((k) => {
            const cnt = counts[k] ?? 0;
            const a = acc(k);
            if (!cnt) return null;
            return (
              <button key={k} className="theme-btn" disabled={startingPuzzles} onClick={() => void startPuzzles({ theme: k, n: 8 })} data-testid={`theme-${k}`}>
                <b>{THEMES[k].name}</b>
                <span className="small muted">{a ? `${a.pct}% of ${a.n} solved` : `${cnt} puzzles`}</span>
                <div className="meter good">
                  <i style={{ width: `${a?.pct ?? 0}%` }} />
                </div>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
