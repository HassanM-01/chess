import { beforeAll, describe, expect, it } from 'vitest';
import { AnalysisQueue } from '@/analysis/queue';
import { Chess, uciMove } from '@/chess/compat';
import { parsePgnText } from '@/chesscom/parsePgn';
import { createMemoryRepo } from '@/db/memoryRepo';
import type { GeneratedPayload } from '@/db/types';
import { makeEvaluator } from '@/engine/evalPos';
import { PuzzleFactory, stockTargets, toDraft } from '@/puzzles/factory';
import { fenKey } from '@/puzzles/mineRun';
import { THEME_KEYS } from '@/content/themes';
import { createNodeEngine } from './helpers/nodeEngine';
import { PGN_TEXT } from './helpers/fixtures';

describe('stockTargets', () => {
  it('splits the stock goal by weakness, with a floor for every theme', () => {
    const w = { save: 10, free: 1, fork: 1, stopmate: 1, mate1: 1, mate2: 1, winmat: 1 };
    const t = stockTargets(w, 30, 2);
    expect(t.save).toBeGreaterThan(t.free * 3);
    expect(Math.min(...THEME_KEYS.map((k) => t[k]))).toBeGreaterThanOrEqual(2);
    const even = stockTargets({ save: 1, free: 1, fork: 1, stopmate: 1, mate1: 1, mate2: 1, winmat: 1 }, 35, 2);
    expect(new Set(Object.values(even)).size).toBe(1);
  });
});

describe('PuzzleFactory (real engine, memory repo)', () => {
  const engine = createNodeEngine();
  beforeAll(async () => {
    await engine.boot();
  });

  async function repoWithGames(n: number) {
    const repo = createMemoryRepo({ username: 'huhsaaan' });
    const { games } = parsePgnText(PGN_TEXT, 'huhsaaan');
    await repo.insertGames(games.slice(0, n));
    await new AnalysisQueue(repo, makeEvaluator(engine)).run();
    return repo;
  }

  it('builds verified personal puzzles from the user’s own games, stores them as generated items, and never duplicates', async () => {
    const repo = await repoWithGames(14);
    const factory = new PuzzleFactory(repo, engine);
    const states: string[] = [];
    factory.subscribe(() => states.push(factory.state.phase));

    const added = await factory.build({ selfPlay: false, scanDepth: 10, verifyDepth: 12, maxMs: 120_000 });
    expect(added).toBeGreaterThanOrEqual(5);
    expect(factory.state.phase).toBe('done');
    expect(states).toContain('running');

    const items = (await repo.listTrainingItems()).filter((i) => i.kind === 'generated');
    expect(items).toHaveLength(added);
    for (const it of items) {
      const p = it.payload as GeneratedPayload;
      expect(it.gameId).toBeNull();
      expect(p.pool).toBe('gen');
      expect(THEME_KEYS).toContain(p.theme);
      expect(p.explain.length).toBeGreaterThan(10);
      expect(new Chess(p.fen).turn()).toBe(p.me);
      const c = new Chess(p.fen);
      for (const u of p.moves) expect(uciMove(c, u)).not.toBeNull();
      if (p.theme === 'mate1' || p.theme === 'mate2') expect(c.isCheckmate()).toBe(true);
    }
    expect(new Set(items.map((i) => fenKey((i.payload as GeneratedPayload).fen))).size).toBe(items.length);

    // a second run only adds puzzles that are not already stored
    const again = await factory.build({ selfPlay: false, scanDepth: 10, verifyDepth: 12, maxMs: 60_000 });
    const after = (await repo.listTrainingItems()).filter((i) => i.kind === 'generated');
    expect(after).toHaveLength(added + again);
    expect(new Set(after.map((i) => fenKey((i.payload as GeneratedPayload).fen))).size).toBe(after.length);
  }, 300_000);

  it('asks for more of what the user is weak at', async () => {
    const repo = await repoWithGames(8);
    const factory = new PuzzleFactory(repo, engine);
    const plan = await factory.plan();
    const profile = await (await import('@/skill/profileData')).loadSkillProfile(repo);
    const top = THEME_KEYS.slice().sort((a, b) => profile.themeWeights[b] - profile.themeWeights[a])[0];
    const bottom = THEME_KEYS.slice().sort((a, b) => profile.themeWeights[a] - profile.themeWeights[b])[0];
    expect(plan.wanted[top] ?? 0).toBeGreaterThanOrEqual(plan.wanted[bottom] ?? 0);
    expect(plan.total).toBeGreaterThan(0);
  }, 120_000);

  it('can be cancelled, and calling build twice joins the same run', async () => {
    const repo = await repoWithGames(6);
    const factory = new PuzzleFactory(repo, engine);
    const a = factory.build({ selfPlay: true, scanDepth: 8, verifyDepth: 10, maxMs: 60_000 });
    const b = factory.build();
    expect(a).toBe(b);
    setTimeout(() => factory.cancel(), 1500);
    await a;
    expect(factory.running).toBe(false);
    expect(['done', 'error']).toContain(factory.state.phase);
  }, 120_000);

  it('toDraft produces a game-less training item', () => {
    const d = toDraft({ theme: 'free', fen: '4k3/8/8/3n4/8/8/8/3RK3 w - - 0 1', moves: ['d1d5'], alts: [], explain: 'x', lastMove: null, rating: 550 }, 5);
    expect(d).toMatchObject({ kind: 'generated', gameId: null, ply: 5 });
    expect((d.payload as GeneratedPayload).me).toBe('w');
  });
});
