import type { Color } from '@/chess/types';
import type { MoveClass, MoveReview } from '@/review/types';
import { CLASS_META } from './classInfo';

/** Vertical bar: White's share of the board, flipped when Black is at the bottom. */
export function EvalBar({ ep, label, orientation }: { ep: number; label: string; orientation: Color }): JSX.Element {
  const whitePct = Math.max(2, Math.min(98, ep * 100));
  const bottomIsWhite = orientation === 'w';
  // The number sits inside the side that is ahead, in a colour that reads against it.
  const whiteWins = ep >= 0.5;
  const atBottom = whiteWins === bottomIsWhite;
  return (
    <div className="evalbar-v" title="Evaluation" data-testid="evalbar">
      <div className="ev-black" style={{ height: `${bottomIsWhite ? 100 - whitePct : whitePct}%`, background: bottomIsWhite ? '#403d39' : '#f1f1ec' }} />
      <div className="ev-white" style={{ height: `${bottomIsWhite ? whitePct : 100 - whitePct}%`, background: bottomIsWhite ? '#f1f1ec' : '#403d39' }} />
      <span className={`ev-num ${atBottom ? 'bottom' : 'top'}`} style={{ color: whiteWins ? '#403d39' : '#f1f1ec' }}>
        {label}
      </span>
    </div>
  );
}

const KEY: MoveClass[] = ['brilliant', 'great', 'miss', 'mistake', 'blunder'];

/** White's winning chances over the whole game. Click to jump to a move. */
export function EvalGraph({ graph, moves, current, onSelect }: { graph: number[]; moves: MoveReview[]; current: number; onSelect: (ply: number) => void }): JSX.Element {
  const W = 400;
  const H = 84;
  const n = Math.max(1, graph.length - 1);
  const x = (i: number): number => (i / n) * W;
  const y = (ep: number): number => H - ep * H;
  const line = graph.map((g, i) => `${i === 0 ? 'M' : 'L'}${x(i).toFixed(1)},${y(g).toFixed(1)}`).join(' ');
  const area = graph.length ? `${line} L${x(graph.length - 1).toFixed(1)},${H} L0,${H} Z` : '';
  return (
    <svg
      className="eval-graph"
      viewBox={`0 0 ${W} ${H}`}
      preserveAspectRatio="none"
      role="img"
      aria-label="Evaluation graph"
      onClick={(e) => {
        const r = e.currentTarget.getBoundingClientRect();
        onSelect(Math.round(((e.clientX - r.left) / r.width) * n));
      }}
    >
      <rect x="0" y="0" width={W} height={H} fill="#403d39" />
      {area && <path d={area} fill="#f1f1ec" />}
      <line x1="0" x2={W} y1={H / 2} y2={H / 2} stroke="#8884" strokeWidth="1" />
      {moves
        .filter((m) => KEY.includes(m.cls))
        .map((m) => (
          <circle key={m.ply} cx={x(m.ply + 1)} cy={y(graph[m.ply + 1] ?? 0.5)} r="2.6" fill={CLASS_META[m.cls].color} vectorEffect="non-scaling-stroke" />
        ))}
      {current >= 0 && <line x1={x(current)} x2={x(current)} y1="0" y2={H} stroke="#e8b923" strokeWidth="2" vectorEffect="non-scaling-stroke" />}
    </svg>
  );
}
