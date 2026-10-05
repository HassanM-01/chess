import { beforeAll, describe, expect, it } from 'vitest';
import { Chess, uciMove } from '@/chess/compat';
import { makeEvaluator } from '@/engine/evalPos';
import { TECHNIQUES, boxSquares, gradeMove, hangingToKing, onEdge, randomStart, stageOf, type TechniqueKind } from '@/mate/technique';
import { createNodeEngine } from './helpers/nodeEngine';

const lcg = (seed: number) => () => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646;

describe('starting positions', () => {
  for (const t of TECHNIQUES) {
    it(`${t.kind}: 150 random starts are legal, White to move, Black has only a king, nothing is over`, () => {
      const rng = lcg(5);
      for (let i = 0; i < 150; i++) {
        const fen = randomStart(t.kind, rng);
        const c = new Chess(fen);
        expect(c.turn()).toBe('w');
        expect(c.isGameOver()).toBe(false);
        const pieces = c.board().flat().filter(Boolean);
        expect(pieces.filter((p) => p!.color === 'b').map((p) => p!.type)).toEqual(['k']);
        expect(pieces.filter((p) => p!.color === 'w' && p!.type !== 'k').map((p) => p!.type)).toEqual(t.pieces);
        // Black is not in check (that would be illegal with White to move)
        expect(new Chess(fen.replace(' w ', ' b ')).inCheck()).toBe(false);
      }
    });
  }
  it('mostly starts the king in the middle (where the box is needed)', () => {
    const rng = lcg(9);
    let central = 0;
    for (let i = 0; i < 200; i++) {
      const c = new Chess(randomStart('kq', rng));
      const bk = c.board().flat().find((p) => p && p.type === 'k' && p.color === 'b')!;
      if (!onEdge(bk.square)) central++;
    }
    expect(central / 200).toBeGreaterThan(0.6);
  });
});

describe('stages of the plan', () => {
  it('detects the middle, the edge far from your king, the edge close, and mate in one', () => {
    expect(stageOf('kq', '8/8/8/4k3/8/8/8/Q3K3 w - - 0 1', null).id).toBe('center');
    expect(stageOf('kq', '4k3/8/8/8/8/8/8/Q3K3 w - - 0 1', null).id).toBe('edge-far');
    expect(stageOf('kq', '4k3/8/4K3/8/8/8/8/Q7 w - - 0 1', null).id).toBe('edge-close');
    expect(stageOf('kq', '4k3/8/4K3/8/8/8/8/Q7 w - - 0 1', 1).id).toBe('mate-in-one');
    for (const t of TECHNIQUES) for (const s of ['8/8/8/4k3/8/8/8/Q3K3 w - - 0 1', '4k3/8/8/8/8/8/8/Q3K3 w - - 0 1']) expect(stageOf(t.kind, s, null).plan.length).toBeGreaterThan(40);
  });
});

describe('the box', () => {
  it('counts the squares the lone king can still reach', () => {
    // only a far-away king: the king's own square and the three it covers are out
    expect(boxSquares('8/8/8/4k3/8/8/8/K7 w - - 0 1')).toHaveLength(60);
    // a queen a knight's move away from a king in the corner leaves him no squares at all
    expect(boxSquares('7k/8/6Q1/8/8/8/8/K7 b - - 0 1')).toEqual(['h8']);
    // adding a queen can only shrink the box
    expect(boxSquares('8/8/8/4k3/8/8/Q7/K7 w - - 0 1').length).toBeLessThan(60);
  });

  it('a rook covers the square behind the king, so he cannot run along the check', () => {
    const box = boxSquares('R3k3/8/8/8/8/8/8/4K3 b - - 0 1');
    expect(box).not.toContain('d8');
    expect(box).not.toContain('f8');
    expect(box).toContain('e8');
  });

  it('sees an unprotected piece the king could take, but not a protected one', () => {
    expect(hangingToKing('8/8/8/8/3k4/3Q4/8/7K b - - 0 1')).toBe('d3');
    expect(hangingToKing('8/8/8/8/3k4/3Q4/2K5/8 b - - 0 1')).toBeNull(); // the white king protects the queen
  });
});

describe('grading a move', () => {
  it('checkmate and stalemate are recognised from the board', () => {
    expect(gradeMove('7k/5K2/8/8/8/8/8/6Q1 w - - 0 1', '7k/5KQ1/8/8/8/8/8/8 b - - 1 1').verdict).toBe('mate');
    const stale = gradeMove('7k/8/8/6Q1/8/8/8/K7 w - - 0 1', '7k/8/6Q1/8/8/8/8/K7 b - - 1 1');
    expect(stale.verdict).toBe('stalemate');
    expect(stale.text).toContain('draw');
  });

  it('a queen hung to the king is called out', () => {
    const g = gradeMove('8/8/8/8/8/3k4/8/Q3K3 w - - 0 1', '8/8/8/8/3Q4/3k4/8/4K3 b - - 1 1');
    expect(g.verdict).toBe('lost-win');
    expect(g.text).toContain('d4');
  });

  it('reports what the move did to the box, and the verdict agrees with the numbers', () => {
    const start = '8/8/8/4k3/8/8/Q7/K7 w - - 0 1';
    for (const after of ['8/8/8/4k3/8/Q7/8/K7 b - - 1 1', '8/8/4k3/8/4Q3/8/8/K7 b - - 1 1', '8/8/8/4k3/8/8/Q7/1K6 b - - 1 1']) {
      const g = gradeMove(start, after);
      expect(g.text.length).toBeGreaterThan(20);
      if (g.boxAfter < g.boxBefore) expect(g.verdict).toBe('tighten');
      else if (g.boxAfter > g.boxBefore) expect(g.verdict).toBe('loosen');
      else expect(['hold', 'progress']).toContain(g.verdict);
      if (g.verdict === 'tighten') expect(g.text).toContain(`${g.boxBefore} squares to ${g.boxAfter}`);
    }
  });

  it('a check that frees the king is "loosen"', () => {
    // box before: the king is already hemmed in by the queen on the 3rd rank; the check from behind lets him back toward the middle
    const hemmed = '7k/8/8/8/8/Q7/8/K7 w - - 0 1';
    const g = gradeMove(hemmed, '7k/8/8/8/8/8/Q7/K7 b - - 1 1');
    expect(g.boxAfter).toBeGreaterThanOrEqual(g.boxBefore);
    expect(['loosen', 'hold', 'progress']).toContain(g.verdict);
  });
});

/** A student who only follows the box rule: take the safe move that leaves the smallest box, then the closer king. */
function greedy(fen: string, seen: Set<string>): string {
  const c = new Chess(fen);
  let best = '';
  let bestKey = [Infinity, Infinity, Infinity];
  for (const m of c.moves({ verbose: true })) {
    const u = m.from + m.to + (m.promotion ?? '');
    const t = new Chess(fen);
    uciMove(t, u);
    const g = gradeMove(fen, t.fen());
    if (g.verdict === 'mate') return u;
    if (g.verdict === 'stalemate' || g.verdict === 'lost-win') continue;
    const bk = t.board().flat().find((p) => p && p.type === 'k' && p.color === 'b')!.square;
    const wk = t.board().flat().find((p) => p && p.type === 'k' && p.color === 'w')!.square;
    const kingGap = Math.max(Math.abs(bk.charCodeAt(0) - wk.charCodeAt(0)), Math.abs(+bk[1] - +wk[1]));
    const key = [seen.has(t.fen().split(' ').slice(0, 2).join(' ')) ? 1 : 0, g.boxAfter, kingGap];
    if (key[0] < bestKey[0] || (key[0] === bestKey[0] && (key[1] < bestKey[1] || (key[1] === bestKey[1] && key[2] < bestKey[2])))) {
      best = u;
      bestKey = key;
    }
  }
  return best;
}

describe('with the real engine', () => {
  const engine = createNodeEngine();
  const evalPos = makeEvaluator(engine);
  beforeAll(async () => {
    await engine.boot();
  });

  for (const kind of ['kq', 'rr'] as TechniqueKind[]) {
    it(`${kind}: a student who only follows the box rule mates the engine's best defence from random starts`, async () => {
      const rng = lcg(kind.charCodeAt(1) * 11);
      for (let game = 0; game < 3; game++) {
        const c = new Chess(randomStart(kind, rng));
        const seen = new Set<string>();
        let moves = 0;
        while (!c.isGameOver() && moves < 45) {
          moves++;
          const u = greedy(c.fen(), seen);
          expect(u, c.fen()).toBeTruthy();
          uciMove(c, u);
          seen.add(c.fen().split(' ').slice(0, 2).join(' '));
          if (c.isGameOver()) break;
          const reply = await evalPos(c.fen(), 8);
          uciMove(c, reply.best as string);
        }
        expect(c.isCheckmate(), `${kind} game ${game} after ${moves} moves`).toBe(true);
      }
    }, 240_000);
  }

  it('the engine itself, as the student, never stalemates or hangs a piece, and mostly shrinks the box', async () => {
    const rng = lcg(3);
    let tight = 0;
    let total = 0;
    for (const kind of ['kq', 'kr', 'rr'] as TechniqueKind[]) {
      const c = new Chess(randomStart(kind, rng));
      let moves = 0;
      while (!c.isGameOver() && moves < 40) {
        moves++;
        const before = c.fen();
        const e0 = await evalPos(before, 12);
        uciMove(c, e0.best as string);
        const g = gradeMove(before, c.fen());
        expect(['stalemate', 'lost-win']).not.toContain(g.verdict);
        total++;
        if (['tighten', 'progress', 'mate'].includes(g.verdict)) tight++;
        if (c.isGameOver()) break;
        uciMove(c, (await evalPos(c.fen(), 8)).best as string);
      }
      expect(c.isCheckmate(), kind).toBe(true);
    }
    expect(tight / total).toBeGreaterThan(0.5);
  }, 240_000);
});
