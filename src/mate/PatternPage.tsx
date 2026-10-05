// One mating pattern: watch it happen step by step, or play it yourself and have the reason for each move explained.
import { useEffect, useMemo, useState } from 'react';
import { Navigate, useNavigate, useParams } from 'react-router-dom';
import { Chess } from '@/chess/compat';
import { Board, arrowOf, arrowsOf } from '@/components/Board';
import { Segmented, SessTop } from '@/components/ui';
import type { Uci } from '@/chess/types';
import { toast } from '@/state/toast';
import { analyzeMate } from './anatomy';
import { MateStepper } from './MateStepper';
import { PATTERNS, patternById, patternLine, type MatePattern } from './patterns';

export function PatternPage(): JSX.Element {
  const { id } = useParams();
  const p = id ? patternById(id) : undefined;
  if (!p) return <Navigate to="/learn/mate" replace />;
  return <Pattern key={p.id} p={p} />;
}

function Pattern({ p }: { p: MatePattern }): JSX.Element {
  const nav = useNavigate();
  const [mode, setMode] = useState<'watch' | 'play'>('watch');
  const line = useMemo(() => patternLine(p), [p]);
  const idx = PATTERNS.findIndex((x) => x.id === p.id);
  const next = PATTERNS[idx + 1];

  return (
    <div className="stack" data-testid="pattern">
      <SessTop title={p.title} sub="Checkmate school" to="/learn/mate" />
      <div className="card stack-s">
        <p>{p.blurb}</p>
        <p className="small">
          <b>Look for: </b>
          {p.lookFor}
        </p>
      </div>
      <Segmented
        label="Mode"
        value={mode}
        options={[
          { value: 'watch', label: 'Watch it' },
          { value: 'play', label: 'Play it yourself' },
        ]}
        onChange={setMode}
      />
      {mode === 'watch' ? <MateStepper key="watch" startFen={p.startFen} moves={line.uci} captions={line.whys} orientation={p.side} intro={`${p.side === 'w' ? 'White' : 'Black'} to move. ${p.moves.length === 1 ? 'There is a checkmate on the board.' : 'Watch the plan.'}`} /> : <PlayIt key="play" p={p} line={line} onWatch={() => setMode('watch')} />}
      <div className="row">
        {next && (
          <button className="btn" onClick={() => nav(`/learn/mate/pattern/${next.id}`)}>
            Next pattern: {next.title}
          </button>
        )}
        <button className="btn ghost" onClick={() => nav('/learn/mate')}>
          All patterns
        </button>
      </div>
    </div>
  );
}

function PlayIt({ p, line, onWatch }: { p: MatePattern; line: ReturnType<typeof patternLine>; onWatch: () => void }): JSX.Element {
  const [i, setI] = useState(0);
  const [wrong, setWrong] = useState(0);
  const [say, setSay] = useState<{ tone: '' | 'good' | 'bad'; text: string } | null>(null);
  const [shown, setShown] = useState(false);

  const fen = useMemo(() => {
    const c = new Chess(p.startFen);
    for (let n = 0; n < i; n++) c.move(line.sans[n]);
    return c.fen();
  }, [p, line, i]);
  const done = i >= line.uci.length;
  const myTurn = !done && new Chess(fen).turn() === p.side;
  const expected = line.uci[i];
  const anatomy = useMemo(() => (done ? analyzeMate(fen) : null), [done, fen]);
  const lastMove: Uci | null = i > 0 ? line.uci[i - 1] : null;

  // the opponent's reply plays itself
  useEffect(() => {
    if (done || myTurn) return;
    const t = setTimeout(() => {
      setSay({ tone: '', text: line.whys[i] });
      setI(i + 1);
    }, 800);
    return () => clearTimeout(t);
  }, [done, myTurn, i, line]);

  const onMove = (u: Uci): void => {
    if (u === expected || (u.length === 4 && expected.startsWith(u))) {
      setWrong(0);
      setShown(false);
      setSay({ tone: 'good', text: line.whys[i] });
      setI(i + 1);
      return;
    }
    const w = wrong + 1;
    setWrong(w);
    const c = new Chess(fen);
    const m = c.move({ from: u.slice(0, 2), to: u.slice(2, 4), promotion: u[4] || 'q' });
    setSay({
      tone: 'bad',
      text: `${m ? `${m.san} is not the move here. ` : ''}${p.moves.length === 1 ? `Hint: ${p.lookFor}` : 'Think about which squares the king can still use, and take them away.'}`,
    });
  };

  const arrows = done && anatomy ? anatomy.arrows : (shown || wrong >= 2) && myTurn ? arrowsOf(arrowOf(expected, 'good')) : [];

  return (
    <div className="stack" data-testid="pattern-play">
      <Board
        fen={fen}
        orientation={p.side}
        interactive={myTurn}
        movableColor={p.side}
        lastMove={lastMove}
        arrows={arrows}
        marks={done && anatomy ? anatomy.marks : {}}
        onMove={onMove}
        onBadTap={() => toast('Tap one of your pieces, then where it should go.')}
        onIdleTap={() => toast(done ? 'Done. Tap Watch it, or pick the next pattern.' : 'The opponent is replying…')}
      />
      <div className={`feedback ${done ? 'good' : (say?.tone ?? '')} stack-s`} aria-live="polite">
        {done && anatomy ? (
          <>
            <h3>Checkmate!</h3>
            <p className="small" data-testid="mate-why">
              {anatomy.summary}
            </p>
            <p className="small muted">Red squares are where the king cannot go. Yellow ones are blocked by its own pieces.</p>
          </>
        ) : say ? (
          <p className="small">{say.text}</p>
        ) : (
          <p className="small">{myTurn ? (p.moves.length === 1 ? 'Find the checkmate.' : 'Your move. Follow the plan.') : 'Get ready…'}</p>
        )}
      </div>
      <div className="row actions">
        {done ? (
          <>
            <button className="btn" onClick={() => { setI(0); setSay(null); setWrong(0); }}>
              Play it again
            </button>
            <button className="btn primary" style={{ flex: 1 }} onClick={onWatch}>
              Watch it
            </button>
          </>
        ) : (
          myTurn && (
            <button className="btn ghost" onClick={() => setShown(true)} data-testid="pattern-show">
              Show me the move
            </button>
          )
        )}
      </div>
    </div>
  );
}
