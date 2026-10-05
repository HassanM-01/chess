import { useState } from 'react';
import type { Color, Uci } from '@/chess/types';
import { MateStepper } from './MateStepper';

/** After a mate puzzle: a button that replays the solution and explains why the final position is checkmate. */
export function MateWhy({ fen, moves, side }: { fen: string; moves: Uci[]; side: Color }): JSX.Element {
  const [open, setOpen] = useState(false);
  if (!open) {
    return (
      <button className="btn block" onClick={() => setOpen(true)} data-testid="mate-why-open">
        See how the mate works
      </button>
    );
  }
  return (
    <div className="card stack-s" data-testid="mate-why-card">
      <div className="spread">
        <h3>How the mate works</h3>
        <button className="btn ghost" onClick={() => setOpen(false)}>
          Close
        </button>
      </div>
      <MateStepper startFen={fen} moves={moves} orientation={side} intro="Here is the position. Tap Show me to watch the mate happen." />
    </div>
  );
}
