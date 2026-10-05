// The full personal-training pipeline against a real Supabase project (skipped without credentials):
// import games -> analyze (engine) -> mistakes + mirrored variants stored -> factory builds personal puzzles from the games.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AnalysisQueue } from '@/analysis/queue';
import { parsePgnText } from '@/chesscom/parsePgn';
import { createSupabaseRepo } from '@/db/supabaseRepo';
import type { Repo } from '@/db/repo';
import { makeEvaluator } from '@/engine/evalPos';
import { backfillVariants } from '@/puzzles/backfill';
import { PuzzleFactory } from '@/puzzles/factory';
import { createNodeEngine } from './helpers/nodeEngine';
import { PGN_TEXT } from './helpers/fixtures';
import { createTestUser, deleteTestUser, hasSupabase, type TestUser } from './helpers/supabaseEnv';

describe.skipIf(!hasSupabase)('personal training pipeline on real Supabase', () => {
  const engine = createNodeEngine();
  let user: TestUser;
  let repo: Repo;

  beforeAll(async () => {
    await engine.boot();
    user = await createTestUser('pipeline');
    repo = createSupabaseRepo(user.client, user.id);
    await repo.updateProfile({ chesscomUsername: 'huhsaaan' });
  });
  afterAll(async () => {
    if (user) await deleteTestUser(user);
  });

  it('analyzes real games, stores mistakes with mirrored variants linked to them', async () => {
    const { games } = parsePgnText(PGN_TEXT, 'huhsaaan');
    const inserted = await repo.insertGames(games.slice(0, 10));
    expect(inserted).toHaveLength(10);
    expect(await new AnalysisQueue(repo, makeEvaluator(engine)).run()).toBe(10);

    const mistakes = await repo.listMistakes();
    const items = await repo.listTrainingItems();
    const own = items.filter((i) => i.kind === 'own_mistake');
    const variants = items.filter((i) => i.kind === 'variant');
    expect(mistakes.length).toBeGreaterThan(0);
    expect(own.length).toBe(mistakes.length);
    expect(variants.length).toBeGreaterThanOrEqual(mistakes.length); // up to 3 per mistake
    expect(new Set(variants.map((v) => (v.payload as { variant?: string }).variant))).toEqual(new Set(['mirror', 'swap', 'both']));
    // every variant is linked to the real mistake it came from
    const ids = new Set(mistakes.map((m) => m.id));
    expect(variants.every((v) => v.mistakeId && ids.has(v.mistakeId))).toBe(true);

    // backfill is idempotent: nothing new to add once variants exist
    expect(await backfillVariants(repo)).toBe(0);
  }, 240_000);

  it('the factory builds personal puzzles from those games and they persist without duplicates', async () => {
    const factory = new PuzzleFactory(repo, engine);
    const added = await factory.build({ selfPlay: false, scanDepth: 10, verifyDepth: 12, maxMs: 120_000 });
    expect(added).toBeGreaterThan(0);
    const gen = (await repo.listTrainingItems()).filter((i) => i.kind === 'generated');
    expect(gen).toHaveLength(added);
    expect(gen.every((g) => g.gameId === null)).toBe(true);
    const again = await factory.build({ selfPlay: false, scanDepth: 10, verifyDepth: 12, maxMs: 60_000 });
    const after = (await repo.listTrainingItems()).filter((i) => i.kind === 'generated');
    expect(after).toHaveLength(added + again);
    expect(new Set(after.map((g) => (g.payload as { fen: string }).fen.split(' ').slice(0, 2).join(' '))).size).toBe(after.length);
  }, 300_000);

  it('re-analyzing a game replaces its mistakes and variants without leaving orphans', async () => {
    const mistakeGames = new Set((await repo.listMistakes()).map((m) => m.gameId));
    const withMistakes = (await repo.listGames()).find((g) => mistakeGames.has(g.id)) as NonNullable<Awaited<ReturnType<Repo['getGame']>>>;
    expect(withMistakes).toBeDefined();
    const before = (await repo.listTrainingItems()).filter((i) => i.gameId === withMistakes.id);
    await repo.setGameStatus(withMistakes.id, 'pending');
    await new AnalysisQueue(repo, makeEvaluator(engine)).run();
    const after = (await repo.listTrainingItems()).filter((i) => i.gameId === withMistakes.id);
    expect(after.length).toBe(before.length);
    const mistakeIds = new Set((await repo.listMistakes()).map((m) => m.id));
    expect(after.filter((i) => i.mistakeId).every((i) => mistakeIds.has(i.mistakeId as string))).toBe(true);
  }, 120_000);
});
