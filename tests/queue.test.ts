import { beforeAll, describe, expect, it } from 'vitest';
import { AnalysisQueue } from '@/analysis/queue';
import { evaluateGame } from '@/analysis/analyzeGame';
import { createMemoryRepo } from '@/db/memoryRepo';
import { makeEvaluator } from '@/engine/evalPos';
import { parsePgnText } from '@/chesscom/parsePgn';
import { createNodeEngine } from './helpers/nodeEngine';
import { PGN_TEXT } from './helpers/fixtures';

describe('analysis queue + persistence (memory repo, real engine)', () => {
  const engine = createNodeEngine();
  const evalPos = makeEvaluator(engine);
  beforeAll(async () => {
    await engine.boot();
  });

  const pick = (opp: string, date: string) => {
    const { games } = parsePgnText(PGN_TEXT, 'huhsaaan');
    return games.filter((g) => (g.white === opp || g.black === opp) && (g.playedAt ?? '').startsWith(date));
  };

  it('analyzes pending games newest first, stores mistakes + training items, and marks them done', async () => {
    const repo = createMemoryRepo({ username: 'huhsaaan' });
    const a = pick('whole_cooked_chicken', '2026-10-05');
    const b = pick('Nahomxo', '2026-10-01');
    await repo.insertGames([...b, ...a]);
    const q = new AnalysisQueue(repo, evalPos);
    const seen: number[] = [];
    q.subscribe(() => seen.push(q.state.fraction));
    const n = await q.run();
    expect(n).toBe(2);
    expect(q.state.running).toBe(false);
    expect(seen.length).toBeGreaterThan(2);
    expect(Math.max(...seen)).toBeLessThanOrEqual(1);

    const games = await repo.listGames();
    expect(games.every((g) => g.analysisStatus === 'done')).toBe(true);
    const mistakes = await repo.listMistakes();
    const chicken = games.find((g) => g.white === 'whole_cooked_chicken' || g.black === 'whole_cooked_chicken');
    expect(mistakes.some((m) => m.gameId === chicken?.id && m.ply === 6 && m.category === 'ignored')).toBe(true);
    expect(mistakes.every((m) => m.playedAt)).toBe(true);

    const analysis = await repo.getAnalysis(chicken!.id);
    expect(analysis?.evals.length).toBe((chicken?.movesUci.length ?? 0) + 1);
    expect(analysis?.engine).toBe('sf18-lite-d15');
    expect(analysis?.depth).toBe(15);

    const items = await repo.listTrainingItems();
    const kinds = new Set(items.map((i) => i.kind));
    expect(kinds.has('own_mistake')).toBe(true);
    expect(kinds.has('threat')).toBe(true);
    expect(kinds.has('judge')).toBe(true);
    // every own_mistake links to a stored mistake
    const own = items.filter((i) => i.kind === 'own_mistake');
    expect(own.every((i) => mistakes.some((m) => m.id === i.mistakeId))).toBe(true);
    // unique (kind, game, ply)
    const keys = items.map((i) => `${i.kind}|${i.gameId}|${i.ply}`);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('is resumable: a game left "running" by a closed tab goes back to pending and is analyzed', async () => {
    const repo = createMemoryRepo({ username: 'huhsaaan' });
    const [g] = await repo.insertGames(pick('19293a', '2026-10-05'));
    await repo.setGameStatus(g.id, 'running');
    expect((await repo.listGames())[0].analysisStatus).toBe('running');
    const q = new AnalysisQueue(repo, evalPos);
    expect(await q.run()).toBe(1);
    expect((await repo.listGames())[0].analysisStatus).toBe('done');
  });

  it('results do not depend on what the engine analyzed before (hash is cleared per game)', async () => {
    const a = pick('YossufM', '2026-10-01').find((g) => g.white === 'huhsaaan')!;
    const b = pick('Nahomxo', '2026-10-01')[0];
    const fresh = await evaluateGame(a, makeEvaluator(createNodeEngine()));
    const warm = createNodeEngine();
    const warmEval = makeEvaluator(warm);
    await evaluateGame(b, warmEval);
    const after = await evaluateGame(a, warmEval);
    expect(after).toEqual(fresh);
  });

  it('skipped and errored games are not re-analyzed', async () => {
    const repo = createMemoryRepo({ username: 'huhsaaan' });
    const [g] = await repo.insertGames(pick('19293a', '2026-10-05'));
    await repo.setGameStatus(g.id, 'skipped');
    expect(await new AnalysisQueue(repo, evalPos).run()).toBe(0);
  });
});

describe('engine priority queue', () => {
  it('a bot reply under background load arrives in under 1 s, ahead of the queued analysis', async () => {
    const engine = createNodeEngine();
    await engine.boot();
    const evalPos = makeEvaluator(engine);
    const fen = 'r1bqkbnr/pppp1ppp/2n5/4p3/4P3/5N2/PPPP1PPP/RNBQKB1R w KQkq - 2 3';
    // Flood the queue with background analysis.
    let bgDone = 0;
    const bg = Array.from({ length: 40 }, (_, i) =>
      evalPos(`${fen.split(' ')[0]} ${i % 2 ? 'b' : 'w'} KQkq - 2 3`, 12, 'background').then(() => void bgDone++),
    );
    await new Promise((r) => setTimeout(r, 30));
    const t0 = Date.now();
    const bot = await engine.run(fen, { depth: 8, skill: 6, priority: 'interactive' });
    const dt = Date.now() - t0;
    expect(bot.best).toBeTruthy();
    expect(dt).toBeLessThan(1000);
    expect(bgDone).toBeLessThan(20); // the interactive request jumped the queue
    await Promise.all(bg); // and background work still completes afterwards
    expect(bgDone).toBe(40);
  });

  it('answers checkmate/stalemate positions without the engine', async () => {
    const evalPos = makeEvaluator({ run: () => Promise.reject(new Error('engine must not be called')) });
    const mated = await evalPos('rnb1kbnr/pppp1ppp/8/4p3/6Pq/5P2/PPPPP2P/RNBQKBNR w KQkq - 1 3');
    expect(mated.mateWhite).toBe(-1);
    expect(mated.cpWhite).toBe(-10000);
    const stale = await evalPos('7k/5Q2/6K1/8/8/8/8/8 b - - 0 1');
    expect(stale.cpWhite).toBe(0);
    expect(stale.mateWhite).toBeNull();
  });
});
