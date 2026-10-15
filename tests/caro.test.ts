// The Caro-Kann coach and the bot's White plans (real Stockfish).
import { beforeAll, describe, expect, it } from 'vitest';
import { Chess, uciMove } from '@/chess/compat';
import { parseFen } from '@/chess/tactics';
import { OPENINGS } from '@/content/openings';
import { makeEvaluator } from '@/engine/evalPos';
import { caroAdvice } from '@/features/caro/advice';
import { CARO_PLANS, CARO_STEPS } from '@/features/caro/steps';
import type { Advice } from '@/features/london/advice';
import { createNodeEngine } from './helpers/nodeEngine';

const engine = createNodeEngine();
const evalPos = makeEvaluator(engine);
beforeAll(async () => {
  await engine.boot();
});

async function adviceAfter(moves: string): Promise<Advice> {
  const c = new Chess();
  for (const u of moves.split(' ').filter(Boolean)) expect(uciMove(c, u), `${u} legal`).toBeTruthy();
  const hist = c.history({ verbose: true });
  return caroAdvice(c.fen(), evalPos, { lastMove: hist.length ? hist[hist.length - 1] : null });
}

const ADV = 'e2e4 c7c6 d2d4 d7d5 e4e5';

describe('Caro-Kann coach', () => {
  it('opens the setup in order: ...c6, then ...d5', async () => {
    const first = await adviceAfter('e2e4');
    expect(first.kind).toBe('setup');
    expect(first.step).toBe('c6');
    expect(first.uci).toBe('c7c6');
    const second = await adviceAfter('e2e4 c7c6 d2d4');
    expect(second.step).toBe('d5');
    expect(second.uci).toBe('d7d5');
  });

  it('after 3.e5 the bishop comes out before ...e6', async () => {
    const a = await adviceAfter(ADV);
    expect(a.kind).toBe('setup');
    expect(a.step).toBe('Bf5');
    expect(a.uci).toBe('c8f5');
    expect(a.text).toContain('BEFORE');
  });

  it('g4 attacking the bishop: moves it or takes the pawn, and does not carry on with the setup', async () => {
    const a = await adviceAfter(`${ADV} c8f5 g2g4`);
    expect(a.kind).toBe('answer');
    expect(a.title).toBe('A pawn is attacking your bishop');
    expect(a.text).toContain('Move it or take the pawn first.');
    expect((a.uci as string).startsWith('f5') || (a.uci as string).slice(2, 4) === 'g4').toBe(true);
    expect(a.uci).not.toBe('e7e6');
  });

  it('a knight hunting the bishop is answered with a retreat', async () => {
    // 1.e4 c6 2.Nc3 d5 3.Nf3 dxe4 4.Nxe4 Bf5 5.Ng3
    const a = await adviceAfter('e2e4 c7c6 b1c3 d7d5 g1f3 d5e4 c3e4 c8f5 e4g3');
    expect(a.kind).toBe('answer');
    expect(a.title).toBe('The knight is hunting your bishop');
    expect((a.uci as string).startsWith('f5')).toBe(true);
  });

  it('against the Advance, once the bishop is out and ...e6 is in, the plan is ...c5', async () => {
    const a = await adviceAfter(`${ADV} c8f5 g1f3 e7e6 f1e2`);
    expect(a.kind).toBe('plan');
    expect(a.uci).toBe('c6c5');
    expect(a.title).toContain('...c5');
  });

  it('defends b7 against Qb3 in the Exchange', async () => {
    const a = await adviceAfter('e2e4 c7c6 d2d4 d7d5 e4d5 c6d5 f1d3 b8c6 c2c3 g8f6 c1f4 c8g4 d1b3');
    expect(a.kind).toBe('answer');
    expect(a.title).toBe('White is going after your b7 pawn');
    expect(['d8d7', 'd8b6', 'd8c7', 'b7b6']).toContain(a.uci);
  });

  it('adds a defender when the d5 pawn is attacked more often than it is defended (Panov)', async () => {
    const a = await adviceAfter('e2e4 c7c6 d2d4 d7d5 e4d5 c6d5 c2c4 b8c6 b1c3');
    expect(a.kind).toBe('answer');
    expect(a.title).toBe('Your d5 pawn needs another defender');
    expect(['g8f6', 'e7e6', 'd8d7', 'd8b6']).toContain(a.uci);
  });

  it('after White captures, "Recapture first" outranks the next setup move', async () => {
    const a = await adviceAfter('e2e4 c7c6 d2d4 d7d5 e4d5');
    expect(a.kind).toBe('recapture');
    expect(['c6d5', 'd8d5']).toContain(a.uci);
    expect(a.title.startsWith('Recapture first')).toBe(true);
    expect(a.text).toContain('They just took your pawn on d5');
  });

  it('finds a mate for Black', async () => {
    // 1.f3 e5 2.g4 Qh4#
    const a = await adviceAfter('f2f3 e7e5 g2g4');
    expect(a.kind).toBe('tactic');
    expect(a.uci).toBe('d8h4');
    expect(a.text).toContain('checkmate');
  });

  it('setup chips are decided by board state, and ...Bf5 does not apply in the Panov', () => {
    const c = new Chess();
    for (const u of ['e2e4', 'c7c6', 'd2d4', 'd7d5', 'e4e5', 'c8f5']) uciMove(c, u);
    expect(CARO_STEPS.filter((s) => s.done(parseFen(c.fen()))).map((s) => s.san)).toEqual(['c6', 'd5', 'Bf5']);
    const p = new Chess();
    for (const u of ['e2e4', 'c7c6', 'd2d4', 'd7d5', 'e4d5', 'c6d5', 'c2c4']) uciMove(p, u);
    expect(CARO_STEPS.find((s) => s.san === 'Bf5')!.done(parseFen(p.fen()))).toBe(true);
  });
});

describe('the bot plays real theory as White', () => {
  // Follow each plan against the trainer line's Black moves (ignoring evals): the bot's first moves match the line.
  const PAIRS: [string, number, number][] = [
    ['Advance (3.e5)', 0, 5],
    ['Classical (3.Nc3)', 1, 9],
    ['Exchange (3.exd5)', 2, 6],
    ['Panov-Botvinnik (4.c4)', 3, 9],
    ['Two Knights (2.Nf3)', 4, 6],
    ['Fantasy (3.f3)', 5, 6],
  ];
  for (const [name, li, n] of PAIRS) {
    it(`${name}: the plan's first ${n} moves are the trainer line's White moves`, () => {
      const plan = CARO_PLANS.find((p) => p.name === name)!;
      const line = OPENINGS.caro.lines[li].moves.map((m) => m[0]);
      const c = new Chess();
      const used: string[] = [];
      for (let ply = 0; ply < line.length && used.length < n; ply++) {
        if (c.turn() === 'w') {
          const s = plan.moves.filter((x) => !used.includes(x)).slice(0, 2).find((x) => c.moves().some((m) => m.replace(/[+#]/g, '') === x));
          expect(s, `${name}: plan move at ply ${ply}`).toBeTruthy();
          expect(s).toBe(line[ply].replace(/[+#]/g, ''));
          used.push(s!);
        }
        expect(c.move(line[ply]), `${name}: ${line[ply]}`).toBeTruthy();
      }
      expect(used.length).toBe(n);
    });
  }

  it('every plan is a sequence of legal-looking SAN with no duplicates', () => {
    for (const p of CARO_PLANS) {
      expect(new Set(p.moves).size, p.name).toBe(p.moves.length);
      expect(p.moves[0]).toBe('e4');
    }
  });
});
