// Opening trainer (ported from prototype openOpening): you play your side, the trainer plays theirs and explains every move.
import { useEffect, useMemo, useRef, useState } from 'react';
import { Navigate, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { Chess, tryMove } from '@/chess/compat';
import { moveToUci } from '@/chess/helpers';
import { colorName, START_FEN, type Uci } from '@/chess/types';
import { Board, arrowOf, arrowsOf } from '@/components/Board';
import { SessTop } from '@/components/ui';
import { OPENINGS, type OpeningKey } from '@/content/openings';
import { toast } from '@/state/toast';
import { useProgress, useProgressUpdater } from '@/state/queries';

interface Say {
  tone: '' | 'good' | 'bad';
  eyebrow?: string;
  title?: string;
  text: string;
}

export function OpeningPage(): JSX.Element {
  const { set: setKey, line } = useParams();
  const [sp] = useSearchParams();
  const set = OPENINGS[setKey as OpeningKey];
  if (!set) return <Navigate to="/learn" replace />;
  const cycle = sp.get('cycle') === '1';
  return <Trainer key={`${setKey}-${line ?? 0}`} setKey={setKey as OpeningKey} startLine={Math.max(0, Math.min(set.lines.length - 1, Number(line ?? 0) || 0))} cycle={cycle} />;
}

function Trainer({ setKey, startLine, cycle }: { setKey: OpeningKey; startLine: number; cycle: boolean }): JSX.Element {
  const nav = useNavigate();
  const set = OPENINGS[setKey];
  const { data: progress } = useProgress();
  const updateProgress = useProgressUpdater();
  const [li, setLi] = useState(startLine);
  const [i, setI] = useState(0); // moves played so far in the line
  const [wrong, setWrong] = useState(0);
  const [say, setSay] = useState<Say | null>(null);
  const [showMe, setShowMe] = useState(false);
  const [lastUci, setLastUci] = useState<Uci | null>(null);
  const recorded = useRef(false);
  const line = set.lines[li];

  // Board after i moves of the line (the line is fully determined, wrong moves never change the position).
  const { fen, expected } = useMemo(() => {
    const c = new Chess(START_FEN);
    for (let n = 0; n < i; n++) tryMove(c, line.moves[n][0]);
    let exp: Uci | null = null;
    if (i < line.moves.length) {
      const t = new Chess(c.fen());
      const m = tryMove(t, line.moves[i][0]);
      exp = m ? moveToUci(m) : null;
    }
    return { fen: c.fen(), expected: exp };
  }, [i, line]);

  const done = i >= line.moves.length;
  const turn = fen.split(' ')[1];
  const myTurn = !done && turn === set.side;

  // The trainer plays the other side after a short pause.
  useEffect(() => {
    if (done || myTurn) return;
    const t = setTimeout(
      () => {
        const [san, txt] = line.moves[i];
        const c = new Chess(fen);
        const m = tryMove(c, san);
        setSay({ tone: '', eyebrow: `They play ${san}`, text: txt });
        setLastUci(m ? moveToUci(m) : null);
        setShowMe(false);
        setI(i + 1);
      },
      i === 0 ? 300 : 700,
    );
    return () => clearTimeout(t);
  }, [i, done, myTurn, line, fen]);

  // Count the completed line once.
  useEffect(() => {
    if (!done || recorded.current) return;
    recorded.current = true;
    void updateProgress((p) => ({ openings: { ...p.openings, [`${setKey}${li}`]: (p.openings[`${setKey}${li}`] ?? 0) + 1 } }));
  }, [done, setKey, li, updateProgress]);

  const restart = (nextLine = li): void => {
    recorded.current = false;
    setLi(nextLine);
    setI(0);
    setWrong(0);
    setSay(null);
    setShowMe(false);
    setLastUci(null);
  };

  const onMove = (u: Uci): void => {
    if (!expected) return;
    if (u !== expected && !(u.length === 4 && expected.startsWith(u))) {
      const w = wrong + 1;
      setWrong(w);
      const t = new Chess(fen);
      const m = tryMove(t, { from: u.slice(0, 2), to: u.slice(2, 4), promotion: u[4] || 'q' });
      setSay({ tone: 'bad', title: m ? `${m.san} isn't the move in this line` : 'Not this one', text: `Hint: ${line.moves[i][1]}` });
      return;
    }
    const [san, txt] = line.moves[i];
    setWrong(0);
    setShowMe(false);
    setSay({ tone: 'good', eyebrow: `You play ${san}`, text: txt });
    setLastUci(expected);
    setI(i + 1);
  };

  const hasNext = li + 1 < set.lines.length;
  const hintArrow = (showMe || wrong >= 2) && myTurn && expected ? arrowsOf(arrowOf(expected, 'good')) : [];
  const count = progress?.openings[`${setKey}${li}`] ?? 0;

  return (
    <div className="stack" data-testid="opening">
      <SessTop title={set.title} to="/learn" />
      <div className="stack-s">
        <h2>{line.name}</h2>
        <div className="small muted">{`You play ${colorName(set.side)}. ${line.moves.length} moves.${count ? ` Completed ${count} time${count === 1 ? '' : 's'}.` : ''}`}</div>
      </div>
      <Board fen={fen} orientation={set.side} interactive={myTurn} movableColor={set.side} lastMove={lastUci} arrows={hintArrow} onMove={onMove}
        onBadTap={() => toast(`Tap one of your ${colorName(set.side).toLowerCase()} pieces, then where it should go.`)}
        onIdleTap={() => toast(done ? 'Line complete. Tap Repeat or Next line.' : 'The trainer is playing its move…')}
      />
      {say ? (
        <div className={`feedback ${say.tone}`} aria-live="polite">
          {say.eyebrow && <div className="eyebrow">{say.eyebrow}</div>}
          {say.title && <h3>{say.title}</h3>}
          <p className={say.tone === 'bad' ? 'small' : ''}>{say.text}</p>
        </div>
      ) : myTurn && i === 0 ? (
        <div className="feedback">
          <p>Your move. Start by taking the center.</p>
        </div>
      ) : null}
      {done && (
        <div className="feedback good" style={{ marginTop: 4 }}>
          <h3>Line complete</h3>
          <p className="small">Repeat each line a few times on different days until you can play it without thinking.</p>
        </div>
      )}
      <div className="actions row" data-testid="opening-actions">
        {myTurn && (
          <button className="btn ghost" onClick={() => setShowMe(true)}>
            Show me
          </button>
        )}
        {done && (
          <>
            <button className="btn" onClick={() => restart()}>
              Repeat
            </button>
            {hasNext ? (
              <button className="btn primary" style={{ flex: 1 }} onClick={() => restart(li + 1)} data-testid="next-line">
                Next line
              </button>
            ) : (
              <button className="btn primary" style={{ flex: 1 }} onClick={() => nav('/learn')}>
                Done
              </button>
            )}
          </>
        )}
      </div>
      {cycle && !done && <p className="small muted">Practicing every line in this set, one after another.</p>}
    </div>
  );
}
