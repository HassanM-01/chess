// Phase 6 acceptance: the London coach (real Stockfish).
import { beforeAll, describe, expect, it } from 'vitest';
import { Chess, uciMove } from '@/chess/compat';
import { makeEvaluator } from '@/engine/evalPos';
import { londonAdvice, type Advice } from '@/features/london/advice';
import { LONDON_STEPS } from '@/features/london/steps';
import { parseFen } from '@/chess/tactics';
import { createNodeEngine } from './helpers/nodeEngine';

const engine = createNodeEngine();
const evalPos = makeEvaluator(engine);
beforeAll(async () => {
  await engine.boot();
});

async function adviceAfter(moves: string): Promise<Advice> {
  const c = new Chess();
  for (const u of moves.split(' ').filter(Boolean)) uciMove(c, u);
  const hist = c.history({ verbose: true });
  return londonAdvice(c.fen(), evalPos, { lastMove: hist.length ? hist[hist.length - 1] : null });
}

describe('London coach', () => {
  it('1.d4 d5 2.Bf4 Nc6 3.e3 e5: deals with the attacked bishop or takes the pawn, not Nf3 (spec phase 6)', async () => {
    const a = await adviceAfter('d2d4 d7d5 c1f4 b8c6 e2e3 e7e5');
    expect(a.uci).toBeTruthy();
    expect(a.uci).not.toBe('g1f3');
    expect(a.kind).toBe('answer');
    expect(a.title).toBe('A pawn is attacking your bishop');
    expect(a.text).toContain('A pawn is attacking your bishop. Move it or take the pawn first.');
    const fromF4 = (a.uci as string).startsWith('f4');
    const takesPawn = (a.uci as string).slice(2, 4) === 'e5';
    expect(fromF4 || takesPawn, `advice was ${a.uci}`).toBe(true);
  });

  it('...g5 attacking the bishop triggers the same rule', async () => {
    const a = await adviceAfter('d2d4 d7d5 c1f4 g7g5');
    expect(a.kind).toBe('answer');
    expect(a.title).toBe('A pawn is attacking your bishop');
    expect((a.uci as string).startsWith('f4') || (a.uci as string).slice(2, 4) === 'g5').toBe(true);
  });

  it('after the opponent captures, "Recapture first" outranks the next setup move', async () => {
    // 1.d4 d5 2.Bf4 c5 3.e3 Nc6 4.Nf3 cxd4 5.c3 dxc3 : the user's real game lost a rook by ignoring this
    const a = await adviceAfter('d2d4 d7d5 c1f4 c7c5 e2e3 b8c6 g1f3 c5d4 c2c3 d4c3');
    expect(a.kind).toBe('recapture');
    expect(['b2c3', 'b1c3']).toContain(a.uci);
    expect(a.title.startsWith('Recapture first')).toBe(true);
    expect(a.text).toContain('They just took your pawn on c3');
  });

  it('opens with the setup in the right order: d4, then Bf4 before e3', async () => {
    const first = await adviceAfter('');
    expect(first.kind).toBe('setup');
    expect(first.step).toBe('d4');
    const second = await adviceAfter('d2d4 d7d5');
    expect(second.kind).toBe('setup');
    expect(second.step).toBe('Bf4');
    expect(second.uci).toBe('c1f4');
  });

  it('setup chips are decided by board state, not move history', () => {
    const c = new Chess();
    for (const u of ['d2d4', 'd7d5', 'c1f4']) uciMove(c, u);
    const b = parseFen(c.fen());
    expect(LONDON_STEPS.filter((s) => s.done(b)).map((s) => s.san)).toEqual(['d4', 'Bf4']);
  });

  it('answers ...Qb6 against b2 with Qb3, Qc1 or b3', async () => {
    const a = await adviceAfter('d2d4 d7d5 c1f4 c7c5 e2e3 b8c6 c2c3 d8b6');
    expect(a.kind).toBe('answer');
    expect(['d1b3', 'd1c1', 'b2b3', 'd1c2']).toContain(a.uci);
  });
});
