// Chess.com-style move classification from raw engine output.
//
// Everything is measured in "expected points" (win chance + half the draw chance) from the mover's side:
//   Best 0 · Excellent <= 0.02 · Good <= 0.05 · Inaccuracy <= 0.10 · Mistake <= 0.20 · Blunder > 0.20
// plus the special labels:
//   Brilliant  a sound (best or near-best) move that gives up real material, when the mover was not already winning
//   Great      the engine's top move when the next-best move is clearly worse (an "only move"), not a plain recapture
//   Miss       letting a clearly winning chance slip right after the opponent erred
//   Book       the position is on a named opening line
//   Forced     the only legal move
import { Chess, uciMove } from '@/chess/compat';
import { sanOf } from '@/chess/helpers';
import type { Color, Uci } from '@/chess/types';
import { bookName } from './book';
import { epFor, epWhite } from './expected';
import { materialBalance, playLine } from './material';
import { emptyCounts, type MoveClass, type MoveReview, type PosAnalysis, type ReviewSummary, type SideSummary } from './types';

export const THRESHOLDS = { best: 0.003, excellent: 0.02, good: 0.05, inaccuracy: 0.1, mistake: 0.2 } as const;
const GREAT_GAP = 0.1;
const BRILLIANT_MAX_BEFORE = 0.92;
const BRILLIANT_MIN_AFTER = 0.45;
const SACRIFICE_PLIES = 8;
const BOOK_MAX_PLY = 40;
const PIECE_VALUE: Record<string, number> = { p: 1, n: 3, b: 3, r: 5, q: 9, k: 0 };

export function classFromLoss(loss: number): MoveClass {
  if (loss <= THRESHOLDS.best) return 'best';
  if (loss <= THRESHOLDS.excellent) return 'excellent';
  if (loss <= THRESHOLDS.good) return 'good';
  if (loss <= THRESHOLDS.inaccuracy) return 'inaccuracy';
  if (loss <= THRESHOLDS.mistake) return 'mistake';
  return 'blunder';
}

/** Lichess' per-move accuracy curve over win percentages (0..100). */
export const moveAccuracy = (winBefore: number, winAfter: number): number =>
  winAfter >= winBefore ? 100 : Math.max(0, Math.min(100, 103.1668 * Math.exp(-0.04354 * (winBefore - winAfter)) - 3.1669));

/**
 * Did `color` give up real material in the engine's expected continuation after the move?
 * `fenBefore` is the position before the move, `fenAfter` after it, `pv` the opponent's best line from `fenAfter`.
 */
export function isSacrifice(fenBefore: string, fenAfter: string, pv: Uci[], color: Color): boolean {
  if (pv.length < 2) return false;
  const fens = playLine(fenAfter, pv.slice(0, SACRIFICE_PLIES));
  if (fens.length < 2) return false;
  const before = materialBalance(fenBefore, color);
  const quiet = fens.length - (fens.length % 2); // stop after the mover's reply, not after an unanswered capture
  const final = materialBalance(fens[quiet - 1], color) - before;
  let worst = 0;
  for (let i = 0; i < quiet; i++) worst = Math.min(worst, materialBalance(fens[i], color) - before);
  return worst <= -3 && final <= -2;
}

export function reviewMoves(startFen: string, movesUci: Uci[], positions: PosAnalysis[]): MoveReview[] {
  const out: MoveReview[] = [];
  const chess = new Chess(startFen);
  let prevLoss = 0; // the previous move's loss (by the opponent), for "Miss"
  let prevDest = '';
  let prevCapture = false;
  for (let i = 0; i < movesUci.length; i++) {
    const A = positions[i];
    const B = positions[i + 1];
    const fenBefore = chess.fen();
    const color: Color = chess.turn();
    const mv = uciMove(chess, movesUci[i]);
    if (!mv) break;
    const fenAfter = chess.fen();
    if (!A || !B || !A.lines[0] || !B.lines[0]) break;

    const top = A.lines[0];
    const playedIsTop = top.pv[0] === movesUci[i];
    const epBest = epFor(top, color);
    const epAfter = playedIsTop ? epBest : epFor(B.lines[0], color);
    const loss = playedIsTop ? 0 : Math.max(0, epBest - epAfter);
    const second = A.lines[1] ? epFor(A.lines[1], color) : null;
    const bestUci = top.pv[0] ?? null;
    const bestSan = sanOf(fenBefore, bestUci);

    let cls: MoveClass = classFromLoss(loss);
    let note: string | undefined;
    let book: string | undefined;

    const recapture = prevCapture && mv.to === prevDest && !!mv.captured;
    // Taking a more valuable piece is the obvious move, not a great one.
    const obviousCapture = !!mv.captured && PIECE_VALUE[mv.captured] > PIECE_VALUE[mv.piece];
    if (A.legal === 1) {
      cls = 'forced';
    } else if (B.terminal === 'mate') {
      cls = 'best'; // checkmate beats everything, even a named opening trap
    } else if (i < BOOK_MAX_PLY && loss <= THRESHOLDS.inaccuracy && (book = bookName(fenAfter))) {
      cls = 'book';
    } else if (
      loss <= THRESHOLDS.excellent &&
      // Not "brilliant" if the game was already won on material and the engine merely shows a tidier way to finish.
      (epBest <= BRILLIANT_MAX_BEFORE || materialBalance(fenBefore, color) < 3) &&
      epAfter >= BRILLIANT_MIN_AFTER &&
      isSacrifice(fenBefore, fenAfter, B.lines[0].pv, color)
    ) {
      cls = 'brilliant';
      note = 'A sacrifice the engine confirms is the best way to play on';
    } else if (playedIsTop && second !== null && epBest - second >= GREAT_GAP && epBest >= 0.12 && epBest < 0.97 && !recapture && !obviousCapture) {
      cls = 'great';
      note = epBest - second >= 0.3 ? 'The only move that keeps the position under control' : 'Much better than any other move';
    } else if (prevLoss >= THRESHOLDS.inaccuracy && loss > THRESHOLDS.good && loss <= THRESHOLDS.mistake && epBest >= 0.6) {
      cls = 'miss';
      note = 'The opponent slipped, but this lets the advantage go';
    }

    const bestLineSan: string[] = [];
    if (top.pv.length) {
      const c2 = new Chess(fenBefore);
      for (const u of top.pv.slice(0, 6)) {
        const m = uciMove(c2, u);
        if (!m) break;
        bestLineSan.push(m.san);
      }
    }

    out.push({
      ply: i,
      color,
      san: mv.san,
      uci: movesUci[i],
      cls,
      epBest,
      epAfter,
      loss,
      accuracy: moveAccuracy(epBest * 100, epAfter * 100),
      bestUci,
      bestSan,
      bestLineSan,
      evalCp: B.lines[0].cp,
      evalMate: B.lines[0].mate,
      note,
      bookName: book,
    });
    prevLoss = cls === 'book' || cls === 'forced' ? 0 : loss;
    prevDest = mv.to;
    prevCapture = !!mv.captured;
  }
  return out;
}

// ---- per-game summary --------------------------------------------------------------------------------------

const clamp = (v: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, v));
const stdDev = (xs: number[]): number => {
  const m = xs.reduce((a, b) => a + b, 0) / xs.length;
  return Math.sqrt(xs.reduce((a, b) => a + (b - m) ** 2, 0) / xs.length);
};

/** Game accuracy as lichess computes it: volatility-weighted mean and harmonic mean, averaged. */
function sideAccuracy(moves: MoveReview[], weights: number[]): number {
  if (!moves.length) return 100;
  let wsum = 0;
  let asum = 0;
  let inv = 0;
  for (const m of moves) {
    const w = weights[m.ply] ?? 1;
    wsum += w;
    asum += m.accuracy * w;
    inv += 1 / Math.max(m.accuracy, 0.001);
  }
  return Math.round(((asum / wsum + moves.length / inv) / 2) * 10) / 10;
}

export function summarizeReview(moves: MoveReview[], positions: PosAnalysis[]): ReviewSummary {
  const graph = positions.map((p) => (p.lines[0] ? epWhite(p.lines[0]) : 0.5));
  const win = graph.map((g) => g * 100);
  const size = clamp(Math.floor(win.length / 10), 2, 8);
  const windows: number[][] = [];
  for (let i = 0; i < Math.min(size, win.length) - 2; i++) windows.push(win.slice(0, size));
  for (let i = 0; i + size <= win.length; i++) windows.push(win.slice(i, i + size));
  const weights = windows.map((w) => clamp(stdDev(w), 0.5, 12));

  const side = (color: Color): SideSummary => {
    const mine = moves.filter((m) => m.color === color);
    const counts = emptyCounts();
    for (const m of mine) counts[m.cls]++;
    const avg = mine.length ? (mine.reduce((a, m) => a + m.loss, 0) / mine.length) * 100 : 0;
    return { accuracy: sideAccuracy(mine, weights), counts, avgLossPct: Math.round(avg * 10) / 10 };
  };
  return { white: side('w'), black: side('b'), graph };
}
