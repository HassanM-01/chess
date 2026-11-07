// The Play page's engine-free logic: computer strengths, the heads-up scan, game results, goals and tallies.
import { describe, expect, it } from 'vitest';
import { Chess } from '@/chess/compat';
import { PLAY_LEVELS, countMoves, countsText, endOf, goalResult, headsUp, shouldWarn } from '@/review/playCoach';

describe('computer strengths', () => {
  it('get stronger level by level', () => {
    for (let i = 1; i < PLAY_LEVELS.length; i++) {
      expect(PLAY_LEVELS[i].skill).toBeGreaterThanOrEqual(PLAY_LEVELS[i - 1].skill);
      expect(PLAY_LEVELS[i].rand).toBeLessThanOrEqual(PLAY_LEVELS[i - 1].rand);
      expect(PLAY_LEVELS[i].depth).toBeGreaterThanOrEqual(PLAY_LEVELS[i - 1].depth);
    }
    expect(PLAY_LEVELS[0].rand).toBeGreaterThan(0.3); // a complete beginner can win
    expect(PLAY_LEVELS[PLAY_LEVELS.length - 1]).toMatchObject({ skill: 20, rand: 0 });
  });
});

describe('when Blunder Check stops you', () => {
  it('stops on mistakes, misses and blunders, and on inaccuracies only in strict mode', () => {
    for (const c of ['mistake', 'miss', 'blunder'] as const) expect(shouldWarn(c, false)).toBe(true);
    expect(shouldWarn('inaccuracy', false)).toBe(false);
    expect(shouldWarn('inaccuracy', true)).toBe(true);
    for (const c of ['best', 'excellent', 'good', 'great', 'brilliant', 'book', 'forced'] as const) expect(shouldWarn(c, true)).toBe(false);
  });
});

describe('heads-up', () => {
  it('warns about a piece that can be taken for free', () => {
    const h = headsUp('4k3/8/8/3p4/4N3/8/8/4K3 w - - 0 1', 'w');
    expect(h.dangers.map((d) => d.square)).toContain('e4');
    expect(h.dangers[0].text).toMatch(/knight on e4/);
    expect(h.dangers[0].text).toMatch(/nothing protects it/);
  });
  it('points out a piece of theirs you can win', () => {
    const h = headsUp('4k3/8/8/8/3b4/8/8/3RK3 w - - 0 1', 'w');
    expect(h.dangers).toHaveLength(0);
    expect(h.chances.map((c) => c.square)).toContain('d4');
    expect(h.chances[0].text).toMatch(/bishop on d4/);
  });
  it('spots a checkmate in one for you', () => {
    const h = headsUp('r1bqkbnr/pppp1ppp/2n5/4p2Q/2B1P3/8/PPPP1PPP/RNB1K1NR w KQkq - 0 1', 'w');
    expect(h.chances.some((c) => /checkmate with Qxf7#/.test(c.text))).toBe(true);
  });
  it('spots a checkmate they threaten', () => {
    const h = headsUp('r1bqkbnr/pppp1ppp/2n5/4p2Q/2B1P3/8/PPPP1PPP/RNB1K1NR b KQkq - 3 3', 'b');
    expect(h.dangers.some((d) => /checkmate you/.test(d.text))).toBe(true);
  });
  it('says so when you are in check', () => {
    const h = headsUp('4k3/8/8/8/8/8/4r3/4K3 w - - 0 1', 'w');
    expect(h.check).toBe(true);
    expect(h.dangers[0].text).toMatch(/in check/);
  });
  it('has nothing to say on the opening position, or when it is not your turn', () => {
    const start = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
    expect(headsUp(start, 'w')).toEqual({ check: false, dangers: [], chances: [] });
    expect(headsUp(start, 'b')).toEqual({ check: false, dangers: [], chances: [] });
    expect(headsUp('garbage', 'w')).toEqual({ check: false, dangers: [], chances: [] });
  });
});

describe('how a game ended', () => {
  it('checkmate: you win or lose depending on your colour', () => {
    const c = new Chess('rnb1kbnr/pppp1ppp/8/4p3/6Pq/5P2/PPPPP2P/RNBQKBNR w KQkq - 1 3');
    expect(endOf(c, 'b')).toEqual({ result: '0-1', outcome: 'win', title: 'Checkmate! You win!' });
    expect(endOf(c, 'w')).toMatchObject({ result: '0-1', outcome: 'loss', title: 'Checkmated.' });
  });
  it('stalemate and dead positions are draws, with a reason', () => {
    expect(endOf(new Chess('7k/5Q2/6K1/8/8/8/8/8 b - - 0 1'), 'w')).toMatchObject({ result: '1/2-1/2', outcome: 'draw' });
    expect(endOf(new Chess('7k/5Q2/6K1/8/8/8/8/8 b - - 0 1'), 'w')?.title).toMatch(/Stalemate/);
    expect(endOf(new Chess('8/8/8/4k3/8/8/8/4K3 w - - 0 1'), 'w')?.title).toMatch(/enough pieces/);
  });
  it('is null while the game goes on', () => {
    expect(endOf(new Chess(), 'w')).toBeNull();
  });
});

describe('did you meet the goal', () => {
  it('a winning position must be won', () => {
    expect(goalResult('win', 'win').met).toBe(true);
    expect(goalResult('win', 'draw').met).toBe(false);
    expect(goalResult('win', 'loss').met).toBe(false);
  });
  it('a position to hold only has to not be lost', () => {
    expect(goalResult('draw', 'draw').met).toBe(true);
    expect(goalResult('draw', 'win').met).toBe(true);
    expect(goalResult('draw', 'loss').met).toBe(false);
  });
  it('free play only fails on a loss', () => {
    expect(goalResult('play', 'draw').met).toBe(true);
    expect(goalResult('play', 'loss').met).toBe(false);
  });
});

describe('tally of your moves', () => {
  it('groups classes and reads naturally', () => {
    const n = countMoves(['best', 'good', 'book', 'inaccuracy', 'mistake', 'miss', 'blunder', 'great']);
    expect(n).toEqual({ total: 8, good: 4, inaccuracies: 1, mistakes: 2, blunders: 1 });
    expect(countsText(n)).toBe('8 moves checked: 4 good, 1 inaccurate, 2 mistakes, 1 blunder.');
    expect(countsText(countMoves(['best']))).toBe('1 move checked: 1 good.');
    expect(countsText(countMoves([]))).toBe('No moves checked yet.');
  });
});
