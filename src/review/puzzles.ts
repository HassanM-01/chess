// Puzzles: built from the user's own reviewed games, from the Lichess database, and from the bundled set.
import { Chess, uciMove } from '@/chess/compat';
import type { Color, Square, Uci } from '@/chess/types';
import { epFor } from './expected';
import type { MoveClass, MoveReview, PosAnalysis } from './types';

/** how a puzzle is answered: play the move(s), tap the pieces in danger, or say whether a move was a blunder */
export type PuzzleKind = 'solve' | 'threat' | 'judge';

/** which training mode a puzzle belongs to */
export type PuzzleGroup = 'rated' | 'mistake' | 'punish' | 'mate' | 'tactic' | 'threat' | 'judge';

export interface Puzzle {
  id: string;
  /** position with the solver to move */
  fen: string;
  /** solver move, reply, solver move, ... (always ends on a solver move) */
  solution: Uci[];
  /** other first moves that are accepted */
  alts: Uci[];
  rating: number;
  themes: string[];
  source: 'game' | 'lichess' | 'bundled';
  /** the opponent move that was just played (highlighted on the board) */
  lastMove?: Uci | null;
  /** default 'solve' */
  kind?: PuzzleKind;
  /** default 'rated' */
  group?: PuzzleGroup;
  /** one line of set-up shown while solving, e.g. "You played Nxe5 here" */
  context?: string;
  /** plain-English explanation shown once the puzzle is over */
  explain?: string[];
  /** the habit to remember */
  lesson?: string;
  /** where in the games this came from, for the "open the game" link */
  from?: { gameId: string; ply: number };
  /** spot-the-threat: your pieces in danger (empty = a calm position) and who attacks them */
  threat?: { danger: Square[]; arrows: { from: Square; to: Square }[]; lastSan: string | null };
  /** safe-or-blunder: the move to judge */
  judge?: { move: Uci; san: string; verdict: 'blunder' | 'safe'; reply: Uci | null; cls: MoveClass; byUser: boolean };
  /** only for puzzles from your games */
  game?: { gameId: string; ply: number; played: string; best: string; opponent: string; loss: number; moveNo: string };
}

/** Puzzle modes built from your own games whose puzzles have a difficulty, so they move your rating like the rated trainer. */
export const RATED_GAME_GROUPS: PuzzleGroup[] = ['mate', 'tactic', 'punish'];

/** Does solving or failing this puzzle change the puzzle rating? Other game-based modes are practice only. */
export function countsForRating(p: Pick<Puzzle, 'source' | 'group' | 'rating'>): boolean {
  if (p.source !== 'game') return true;
  return RATED_GAME_GROUPS.includes(p.group ?? 'rated') && p.rating > 0;
}

export const sideOf = (fen: string): Color =>(fen.split(' ')[1] === 'b' ? 'b' : 'w');

/** Is `uci` legal here, and does it give checkmate? (a checkmating move always solves a puzzle) */
export function givesMate(fen: string, uci: Uci): boolean {
  try {
    const c = new Chess(fen);
    return !!uciMove(c, uci) && c.isCheckmate();
  } catch {
    return false;
  }
}

/** Keep only the part of a line that stays legal, and end it on a solver move. */
export function trimLine(fen: string, pv: Uci[], maxSolverMoves = 3): Uci[] {
  const c = new Chess(fen);
  const out: Uci[] = [];
  for (const u of pv.slice(0, maxSolverMoves * 2 - 1)) {
    if (!uciMove(c, u)) break;
    out.push(u);
  }
  if (out.length % 2 === 0) out.pop();
  return out;
}

export type StepResult = 'correct' | 'alt' | 'wrong';

export function checkMove(p: Puzzle, fen: string, step: number, uci: Uci): StepResult {
  const want = p.solution[step];
  if (uci === want) return 'correct';
  if (step === 0 && p.alts.includes(uci)) return 'alt';
  if (givesMate(fen, uci)) return 'alt';
  return 'wrong';
}

/**
 * Turn the user's mistakes into puzzles. A mistake qualifies when the engine's best move is clearly better than every other move
 * (so there is one answer), and playing it leaves the solver with real winning chances or a mate.
 */
export function puzzlesFromReview(
  gameId: string,
  opponentName: (c: Color) => string,
  fenBefore: (ply: number) => string,
  positions: PosAnalysis[],
  moves: MoveReview[],
  onlyColor: Color | null,
): Puzzle[] {
  const out: Puzzle[] = [];
  for (const m of moves) {
    if (m.cls !== 'blunder' && m.cls !== 'mistake' && m.cls !== 'miss') continue;
    if (onlyColor && m.color !== onlyColor) continue;
    const A = positions[m.ply];
    if (!A || !A.lines[0] || A.legal < 2) continue;
    const gap = A.lines[1] ? m.epBest - epFor(A.lines[1], m.color) : 1;
    // Either there was a clearly winning idea, or an "only move" that saves the game (defending is a skill too).
    const attack = gap >= 0.12 && m.epBest >= 0.55;
    const defence = !attack && gap >= 0.3 && m.epBest >= 0.35;
    if ((!attack && !defence) || m.loss < 0.1) continue;
    const fen = fenBefore(m.ply);
    const solution = defence ? trimLine(fen, A.lines[0].pv, 1) : trimLine(fen, A.lines[0].pv);
    if (!solution.length) continue;
    const mate = A.lines[0].mate != null && (A.lines[0].mate > 0) === (m.color === 'w') ? Math.abs(A.lines[0].mate) : null;
    const themes = [mate ? `mateIn${mate}` : defence ? 'defence' : m.epBest > 0.85 ? 'crushing' : 'advantage', 'yourMistake'];
    out.push({
      id: `g:${gameId}:${m.ply}`,
      fen,
      solution,
      alts: [],
      rating: 0,
      themes,
      source: 'game',
      kind: 'solve',
      group: 'mistake',
      from: { gameId, ply: m.ply },
      game: {
        gameId,
        ply: m.ply,
        played: m.san,
        best: m.bestSan,
        opponent: opponentName(m.color === 'w' ? 'b' : 'w'),
        loss: m.loss,
        moveNo: `${Math.floor(m.ply / 2) + 1}${m.color === 'w' ? '.' : '...'}`,
      },
    });
  }
  return out;
}

/** Lichess rows are [id, FEN before the opponent's move, moves, rating, themes]; the first move is the opponent's. */
export function fromLichessRow(row: [string, string, string, number, string]): Puzzle | null {
  const [id, fen, movesStr, rating, themes] = row;
  const moves = movesStr.split(' ');
  if (moves.length < 2) return null;
  try {
    const c = new Chess(fen);
    if (!uciMove(c, moves[0])) return null;
    return { id: `li:${id}`, fen: c.fen(), solution: moves.slice(1), alts: [], rating, themes: themes.split(' ').filter(Boolean), source: 'lichess', lastMove: moves[0] };
  } catch {
    return null;
  }
}

/** Standard Elo update. `solved` = found every move without help or a wrong try. */
export function eloUpdate(user: number, puzzle: number, solved: boolean, k = 24): number {
  const expected = 1 / (1 + 10 ** ((puzzle - user) / 400));
  return Math.round(k * ((solved ? 1 : 0) - expected));
}

/** Pick the next puzzle near the user's rating that has not been seen (or the least recently seen). */
export function pickPuzzle<T extends { id: string; rating: number }>(pool: T[], rating: number, seen: Record<string, number>, rand: () => number = Math.random): T | null {
  if (!pool.length) return null;
  const fresh = pool.filter((p) => !(p.id in seen));
  const base = fresh.length ? fresh : pool.slice().sort((a, b) => (seen[a.id] ?? 0) - (seen[b.id] ?? 0)).slice(0, Math.max(20, Math.ceil(pool.length / 10)));
  for (const w of [60, 120, 250, 500, 5000]) {
    const near = base.filter((p) => Math.abs(p.rating - rating) <= w);
    if (near.length) return near[Math.floor(rand() * near.length)];
  }
  return base[0];
}
