// The plain-English explainer, checked against the real engine on positions where the right answer is known.
import { afterAll, describe, expect, it } from 'vitest';
import { Chess } from '@/chess/compat';
import { reviewMoves } from '@/review/classify';
import { evalWords, explainMove, sanLine, type Explanation } from '@/review/explain';
import { analyzePositions } from '@/review/runReview';
import { hasNativeEngine, makeNativeEngine } from './helpers/nativeEngine';

const engine = hasNativeEngine ? makeNativeEngine(4, 256) : null;
afterAll(() => engine?.requestRestart());

const SETTINGS = { depth: 16, movetimeMs: 2500, multipv: 3 };

async function explainOne(fen: string, uci: string, userColor: 'w' | 'b' | null = null): Promise<{ ex: Explanation; cls: string }> {
  const positions = await analyzePositions(fen, [uci], engine!, SETTINGS);
  const [m] = reviewMoves(fen, [uci], positions);
  const ex = explainMove({ fenBefore: fen, move: m, before: positions[0], after: positions[1], userColor });
  expect(ex).not.toBeNull();
  if (process.env.SHOW_EXPLAIN) {
    const text = [`[${m.cls}] ${m.san} tags=${ex!.tags.join(',')}`, `  ${ex!.headline}`, ...ex!.what.map((w) => `  - ${w}`), `  BETTER: ${ex!.better}`, `  LESSON: ${ex!.lesson}`];
    process.stdout.write('\n' + text.join('\n') + '\n');
  }
  return { ex: ex!, cls: m.cls };
}

describe('helpers', () => {
  it('numbers a line of moves', () => {
    const c = new Chess();
    expect(sanLine(c.fen(), ['e2e4', 'e7e5', 'g1f3'])).toBe('1.e4 e5 2.Nf3');
    c.move('e4');
    expect(sanLine(c.fen(), ['e7e5', 'g1f3'])).toBe('1...e5 2.Nf3');
  });
  it('describes evaluations in words', () => {
    expect(evalWords(0.5)).toBe('roughly equal');
    expect(evalWords(0.95)).toBe('winning');
    expect(evalWords(0.05)).toBe('losing');
  });
});

describe.skipIf(!hasNativeEngine)('explanations (real engine)', () => {
  it('a piece moved onto an attacked, unprotected square', async () => {
    const { ex, cls } = await explainOne('r1bqk2r/1ppp1ppp/p1n2n2/4p3/4P3/2N2N2/PPPP1PPP/R1BQK2R w KQkq - 0 1', 'c3b5', 'w');
    expect(['blunder', 'mistake']).toContain(cls);
    expect(ex.tags).toContain('hung-piece');
    expect(ex.what.join(' ')).toMatch(/pawn on a6/);
    expect(ex.what.join(' ')).toMatch(/Nothing of yours protects/);
  }, 60_000);

  it('a missed checkmate in one', async () => {
    const { ex } = await explainOne('6k1/5ppp/8/8/8/8/5PPP/R5K1 w - - 0 1', 'a1b1', 'w');
    expect(ex.tags).toContain('missed-mate');
    expect(ex.what[0]).toMatch(/checkmate in one: Ra8#/);
  }, 60_000);

  it('a move that allows checkmate', async () => {
    const fen = 'r1bqkbnr/pppp1ppp/2n5/4p2Q/2B1P3/8/PPPP1PPP/RNB1K1NR b KQkq - 3 3';
    const { ex } = await explainOne(fen, 'g8f6', 'b');
    // 3...Nf6?? is met by Qxf7#
    expect(ex.tags).toContain('allowed-mate');
    expect(ex.what[0]).toMatch(/Qxf7#/);
  }, 60_000);

  it('an ignored threat to a piece', async () => {
    const { ex } = await explainOne('r1bqkb1r/p1pp1ppp/2n2n2/1p2p3/2B1P3/2N2N2/PPPP1PPP/R1BQK2R w KQkq - 0 1', 'e1g1', 'w');
    expect(ex.tags).toContain('ignored-threat');
    expect(ex.what.join(' ')).toMatch(/already under attack/);
  }, 60_000);

  it('a missed free piece', async () => {
    const { ex } = await explainOne('r3k2r/ppp2ppp/8/3q4/8/8/PPP2PPP/R2QK2R w KQkq - 0 1', 'e1g1', 'w');
    expect(ex.tags).toContain('missed-free-piece');
    expect(ex.what.join(' ')).toMatch(/not protected by anything/);
  }, 60_000);

  it('moving the defender leaves a piece hanging', async () => {
    const { ex } = await explainOne('4k3/pppp1ppp/8/4b3/3N4/8/PPP2PPP/3RK3 w - - 0 1', 'd1c1', 'w');
    expect(ex.tags[0]).toMatch(/left-piece-hanging|ignored-threat|hung-piece/);
  }, 60_000);

  it('a knight fork is named as a fork', async () => {
    const { ex } = await explainOne('6k1/pppp1ppp/8/8/1n6/8/P3P1PP/Q3K3 w - - 0 1', 'e2e3', 'w');
    expect(ex.tags[0]).toBe('allowed-fork');
    expect(ex.what.join(' ')).toMatch(/at the same time/);
  }, 60_000);

  it('a good move gets a positive line, never a complaint', async () => {
    const { ex, cls } = await explainOne('6k1/5ppp/8/8/8/8/5PPP/R5K1 w - - 0 1', 'a1a8', 'w');
    expect(['best', 'brilliant', 'great']).toContain(cls);
    expect(ex.better).toBeUndefined();
    expect(ex.what.join(' ')).toMatch(/is checkmate/i);
  }, 60_000);
});
