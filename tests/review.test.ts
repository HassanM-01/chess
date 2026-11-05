import { afterAll, describe, expect, it } from 'vitest';
import { Chess } from '@/chess/compat';
import { START_FEN } from '@/chess/types';
import { bookName } from '@/review/book';
import { classFromLoss, isSacrifice, moveAccuracy, reviewMoves, summarizeReview } from '@/review/classify';
import { epFor, epWhite } from '@/review/expected';
import { analyzePositions } from '@/review/runReview';
import type { PosAnalysis, StoredLine } from '@/review/types';
import { hasNativeEngine, makeNativeEngine } from './helpers/nativeEngine';

const line = (cp: number, pv: string[] = [], extra: Partial<StoredLine> = {}): StoredLine => ({ cp, mate: null, pv, depth: 20, ...extra });
const pos = (lines: StoredLine[], legal = 20): PosAnalysis => ({ lines, depth: 20, legal });

describe('expected points', () => {
  it('is 0.5 when equal and symmetric', () => {
    expect(epWhite(line(0))).toBeCloseTo(0.5, 5);
    expect(epWhite(line(300)) + epWhite(line(-300))).toBeCloseTo(1, 5);
    expect(epFor(line(300), 'b')).toBeCloseTo(1 - epWhite(line(300)), 8);
  });
  it('mate is decisive, and the engine win/draw/loss does not flatten the curve for human games', () => {
    expect(epWhite({ cp: 10000, mate: 3 })).toBe(1);
    expect(epWhite({ cp: -10000, mate: -2 })).toBe(0);
    // +2.7 is a clear edge but nowhere near a sure win for a human player
    expect(epWhite(line(270, [], { wdl: [999, 1, 0] }))).toBeLessThan(0.8);
  });
});

describe('thresholds', () => {
  it('maps expected-points loss to chess.com classes', () => {
    expect(classFromLoss(0)).toBe('best');
    expect(classFromLoss(0.015)).toBe('excellent');
    expect(classFromLoss(0.04)).toBe('good');
    expect(classFromLoss(0.08)).toBe('inaccuracy');
    expect(classFromLoss(0.15)).toBe('mistake');
    expect(classFromLoss(0.35)).toBe('blunder');
  });
  it('accuracy is 100 for no loss and falls quickly', () => {
    expect(moveAccuracy(60, 60)).toBe(100);
    expect(moveAccuracy(50, 60)).toBe(100);
    expect(moveAccuracy(80, 30)).toBeLessThan(15);
  });
});

describe('classification from synthetic engine output', () => {
  it('a big drop is a blunder, an opening move on a named line is Book', () => {
    const a = [pos([line(30, ['e2e4']), line(20, ['d2d4'])]), pos([line(-900, ['e7e5'])])];
    expect(reviewMoves(START_FEN, ['e2e4'], a)[0].cls).toBe('book');
    const [h] = reviewMoves(START_FEN, ['h2h4'], a);
    expect(h.cls).toBe('blunder');
    expect(h.loss).toBeGreaterThan(0.2);
    expect(h.bestSan).toBe('e4');
  });
  it('the only legal move is Forced', () => {
    const fen = '7k/8/8/8/8/8/6q1/7K w - - 0 1'; // the white king can only take the queen... count it
    const c = new Chess(fen);
    const moves = c.moves({ verbose: true });
    const [m] = reviewMoves(fen, [moves[0].from + moves[0].to], [pos([line(0, [moves[0].from + moves[0].to])], moves.length), pos([line(0)], 5)]);
    if (moves.length === 1) expect(m.cls).toBe('forced');
    else expect(m.cls).not.toBe('forced');
  });
});

describe('Great moves', () => {
  const fen = '4k3/8/8/8/2r5/8/8/4KB2 w - - 0 1';
  const gap = (first: string): PosAnalysis[] => [
    { lines: [line(500, [first]), line(-300, ['e1d1'])], depth: 30, legal: 9 },
    { lines: [line(500, [])], depth: 30, legal: 9 },
  ];
  it('is given for a quiet only-move with a big gap to the alternatives', () => {
    expect(reviewMoves(fen, ['e1d2'], gap('e1d2'))[0].cls).toBe('great');
  });
  it('is not given for simply taking a more valuable piece', () => {
    expect(reviewMoves(fen, ['f1c4'], gap('f1c4'))[0].cls).toBe('best');
  });
});

describe('opening book', () => {
  it('knows mainline openings', () => {
    const c = new Chess();
    for (const m of ['e4', 'e5', 'Nf3', 'Nc6', 'Bb5']) c.move(m);
    expect(bookName(c.fen())).toMatch(/Ruy Lopez/);
  });
  it('does not know a silly position', () => {
    const c = new Chess();
    for (const m of ['a4', 'h5', 'Ra3', 'Rh6']) c.move(m);
    expect(bookName(c.fen())).toBeUndefined();
  });
});

describe('sacrifice detection', () => {
  it("sees Legal's mate queen sacrifice (5.Nxe5)", () => {
    const c = new Chess();
    for (const m of ['e4', 'e5', 'Nf3', 'd6', 'Bc4', 'Bg4', 'Nc3', 'g6']) c.move(m);
    const before = c.fen();
    c.move('Nxe5');
    expect(isSacrifice(before, c.fen(), ['g4d1', 'c4f7', 'e8e7', 'c3d5'], 'w')).toBe(true);
  });
  it('does not call an even trade a sacrifice', () => {
    const b = new Chess();
    for (const m of ['e4', 'e5', 'Nf3', 'Nc6', 'Bb5', 'a6']) b.move(m);
    const before = b.fen();
    b.move('Bxc6');
    expect(isSacrifice(before, b.fen(), ['d7c6', 'f3e5'], 'w')).toBe(false);
  });
});

describe.skipIf(!hasNativeEngine)('with the native Stockfish', () => {
  const engine = makeNativeEngine();
  afterAll(() => engine.requestRestart());
  const settings = { depth: 18, movetimeMs: 4000, multipv: 3 };

  async function review(sans: string[]) {
    const c = new Chess();
    const ucis: string[] = [];
    for (const s of sans) {
      const m = c.move(s);
      ucis.push(m.from + m.to + (m.promotion ?? ''));
    }
    const positions = await analyzePositions(START_FEN, ucis, engine, settings);
    return { moves: reviewMoves(START_FEN, ucis, positions), positions };
  }

  it("Fool's mate: 2.g4 is a blunder and ...Qh4# is best", async () => {
    const { moves, positions } = await review(['f3', 'e5', 'g4', 'Qh4#']);
    // depth and win/draw/loss must really come through from the engine
    expect(positions[0].lines[0].depth).toBeGreaterThanOrEqual(12);
    expect(positions[0].lines[0].wdl).toBeDefined();
    expect(positions[0].lines).toHaveLength(3);
    expect(moves[2].cls).toBe('blunder');
    expect(moves[3].cls).toBe('best');
  }, 120_000);

  it("Legal's trap: taking the queen (5...Bxd1??) is punished", async () => {
    const { moves, positions } = await review(['e4', 'e5', 'Nf3', 'd6', 'Bc4', 'Bg4', 'Nc3', 'g6', 'Nxe5', 'Bxd1', 'Bxf7+', 'Ke7', 'Nd5#']);
    expect(['blunder', 'mistake']).toContain(moves[9].cls);
    expect(moves[12].cls).toBe('best');
    const s = summarizeReview(moves, positions);
    expect(s.white.accuracy).toBeGreaterThan(s.black.accuracy);
  }, 180_000);

  it("The Opera Game: 16.Qb8+!! (a queen sacrifice that mates) is brilliant", async () => {
    const game = 'e4 e5 Nf3 d6 d4 Bg4 dxe5 Bxf3 Qxf3 dxe5 Bc4 Nf6 Qb3 Qe7 Nc3 c6 Bg5 b5 Nxb5 cxb5 Bxb5+ Nbd7 O-O-O Rd8 Rxd7 Rxd7 Rd1 Qe6 Bxd7+ Nxd7 Qb8+ Nxb8 Rd8#'.split(' ');
    const { moves, positions } = await review(game);
    const q = moves[30];
    expect(q.san).toBe('Qb8+');
    expect(q.cls).toBe('brilliant');
    expect(summarizeReview(moves, positions).white.counts.brilliant).toBeGreaterThanOrEqual(1);
  }, 400_000);

  it('mainline opening moves are Book', async () => {
    const { moves } = await review(['e4', 'e5', 'Nf3', 'Nc6', 'Bb5', 'a6']);
    expect(moves.map((m) => m.cls)).toEqual(['book', 'book', 'book', 'book', 'book', 'book']);
  }, 120_000);
});
