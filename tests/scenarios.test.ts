// The practice positions for the Play page: legal, labelled correctly, and (with the real engine) really a win / a draw / balanced.
import { afterAll, describe, expect, it } from 'vitest';
import { Chess } from '@/chess/compat';
import { ENDGAMES, MIDDLEGAMES, OPENING_CHOICES, SCENARIOS, drillFens, scenarioById, without } from '@/review/scenarios';
import { hasNativeEngine, makeNativeEngine } from './helpers/nativeEngine';

describe('practice positions', () => {
  it('have unique ids and legal start positions that are not over', () => {
    expect(new Set(SCENARIOS.map((s) => s.id)).size).toBe(SCENARIOS.length);
    for (const s of SCENARIOS) {
      const c = new Chess(s.fen);
      expect(c.isGameOver(), s.id).toBe(false);
      expect(c.moves().length, s.id).toBeGreaterThan(0);
    }
  });
  it('middlegames are about equal at the start of a tense game and have a side to play', () => {
    expect(MIDDLEGAMES.length).toBeGreaterThanOrEqual(8);
    for (const s of MIDDLEGAMES) {
      // the middlegame list never puts you on move without pieces
      expect(new Chess(s.fen).fen().split(' ')[0].replace(/[0-9/]/g, '').length, s.id).toBeGreaterThan(8);
      expect(s.tips.length, s.id).toBeGreaterThanOrEqual(2);
    }
  });
  it('endgames have a clear goal and tips', () => {
    expect(ENDGAMES.length).toBeGreaterThanOrEqual(8);
    for (const s of ENDGAMES) {
      expect(['win', 'draw']).toContain(s.goal);
      expect(s.tips.length).toBeGreaterThanOrEqual(2);
    }
  });
  it('can be looked up by id, and removing pieces gives a legal position', () => {
    expect(scenarioById('eg-lucena')?.title).toMatch(/Lucena/);
    expect(scenarioById('nope')).toBeUndefined();
    const f = without('rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1', ['b8']);
    expect(f).toContain('r1bqkbnr');
  });
});

describe('opening drills', () => {
  it('every line is legal and the player moves are on the right colour', () => {
    expect(OPENING_CHOICES.length).toBeGreaterThanOrEqual(5);
    for (const o of OPENING_CHOICES) {
      expect(o.lines.length, o.key).toBeGreaterThan(0);
      for (const d of o.lines) {
        const fens = drillFens(d);
        expect(fens, d.id).not.toBeNull();
        expect(fens!.length).toBe(d.moves.length + 1);
        d.moves.forEach((m, i) => expect(m.by, `${d.id} ply ${i}`).toBe(i % 2 === 0 ? 'w' : 'b'));
        // you get to make at least a few moves yourself
        expect(d.moves.filter((m) => m.by === d.side).length, d.id).toBeGreaterThanOrEqual(3);
        d.moves.forEach((m) => expect(m.why.length, d.id).toBeGreaterThan(0));
      }
    }
  });
});

const engine = hasNativeEngine ? makeNativeEngine(4, 256) : null;
afterAll(() => engine?.requestRestart());

describe.skipIf(!hasNativeEngine)('Stockfish agrees with the label on every practice position', () => {
  for (const s of SCENARIOS) {
    it(`${s.id}: ${s.title}`, async () => {
      const e = await engine!.run(s.fen, { depth: s.kind === 'endgame' ? 24 : 20, movetimeMs: 9000, priority: 'interactive' });
      // from the point of view of the side you play
      const white = e.mateWhite != null ? (e.mateWhite > 0 ? 100000 : -100000) : e.cpWhite;
      const mine = s.side === 'w' ? white : -white;
      if (s.expect.min != null) expect(mine, `${s.id} score ${mine}`).toBeGreaterThanOrEqual(s.expect.min);
      if (s.expect.max != null) expect(mine, `${s.id} score ${mine}`).toBeLessThanOrEqual(s.expect.max);
    }, 60_000);
  }
});
