// Replays a line move by move with a caption for each, and ends on the mating position with every escape square explained.
import { useMemo, useState } from 'react';
import { Chess, uciMove } from '@/chess/compat';
import { Board, arrowOf, arrowsOf, type Arrow } from '@/components/Board';
import { colorName, type Color, type Uci } from '@/chess/types';
import { analyzeMate } from './anatomy';

export interface StepperProps {
  startFen: string;
  moves: Uci[];
  /** optional caption per move (same length as moves); otherwise the move itself is described */
  captions?: string[];
  /** which side to show at the bottom (default: the side to move at the start) */
  orientation?: Color;
  intro?: string;
}

interface Frame {
  fen: string;
  last: Uci | null;
  san: string | null;
  caption: string;
}

export function MateStepper({ startFen, moves, captions, orientation, intro }: StepperProps): JSX.Element {
  const frames = useMemo<Frame[]>(() => {
    const c = new Chess(startFen);
    const out: Frame[] = [{ fen: c.fen(), last: null, san: null, caption: intro ?? `${colorName(c.turn())} to move. Find the plan.` }];
    moves.forEach((u, i) => {
      const color = c.turn();
      const m = uciMove(c, u);
      const san = m?.san ?? u;
      const auto = `${colorName(color)} plays ${san}.${c.isCheckmate() ? ' Checkmate.' : c.inCheck() ? ' That is check.' : ''}`;
      out.push({ fen: c.fen(), last: u, san, caption: captions?.[i] ?? auto });
    });
    return out;
  }, [startFen, moves, captions, intro]);

  const [i, setI] = useState(0);
  const f = frames[i];
  const atEnd = i === frames.length - 1;
  const anatomy = useMemo(() => (atEnd ? analyzeMate(f.fen) : null), [atEnd, f.fen]);
  const side = orientation ?? (new Chess(startFen).turn() as Color);

  const arrows: Arrow[] = anatomy
    ? anatomy.arrows.map((a) => ({ from: a.from, to: a.to, color: a.color }))
    : f.last
      ? arrowsOf(arrowOf(f.last, 'info'))
      : [];

  return (
    <div className="stack" data-testid="mate-stepper">
      <Board fen={f.fen} orientation={side} lastMove={f.last} arrows={arrows} marks={anatomy?.marks ?? {}} />
      <div className={`feedback ${anatomy ? 'good' : ''} stack-s`} aria-live="polite">
        <div className="eyebrow">{i === 0 ? 'Start' : `Step ${i} of ${frames.length - 1}`}</div>
        <p data-testid="mate-caption">{f.caption}</p>
        {anatomy && (
          <>
            <p className="small" data-testid="mate-why">
              {anatomy.summary}
            </p>
            <p className="small muted">Red squares are where the king cannot go. Yellow ones are blocked by its own pieces.</p>
          </>
        )}
      </div>
      <div className="row">
        <button className="btn" onClick={() => setI(Math.max(0, i - 1))} disabled={i === 0} aria-label="Previous step">
          ‹ Back
        </button>
        <button className="btn primary" style={{ flex: 1 }} onClick={() => setI(Math.min(frames.length - 1, i + 1))} disabled={atEnd} data-testid="mate-next">
          {i === 0 ? 'Show me' : 'Next ›'}
        </button>
        <button className="btn ghost" onClick={() => setI(0)} disabled={i === 0}>
          Replay
        </button>
      </div>
    </div>
  );
}
