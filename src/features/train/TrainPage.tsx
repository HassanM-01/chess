import { useMemo } from 'react';
import { Hero, Pill } from '@/components/ui';
import { THEMES, THEME_KEYS } from '@/content/themes';
import { trainerCounts } from '@/skill/sessionBuilder';
import { useAttempts, useGames, usePuzzleCounts, useTrainingItems } from '@/state/queries';
import { useStartSession } from './useStartSession';

export function TrainPage(): JSX.Element {
  const { data: games = [] } = useGames();
  const { data: training = [] } = useTrainingItems();
  const { data: attempts = [] } = useAttempts();
  const { data: counts = {} } = usePuzzleCounts();
  const { startPuzzles, startTrainer, startFix } = useStartSession();

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

      <div className="card stack-s">
        <h2>Daily mix</h2>
        <p className="muted small">Ten puzzles weighted toward your weakest themes. The theme is hidden, like in a real game.</p>
        <button className="btn primary" onClick={() => void startPuzzles({ theme: 'mix', n: 10 })} data-testid="start-mix">
          Start 10 puzzles
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
              <button key={k} className="theme-btn" onClick={() => void startPuzzles({ theme: k, n: 8 })} data-testid={`theme-${k}`}>
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
