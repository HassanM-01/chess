// Mining training material out of a reviewed game, with the real engine on a short game where the answers are known.
import { afterAll, describe, expect, it } from 'vitest';
import { Chess } from '@/chess/compat';
import { START_FEN } from '@/chess/types';
import { mineGame, realThreats } from '@/review/mineGames';
import { checkMove, countsForRating, type Puzzle } from '@/review/puzzles';
import { analyzePositions } from '@/review/runReview';
import { hasNativeEngine, makeNativeEngine } from './helpers/nativeEngine';

describe('defensive "only move" puzzles', () => {
  const line = (cp: number, pv: string[]) => ({ cp, mate: null, pv, depth: 30 });
  const pos = (lines: ReturnType<typeof line>[]) => ({ lines, depth: 30, legal: 20 });
  it('offers the saving move when everything else loses', () => {
    const positions = [pos([line(10, ['e2e4', 'e7e5']), line(-700, ['d2d4'])]), pos([line(-900, ['e7e5'])])];
    const r = mineGame({ id: 'x', startFen: START_FEN, movesUci: ['h2h4'], white: 'Me', black: 'Opp', userColor: 'w' }, positions);
    // 1.h4 is a blunder here only because the synthetic numbers say so; the point is the puzzle shape
    const p = r.puzzles.find((q) => q.group === 'mistake');
    expect(p?.solution).toEqual(['e2e4']);
    expect(p?.themes).toContain('defence');
  });
});

describe('which puzzles move the rating', () => {
  const p = (source: 'game' | 'bundled' | 'lichess', group: Puzzle['group'], rating: number) => ({ source, group, rating });
  it('rated puzzles always count', () => {
    expect(countsForRating(p('bundled', 'rated', 1200))).toBe(true);
    expect(countsForRating(p('lichess', undefined, 1500))).toBe(true);
  });
  it('game puzzles count for checkmate, tactics and punish, but only when they have a difficulty', () => {
    for (const g of ['mate', 'tactic', 'punish'] as const) {
      expect(countsForRating(p('game', g, 800)), g).toBe(true);
      expect(countsForRating(p('game', g, 0)), `${g} without a rating`).toBe(false);
    }
  });
  it('mistakes, threats and safe-or-blunder are practice', () => {
    for (const g of ['mistake', 'threat', 'judge'] as const) expect(countsForRating(p('game', g, 900)), g).toBe(false);
  });
});

describe('realThreats', () => {
  it('finds a knight that can be taken for free, and ignores protected or pinned attackers', () => {
    // black pawn d5 attacks the knight on e4; nothing protects it
    expect(realThreats('4k3/8/8/3p4/4N3/8/8/4K3 w - - 0 1', 'w')).toEqual([{ square: 'e4', by: 'd5', type: 'n', reason: 'undefended' }]);
    // knight protected by a pawn and attacked by a knight: an even trade, not a threat
    expect(realThreats('4k3/8/8/8/4N3/3P4/8/4K3 w - - 0 1', 'w')).toEqual([]);
    // the attacking rook is pinned to its king, so it cannot take
    expect(realThreats('4k3/4r3/8/8/8/8/4N3/4RK2 b - - 0 1', 'b')).toEqual([]);
  });
});

const engine = hasNativeEngine ? makeNativeEngine(4, 256) : null;
afterAll(() => engine?.requestRestart());

describe.skipIf(!hasNativeEngine)('mining a short reviewed game (real engine)', () => {
  // 1.e4 e5 2.Qh5 Nc6 3.Bc4 Nf6?? 4.Qxf7#  (the user is Black and blundered)
  const sans = ['e4', 'e5', 'Qh5', 'Nc6', 'Bc4', 'Nf6', 'Qxf7#'];
  const movesUci = (() => {
    const c = new Chess();
    return sans.map((s) => {
      const m = c.move(s);
      return m.from + m.to + (m.promotion ?? '');
    });
  })();

  it('builds mate, punish, mistake and judge puzzles with explanations', async () => {
    const positions = await analyzePositions(START_FEN, movesUci, engine!, { depth: 16, movetimeMs: 2000, multipv: 3 });
    const game = { id: 'g1', startFen: START_FEN, movesUci, white: 'Opp', black: 'Me', userColor: 'b' as const };
    const r = mineGame(game, positions);
    const by = (g: string) => r.puzzles.filter((p) => p.group === g);

    // mate in one for the position before 4.Qxf7#
    const mate = by('mate')[0];
    expect(mate).toBeTruthy();
    expect(mate.solution).toEqual(['h5f7']);
    expect(checkMove(mate, mate.fen, 0, 'h5f7')).toBe('correct');

    // you are Black, so Black's blunder is yours and nothing is offered to "punish"
    expect(by('punish')).toHaveLength(0);

    // the user's own blunder is counted as "walked into a mate". (Black had many good moves there, so it is not offered as a one-answer puzzle.)
    expect(r.weak['allowed-mate']).toBe(1);
    expect(r.badMoves).toBe(1);

    // safe-or-blunder: the Nf6 blunder is offered as a blunder
    const blunder = by('judge').find((p) => p.judge!.verdict === 'blunder');
    expect(blunder?.judge?.san).toBe('Nf6');
    expect(blunder?.judge?.reply).toBe('h5f7');
    // seen from White's side (or with no side known) the same blunder becomes a "punish" puzzle
    const asWhite = mineGame({ ...game, userColor: 'w' }, positions);
    const punish = asWhite.puzzles.find((p) => p.group === 'punish');
    expect(punish?.solution).toEqual(['h5f7']);
    expect(punish?.explain?.join(' ')).toMatch(/checkmate/i);
    expect(punish?.context).toMatch(/Nf6/);

    // which of these move your rating: checkmate, tactics and punish do (they have a difficulty); the rest are practice
    expect(mate.rating).toBe(600);
    expect(countsForRating(mate)).toBe(true);
    expect(punish!.rating).toBe(600); // a mate in one: rated like any mate in one
    expect(countsForRating(punish!)).toBe(true);
    for (const p of r.puzzles.filter((q) => ['mistake', 'threat', 'judge'].includes(q.group!))) expect(countsForRating(p), `${p.group} ${p.id}`).toBe(false);
  }, 120_000);
});
