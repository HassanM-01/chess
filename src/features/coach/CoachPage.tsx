import { useMemo } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { opponentName } from '@/analysis/queue';
import { THEMES } from '@/content/themes';
import { LESSONS } from '@/content/lessons';
import { weakInfo } from '@/content/cats';
import { pieceName } from '@/chess/tactics';
import { Hero, Pill } from '@/components/ui';
import type { ProgressRow, ThemeKey } from '@/db/types';
import { cap } from '@/lib/util';
import { describeTrend, type SkillProfile } from '@/skill/computeSkillProfile';
import { dueOwn } from '@/skill/sessionBuilder';
import { useStartSession } from '@/features/train/useStartSession';
import { dailyFor, useAttempts, useGames, useProgress, useSkillProfile, useSnapshots, useTrainingItems } from '@/state/queries';
import { useSyncController, useSyncState } from '@/state/sync';

const OUTCOME = { w: 'Win', l: 'Loss', d: 'Draw' } as const;

export function nextLesson(progress: ProgressRow | undefined) {
  return LESSONS.find((l) => !progress?.lessons[l.id]) ?? null;
}

function PlanItem({ done, title, sub, onGo, testId }: { done: boolean; title: string; sub: string; onGo: () => void; testId?: string }): JSX.Element {
  return (
    <div className="plan-item">
      <div className={`tick${done ? ' done' : ''}`} aria-label={done ? 'Done' : 'Not done yet'}>
        {done ? '✓' : ''}
      </div>
      <div>
        <b>{title}</b>
        <div className="small muted">{sub}</div>
      </div>
      <button className="btn" onClick={onGo} data-testid={testId}>
        Go
      </button>
    </div>
  );
}

function Sparkline({ values }: { values: number[] }): JSX.Element | null {
  if (values.length < 2) return null;
  const max = Math.max(...values, 0.1);
  const pts = values.map((v, i) => `${(i / (values.length - 1)) * 100},${36 - (v / max) * 32}`).join(' ');
  return (
    <svg viewBox="0 0 100 40" preserveAspectRatio="none" style={{ width: '100%', height: 48 }} role="img" aria-label="Blunders per game over time">
      <polyline points={pts} fill="none" stroke="var(--accent)" strokeWidth="2" vectorEffect="non-scaling-stroke" />
    </svg>
  );
}

export function CoachPage(): JSX.Element {
  const nav = useNavigate();
  const sync = useSyncState();
  const controller = useSyncController();
  const { data: skill } = useSkillProfile();
  const { data: games = [] } = useGames();
  const { data: progress } = useProgress();
  const { data: training = [] } = useTrainingItems();
  const { data: attempts = [] } = useAttempts();
  const { data: snaps = [] } = useSnapshots();
  const { startPuzzles, startTrainer } = useStartSession();

  const r: SkillProfile | undefined = skill;
  const analyzed = r?.gamesAnalyzed ?? 0;
  const daily = dailyFor(progress);
  const nl = nextLesson(progress);
  const dueCount = useMemo(() => dueOwn(training).length, [training]);

  const lastGame = useMemo(
    () =>
      games
        .filter((g) => (g.source === 'chesscom' || g.source === 'pgn') && g.userColor && g.analysisStatus === 'done')
        .sort((a, b) => (b.playedAt ?? b.createdAt).localeCompare(a.playedAt ?? a.createdAt))[0],
    [games],
  );

  const accs = useMemo(() => {
    const by = new Map<string, { n: number; ok: number }>();
    for (const a of attempts) {
      if (!a.puzzleId || !a.theme || !(a.theme in THEMES)) continue;
      const e = by.get(a.theme) ?? { n: 0, ok: 0 };
      e.n++;
      if (a.correct && !a.usedHint) e.ok++;
      by.set(a.theme, e);
    }
    return [...by.entries()].map(([k, v]) => ({ key: k as ThemeKey, acc: Math.round((100 * v.ok) / v.n), n: v.n }));
  }, [attempts]);

  const startedLondon = !!progress && (Object.keys(progress.openings).some((k) => k.startsWith('london')) || (progress.play.london?.games ?? 0) > 0);
  const maxWeak = Math.max(0.001, ...(r?.weaknesses.map((w) => w.score) ?? [0]));
  const blunderHistory = snaps.slice().reverse().map((s) => (s.profile as SkillProfile).blundersPerGame ?? 0);
  const trendLines = (r?.trend ?? []).map((t) => ({ t, text: describeTrend(t) })).filter((x): x is { t: SkillProfile['trend'][number]; text: string } => !!x.text);

  return (
    <div className="stack">
      <Hero eyebrow="Your coach" title={analyzed ? "Here's why you're losing, and what to train." : "Let's find out why you're losing."} />

      {sync.phase === 'analyzing' && (
        <div className="feedback" aria-live="polite">
          <b>{sync.label}</b> Your report updates as games finish.
        </div>
      )}

      {lastGame && (
        <div className="card stack-s">
          <div className="spread">
            <h3>Your last game</h3>
            {lastGame.outcome ? <Pill tone={lastGame.outcome === 'w' ? 'good' : lastGame.outcome === 'l' ? 'bad' : ''}>{OUTCOME[lastGame.outcome]}</Pill> : null}
          </div>
          <p className="small muted">
            vs {opponentName(lastGame)} · {lastGame.playedAt ? new Date(lastGame.playedAt).toLocaleDateString() : ''}
          </p>
          <Link className="btn primary" to={`/games/${lastGame.id}/walk`} data-testid="last-game-walk">
            Walk me through it, move by move
          </Link>
        </div>
      )}

      {!analyzed ? (
        <div className="card stack-s">
          <h3>Step 1: bring in your games</h3>
          <p className="muted">
            Pull your recent chess.com games. The engine checks every move you made and finds the mistakes that keep costing you games. More games means a sharper report. 10 to 20
            is a good start.
          </p>
          <button
            className="btn primary"
            onClick={() => {
              void controller.pull();
              nav('/games');
            }}
            data-testid="coach-pull"
          >
            Pull recent games
          </button>
        </div>
      ) : (
        r && (
          <>
            <div className="stats">
              <div className="stat">
                <b>{r.record.w + r.record.l + r.record.d}</b>
                <span>Games</span>
              </div>
              <div className="stat">
                <b>{`${r.record.w}-${r.record.l}-${r.record.d}`}</b>
                <span>Won-Lost-Drawn</span>
              </div>
              <div className="stat">
                <b>{r.blundersPerGame.toFixed(1)}</b>
                <span>Blunders per game</span>
              </div>
            </div>

            <div className="card stack" data-testid="weaknesses">
              <div className="spread">
                <h2>What's costing you games</h2>
                <Pill>{r.gamesAnalyzed} analyzed</Pill>
              </div>
              {!r.weaknesses.length && <p className="muted">No clear pattern yet. Pull a few more games.</p>}
              {r.weaknesses.map((w, i) => {
                const info = weakInfo(w.key);
                const isCat = w.key !== 'nocastle' && w.key !== 'earlyqueen';
                const evidence = isCat ? `${w.count} time${w.count === 1 ? '' : 's'} in ${w.games} of ${r.gamesAnalyzed} games` : `${w.games} of ${r.gamesAnalyzed} games`;
                const piece = (w.key === 'hung' || w.key === 'ignored') && w.topPiece ? ` Most often your ${pieceName(w.topPiece)}.` : '';
                return (
                  <div className="weak" key={w.key}>
                    <div className="rank">{i + 1}</div>
                    <h3>{info.label}</h3>
                    <span className="small muted" style={{ fontVariantNumeric: 'tabular-nums' }}>
                      {evidence}
                    </span>
                    <div className="meter">
                      <i style={{ width: `${Math.round((100 * w.score) / maxWeak)}%` }} />
                    </div>
                    <div className="stack-s">
                      <p className="small">{info.advice + piece}</p>
                      <div className="row">
                        {info.theme && (
                          <button className="btn" onClick={() => void startPuzzles({ theme: info.theme as ThemeKey, n: 8 })}>
                            Train this
                          </button>
                        )}
                        {info.lesson && (
                          <Link className="btn ghost" to={`/learn/lesson/${info.lesson}`}>
                            Lesson
                          </Link>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>

            <div className="card stack">
              <h3>When your mistakes happen</h3>
              <div className="bars">
                {(['opening', 'middlegame', 'endgame'] as const).map((k) => {
                  const mx = Math.max(1, r.phases.opening, r.phases.middlegame, r.phases.endgame);
                  return (
                    <div className="bar-row" key={k}>
                      <span>{cap(k)}</span>
                      <div className="track">
                        <i style={{ width: `${Math.round((100 * r.phases[k]) / mx)}%` }} />
                      </div>
                      <span className="n">{r.phases[k]}</span>
                    </div>
                  );
                })}
              </div>
              {Object.keys(r.lossesBy).length > 0 && (
                <p className="small muted">
                  How your losses ended:{' '}
                  {Object.entries(r.lossesBy)
                    .sort((a, b) => b[1] - a[1])
                    .map(([k, v]) => `${k} ${v}`)
                    .join(', ')}
                  .
                </p>
              )}
              <p className="small muted">
                You castled early in {Math.round(r.castledEarlyRate * r.gamesAnalyzed)} of {r.gamesAnalyzed} games.
                {r.openingGames ? ` After move 10 you were worse in ${r.openingBad} of ${r.openingGames}.` : ''}
              </p>
            </div>

            {(trendLines.length > 0 || blunderHistory.length > 1) && (
              <div className="card stack-s" data-testid="trend">
                <h3>Are you improving?</h3>
                {trendLines.length ? (
                  <ul className="trend-list small">
                    {trendLines.map(({ t, text }) => (
                      <li key={t.key} className={t.recent < t.previous ? 'trend-down' : t.recent > t.previous ? 'trend-up' : ''}>
                        {text}
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="small muted">Play a few more games and your two-week trend shows up here.</p>
                )}
                <Sparkline values={blunderHistory} />
                {blunderHistory.length > 1 && <p className="small muted">Blunders per game after each pull.</p>}
              </div>
            )}
          </>
        )
      )}

      <div className="card" data-testid="daily-plan">
        <div className="spread" style={{ marginBottom: 6 }}>
          <h2>Today's 15 minutes</h2>
          <span className="small muted">{new Date().toLocaleDateString(undefined, { weekday: 'long' })}</span>
        </div>
        {analyzed > 0 && (
          <PlanItem
            done={!!daily.trainer}
            title="Game trainer: 15 positions from your games"
            sub={dueCount ? `Spot threats, judge your moves, punish their blunders · ${dueCount} mistakes due` : 'Spot threats, judge your moves, punish their blunders'}
            onGo={() => startTrainer('mix', { dailyKey: 'trainer' })}
            testId="plan-trainer"
          />
        )}
        <PlanItem done={(daily.puzzles ?? 0) >= 10} title="Puzzle mix, aimed at your weak spots" sub={`${Math.min(daily.puzzles ?? 0, 10)}/10 solved today`} onGo={() => void startPuzzles({ theme: 'mix', n: 10 })} testId="plan-puzzles" />
        {nl && <PlanItem done={(daily.lesson ?? 0) > 0} title={`Lesson: ${nl.title}`} sub={`${nl.mins} min`} onGo={() => nav(`/learn/lesson/${nl.id}`)} />}
        <PlanItem
          done={!!daily.played}
          title={startedLondon ? 'Play one London System game' : 'Play one game with Blunder Check'}
          sub={startedLondon ? 'Your coach guides every move' : 'It stops you before you hang a piece'}
          onGo={() => nav(startedLondon ? '/london' : '/play')}
        />
      </div>

      {accs.length > 0 && (
        <div className="card stack">
          <h3>Puzzle accuracy</h3>
          <div className="bars">
            {accs.map(({ key, acc }) => (
              <div className="bar-row" key={key}>
                <span>{THEMES[key].name}</span>
                <div className="track">
                  <i style={{ width: `${acc}%`, background: acc >= 70 ? 'var(--good)' : acc >= 45 ? 'var(--warn)' : 'var(--bad)' }} />
                </div>
                <span className="n">{acc}%</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
