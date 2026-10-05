// Game analysis (spec 6.2): evaluate every position, then derive mistakes + summary from the evals.
import { Chess, uciMove } from '@/chess/compat';
import { gameFens, sanOf } from '@/chess/helpers';
import { parseFen, phaseOf } from '@/chess/tactics';
import type { Color, Square } from '@/chess/types';
import type { Evaluator } from '@/engine/evalPos';
import { fromStored, toStored, type PosEval, type StoredEval } from '@/engine/types';
import { wpFor } from '@/engine/winprob';
import { categorize } from './categorize';
import type { AnalyzableGame, GameSummary, MistakeDraft, Outcome, Termination } from './types';
import { verdictCounts, walkSteps, type EvalTriple } from './walk';

export const ANALYSIS_DEPTH = 11;
export const ENGINE_TAG = 'sf18-lite-d11';

/** Candidate thresholds from the spec. */
export const MISTAKE_MIN_DROP = 18;
export const MISTAKE_MIN_BEFORE = 6;
export const MISTAKE_SKIP_IF_ABOVE = 88;
export const BLUNDER_DROP = 30;

/** Evaluate every position of the game at depth 11, background priority. */
export async function evaluateGame(
  game: Pick<AnalyzableGame, 'startFen' | 'movesUci'>,
  evalPos: Evaluator,
  onProgress?: (fraction: number) => void,
  shouldCancel?: () => boolean,
): Promise<StoredEval[]> {
  const fens = gameFens(game.startFen, game.movesUci);
  const out: StoredEval[] = [];
  for (let i = 0; i < fens.length; i++) {
    if (shouldCancel?.()) throw new Error('analysis cancelled');
    const r = await evalPos(fens[i], ANALYSIS_DEPTH, 'background');
    out.push(toStored(r));
    onProgress?.((i + 1) / fens.length);
  }
  return out;
}

export function findMistakes(game: AnalyzableGame, evals: EvalTriple[]): MistakeDraft[] {
  const me = game.userColor;
  if (!me) return [];
  const fens = gameFens(game.startFen, game.movesUci);
  const out: MistakeDraft[] = [];
  const seen = new Set<string>();
  for (let i = 0; i < game.movesUci.length; i++) {
    if (fens[i].split(' ')[1] !== me) continue;
    const before = wpFor(evals[i], me);
    const after = wpFor(evals[i + 1], me);
    const drop = before - after;
    if (drop < MISTAKE_MIN_DROP || before < MISTAKE_MIN_BEFORE) continue;
    // Still winning big after the move (and no mate was missed): not worth flagging.
    if (after > MISTAKE_SKIP_IF_ABOVE && !(evals[i].mateWhite != null)) continue;
    const c = categorize(fens[i], fens[i + 1], game.movesUci[i], evals[i], evals[i + 1], me);
    if (!c) continue;
    // Dedupe: the same category on the same square in one game counts once.
    if (c.sq) {
      const key = `${c.cat === 'ignored' ? 'hung' : c.cat}:${c.sq}`;
      if (seen.has(key)) continue;
      seen.add(key);
    }
    out.push({
      ply: i,
      fen: fens[i],
      playedUci: game.movesUci[i],
      playedSan: game.movesSan[i],
      bestUci: evals[i].best,
      bestSan: sanOf(fens[i], evals[i].best),
      replyUci: evals[i + 1].best,
      replySan: sanOf(fens[i + 1], evals[i + 1].best),
      category: c.cat,
      severity: drop >= BLUNDER_DROP ? 'blunder' : 'mistake',
      phase: phaseOf(parseFen(fens[i]), i),
      piece: c.piece ?? null,
      square: (c.sq as Square | undefined) ?? null,
      winDrop: Math.round(drop),
      explanation: c.text,
    });
  }
  return out;
}

/** Termination header -> category (spec 5 step 5); falls back to the final position. */
export function howEnded(game: AnalyzableGame): Termination {
  const t = String(game.termination ?? '').toLowerCase();
  if (t.includes('checkmate')) return 'checkmate';
  if (t.includes('resign')) return 'resignation';
  if (t.includes('time')) return 'time';
  if (t.includes('abandon')) return 'abandoned';
  if (/stalemate|repetition|agreement|insufficient|50|draw/.test(t)) return 'draw';
  const c = new Chess(game.startFen);
  for (const u of game.movesUci) uciMove(c, u);
  return c.isCheckmate() ? 'checkmate' : 'other';
}

export function summarize(game: AnalyzableGame, evals: EvalTriple[], mistakes: MistakeDraft[]): GameSummary {
  const me = game.userColor;
  const counts = { best: 0, good: 0, inacc: 0, mistake: 0, blunder: 0 };
  const s: GameSummary = {
    castled_move: null,
    early_queen: false,
    eval_after_10: null,
    how_ended: howEnded(game),
    outcome: (game.outcome as Outcome | null | undefined) ?? null,
    counts,
  };
  if (!me) return s;
  const fens = gameFens(game.startFen, game.movesUci);
  let myMoves = 0;
  for (let i = 0; i < game.movesUci.length; i++) {
    if (fens[i].split(' ')[1] !== me) continue;
    myMoves++;
    if (s.castled_move == null && game.movesSan[i].startsWith('O-O')) s.castled_move = myMoves;
    const p = parseFen(fens[i])[game.movesUci[i].slice(0, 2)];
    if (p && p.type === 'q' && myMoves <= 5) s.early_queen = true;
  }
  if (evals.length > 20) s.eval_after_10 = Math.round(wpFor(evals[20], me as Color));
  s.counts = verdictCounts(walkSteps(game, evals, mistakes).steps);
  return s;
}

export interface GameAnalysisResult {
  evals: StoredEval[];
  mistakes: MistakeDraft[];
  summary: GameSummary;
}

/** Everything derivable from stored evals (pure; used after the engine finishes and by tests). */
export function analyzeFromEvals(game: AnalyzableGame, evals: StoredEval[]): GameAnalysisResult {
  const e: PosEval[] = evals.map(fromStored);
  const mistakes = game.userColor ? findMistakes(game, e) : [];
  return { evals, mistakes, summary: summarize(game, e, mistakes) };
}

export async function analyzeGame(
  game: AnalyzableGame,
  evalPos: Evaluator,
  onProgress?: (fraction: number) => void,
  shouldCancel?: () => boolean,
): Promise<GameAnalysisResult> {
  const evals = await evaluateGame(game, evalPos, onProgress, shouldCancel);
  return analyzeFromEvals(game, evals);
}

