import { describe, expect, it } from 'vitest';
import { computeSkillProfile, describeTrend, recencyWeight, type SkillInput } from '@/skill/computeSkillProfile';
import { LEITNER_DAYS, nextSchedule, updateThemeRating } from '@/skill/leitner';
import { pickPuzzles, weightedPick } from '@/skill/pickPuzzles';
import { createMemoryRepo } from '@/db/memoryRepo';
import { bundledPuzzles } from './helpers/fixtures';

const NOW = new Date('2026-10-05T12:00:00Z');
const daysAgo = (d: number): string => new Date(NOW.getTime() - d * 86_400_000).toISOString();

type M = SkillInput['mistakes'][number];
const mk = (gameId: string, category: M['category'], severity: M['severity'], d: number, piece: M['piece'] = null, phase: M['phase'] = 'middlegame'): M => ({
  gameId,
  category,
  severity,
  phase,
  piece,
  playedAt: daysAgo(d),
  createdAt: daysAgo(d),
});
const game = (id: string, d: number, outcome: 'w' | 'l' | 'd' = 'l'): SkillInput['games'][number] => ({ id, outcome, playedAt: daysAgo(d), createdAt: daysAgo(d) });
const summary = (gameId: string, o: Partial<SkillInput['summaries'][number]['summary']> = {}): SkillInput['summaries'][number] => ({
  gameId,
  summary: { castled_move: 8, early_queen: false, eval_after_10: 50, how_ended: 'checkmate', outcome: 'l', counts: { best: 0, good: 0, inacc: 0, mistake: 0, blunder: 0 }, ...o },
});

describe('computeSkillProfile', () => {
  it('weights blunders above mistakes and recent above old (14-day half-life)', () => {
    expect(recencyWeight(14)).toBeCloseTo(0.5);
    expect(recencyWeight(28)).toBeCloseTo(0.25);
    const p = computeSkillProfile({
      now: NOW,
      games: [game('a', 1), game('b', 40)],
      summaries: [summary('a'), summary('b')],
      attempts: [],
      mistakes: [mk('a', 'fork', 'blunder', 1), mk('b', 'hung', 'blunder', 40), mk('b', 'hung', 'blunder', 40)],
    });
    // fork: 1.0 * ~0.95 ; hung: 2 * 1.0 * 0.14 -> fork ranks above hung even though hung happened twice
    expect(p.weaknesses[0].key).toBe('fork');
    expect(p.weaknesses[1].key).toBe('hung');
    const hung = p.weaknesses.find((w) => w.key === 'hung');
    expect(hung?.count).toBe(2);
    expect(hung?.games).toBe(1);
    const mistakeOnly = computeSkillProfile({ now: NOW, games: [game('a', 1)], summaries: [summary('a')], attempts: [], mistakes: [mk('a', 'fork', 'mistake', 0)] });
    expect(mistakeOnly.weaknesses[0].score).toBeCloseTo(0.6);
  });

  it('divides by games analyzed and computes record, phases, blunders per game and how losses ended', () => {
    const p = computeSkillProfile({
      now: NOW,
      games: [game('a', 1, 'l'), game('b', 2, 'w'), game('c', 3, 'l'), game('d', 4, 'd')],
      summaries: [summary('a', { how_ended: 'checkmate' }), summary('b'), summary('c', { how_ended: 'time' }), summary('d')],
      attempts: [],
      mistakes: [mk('a', 'hung', 'blunder', 1, 'q', 'opening'), mk('c', 'hung', 'mistake', 3, 'q', 'endgame'), mk('c', 'fork', 'blunder', 3, 'n', 'middlegame')],
    });
    expect(p.record).toEqual({ w: 1, l: 2, d: 1 });
    expect(p.gamesAnalyzed).toBe(4);
    expect(p.phases).toEqual({ opening: 1, middlegame: 1, endgame: 1 });
    expect(p.blundersPerGame).toBeCloseTo(0.5);
    expect(p.lossesBy).toEqual({ checkmate: 1, time: 1 });
    expect(p.topPiece).toBe('q');
    expect(p.weaknesses.find((w) => w.key === 'hung')?.topPiece).toBe('q');
  });

  it('flags the no-castling and early-queen habits only with at least 3 games', () => {
    const base = (n: number, summ: Partial<SkillInput['summaries'][number]['summary']>): ReturnType<typeof computeSkillProfile> => {
      const ids = Array.from({ length: n }, (_, i) => `g${i}`);
      return computeSkillProfile({ now: NOW, games: ids.map((id) => game(id, 1)), summaries: ids.map((id) => summary(id, summ)), attempts: [], mistakes: [] });
    };
    expect(base(2, { castled_move: null, early_queen: true }).weaknesses).toEqual([]);
    const p = base(5, { castled_move: null, early_queen: true });
    expect(p.weaknesses.map((w) => w.key)).toEqual(['nocastle', 'earlyqueen']);
    expect(p.castledEarlyRate).toBe(0);
    expect(base(5, { castled_move: 7 }).weaknesses).toEqual([]);
    expect(base(5, { castled_move: 14 }).weaknesses.map((w) => w.key)).toEqual(['nocastle']);
  });

  it('theme weights: base 1 + 3 x normalized weakness + 2 for low recent accuracy', () => {
    const p = computeSkillProfile({
      now: NOW,
      games: [game('a', 0)],
      summaries: [summary('a')],
      attempts: [
        { theme: 'mate1', correct: false, createdAt: daysAgo(0) },
        { theme: 'mate1', correct: false, createdAt: daysAgo(0) },
        { theme: 'mate1', correct: true, createdAt: daysAgo(0) },
        { theme: 'free', correct: true, createdAt: daysAgo(0) },
        { theme: 'free', correct: true, createdAt: daysAgo(0) },
        { theme: 'free', correct: true, createdAt: daysAgo(0) },
      ],
      mistakes: [mk('a', 'hung', 'blunder', 0), mk('a', 'hung', 'blunder', 0), mk('a', 'fork', 'blunder', 0)],
    });
    expect(p.themeWeights.save).toBeCloseTo(4); // top weakness: 1 + 3 * 1
    expect(p.themeWeights.fork).toBeCloseTo(1 + 3 * 0.5);
    expect(p.themeWeights.winmat).toBe(1);
    expect(p.themeWeights.mate1).toBe(3); // 1 + 0 + 2 (1 of 3 correct = 33% < 60%)
    expect(p.themeWeights.free).toBe(1); // accurate: no bonus
  });

  it('weights shift within one sync: a user who starts hanging rooks gets more "save" weight', () => {
    const before = computeSkillProfile({ now: NOW, games: [game('a', 1)], summaries: [summary('a')], attempts: [], mistakes: [mk('a', 'fork', 'blunder', 1)] });
    const after = computeSkillProfile({
      now: NOW,
      games: [game('a', 1), game('b', 0)],
      summaries: [summary('a'), summary('b')],
      attempts: [],
      mistakes: [mk('a', 'fork', 'blunder', 1), mk('b', 'hung', 'blunder', 0, 'r'), mk('b', 'hung', 'blunder', 0, 'r'), mk('b', 'ignored', 'blunder', 0, 'r')],
    });
    expect(after.themeWeights.save).toBeGreaterThan(before.themeWeights.save);
    expect(after.weaknesses[0].key).toBe('hung');
    expect(after.weaknesses[0].topPiece).toBe('r');
  });

  it('trend compares the last 14 days with the 14 before, per game', () => {
    const p = computeSkillProfile({
      now: NOW,
      games: [game('r1', 3), game('r2', 6), game('p1', 20), game('p2', 22)],
      summaries: ['r1', 'r2', 'p1', 'p2'].map((id) => summary(id)),
      attempts: [],
      mistakes: [mk('p1', 'hung', 'blunder', 20), mk('p1', 'hung', 'blunder', 20), mk('p2', 'hung', 'blunder', 22), mk('p2', 'ignored', 'mistake', 22), mk('r1', 'hung', 'blunder', 3)],
    });
    const hung = p.trend.find((t) => t.key === 'hung');
    expect(hung).toEqual({ key: 'hung', recent: 0.5, previous: 2 });
    expect(describeTrend(hung!)).toBe('Hanging pieces: down 75% vs the previous 2 weeks');
  });
});

describe('Leitner schedule', () => {
  const now = new Date('2026-10-05T12:00:00Z');
  it('uses boxes 0,1,3,7,14,30,60 days', () => {
    expect(LEITNER_DAYS).toEqual([0, 1, 3, 7, 14, 30, 60]);
    let box = 0;
    const gaps: number[] = [];
    for (let i = 0; i < 7; i++) {
      const s = nextSchedule(box, true, now);
      gaps.push((s.dueAt.getTime() - now.getTime()) / 86_400_000);
      box = s.box;
    }
    expect(gaps).toEqual([1, 3, 7, 14, 30, 60, 60]);
    expect(box).toBe(6);
  });
  it('a wrong answer resets to box 0 and is due again in 10 minutes', () => {
    const s = nextSchedule(4, false, now);
    expect(s.box).toBe(0);
    expect(s.dueAt.getTime() - now.getTime()).toBe(10 * 60_000);
  });
});

describe('theme rating Elo', () => {
  it('K=32 against the puzzle rating; a hint counts as a loss', () => {
    expect(updateThemeRating(800, 800, true, false)).toBeCloseTo(816);
    expect(updateThemeRating(800, 800, false, false)).toBeCloseTo(784);
    expect(updateThemeRating(800, 800, true, true)).toBeCloseTo(784);
    expect(updateThemeRating(800, 1200, true, false)).toBeGreaterThan(827);
  });
});

describe('pickPuzzles', () => {
  const puzzles = bundledPuzzles();
  const rng = (): (() => number) => {
    let s = 42;
    return () => ((s = (s * 1664525 + 1013904223) % 4294967296) / 4294967296);
  };

  it('returns n distinct puzzles of the requested theme', async () => {
    const repo = createMemoryRepo({ puzzles });
    const r = await pickPuzzles(repo, { theme: 'fork', n: 8, rng: rng() });
    expect(r).toHaveLength(8);
    expect(new Set(r.map((p) => p.id)).size).toBe(8);
    expect(r.every((p) => p.themes.includes('fork'))).toBe(true);
  });

  it('weights a mix by themeWeights', async () => {
    const repo = createMemoryRepo({ puzzles });
    const weights = { save: 50, free: 1, fork: 1, stopmate: 1, mate1: 1, mate2: 1, winmat: 1 };
    const counts: Record<string, number> = {};
    for (let i = 0; i < 20; i++) {
      for (const p of await pickPuzzles(repo, { theme: 'mix', n: 10, themeWeights: weights, rng: rng() })) counts[p.themes[0]] = (counts[p.themes[0]] ?? 0) + 1;
    }
    expect(counts.save).toBeGreaterThan((counts.free ?? 0) + (counts.fork ?? 0) + (counts.winmat ?? 0));
  });

  it('skips puzzles attempted in the last 7 days and mixes in ~20% failed ones for review', async () => {
    const repo = createMemoryRepo({ puzzles });
    const forks = puzzles.filter((p) => p.themes[0] === 'fork');
    // fork puzzle 0 failed 2 days ago (review candidate); puzzle 1 solved 1 day ago (excluded)
    await repo.insertAttempt({ puzzleId: forks[0].id, trainingItemId: null, theme: 'fork', correct: false, usedHint: false, ms: 1000, createdAt: daysAgo(2) });
    await repo.insertAttempt({ puzzleId: forks[1].id, trainingItemId: null, theme: 'fork', correct: true, usedHint: false, ms: 1000, createdAt: daysAgo(1) });
    const r = await pickPuzzles(repo, { theme: 'mix', n: 10, themeWeights: { save: 1, free: 1, fork: 1, stopmate: 1, mate1: 1, mate2: 1, winmat: 1 }, rng: rng(), now: NOW });
    expect(r.map((p) => p.id)).toContain(forks[0].id);
    expect(r.map((p) => p.id)).not.toContain(forks[1].id);
  });

  it('weightedPick respects zero-ish weights', () => {
    const r = rng();
    const picks = Array.from({ length: 50 }, () => weightedPick({ a: 1000, b: 0.0001 }, r));
    expect(picks.every((k) => k === 'a')).toBe(true);
  });
});
