// A free analysis board: move the pieces, set up a position, and watch the engine think without a depth limit.
import { useMemo, useState } from 'react';
import { Chess, uciMove } from '@/chess/compat';
import { START_FEN } from '@/chess/types';
import { Board, arrowOf, arrowsOf } from '@/components/Board';
import { EvalBar } from '../ui/charts';
import { formatEval } from '../ui/classInfo';
import { LiveEngine, type LiveSnapshot } from '../ui/LiveEngine';
import { epWhite } from '@/review/expected';

export function AnalysisPage(): JSX.Element {
  const [start, setStart] = useState(START_FEN);
  const [moves, setMoves] = useState<string[]>([]);
  const [flip, setFlip] = useState(false);
  const [fenText, setFenText] = useState('');
  const [err, setErr] = useState('');
  const [snap, setSnap] = useState<LiveSnapshot | null>(null);
  const [lines, setLines] = useState(3);

  const { fen, sans } = useMemo(() => {
    const c = new Chess(start);
    const s: string[] = [];
    for (const u of moves) {
      const m = uciMove(c, u);
      if (m) s.push(m.san);
    }
    return { fen: c.fen(), sans: s };
  }, [start, moves]);

  const top = snap?.lines[0];
  const ep = top ? epWhite({ cp: top.cpWhite, mate: top.mateWhite }) : 0.5;
  const best = top?.pv[0];

  const loadFen = (): void => {
    try {
      const c = new Chess(fenText.trim());
      setStart(c.fen());
      setMoves([]);
      setErr('');
    } catch {
      setErr('That is not a valid FEN.');
    }
  };

  return (
    <div className="dk-review" data-testid="analysis-page">
      <section className="dk-boardcol">
        <div className="board-row">
          <EvalBar ep={ep} label={top ? formatEval(top.cpWhite, top.mateWhite) : '0.00'} orientation={flip ? 'b' : 'w'} />
          <div className="board-holder">
            <Board
              fen={fen}
              orientation={flip ? 'b' : 'w'}
              interactive
              lastMove={moves.length ? moves[moves.length - 1] : null}
              arrows={best ? arrowsOf(arrowOf(best, 'good')) : []}
              onMove={(u) => setMoves([...moves, u])}
            />
          </div>
        </div>
        <div className="dk-controls">
          <button className="btn" onClick={() => setMoves(moves.slice(0, -1))} disabled={!moves.length}>Undo</button>
          <button className="btn" onClick={() => { setStart(START_FEN); setMoves([]); }}>Reset</button>
          <button className="btn" onClick={() => setFlip(!flip)}>Flip</button>
        </div>
      </section>
      <aside className="dk-side">
        <h2>Analysis board</h2>
        <div className="dk-card">
          <LiveEngine fen={fen} enabled lines={lines} onSnapshot={setSnap} />
          <label className="row small" style={{ marginTop: 8 }}>
            Lines
            <select value={lines} onChange={(e) => setLines(+e.target.value)} style={{ width: 70 }}>
              {[1, 2, 3, 4, 5].map((n) => <option key={n} value={n}>{n}</option>)}
            </select>
          </label>
        </div>
        <div className="dk-card small">
          <b>Moves</b>
          <div className="dk-movelist plain">{sans.length ? sans.map((s, i) => <span key={i}>{i % 2 === 0 ? `${Math.floor(i / 2) + 1}. ` : ''}{s} </span>) : <span className="muted">Play a move on the board.</span>}</div>
        </div>
        <div className="dk-card stack-s">
          <label className="lbl" htmlFor="fen">Set up a position (FEN)</label>
          <input id="fen" type="text" value={fenText} onChange={(e) => setFenText(e.target.value)} placeholder={START_FEN} />
          <div className="row"><button className="btn" onClick={loadFen} disabled={!fenText.trim()}>Load</button></div>
          {err && <div className="err small">{err}</div>}
        </div>
      </aside>
    </div>
  );
}
