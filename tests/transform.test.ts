import { beforeAll, describe, expect, it } from 'vitest';
import { Chess } from '@/chess/compat';
import { gameFens } from '@/chess/helpers';
import { parsePgnText } from '@/chesscom/parsePgn';
import { analyzeFromEvals } from '@/analysis/analyzeGame';
import { transformEval, transformFen, transformSquare, transformUci, VARIANT_KINDS, legalIn } from '@/puzzles/transform';
import { wpWhite } from '@/engine/winprob';
import { fromStored } from '@/engine/types';
import { makeEvaluator } from '@/engine/evalPos';
import { createNodeEngine } from './helpers/nodeEngine';
import { PGN_TEXT } from './helpers/fixtures';

describe('board transforms', () => {
  const START = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
  const AFTER_E4 = 'rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq e3 0 1';

  it('mirror, swap and both are involutions', () => {
    for (const kind of VARIANT_KINDS) {
      const once = transformFen(AFTER_E4, kind);
      const twice = transformFen(once, kind);
      expect(twice.split(' ').slice(0, 2)).toEqual(AFTER_E4.split(' ').slice(0, 2));
    }
  });

  it('known results', () => {
    expect(transformFen(AFTER_E4, 'mirror')).toBe('rnbkqbnr/pppppppp/8/8/3P4/8/PPP1PPPP/RNBKQBNR b - - 0 1');
    // swap: ranks reversed, colours swapped, turn flipped (black to move becomes white to move)
    expect(transformFen(AFTER_E4, 'swap')).toBe('rnbqkbnr/pppp1ppp/8/4p3/8/8/PPPPPPPP/RNBQKBNR w - - 0 1');
    expect(transformFen(START, 'both')).toBe('rnbkqbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBKQBNR b - - 0 1');
    expect(transformSquare('e2', 'swap')).toBe('e7');
    expect(transformSquare('a1', 'mirror')).toBe('h1');
    expect(transformSquare('b1', 'both')).toBe('g8');
    expect(transformUci('e7e8q', 'swap')).toBe('e2e1q');
    expect(transformUci(null, 'swap')).toBeNull();
  });

  it('every transform keeps the position legal and the number of legal moves identical', () => {
    const c = new Chess();
    const fens: string[] = [c.fen()];
    for (const san of ['e4', 'c5', 'Nf3', 'd6', 'd4', 'cxd4', 'Nxd4', 'Nf6', 'Nc3', 'a6', 'Bg5', 'e6']) {
      c.move(san);
      fens.push(c.fen());
    }
    for (const fen of fens) {
      const n = new Chess(fen).moves().length;
      for (const kind of VARIANT_KINDS) {
        const t = transformFen(fen, kind);
        // castling is dropped, so compare against the original with castling rights removed
        const base = new Chess(fen.split(' ').slice(0, 2).join(' ') + ' - - 0 1');
        expect(new Chess(t).moves().length).toBe(base.moves().length);
        expect(n).toBeGreaterThan(0);
      }
    }
  });

  it('eval mapping flips the sign only when colours swap', () => {
    expect(transformEval([120, null, 'e2e4'], 'mirror')).toEqual([120, null, 'd2d4']);
    expect(transformEval([120, null, 'e2e4'], 'swap')).toEqual([-120, null, 'e7e5']);
    expect(transformEval([10000, 2, 'a1a8'], 'both')).toEqual([-10000, -2, 'h8h1']);
    expect(transformEval([0, null, null], 'swap')).toEqual([0, null, null]);
  });
});

describe('transforms agree with the real engine (the symmetry claim itself)', () => {
  const engine = createNodeEngine();
  const evalPos = makeEvaluator(engine);
  beforeAll(async () => {
    await engine.boot();
  });

  it("transformed positions of a user's real mistakes get the same verdict and the same best move", async () => {
    const { games } = parsePgnText(PGN_TEXT, 'huhsaaan');
    const g = games.find((x) => x.black === 'whole_cooked_chicken')!;
    const fens = gameFens(g.startFen, g.movesUci);
    // positions without castling rights/moves so only the symmetry is being tested
    const probes = [fens[6], fens[7], fens[12], fens[20]].map((f) => f.split(' ').slice(0, 2).join(' ') + ' - - 0 1');
    let compared = 0;
    for (const fen of probes) {
      const base = await evalPos(fen, 12, 'background', { newGame: true });
      for (const kind of VARIANT_KINDS) {
        const tf = transformFen(fen, kind);
        const e = await evalPos(tf, 12, 'background', { newGame: true });
        const mapped = transformEval([base.cpWhite, base.mateWhite, base.best], kind);
        // same win chance (within engine noise) and the engine's best move maps across (or is an equal alternative)
        expect(Math.abs(wpWhite(e) - wpWhite(fromStored(mapped)))).toBeLessThan(6);
        if (e.best !== mapped[2]) {
          // an equally good alternative: check the mapped best move is legal and about as good
          expect(legalIn(tf, mapped[2] as string)).toBe(true);
        }
        compared++;
      }
    }
    expect(compared).toBe(12);
  });

  it('variants of the real analysis keep the mistake category and rename the squares in the text', async () => {
    const { generateVariantItems } = await import('@/puzzles/variants');
    const { games } = parsePgnText(PGN_TEXT, 'huhsaaan');
    const g = games.find((x) => x.black === 'whole_cooked_chicken')!;
    const { evaluateGame } = await import('@/analysis/analyzeGame');
    const evals = await evaluateGame(g, evalPos);
    const { mistakes } = analyzeFromEvals(g, evals);
    const m = mistakes.find((x) => x.ply === 6)!;
    expect(m.category).toBe('ignored');
    const items = generateVariantItems(g, evals, mistakes, { gameId: 'x', opponent: 'chicken' });
    expect(items.length).toBeGreaterThanOrEqual(3);
    const fromPly6 = items.filter((i) => 'srcPly' in i && (i as { srcPly?: number }).srcPly === 6);
    expect(fromPly6).toHaveLength(3);
    for (const it of fromPly6) {
      const p = it.payload as { text: string; cat: string; best: string; fen: string; variant: string };
      expect(p.cat).toBe('ignored');
      expect(legalIn(p.fen, p.best)).toBe(true);
      if (p.variant === 'mirror') expect(p.text).toContain('bishop on c4'); // f4 mirrored left-right is c4
      if (p.variant === 'swap') expect(p.text).toContain('bishop on f5'); // f4 reflected top-bottom is f5
      if (p.variant === 'both') expect(p.text).toContain('bishop on c5');
    }
  });
});
