// Walkthrough step model, ported from prototype walkSteps / verdictOf / standing / whyBest.
import { Chess, uciMove } from '@/chess/compat';
import { gameFens, moveInfo, sanOf } from '@/chess/helpers';
import { VAL, forkTargets, hangingInfo, hangingPieces, parseFen, pieceName } from '@/chess/tactics';
import type { Color, Uci } from '@/chess/types';
import { wpFor } from '@/engine/winprob';
import type { PosEval } from '@/engine/types';
import { categorize } from './categorize';
import type { AnalyzableGame, MistakeDraft, VerdictCounts, VerdictKey } from './types';

export interface Verdict {
  k: VerdictKey;
  label: string;
  cls: '' | 'good' | 'warn' | 'bad';
}

export function verdictOf(drop: number, played: Uci, best: Uci | null): Verdict {
  if (played === best) return { k: 'best', label: 'Best move', cls: 'good' };
  if (drop < 4) return { k: 'good', label: 'Good move', cls: 'good' };
  if (drop < 10) return { k: 'inacc', label: 'Inaccuracy', cls: '' };
  if (drop < 20) return { k: 'mistake', label: 'Mistake', cls: 'warn' };
  return { k: 'blunder', label: 'Blunder', cls: 'bad' };
}

export function standing(wp: number): string {
  if (wp >= 90) return 'You are winning easily.';
  if (wp >= 70) return 'You are clearly better.';
  if (wp >= 55) return 'You are slightly better.';
  if (wp > 45) return 'The game is about equal.';
  if (wp > 30) return 'You are slightly worse.';
  if (wp > 10) return 'You are clearly worse.';
  return 'You are losing badly.';
}

/** One plain-English sentence about why a move is good. */
export function whyBest(fen: string, u: Uci | null): string {
  const mv = moveInfo(fen, u);
  if (!mv) return '';
  const b = parseFen(fen);
  const opp: Color = mv.color === 'w' ? 'b' : 'w';
  if (mv.san.includes('#')) return `${mv.san} is checkmate.`;
  if (mv.captured) {
    const hi = hangingInfo(b, mv.to);
    if (hi && b[mv.to] && b[mv.to].color === opp) {
      return `${mv.san} takes their ${pieceName(mv.captured)}${hi.reason === 'undefended' ? ', which nothing was protecting' : ' with a cheaper piece'}.`;
    }
    return `${mv.san} captures their ${pieceName(mv.captured)}.`;
  }
  const mineLoose = hangingPieces(b, mv.color).filter((x) => VAL[x.piece.type] >= 3);
  if (mineLoose.some((x) => x.square === mv.from)) return `${mv.san} gets your ${pieceName(mv.piece)} out of danger.`;
  const c = new Chess(fen);
  uciMove(c, u as Uci);
  const ft = forkTargets(parseFen(c.fen()), mv.to);
  if (ft.length >= 2) return `${mv.san} attacks two of their pieces at once.`;
  if (mv.san.includes('+')) return `${mv.san} gives check and keeps the pressure on.`;
  return '';
}

export interface WalkStep {
  ply: number;
  mine: boolean;
  fen: string;
  uci: Uci;
  san: string;
  best: Uci | null;
  bestSan: string;
  wpBefore: number; // user's win%
  wpAfter: number;
  drop?: number;
  v?: Verdict;
  problem?: string;
  gain?: number;
  punish?: { best: Uci | null; bestSan: string; played: string; found: boolean };
}

export type EvalTriple = Pick<PosEval, 'cpWhite' | 'mateWhite' | 'best'>;

export function walkSteps(
  game: AnalyzableGame,
  evals: EvalTriple[],
  mistakes: Pick<MistakeDraft, 'ply' | 'explanation'>[],
): { steps: WalkStep[]; fens: string[] } {
  const me = game.userColor as Color;
  const fens = gameFens(game.startFen, game.movesUci);
  const steps: WalkStep[] = [];
  for (let i = 0; i < game.movesUci.length; i++) {
    const turn = fens[i].split(' ')[1];
    const mine = turn === me;
    const before = wpFor(evals[i], me);
    const after = wpFor(evals[i + 1], me);
    const s: WalkStep = {
      ply: i,
      mine,
      fen: fens[i],
      uci: game.movesUci[i],
      san: game.movesSan[i],
      best: evals[i].best,
      bestSan: sanOf(fens[i], evals[i].best),
      wpBefore: before,
      wpAfter: after,
    };
    if (mine) {
      s.drop = before - after;
      s.v = verdictOf(s.drop, s.uci, s.best);
      if (s.best && s.uci !== s.best && s.v.k !== 'blunder') {
        const bm = moveInfo(fens[i], s.best);
        const b0 = parseFen(fens[i]);
        const hi = bm && bm.captured && VAL[bm.captured] >= 3 ? hangingInfo(b0, bm.to) : null;
        if (bm && hi && game.movesUci[i].slice(2, 4) !== bm.to) {
          s.v = { k: 'mistake', label: 'Missed free piece', cls: 'warn' };
          s.problem = `Their ${pieceName(bm.captured as never)} on ${bm.to} was ${hi.reason === 'undefended' ? 'not protected' : 'attackable by your cheaper piece'}, and you didn't take it.`;
        }
      }
      if (!s.problem && (s.v.k === 'mistake' || s.v.k === 'blunder' || s.v.k === 'inacc')) {
        const m = mistakes.find((x) => x.ply === i);
        s.problem = m ? m.explanation : (categorize(fens[i], fens[i + 1], s.uci, evals[i], evals[i + 1], me)?.text ?? '');
      }
    } else {
      s.gain = after - before;
      if (s.gain >= 15 && i + 1 < game.movesUci.length) {
        s.punish = {
          best: evals[i + 1].best,
          bestSan: sanOf(fens[i + 1], evals[i + 1].best),
          played: game.movesSan[i + 1],
          found: game.movesUci[i + 1] === evals[i + 1].best || wpFor(evals[i + 1], me) - wpFor(evals[i + 2], me) < 5,
        };
      }
    }
    steps.push(s);
  }
  return { steps, fens };
}

export function verdictCounts(steps: WalkStep[]): VerdictCounts {
  const counts: VerdictCounts = { best: 0, good: 0, inacc: 0, mistake: 0, blunder: 0 };
  for (const s of steps) if (s.mine && s.v) counts[s.v.k]++;
  return counts;
}

/** Steps the "Mistakes »" button jumps between (spec 7): your mistakes/blunders and their blunders you didn't punish. */
export function isBigMoment(s: WalkStep): boolean {
  return (s.mine && !!s.v && (s.v.k === 'mistake' || s.v.k === 'blunder')) || (!!s.punish && !s.punish.found);
}
