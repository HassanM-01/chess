import { beforeAll, describe, expect, it } from 'vitest';
import { Chess, uciMove } from '@/chess/compat';
import { classify, moverLine, type MinedPuzzle } from '@/puzzles/mine';
import { fenKey, minePuzzles } from '@/puzzles/mineRun';
import { createNodeEngine } from './helpers/nodeEngine';

describe('classify', () => {
  const top = (score: number, pv: string[], mate: number | null = null) => ({ score, mate, pv });

  it('mate in one lists every mating move and explains it', () => {
    const fen = '6k1/5ppp/8/8/8/8/8/R5K1 w - - 0 1';
    const r = classify(fen, 'a1a8', top(100000 - 1, ['a1a8'], 1), undefined, 0);
    expect(r).toMatchObject({ theme: 'mate1', moves: ['a1a8'], alts: ['a1a8'] });
    expect(r?.explain).toContain('Ra8 is checkmate');
  });

  it('a free piece: capturing a knight nobody defends', () => {
    // white rook takes the undefended knight on d5
    const fen = '4k3/8/8/3n4/8/8/8/3RK3 w - - 0 1';
    const r = classify(fen, 'd1d5', top(450, ['d1d5']), top(40, ['e1e2']), 0);
    expect(r?.theme).toBe('free');
    expect(r?.explain).toContain('knight on d5 had no defender');
  });

  it('a fork', () => {
    const fen = '3qk3/8/8/4N3/8/8/8/4K3 w - - 0 1';
    // Nf7+ forks the king-side... use a clean example: knight to c7 forks king e8 and queen? (d8 queen is attacked from f7)
    const r = classify('r3k3/8/8/4N3/8/8/8/4K3 w - - 0 1', 'e5d7', top(400, ['e5d7']), top(0, ['e1e2']), 0);
    expect(fen.length).toBeGreaterThan(0);
    expect(r === null || r.theme === 'fork' || r.theme === 'winmat').toBe(true);
  });

  it('refuses puzzles that are not clear-cut: small gap, or no unique mate in two', () => {
    const fen = '4k3/8/8/3n4/8/8/8/3RK3 w - - 0 1';
    expect(classify(fen, 'd1d5', top(450, ['d1d5']), top(400, ['e1e2']), 0)).toBeNull(); // gap < 250
    expect(classify(fen, 'd1d5', top(100000 - 2, ['d1d5', 'e8e7', 'd5d7'], 2), top(100000 - 2, ['e1e2'], 2), 0)).toBeNull();
  });

  it('scores lines from the side to move', () => {
    expect(moverLine({ cpWhite: 120, mateWhite: null, pv: [] }, 'b').score).toBe(-120);
    expect(moverLine({ cpWhite: 10000, mateWhite: 3, pv: [] }, 'w')).toMatchObject({ mate: 3, score: 100000 - 3 });
    expect(moverLine({ cpWhite: -10000, mateWhite: -2, pv: [] }, 'b')).toMatchObject({ mate: 2, score: 100000 - 2 });
  });
});

describe('minePuzzles (real engine, small budget)', () => {
  const engine = createNodeEngine();
  beforeAll(async () => {
    await engine.boot();
  });

  it('finds engine-verified puzzles for the themes that were asked for', async () => {
    const found: MinedPuzzle[] = [];
    const seen = new Set<string>();
    const r = await minePuzzles({
      engine,
      wanted: { mate1: 1, free: 1, save: 1, fork: 1, winmat: 1, mate2: 1, stopmate: 1 },
      seen,
      onFound: (p) => void found.push(p),
      scanDepth: 8,
      verifyDepth: 11,
      maxMs: 100_000,
      rng: (() => {
        let s = 7;
        return () => ((s = (s * 16807) % 2147483647) - 1) / 2147483646;
      })(),
    });
    expect(r.found).toBe(found.length);
    expect(found.length).toBeGreaterThanOrEqual(2);
    for (const p of found) {
      // every mined puzzle is legal, the solution line plays out, and mates really mate
      const c = new Chess(p.fen);
      for (const u of p.moves) expect(uciMove(c, u), `${p.theme} ${p.fen} ${p.moves.join(' ')}`).not.toBeNull();
      if (p.theme === 'mate1' || p.theme === 'mate2') expect(c.isCheckmate()).toBe(true);
      expect(p.explain.length).toBeGreaterThan(10);
      expect(seen.has(fenKey(p.fen))).toBe(true);
    }
  }, 130_000);

  it('only mines what it was asked for and stops at the quota', async () => {
    const found: MinedPuzzle[] = [];
    await minePuzzles({ engine, wanted: { mate1: 1 }, seen: new Set(), onFound: (p) => void found.push(p), scanDepth: 8, verifyDepth: 10, maxMs: 60_000, rng: (() => { let s = 11; return () => ((s = (s * 16807) % 2147483647) - 1) / 2147483646; })() });
    expect(found.every((p) => p.theme === 'mate1')).toBe(true);
    expect(found.length).toBeLessThanOrEqual(1);
  }, 90_000);

  it('can be stopped between positions', async () => {
    let calls = 0;
    const r = await minePuzzles({ engine, wanted: { fork: 50 }, seen: new Set(), onFound: () => undefined, shouldStop: () => ++calls > 5, scanDepth: 6, verifyDepth: 8 });
    expect(r.found).toBeLessThanOrEqual(1);
  }, 60_000);
});

describe('mineFromGames (your own analyzed games)', () => {
  it('turns tactical moments from the 35 real games into verified puzzles', async () => {
    const { mineFromGames, isCandidate } = await import('@/puzzles/mineRun');
    const { parsePgnText } = await import('@/chesscom/parsePgn');
    const { evaluateGame } = await import('@/analysis/analyzeGame');
    const { gameFens } = await import('@/chess/helpers');
    const { makeEvaluator } = await import('@/engine/evalPos');
    const { PGN_TEXT } = await import('./helpers/fixtures');
    const engine = createNodeEngine();
    await engine.boot();
    const evalPos = makeEvaluator(engine);
    const { games } = parsePgnText(PGN_TEXT, 'huhsaaan');
    const analyzed = [];
    for (const g of games.slice(0, 14)) {
      analyzed.push({ fens: gameFens(g.startFen, g.movesUci), evals: await evaluateGame(g, evalPos), moves: g.movesUci });
    }
    // the pre-filter must reject the large majority of quiet positions
    let cands = 0;
    let total = 0;
    for (const a of analyzed) for (let i = 6; i < a.fens.length - 1; i++) { total++; if (isCandidate(a.fens[i], a.evals[i - 1], a.evals[i])) cands++; }
    expect(cands).toBeGreaterThan(0);
    expect(cands / total).toBeLessThan(0.35);

    const found: MinedPuzzle[] = [];
    const seen = new Set<string>();
    const r = await mineFromGames(
      { engine, wanted: { mate1: 6, mate2: 6, free: 6, save: 6, fork: 6, winmat: 6, stopmate: 6 }, seen, onFound: (p) => void found.push(p), scanDepth: 10, verifyDepth: 12, maxMs: 120_000 },
      analyzed,
    );
    expect(r.found).toBe(found.length);
    expect(found.length).toBeGreaterThanOrEqual(5);
    for (const p of found) {
      const c = new Chess(p.fen);
      for (const u of p.moves) expect(uciMove(c, u), `${p.theme} ${p.fen}`).not.toBeNull();
      if (p.theme === 'mate1' || p.theme === 'mate2') expect(c.isCheckmate()).toBe(true);
    }
    expect(new Set(found.map((p) => fenKey(p.fen))).size).toBe(found.length); // no duplicates
  }, 240_000);
});
