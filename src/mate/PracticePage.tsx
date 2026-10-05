// Checkmate technique trainer. You play White against the engine's best defence. The page always tells you the plan for the
// position you are in, draws the king's cage (every square he can still reach), and grades each move by what it did to the cage.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Navigate, useNavigate, useParams } from 'react-router-dom';
import { Chess, uciMove } from '@/chess/compat';
import { moveInfo } from '@/chess/helpers';
import { pieceName } from '@/chess/tactics';
import type { Uci } from '@/chess/types';
import { Board, arrowOf, arrowsOf, type MarkKind } from '@/components/Board';
import { Pill, SessTop } from '@/components/ui';
import { engine, evalPos } from '@/state/engine';
import { useProgressUpdater } from '@/state/queries';
import { toast } from '@/state/toast';
import { analyzeMate } from './anatomy';
import { boxSquares, gradeMove, randomStart, stageOf, techniqueByKind, type Grade, type TechniqueInfo } from './technique';

type Phase = 'you' | 'thinking' | 'won' | 'stuck' | 'draw';

export function PracticePage(): JSX.Element {
  const { kind } = useParams();
  const info = techniqueByKind(kind ?? '');
  if (!info) return <Navigate to="/learn/mate" replace />;
  return <Practice key={info.kind} info={info} />;
}

const TONE: Record<Grade['verdict'], '' | 'good' | 'bad' | 'warn'> = { mate: 'good', tighten: 'good', progress: 'good', hold: '', loosen: 'warn', 'lost-win': 'bad', stalemate: 'bad' };

function Practice({ info }: { info: TechniqueInfo }): JSX.Element {
  const nav = useNavigate();
  const updateProgress = useProgressUpdater();
  const [fen, setFen] = useState(() => randomStart(info.kind));
  const [undoStack, setUndoStack] = useState<string[]>([]);
  const [phase, setPhase] = useState<Phase>('you');
  const [grade, setGrade] = useState<Grade | null>(null);
  const [mateIn, setMateIn] = useState<number | null>(null);
  const [best, setBest] = useState<Uci | null>(null);
  const [hint, setHint] = useState(0);
  const [showBox, setShowBox] = useState(true);
  const [count, setCount] = useState(0);
  const [lastMove, setLastMove] = useState<Uci | null>(null);
  const seq = useRef(0); // stale-async guard for the hint analysis
  const replySeq = useRef(0); // stale-async guard: a bot reply that arrives after Undo / New must be thrown away

  const stage = useMemo(() => stageOf(info.kind, fen, mateIn), [info.kind, fen, mateIn]);
  const box = useMemo(() => boxSquares(fen), [fen]);
  const anatomy = useMemo(() => (phase === 'won' ? analyzeMate(fen) : null), [phase, fen]);

  // The engine looks at the position you are about to play (for hints and for "mate in one is on the board").
  useEffect(() => {
    if (phase !== 'you') return;
    const my = ++seq.current;
    setMateIn(null);
    setBest(null);
    void evalPos(fen, 12)
      .then((r) => {
        if (seq.current !== my) return;
        setBest(r.best);
        setMateIn(r.mateWhite != null && r.mateWhite > 0 ? r.mateWhite : null);
      })
      .catch(() => undefined);
    return () => {
      seq.current++;
    };
  }, [fen, phase]);

  useEffect(() => {
    void engine.boot().catch(() => undefined);
  }, []);

  const finish = useCallback(
    (won: boolean): void => {
      if (!won) return;
      void updateProgress((p) => {
        const prev = ((p.play as { mate?: Record<string, number> }).mate ?? {}) as Record<string, number>;
        return { play: { ...p.play, mate: { ...prev, [info.kind]: (prev[info.kind] ?? 0) + 1 } } };
      });
    },
    [info.kind, updateProgress],
  );

  const onMove = useCallback(
    async (u: Uci): Promise<void> => {
      if (phase !== 'you') return;
      const c = new Chess(fen);
      if (!uciMove(c, u)) return;
      const after = c.fen();
      const g = gradeMove(fen, after);
      setGrade(g);
      setUndoStack((s) => [...s, fen]);
      setCount((n) => n + 1);
      setLastMove(u);
      setFen(after);
      setHint(0);
      if (g.verdict === 'mate') {
        setPhase('won');
        finish(true);
        return;
      }
      if (g.verdict === 'stalemate' || g.verdict === 'lost-win') {
        setPhase('stuck');
        return;
      }
      setPhase('thinking');
      const my = ++replySeq.current;
      await new Promise((r) => setTimeout(r, 450));
      let reply: Uci | null = null;
      try {
        reply = (await engine.run(after, { depth: 8, skill: 20, priority: 'interactive' })).best;
      } catch {
        /* engine unavailable */
      }
      if (replySeq.current !== my) return;
      if (!reply) {
        toast('The engine could not reply. Try New position.');
        setPhase('you');
        return;
      }
      const c2 = new Chess(after);
      uciMove(c2, reply);
      setLastMove(reply);
      setFen(c2.fen());
      setPhase(c2.isGameOver() ? 'draw' : 'you');
    },
    [phase, fen, finish],
  );

  const undo = (): void => {
    if (!undoStack.length) {
      toast('Nothing to undo yet.');
      return;
    }
    seq.current++;
    replySeq.current++;
    const prev = undoStack[undoStack.length - 1];
    setUndoStack(undoStack.slice(0, -1));
    setFen(prev);
    setPhase('you');
    setGrade(null);
    setLastMove(null);
    setHint(0);
    setCount((n) => Math.max(0, n - 1));
  };

  const fresh = (): void => {
    seq.current++;
    replySeq.current++;
    setFen(randomStart(info.kind));
    setUndoStack([]);
    setPhase('you');
    setGrade(null);
    setLastMove(null);
    setHint(0);
    setCount(0);
  };

  // ---- what to draw
  const bestInfo = best ? moveInfo(fen, best) : null;
  const bestGrade = useMemo(() => {
    if (!best) return null;
    const c = new Chess(fen);
    return uciMove(c, best) ? gradeMove(fen, c.fen()) : null;
  }, [best, fen]);

  const marks: Record<string, MarkKind> = {};
  if (anatomy) Object.assign(marks, anatomy.marks);
  else if (showBox && phase !== 'draw') for (const s of box) marks[s] = 'sel';
  if (hint >= 1 && bestInfo && phase === 'you') marks[bestInfo.from] = 'good';
  const arrows = anatomy ? anatomy.arrows : hint >= 2 && best && phase === 'you' ? arrowsOf(arrowOf(best, 'info')) : [];

  const hintText = ((): string | null => {
    if (hint <= 0 || phase !== 'you') return null;
    if (!bestInfo) return 'The engine is still looking. Try again in a second.';
    if (hint === 1) return mateIn === 1 ? `There is a checkmate on the board. Move your ${pieceName(bestInfo.piece)} (highlighted).` : `Try moving your ${pieceName(bestInfo.piece)} (highlighted). ${stage.title}.`;
    if (!bestGrade || bestGrade.verdict === 'mate') return `${bestInfo.san} (the arrow). That is checkmate.`;
    const why =
      bestGrade.verdict === 'tighten'
        ? `It takes the cage from ${bestGrade.boxBefore} squares down to ${bestGrade.boxAfter}.`
        : bestGrade.verdict === 'progress'
          ? 'It brings your king closer while keeping the cage as small as it is.'
          : 'It keeps the cage the same and improves your setup, which you need before the final check.';
    return `${bestInfo.san} (the arrow). ${why}`;
  })();

  const status =
    phase === 'thinking' ? 'Black is moving…' : phase === 'won' ? 'Checkmate!' : phase === 'stuck' ? 'Undo that move' : phase === 'draw' ? 'Draw' : 'Your move';

  return (
    <div className="stack" data-testid="practice">
      <SessTop title={info.title} sub="Checkmate school" to="/learn/mate" />
      <div className="spread">
        <div className="row">
          <Pill>{`Moves: ${count}`}</Pill>
          <Pill tone="acc" title="Squares the king can still reach">{`Cage: ${box.length}`}</Pill>
        </div>
        <span className="small muted" data-testid="status">
          {status}
        </span>
      </div>

      <Board
        fen={fen}
        orientation="w"
        interactive={phase === 'you'}
        movableColor="w"
        lastMove={lastMove}
        arrows={arrows}
        marks={marks}
        onMove={(u) => void onMove(u)}
        onBadTap={(sq) => toast(new Chess(fen).get(sq as never)?.color === 'b' ? "That's the enemy king. Tap one of your white pieces." : 'Tap one of your pieces first, then where it should go.')}
        onIdleTap={() => toast(phase === 'thinking' ? 'Black is moving…' : phase === 'stuck' ? 'Tap Undo to take that move back.' : phase === 'won' ? 'Checkmate! Pick another position.' : 'This game is over. Tap New position.')}
      />

      <label className="toggle" style={{ padding: 0 }}>
        <span className="small">Show the cage (yellow = squares the king can reach)</span>
        <button className="switch" role="switch" aria-checked={showBox} aria-label="Show the cage" onClick={() => setShowBox(!showBox)} />
      </label>

      {grade && phase !== 'won' && (
        <div className={`feedback ${TONE[grade.verdict]}`} data-testid="grade" data-verdict={grade.verdict} aria-live="polite">
          <p className="small">{grade.text}</p>
        </div>
      )}

      {phase === 'won' && anatomy ? (
        <div className="feedback good stack-s" data-testid="won">
          <h3>{`Checkmate in ${count} move${count === 1 ? '' : 's'}!`}</h3>
          <p className="small" data-testid="mate-why">
            {anatomy.summary}
          </p>
          <p className="small muted">Red squares are where the king cannot go. Yellow ones are blocked by its own pieces.</p>
        </div>
      ) : phase === 'draw' ? (
        <div className="feedback bad stack-s" data-testid="draw">
          <h3>Draw</h3>
          <p className="small">The king took your last piece, so there is no mate left. Tap New position. Next time, keep every piece next to your king or a knight's move away from his.</p>
        </div>
      ) : (
        <div className="card stack-s" data-testid="plan">
          <div className="eyebrow">Your plan</div>
          <h3>{stage.title}</h3>
          <p className="small">{stage.plan}</p>
          {hintText && (
            <p className="small hint-clue" style={{ paddingLeft: 10 }} data-testid="hint">
              {hintText}
            </p>
          )}
        </div>
      )}

      <div className="row actions" data-testid="practice-actions">
        {phase === 'won' || phase === 'draw' ? (
          <>
            <button className="btn primary" style={{ flex: 1 }} onClick={fresh} data-testid="new-position">
              Another position
            </button>
            <button className="btn" onClick={() => nav('/learn/mate')}>
              Checkmate school
            </button>
          </>
        ) : (
          <>
            <button className="btn" onClick={() => setHint(Math.min(2, hint + 1))} disabled={phase !== 'you'} data-testid="hint-btn">
              {hint === 0 ? 'Hint' : hint === 1 ? 'Show move' : 'Hint'}
            </button>
            <button className={`btn${phase === 'stuck' ? ' primary' : ''}`} style={phase === 'stuck' ? { flex: 1 } : undefined} onClick={undo} data-testid="undo-btn">
              Undo
            </button>
            <button className="btn ghost" onClick={fresh} data-testid="new-position">
              New position
            </button>
          </>
        )}
      </div>
    </div>
  );
}
