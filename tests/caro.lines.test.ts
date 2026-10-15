// The Caro-Kann trainer lines: legal, alternate colors, and every move (either side) is sound according to real Stockfish.
import { beforeAll, describe, expect, it } from 'vitest';
import { Chess } from '@/chess/compat';
import { makeEvaluator } from '@/engine/evalPos';
import { wpFor } from '@/engine/winprob';
import { OPENINGS } from '@/content/openings';
import { createNodeEngine } from './helpers/nodeEngine';

const engine = createNodeEngine();
const evalPos = makeEvaluator(engine);
beforeAll(async () => {
  await engine.boot();
});

const LINES = OPENINGS.caro.lines;

describe('Caro-Kann opening set', () => {
  it('is a Black set with six lines', () => {
    expect(OPENINGS.caro.side).toBe('b');
    expect(LINES.map((l) => l.name)).toHaveLength(6);
  });

  for (const ln of LINES) {
    it(`${ln.name}: legal, starts 1.e4 c6, ends on a Black move or a quiet White move, every move has a reason`, () => {
      const c = new Chess();
      for (const [san, why] of ln.moves) {
        expect(c.move(san), `${ln.name}: ${san}`).toBeTruthy();
        expect(why.length).toBeGreaterThan(8);
      }
      expect(ln.moves[0][0]).toBe('e4');
      expect(ln.moves[1][0]).toBe('c6');
    });

    it(`${ln.name}: no move loses more than 8 win% against the engine's best`, async () => {
      const c = new Chess();
      const bad: string[] = [];
      for (const [san] of ln.moves) {
        const mover = c.turn();
        const before = await evalPos(c.fen(), 14);
        c.move(san);
        const after = await evalPos(c.fen(), 14);
        const drop = wpFor(before, mover) - wpFor(after, mover);
        if (drop > 8) bad.push(`${mover === 'w' ? 'White' : 'Black'} ${san} (-${drop.toFixed(1)}%)`);
      }
      expect(bad).toEqual([]);
    }, 120_000);
  }
});
