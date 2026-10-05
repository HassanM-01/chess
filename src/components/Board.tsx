// Chess board (ported from the prototype's BoardView): tap-to-move, drag-to-move, promotion picker,
// arrows, square marks, last-move + check highlights, flip, coordinates.
import { useCallback, useEffect, useId, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { tryChess } from '@/chess/compat';
import { pieceName } from '@/chess/tactics';
import { colorName, FILES, type Color, type PieceType, type Square, type Uci } from '@/chess/types';

export type ArrowColor = 'good' | 'bad' | 'warn' | 'info';
export interface Arrow {
  from: Square;
  to: Square;
  color: ArrowColor;
}
export type MarkKind = 'bad' | 'good' | 'sel';

export const arrowOf = (u: Uci | null | undefined, color: ArrowColor): Arrow | null => (u ? { from: u.slice(0, 2), to: u.slice(2, 4), color } : null);
export const arrowsOf = (...a: (Arrow | null | undefined)[]): Arrow[] => a.filter((x): x is Arrow => !!x);

export interface BoardProps {
  fen: string;
  orientation?: Color;
  /** pieces can be picked up and moved */
  interactive?: boolean;
  /** restrict movable pieces to one colour (default: side to move) */
  movableColor?: Color | null;
  lastMove?: Uci | null;
  arrows?: Arrow[];
  marks?: Record<Square, MarkKind>;
  /** a legal move was made (UCI, with promotion piece when needed) */
  onMove?: (uci: Uci) => void;
  /** when set, every tap is reported here and no moves are made ("spot the threat") */
  onTap?: (sq: Square) => void;
  /** tapped something that cannot be picked up (opponent's piece / empty square) */
  onBadTap?: (sq: Square) => void;
  /** tapped while the board is not interactive */
  onIdleTap?: (sq: Square) => void;
  ariaLabel?: string;
}

const ARROW_COLORS: Record<ArrowColor, string> = { good: '#2E9E57', bad: '#D2462C', warn: '#E09A1B', info: '#2F6FB5' };

interface DragState {
  from: Square;
  piece: string; // 'wk'
  x: number;
  y: number;
}

export function Board({
  fen,
  orientation = 'w',
  interactive = false,
  movableColor = null,
  lastMove = null,
  arrows = [],
  marks = {},
  onMove,
  onTap,
  onBadTap,
  onIdleTap,
  ariaLabel = 'Chess board',
}: BoardProps): JSX.Element {
  const uid = useId().replace(/:/g, '');
  const chess = useMemo(() => tryChess(fen), [fen]);
  const [sel, setSel] = useState<Square | null>(null);
  const [promo, setPromo] = useState<{ from: Square; to: Square } | null>(null);
  const [drag, setDrag] = useState<DragState | null>(null);
  const gridRef = useRef<HTMLDivElement>(null);
  const pending = useRef<{ from: Square; x: number; y: number; id: number } | null>(null);

  // Any new position clears selection and pending promotion.
  useEffect(() => {
    setSel(null);
    setPromo(null);
    setDrag(null);
    pending.current = null;
  }, [fen]);

  const turn: Color = chess?.turn() ?? 'w';
  const legal = useCallback(
    (from: Square) => (chess ? chess.moves({ square: from as never, verbose: true }) : []),
    [chess],
  );
  const canPick = useCallback(
    (sq: Square): boolean => {
      if (!interactive || !chess) return false;
      const p = chess.get(sq as never);
      return !!p && p.color === turn && (!movableColor || movableColor === p.color);
    },
    [interactive, chess, turn, movableColor],
  );

  const squareAtPoint = useCallback(
    (clientX: number, clientY: number): Square | null => {
      const el = gridRef.current;
      if (!el) return null;
      const r = el.getBoundingClientRect();
      const x = Math.floor(((clientX - r.left) / r.width) * 8);
      const y = Math.floor(((clientY - r.top) / r.height) * 8);
      if (x < 0 || x > 7 || y < 0 || y > 7) return null;
      const file = orientation === 'w' ? x : 7 - x;
      const rank = orientation === 'w' ? 7 - y : y;
      return FILES[file] + (rank + 1);
    },
    [orientation],
  );

  const tryMoveTo = useCallback(
    (from: Square, to: Square): void => {
      const ms = legal(from).filter((m) => m.to === to);
      if (!ms.length) return;
      setSel(null);
      if (ms.some((m) => m.promotion)) {
        setPromo({ from, to });
        return;
      }
      onMove?.(from + to);
    },
    [legal, onMove],
  );

  const onPointerDown = (e: ReactPointerEvent<HTMLDivElement>): void => {
    const sq = squareAtPoint(e.clientX, e.clientY);
    if (!sq) return;
    if (promo) return;
    if (onTap) {
      onTap(sq);
      return;
    }
    if (!interactive) {
      onIdleTap?.(sq);
      return;
    }
    if (sel && sel !== sq && legal(sel).some((m) => m.to === sq)) {
      tryMoveTo(sel, sq);
      return;
    }
    if (canPick(sq)) {
      setSel(sel === sq ? null : sq);
      pending.current = { from: sq, x: e.clientX, y: e.clientY, id: e.pointerId };
      try {
        e.currentTarget.setPointerCapture(e.pointerId);
      } catch {
        /* not all environments support capture */
      }
    } else if (sel) {
      setSel(null);
    } else {
      onBadTap?.(sq);
    }
  };

  const onPointerMove = (e: ReactPointerEvent<HTMLDivElement>): void => {
    const p = pending.current;
    if (!p || e.pointerId !== p.id) return;
    if (!drag) {
      if (Math.hypot(e.clientX - p.x, e.clientY - p.y) < 8) return;
      const piece = chess?.get(p.from as never);
      if (!piece) return;
      setSel(p.from);
      setDrag({ from: p.from, piece: piece.color + piece.type, x: e.clientX, y: e.clientY });
      return;
    }
    setDrag({ ...drag, x: e.clientX, y: e.clientY });
  };

  const endPointer = (e: ReactPointerEvent<HTMLDivElement>): void => {
    const p = pending.current;
    pending.current = null;
    if (!p) return;
    try {
      e.currentTarget.releasePointerCapture(e.pointerId);
    } catch {
      /* ignore */
    }
    if (drag) {
      const to = squareAtPoint(e.clientX, e.clientY);
      setDrag(null);
      if (to && to !== drag.from && legal(drag.from).some((m) => m.to === to)) tryMoveTo(drag.from, to);
    }
  };

  // King square when in check
  const checkSq = useMemo<Square | null>(() => {
    if (!chess || !chess.inCheck()) return null;
    const b = chess.board();
    for (let r = 0; r < 8; r++) {
      for (let f = 0; f < 8; f++) {
        const p = b[r][f];
        if (p && p.type === 'k' && p.color === chess.turn()) return FILES[f] + (8 - r);
      }
    }
    return null;
  }, [chess]);

  const targets = useMemo(() => (sel ? legal(sel) : []), [sel, legal]);
  const lm = lastMove ? [lastMove.slice(0, 2), lastMove.slice(2, 4)] : [];

  const xy = (sq: Square): [number, number] => {
    let x = FILES.indexOf(sq[0]);
    let y = 8 - +sq[1];
    if (orientation === 'b') {
      x = 7 - x;
      y = 7 - y;
    }
    return [x * 100 + 50, y * 100 + 50];
  };

  const cells: JSX.Element[] = [];
  for (let r = 0; r < 8; r++) {
    for (let f = 0; f < 8; f++) {
      const file = orientation === 'w' ? f : 7 - f;
      const rank = orientation === 'w' ? 7 - r : r;
      const sq = FILES[file] + (rank + 1);
      const light = (file + rank) % 2 === 1;
      const cls = ['sq', light ? 'l' : 'd'];
      if (lm.includes(sq)) cls.push('last');
      if (sel === sq) cls.push('sel');
      if (checkSq === sq) cls.push('check');
      if (marks[sq]) cls.push(marks[sq]);
      const p = chess?.get(sq as never);
      const hidden = drag?.from === sq;
      const isTarget = targets.some((m) => m.to === sq);
      cells.push(
        <div
          key={sq}
          className={cls.join(' ')}
          data-sq={sq}
          role="gridcell"
          aria-label={sq + (p ? ` ${colorName(p.color)} ${pieceName(p.type as PieceType)}` : '')}
        >
          {r === 7 && <span className="co f">{FILES[file]}</span>}
          {f === 0 && <span className="co r">{rank + 1}</span>}
          {p && (
            <svg viewBox="0 0 40 40" className="pc" aria-hidden="true" style={hidden ? { opacity: 0.3 } : undefined}>
              <use href={`#pc-${p.color}${p.type}`} />
            </svg>
          )}
          {isTarget && <span className={p ? 'ring' : 'dot'} />}
        </div>,
      );
    }
  }

  const promoColor = chess?.turn() ?? 'w';
  const wrapRect = gridRef.current?.getBoundingClientRect();
  const ghostSize = wrapRect ? wrapRect.width / 8 : 44;

  return (
    <div className="board-wrap" data-testid="board" data-fen={fen}>
      <div
        ref={gridRef}
        className="board"
        role="grid"
        aria-label={ariaLabel}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endPointer}
        onPointerCancel={endPointer}
      >
        {cells}
      </div>
      <svg className="arrows" viewBox="0 0 800 800" aria-hidden="true">
        <defs>
          {(Object.keys(ARROW_COLORS) as ArrowColor[]).map((k) => (
            <marker key={k} id={`ah-${uid}-${k}`} viewBox="0 0 10 10" refX="5" refY="5" markerWidth="3.2" markerHeight="3.2" orient="auto-start-reverse">
              <path d="M0,0 L10,5 L0,10 z" fill={ARROW_COLORS[k]} />
            </marker>
          ))}
        </defs>
        {arrows.map((a, i) => {
          const [x1, y1] = xy(a.from);
          const [x2, y2] = xy(a.to);
          const dx = x2 - x1;
          const dy = y2 - y1;
          const len = Math.hypot(dx, dy) || 1;
          return (
            <line
              key={`${a.from}${a.to}${i}`}
              x1={x1}
              y1={y1}
              x2={x2 - (dx / len) * 32}
              y2={y2 - (dy / len) * 32}
              stroke={ARROW_COLORS[a.color] ?? ARROW_COLORS.info}
              strokeWidth={18}
              strokeLinecap="round"
              opacity={0.82}
              markerEnd={`url(#ah-${uid}-${a.color})`}
              data-arrow={`${a.from}${a.to}:${a.color}`}
            />
          );
        })}
      </svg>
      {drag && (
        <svg
          viewBox="0 0 40 40"
          className="pc ghost"
          style={{ position: 'fixed', left: drag.x - ghostSize / 2, top: drag.y - ghostSize / 2, width: ghostSize, height: ghostSize, pointerEvents: 'none', zIndex: 30 }}
          aria-hidden="true"
        >
          <use href={`#pc-${drag.piece}`} />
        </svg>
      )}
      {promo && (
        <div className="promo" role="dialog" aria-label="Choose a promotion piece">
          <div className="opts">
            {(['q', 'r', 'b', 'n'] as const).map((p) => (
              <button
                key={p}
                aria-label={pieceName(p)}
                onClick={() => {
                  const m = promo;
                  setPromo(null);
                  onMove?.(m.from + m.to + p);
                }}
              >
                <svg viewBox="0 0 40 40" className="pc" aria-hidden="true">
                  <use href={`#pc-${promoColor}${p}`} />
                </svg>
              </button>
            ))}
            <button aria-label="Cancel" onClick={() => setPromo(null)} style={{ fontSize: 20 }}>
              ✕
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
