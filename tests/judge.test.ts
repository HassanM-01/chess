// Judging a move someone tries, and describing positions and moves in words, with the real engine.
import { afterAll, describe, expect, it } from 'vitest';
import { judgeMove } from '@/review/judge';
import { bestMoveSteps, moveInWords, moveSteps, situationWords, walkthrough } from '@/review/words';
import { analyzePositions } from '@/review/runReview';
import { reviewMoves } from '@/review/classify';
import { hasNativeEngine, makeNativeEngine } from './helpers/nativeEngine';

const engine = hasNativeEngine ? makeNativeEngine(4, 256) : null;
afterAll(() => engine?.requestRestart());

describe('moves in words', () => {
  const FEN = 'r1bqkbnr/pppp1ppp/2n5/4p2Q/2B1P3/8/PPPP1PPP/RNB1K1NR w KQkq - 0 1';
  it('describes captures, checks, mates and castling without notation', () => {
    expect(moveInWords(FEN, 'h5f7', 'You')).toBe('You take the pawn on f7 with the queen from h5. That is checkmate, the game is over!');
    expect(moveInWords(FEN, 'c4f7', 'White')).toMatch(/^White takes the pawn on f7 with the bishop from c4\. That is check/);
    expect(moveInWords(FEN, 'b1c3', 'They')).toBe('They move the knight from b1 to c3.');
    expect(moveInWords('r3k2r/8/8/8/8/8/8/R3K2R w KQkq - 0 1', 'e1g1', 'You')).toMatch(/castle kingside/);
  });
  it('walks through a line with You / They', () => {
    const w = walkthrough('rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1', ['e2e4', 'e7e5', 'g1f3'], 'w');
    expect(w).toEqual(['You move the pawn from e2 to e4.', 'They move the pawn from e7 to e5.', 'You move the knight from g1 to f3.']);
  });
  it('describes the board: material and pieces that can be taken', () => {
    const s = situationWords('4k3/8/8/3p4/4N3/8/8/4K3 w - - 0 1', 'w').join(' ');
    expect(s).toMatch(/You have 1 knight \(3 points\)\. They have 1 pawn \(1 points\)/);
    expect(s).toMatch(/Your knight on e4 is attacked by their pawn on d5 and nothing protects it/);
  });
});

describe.skipIf(!hasNativeEngine)('judging tried moves (real engine)', () => {
  // Scholar's mate set-up: after 3.Bc4 Black has many fine moves, and one terrible one.
  const FEN = 'r1bqkbnr/pppp1ppp/2n5/4p2Q/2B1P3/8/PPPP1PPP/RNB1K1NR b KQkq - 3 3';

  it('accepts a different move that is also good, and says so', async () => {
    const j = await judgeMove(engine!, FEN, 'g7g6', { depth: 16, movetimeMs: 1500 });
    expect(j?.good).toBe(true);
  }, 60_000);

  it('rejects a bad move and explains why', async () => {
    const j = await judgeMove(engine!, FEN, 'g8f6', { depth: 16, movetimeMs: 1500 });
    expect(j?.good).toBe(false);
    expect(j?.explanation?.what.join(' ')).toMatch(/Qxf7#/);
  }, 60_000);

  it('rejects an illegal move', async () => {
    expect(await judgeMove(engine!, FEN, 'a1a8')).toBeNull();
  }, 30_000);

  it('builds baby-step breakdowns for a best move and for a mistake', async () => {
    const before = await analyzePositions(FEN, [], engine!, { depth: 16, movetimeMs: 1500, multipv: 2 });
    const steps = bestMoveSteps(FEN, before[0]);
    expect(steps.map((s) => s.title.slice(0, 2))).toEqual(['1.', '2.', '3.', '4.']);
    expect(steps[0].lines.join(' ')).toMatch(/You have .* points/);

    const positions = await analyzePositions(FEN, ['g8f6'], engine!, { depth: 16, movetimeMs: 1500, multipv: 3 });
    const [m] = reviewMoves(FEN, ['g8f6'], positions);
    const ms = moveSteps({ fenBefore: FEN, move: m, before: positions[0], after: positions[1], userColor: 'b' });
    const text = ms.map((s) => s.lines.join(' ')).join(' ');
    expect(text).toMatch(/They take the pawn on f7 with the queen from h5\. That is checkmate/);
    expect(ms.at(-1)?.title).toMatch(/rule to remember/);
    if (process.env.SHOW_STEPS) {
      const all = [...steps, { title: '--- a mistake ---', lines: [] as string[] }, ...ms];
      process.stdout.write('\n' + all.map((st) => [st.title, ...st.lines.map((l) => '   ' + l)].join('\n')).join('\n') + '\n');
    }
  }, 60_000);
});
