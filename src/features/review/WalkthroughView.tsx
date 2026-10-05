// Move-by-move walkthrough (ported from prototype openWalkthrough). Used by /games/:id/walk and the public /share/:gameId page.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Chess, uciMove } from '@/chess/compat';
import { moveNumberLabel, pvSan, sanOf } from '@/chess/helpers';
import type { MistakeDraft } from '@/analysis/types';
import { isBigMoment, standing, walkSteps, whyBest, type WalkStep } from '@/analysis/walk';
import { Board, arrowOf, arrowsOf } from '@/components/Board';
import { Pill, SessTop, Switch } from '@/components/ui';
import type { GameAnalysisRow, GameRow } from '@/db/types';
import { fromStored } from '@/engine/types';
import { wpFor } from '@/engine/winprob';
import { opponentName } from '@/analysis/queue';
import { engine, evalPos } from '@/state/engine';
import { toast } from '@/state/toast';

const OUTCOME = { w: 'Win', l: 'Loss', d: 'Draw' } as const;

export interface WalkthroughViewProps {
  game: GameRow;
  analysis: GameAnalysisRow;
  mistakes: Pick<MistakeDraft, 'ply' | 'explanation'>[];
  startPly?: number;
  onBack: () => void;
  /** persisted quiz toggle (the share page keeps it in local state) */
  quiz: boolean;
  onQuizChange: (v: boolean) => void;
  /** where the user's perspective comes from (public games use the owner's colour) */
  footer?: JSX.Element;
}

export function WalkthroughView({ game, analysis, mistakes, startPly = 0, onBack, quiz, onQuizChange, footer }: WalkthroughViewProps): JSX.Element {
  const me = game.userColor ?? 'w';
  const evals = useMemo(() => analysis.evals.map(fromStored), [analysis]);
  const { steps } = useMemo(() => walkSteps({ ...game, userColor: me }, evals, mistakes), [game, me, evals, mistakes]);
  const [k, setK] = useState(() => Math.max(0, Math.min(steps.length - 1, startPly)));
  const [quizDone, setQuizDone] = useState<Set<number>>(() => new Set());
  const [quizResult, setQuizResult] = useState<{ ply: number; ok: boolean; san: string } | null>(null);
  const [line, setLine] = useState<{ ply: number; text: string } | null>(null);
  const timelineRef = useRef<HTMLDivElement>(null);
  const reqSeq = useRef(0);

  const s: WalkStep = steps[k];
  const label = moveNumberLabel(game.startFen, s.ply);
  const opp = opponentName({ userColor: me, white: game.white, black: game.black });
  const bad = !!s.mine && (s.v?.k === 'mistake' || s.v?.k === 'blunder');
  const isQuiz = bad && quiz && !quizDone.has(s.ply);

  const counts = useMemo(() => {
    const c = { best: 0, good: 0, inacc: 0, mistake: 0, blunder: 0 };
    for (const x of steps) if (x.mine && x.v) c[x.v.k]++;
    return c;
  }, [steps]);

  // Best-line text for a mistake, computed lazily with a stale-result guard.
  useEffect(() => {
    setLine(null);
    if (!s.mine || !s.best || s.uci === s.best || !bad || isQuiz) return;
    const my = ++reqSeq.current;
    void evalPos(s.fen, 12)
      .then((r) => {
        if (reqSeq.current !== my || r.pv[0] !== s.best) return;
        setLine({ ply: s.ply, text: pvSan(s.fen, r.pv, 6).join(' ') });
      })
      .catch(() => undefined);
  }, [s.ply, s.fen, s.best, s.uci, s.mine, bad, isQuiz]);

  useEffect(() => {
    void engine.boot().catch(() => undefined);
  }, []);

  // keep the current timeline square in view
  useEffect(() => {
    timelineRef.current?.querySelector('.tl.cur')?.scrollIntoView?.({ block: 'nearest', inline: 'center' });
  }, [k]);

  const show = useCallback((j: number): void => setK(Math.max(0, Math.min(steps.length - 1, j))), [steps.length]);
  const jump = (): void => {
    const n = steps.findIndex((x, j) => j > k && isBigMoment(x));
    if (n >= 0) show(n);
    else toast('No more big moments after this one.');
  };

  const tryQuiz = async (u: string): Promise<void> => {
    const my = ++reqSeq.current;
    let ok = u === s.best;
    const san = sanOf(s.fen, u);
    if (!ok) {
      const c = new Chess(s.fen);
      uciMove(c, u);
      try {
        const r = await evalPos(c.fen(), 11);
        if (reqSeq.current !== my) return;
        ok = s.wpBefore - wpFor(r, me) < 5; // accepts any move within 5 win%
      } catch {
        /* engine unavailable: only the exact best move counts */
      }
    }
    setQuizDone((d) => new Set(d).add(s.ply));
    setQuizResult({ ply: s.ply, ok, san });
  };

  // ---- board props
  let arrows = arrowsOf();
  if (!s.mine) arrows = arrowsOf(arrowOf(s.uci, 'info'));
  else if (!isQuiz) {
    if (s.uci === s.best) arrows = arrowsOf(arrowOf(s.uci, 'good'));
    else arrows = arrowsOf(arrowOf(s.uci, bad ? 'bad' : 'info'), arrowOf(s.best, 'good'));
  }
  const lastMove = s.ply ? game.movesUci[s.ply - 1] : null;
  const o = game.outcome;
  const quizFb = quizResult && quizResult.ply === s.ply ? quizResult : null;

  return (
    <div className="stack" data-testid="walkthrough">
      <SessTop title={`Walkthrough vs ${opp}`} sub={[game.playedAt ? new Date(game.playedAt).toLocaleDateString() : '', o ? OUTCOME[o] : ''].filter(Boolean).join(' · ')} onBack={onBack} />
      <div className="row">
        <Pill tone="good">{`${counts.best + counts.good} good`}</Pill>
        <Pill>{`${counts.inacc} inaccurate`}</Pill>
        <Pill tone="warn">{`${counts.mistake} mistakes`}</Pill>
        <Pill tone="bad">{`${counts.blunder} blunders`}</Pill>
      </div>
      <div className="timeline" role="group" aria-label="Your moves" ref={timelineRef} data-testid="timeline">
        {steps.map((x, j) =>
          x.mine && x.v ? (
            <button
              key={x.ply}
              className={`tl ${x.v.k}${j === k ? ' cur' : ''}`}
              data-ply={x.ply}
              data-verdict={x.v.k}
              title={`${moveNumberLabel(game.startFen, x.ply)} ${x.san}`}
              aria-label={`${moveNumberLabel(game.startFen, x.ply)} ${x.san}: ${x.v.label}`}
              onClick={() => show(j)}
            />
          ) : null,
        )}
      </div>
      <p className="small muted">Each square is one of your moves. Red arrow: your move. Green: the better move.</p>

      <div className="headline" data-testid="headline">
        {!s.mine ? (
          <>
            <span className="muted">{`${label} ${opp} plays `}</span>
            <b>{s.san}</b>
            {s.punish && !s.punish.found && <Pill tone="warn">Chance for you</Pill>}
          </>
        ) : (
          <>
            <span className="muted">{`${label} You played `}</span>
            <b>{s.san}</b>
            <Pill tone={s.v?.cls ?? ''}>{s.v?.label}</Pill>
            {s.v && s.v.k !== 'best' && s.v.k !== 'good' && (
              <span className="better">
                Better: <b>{s.bestSan}</b>
              </span>
            )}
          </>
        )}
      </div>

      <Board
        fen={s.fen}
        orientation={me}
        interactive={isQuiz}
        movableColor={me}
        lastMove={lastMove}
        arrows={isQuiz ? [] : arrows}
        onMove={(u) => void tryQuiz(u)}
        onIdleTap={() => toast('Tap Next to see the next move.')}
        onBadTap={() => toast("Tap one of your pieces, then where it should go. Or tap Show me.")}
      />
      <div className={`evalbar${me === 'b' ? ' flip' : ''}`} title="Who is winning">
        <i style={{ width: `${s.wpBefore}%` }} />
      </div>

      <div data-testid="walk-card">
        {!s.mine ? (
          <div className={`feedback${s.punish ? ' warn' : ''} stack-s`}>
            <div className="eyebrow">{`${label} ${opp}'s move`}</div>
            <h3>{`They play ${s.san}`}</h3>
            {s.punish ? (
              <p className="small">{`That was a mistake by them. ${s.punish.found ? `You punished it with ${s.punish.played}. Nice.` : `Your best answer was ${s.punish.bestSan}, but you played ${s.punish.played}.`}`}</p>
            ) : (
              <p className="small muted">{standing(s.wpAfter)}</p>
            )}
          </div>
        ) : isQuiz ? (
          <div className="feedback warn stack-s">
            <div className="eyebrow">{`${label} Your move · ${standing(s.wpBefore)}`}</div>
            <h3>{`In the game you played ${s.san}, a ${s.v?.label.toLowerCase()}. Find something better.`}</h3>
            <p className="small muted">Make a move on the board.</p>
            <div className="row">
              <button className="btn" onClick={() => setQuizDone((d) => new Set(d).add(s.ply))}>
                Show me
              </button>
            </div>
          </div>
        ) : (
          <div className={`feedback ${bad ? (s.v?.k === 'blunder' ? 'bad' : 'warn') : s.v?.cls === 'good' ? 'good' : ''} stack-s`}>
            {quizFb && <Pill tone={quizFb.ok ? 'good' : 'bad'}>{quizFb.ok ? `Your answer ${quizFb.san} works!` : `${quizFb.san} isn't it. Here's the better move.`}</Pill>}
            <div className="spread">
              <div className="eyebrow">{`${label} Your move`}</div>
              <Pill tone={s.v?.cls ?? ''}>{s.v?.label}</Pill>
            </div>
            <h3>{`You played ${s.san}`}</h3>
            {s.v?.k === 'best' && <p className="small">{`That's exactly what the engine would play. ${whyBest(s.fen, s.uci)}`}</p>}
            {s.v?.k === 'good' && <p className="small">{`Fine move. The engine slightly preferred ${s.bestSan}.`}</p>}
            {s.v && s.v.k !== 'best' && s.v.k !== 'good' && (
              <>
                {s.problem && <p className="small">{s.problem}</p>}
                <p className="small">
                  <b>{`Better: ${s.bestSan}. `}</b>
                  {whyBest(s.fen, s.best)}
                </p>
                {line && line.ply === s.ply ? <p className="small muted">{`How it continues: ${line.text}`}</p> : null}
              </>
            )}
            <p className="small muted">{standing(s.wpBefore) + (s.drop != null && s.drop >= 10 ? ` After your move: ${standing(s.wpAfter).toLowerCase()}` : '')}</p>
          </div>
        )}
      </div>

      <div className="toggle">
        <div>
          <b>Quiz me on my mistakes</b>
          <div className="small muted">At each mistake, try to find the better move before seeing it</div>
        </div>
        <Switch label="Quiz me on my mistakes" checked={quiz} onChange={onQuizChange} />
      </div>
      {footer}

      <div className="actions walk" data-testid="walk-actions">
        <button className="btn" aria-label="Previous move" onClick={() => show(k - 1)} disabled={k === 0}>
          ‹
        </button>
        <button className="btn primary" onClick={() => show(k + 1)} disabled={k === steps.length - 1} data-testid="walk-next">
          Next ›
        </button>
        <button className="btn" onClick={jump} data-testid="walk-jump">
          Mistakes »
        </button>
      </div>
    </div>
  );
}
