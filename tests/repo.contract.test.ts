// One behaviour contract, run against the in-memory repo always and against the real Supabase repo when credentials exist.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { MistakeDraft } from '@/analysis/types';
import { createMemoryRepo } from '@/db/memoryRepo';
import type { Repo } from '@/db/repo';
import { createSupabaseRepo } from '@/db/supabaseRepo';
import type { NewGame, OwnMistakePayload, PuzzleRow, TrainingItemDraft } from '@/db/types';
import { admin, createTestUser, deleteTestUser, hasSupabase, type TestUser } from './helpers/supabaseEnv';

const game = (ext: string, extra: Partial<NewGame> = {}): NewGame => ({
  source: 'chesscom',
  externalId: ext,
  pgn: '1. e4 e5 2. Nf3 Nc6',
  startFen: 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1',
  movesUci: ['e2e4', 'e7e5', 'g1f3', 'b8c6'],
  movesSan: ['e4', 'e5', 'Nf3', 'Nc6'],
  white: 'me',
  black: 'them',
  whiteRating: 500,
  blackRating: 600,
  userColor: 'w',
  result: '1-0',
  outcome: 'w',
  termination: 'resignation',
  timeClass: 'rapid',
  opening: 'Italian Game',
  eco: 'C50',
  playedAt: '2026-10-01T12:00:00.000Z',
  ...extra,
});

const mistake = (ply: number): MistakeDraft => ({
  ply,
  fen: 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1',
  playedUci: 'e2e4',
  playedSan: 'e4',
  bestUci: 'd2d4',
  bestSan: 'd4',
  replyUci: 'e7e5',
  replySan: 'e5',
  category: 'hung',
  severity: 'blunder',
  phase: 'opening',
  piece: 'q',
  square: 'e4',
  winDrop: 42.5,
  explanation: 'You hung your queen.',
});

const items = (gameId: string): TrainingItemDraft[] => [
  {
    kind: 'own_mistake',
    gameId,
    ply: 2,
    payload: { pool: 'own', fen: 'f', me: 'w', lastMove: null, opponent: 'them', best: 'd2d4', bestSan: 'd4', san: 'e4', uci: 'e2e4', text: 't', cat: 'hung', evBest: [10, null, 'd2d4'] },
  },
  {
    kind: 'threat',
    gameId,
    ply: 4,
    payload: { pool: 'threat', fen: 'f', me: 'w', lastMove: 'e7e5', opponent: 'them', lastSan: 'e5', answer: ['d1'], attackers: ['e5d1'], explain: 'x' },
  },
];

const puzzle = (id: string, theme: PuzzleRow['themes'][number], rating: number): PuzzleRow => ({
  id,
  fen: '8/8/8/8/8/8/8/K6k w - - 0 1',
  moves: ['a1a2'],
  themes: [theme],
  rating,
  explanation: 'because',
  source: 'test',
  lastMove: 'h2h1',
  alts: undefined,
});
const PUZZLES = [puzzle('contract_a', 'free', 500), puzzle('contract_b', 'free', 900), puzzle('contract_c', 'fork', 700)];

function contract(name: string, make: () => Promise<{ repo: Repo; cleanup?: () => Promise<void> }>): void {
  describe(`Repo contract: ${name}`, () => {
    let repo: Repo;
    let cleanup: (() => Promise<void>) | undefined;
    beforeAll(async () => {
      ({ repo, cleanup } = await make());
    });
    afterAll(async () => {
      await cleanup?.();
    });

    it('profile: link a username (stored lowercase) and update settings / last sync', async () => {
      const p = await repo.updateProfile({ chesscomUsername: ' HuhSaaan ', settings: { level: 3 } });
      expect(p.chesscomUsername).toBe('huhsaaan');
      const p2 = await repo.updateProfile({ settings: { blunderCheck: false }, lastSyncedAt: '2026-10-05T00:00:00.000Z' });
      expect(p2.settings).toMatchObject({ level: 3, blunderCheck: false });
      expect(new Date(p2.lastSyncedAt as string).toISOString()).toBe('2026-10-05T00:00:00.000Z');
      expect((await repo.getProfile()).chesscomUsername).toBe('huhsaaan');
    });

    it('games: insert ignores duplicates on external_id and round-trips every field', async () => {
      const first = await repo.insertGames([game('g1'), game('g2', { userColor: 'b', outcome: 'l' })]);
      expect(first).toHaveLength(2);
      const again = await repo.insertGames([game('g1'), game('g3')]);
      expect(again.map((g) => g.externalId)).toEqual(['g3']);
      const all = await repo.listGames();
      expect(all).toHaveLength(3);
      const g1 = all.find((g) => g.externalId === 'g1');
      expect(g1).toMatchObject({
        source: 'chesscom',
        movesUci: ['e2e4', 'e7e5', 'g1f3', 'b8c6'],
        movesSan: ['e4', 'e5', 'Nf3', 'Nc6'],
        userColor: 'w',
        outcome: 'w',
        termination: 'resignation',
        analysisStatus: 'pending',
        isPublic: false,
        whiteRating: 500,
      });
      expect(new Date(g1?.playedAt as string).toISOString()).toBe('2026-10-01T12:00:00.000Z');
      expect((await repo.getGame(first[0].id))?.id).toBe(first[0].id);
      expect(await repo.getGame('00000000-0000-0000-0000-000000000000')).toBeNull();
      // games without an external id (bot games) never conflict
      const bots = await repo.insertGames([game('x', { externalId: null, source: 'bot' }), game('x', { externalId: null, source: 'bot' })]);
      expect(bots).toHaveLength(2);
    });

    it('analysis: saves evals, mistakes and training items; re-analysis replaces mistakes but keeps progress on other items', async () => {
      const [g] = (await repo.listGames()).filter((x) => x.externalId === 'g1');
      await repo.setGameStatus(g.id, 'running');
      const saved = await repo.saveAnalysis({
        gameId: g.id,
        engine: 'sf18-lite-d11',
        depth: 11,
        evals: [[0, null, 'e2e4'], [20, null, 'e7e5'], [30, 3, null]],
        summary: { castled_move: null, early_queen: false, eval_after_10: null, how_ended: 'resignation', outcome: 'w', counts: { best: 1, good: 0, inacc: 0, mistake: 0, blunder: 1 } },
        mistakes: [mistake(2)],
        trainingItems: items(g.id),
      });
      expect(saved).toHaveLength(1);
      expect(saved[0]).toMatchObject({ ply: 2, category: 'hung', severity: 'blunder', phase: 'opening', piece: 'q', square: 'e4', winDrop: 42.5, playedAt: g.playedAt });
      expect((await repo.getGame(g.id))?.analysisStatus).toBe('done');
      const a = await repo.getAnalysis(g.id);
      expect(a?.evals).toEqual([[0, null, 'e2e4'], [20, null, 'e7e5'], [30, 3, null]]);
      expect(a?.summary.counts.blunder).toBe(1);
      expect((await repo.listAnalyses()).length).toBe(1);
      const tr = await repo.listTrainingItems();
      expect(tr).toHaveLength(2);
      const own = tr.find((t) => t.kind === 'own_mistake');
      expect(own?.mistakeId).toBe(saved[0].id);
      expect(own).toMatchObject({ box: 0, attempts: 0, lastResult: null });

      // progress on the threat item survives a re-analysis
      const threat = tr.find((t) => t.kind === 'threat');
      await repo.updateTrainingItem(threat?.id as string, { box: 3, attempts: 2, correct: 2, lastResult: true, dueAt: '2026-11-01T00:00:00.000Z' });
      await repo.saveAnalysis({ gameId: g.id, engine: 'sf18-lite-d11', depth: 11, evals: [[1, null, null]], summary: a!.summary, mistakes: [mistake(2), mistake(4)], trainingItems: items(g.id) });
      expect(await repo.listMistakes()).toHaveLength(2);
      const tr2 = await repo.listTrainingItems();
      expect(tr2.find((t) => t.kind === 'threat')).toMatchObject({ box: 3, attempts: 2, correct: 2, lastResult: true });
      expect(tr2.filter((t) => t.kind === 'own_mistake')).toHaveLength(1);
    });

    it('resets games stuck in running, and switching the user colour clears the analysis', async () => {
      const g2 = (await repo.listGames()).find((x) => x.externalId === 'g2');
      await repo.setGameStatus(g2?.id as string, 'running');
      expect(await repo.resetRunningGames()).toBeGreaterThanOrEqual(1);
      expect((await repo.getGame(g2?.id as string))?.analysisStatus).toBe('pending');
      const g1 = (await repo.listGames()).find((x) => x.externalId === 'g1');
      await repo.setGameUserColor(g1?.id as string, 'b');
      const after = await repo.getGame(g1?.id as string);
      expect(after).toMatchObject({ userColor: 'b', outcome: 'l', analysisStatus: 'pending' });
      expect(await repo.getAnalysis(g1?.id as string)).toBeNull();
      expect((await repo.listMistakes()).filter((m) => m.gameId === g1?.id)).toHaveLength(0);
      expect((await repo.listTrainingItems()).filter((t) => t.gameId === g1?.id)).toHaveLength(0);
    });

    it('attempts, theme skill, snapshots and progress', async () => {
      await repo.insertAttempt({ puzzleId: null, trainingItemId: null, theme: 'g_threat', correct: true, usedHint: false, ms: 1200, createdAt: '2026-10-01T10:00:00.000Z' });
      await repo.insertAttempt({ puzzleId: null, trainingItemId: null, theme: 'g_judge', correct: false, usedHint: true, ms: null, createdAt: '2026-10-02T10:00:00.000Z' });
      const at = await repo.listAttempts({ limit: 10 });
      expect(at.map((a) => a.theme)).toEqual(['g_judge', 'g_threat']); // newest first
      expect(at[0]).toMatchObject({ correct: false, usedHint: true });
      expect((await repo.listAttempts({ sinceIso: '2026-10-02T00:00:00.000Z' })).length).toBe(1);

      await repo.upsertThemeSkill({ theme: 'fork', rating: 812.5, attempts: 1 });
      await repo.upsertThemeSkill({ theme: 'fork', rating: 820, attempts: 2 });
      const ts = await repo.listThemeSkill();
      expect(ts).toHaveLength(1);
      expect(ts[0]).toMatchObject({ theme: 'fork', rating: 820, attempts: 2 });

      await repo.insertSnapshot({ gamesAnalyzed: 3, weaknesses: [] }, 3);
      await repo.insertSnapshot({ gamesAnalyzed: 4, weaknesses: [] }, 4);
      const snaps = await repo.listSnapshots(10);
      expect(snaps.map((s) => s.gamesAnalyzed)).toEqual([4, 3]);

      const p0 = await repo.getProgress();
      expect(p0.lessons).toEqual({});
      const p1 = await repo.updateProgress({ lessons: { values: true }, daily: { date: '2026-10-05', puzzles: 4 } });
      expect(p1.lessons).toEqual({ values: true });
      expect(p1.daily).toEqual({ date: '2026-10-05', puzzles: 4 });
      expect((await repo.getProgress()).lessons).toEqual({ values: true });

      // the coach's plan is saved with the progress row (needs migration 0005 on a real database)
      const stored = { generatedAt: '2026-10-05T12:00:00.000Z', forGames: 7, report: { headline: 'h', diagnosis: 'd', strengths: 's', habits: [], plan: [{ day: 'Mon', title: 't', minutes: 10, action: 'trainer' as const }], encouragement: 'e' } };
      await repo.updateProgress({ coach: { report: stored } });
      expect((await repo.getProgress()).coach.report).toEqual(stored);
      expect((await repo.getProgress()).lessons).toEqual({ values: true }); // other fields untouched
    });

    it('puzzles: query by theme and rating window, exclude ids, count by theme, fetch by id', async () => {
      // A real database also holds the seeded puzzles, so only look at this test's own rows.
      const mine = <T extends { id: string }>(rows: T[]): string[] => rows.filter((r) => r.id.startsWith('contract_')).map((r) => r.id).sort();
      const all = { theme: 'free' as const, limit: 2000 };
      expect(mine(await repo.queryPuzzles(all))).toEqual(['contract_a', 'contract_b']);
      expect(mine(await repo.queryPuzzles({ ...all, minRating: 850, maxRating: 950 }))).toEqual(['contract_b']);
      // theme skills are Elo floats; the rating column is an integer (regression: "invalid input syntax for type integer: 634.223")
      expect(mine(await repo.queryPuzzles({ ...all, minRating: 750.4, maxRating: 900.6 }))).toEqual(['contract_b']);
      expect(mine(await repo.queryPuzzles({ ...all, minRating: 900.5, maxRating: 1000 }))).toEqual([]);
      expect(mine(await repo.queryPuzzles({ ...all, excludeIds: ['contract_a'] }))).toEqual(['contract_b']);
      expect((await repo.queryPuzzles({ theme: 'free', limit: 1 })).length).toBe(1);
      const counts = await repo.countPuzzlesByTheme();
      expect(counts.free).toBeGreaterThanOrEqual(2);
      expect(counts.fork).toBeGreaterThanOrEqual(1);
      const got = await repo.getPuzzles(['contract_c', 'nope']);
      expect(got).toHaveLength(1);
      expect(got[0]).toMatchObject({ id: 'contract_c', themes: ['fork'], rating: 700, moves: ['a1a2'], lastMove: 'h2h1' });
    });

    it('personal puzzles: generated items belong to no game and are deduplicated by position; variants follow their mistake', async () => {
      const gen = (fen: string, ply: number): TrainingItemDraft => ({
        kind: 'generated',
        gameId: null,
        ply,
        payload: { pool: 'gen', theme: 'fork', fen, me: 'w', lastMove: null, opponent: '', moves: ['a1a2'], explain: 'x', rating: 700 },
      });
      const fen = '8/8/8/8/8/8/8/K6k w - - 0 1';
      expect(await repo.addTrainingItems([gen(fen, 11), gen('8/8/8/8/8/8/8/K5k1 w - - 0 1', 12)])).toBe(2);
      expect(await repo.addTrainingItems([gen(fen, 13)])).toBe(0); // same position: skipped
      const g = (await repo.listTrainingItems()).filter((t) => t.kind === 'generated');
      expect(g).toHaveLength(2);
      expect(g.every((t) => t.gameId === null && t.mistakeId === null)).toBe(true);

      // variants are linked to the mistake they were made from, and removed with it on re-analysis
      const [vg] = await repo.insertGames([game('variant-src')]);
      const saved = await repo.saveAnalysis({
        gameId: vg.id,
        engine: 't',
        depth: 1,
        evals: [[0, null, null]],
        summary: { castled_move: null, early_queen: false, eval_after_10: null, how_ended: 'other', outcome: null, counts: { best: 0, good: 0, inacc: 0, mistake: 0, blunder: 0 } },
        mistakes: [mistake(2)],
        trainingItems: [
          ...items(vg.id),
          { kind: 'variant', gameId: vg.id, ply: 1002, srcPly: 2, payload: { ...(items(vg.id)[0].payload as OwnMistakePayload), variant: 'mirror', srcPly: 2 } },
        ],
      });
      const variant = (await repo.listTrainingItems()).find((t) => t.kind === 'variant' && t.gameId === vg.id);
      expect(variant?.mistakeId).toBe(saved[0].id);
      await repo.saveAnalysis({ gameId: vg.id, engine: 't', depth: 1, evals: [[0, null, null]], summary: (await repo.getAnalysis(vg.id))!.summary, mistakes: [], trainingItems: [] });
      expect((await repo.listTrainingItems()).some((t) => t.kind === 'variant' && t.gameId === vg.id)).toBe(false);
    });

    it('deleteGame removes the game and everything that hangs off it', async () => {
      const [g] = await repo.insertGames([game('del1')]);
      await repo.saveAnalysis({
        gameId: g.id,
        engine: 't',
        depth: 1,
        evals: [[0, null, null]],
        summary: { castled_move: null, early_queen: false, eval_after_10: null, how_ended: 'other', outcome: null, counts: { best: 0, good: 0, inacc: 0, mistake: 0, blunder: 0 } },
        mistakes: [mistake(2)],
        trainingItems: items(g.id),
      });
      await repo.deleteGame(g.id);
      expect(await repo.getGame(g.id)).toBeNull();
      expect(await repo.getAnalysis(g.id)).toBeNull();
      expect((await repo.listMistakes()).some((m) => m.gameId === g.id)).toBe(false);
      expect((await repo.listTrainingItems()).some((t) => t.gameId === g.id)).toBe(false);
    });
  });
}

contract('in-memory', async () => ({ repo: createMemoryRepo({ puzzles: PUZZLES }) }));

if (hasSupabase) {
  contract('Supabase (real project, RLS on)', async () => {
    const a = admin();
    await a.from('puzzles').upsert(
      PUZZLES.map((p) => ({ id: p.id, fen: p.fen, moves: p.moves, themes: p.themes, rating: p.rating, explanation: p.explanation, source: p.source, last_move: p.lastMove ?? null, alts: null })),
    );
    const user: TestUser = await createTestUser('contract');
    return {
      repo: createSupabaseRepo(user.client, user.id),
      cleanup: async () => {
        await deleteTestUser(user);
        await a.from('puzzles').delete().like('id', 'contract_%');
      },
    };
  });
}
