// Phase 3 acceptance: the prototype's real outputs on known games (plies are 0-based, depth 11).
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { analyzeGame, type GameAnalysisResult } from '@/analysis/analyzeGame';
import { parsePgnText } from '@/chesscom/parsePgn';
import type { NewGame } from '@/db/types';
import { createNodeEngine } from './helpers/nodeEngine';
import { makeEvaluator } from '@/engine/evalPos';
import { fromStored } from '@/engine/types';
import { walkSteps } from '@/analysis/walk';

const PGN = readFileSync(join(__dirname, '..', 'reference', 'data', 'huhsaaan-games.pgn'), 'utf8');
const { games } = parsePgnText(PGN, 'huhsaaan');

const find = (opp: string, date: string): NewGame => {
  const g = games.find(
    (x) => (x.white === opp || x.black === opp) && (x.playedAt ?? '').startsWith(date),
  );
  if (!g) throw new Error(`fixture game not found: ${opp} ${date}`);
  return g;
};

describe('PGN import', () => {
  it('parses all 35 games from the real PGN file', () => {
    const r = parsePgnText(PGN, 'huhsaaan');
    expect(r.errors).toBe(0);
    expect(r.games).toHaveLength(35);
    expect(r.games.every((g) => g.userColor === 'w' || g.userColor === 'b')).toBe(true);
    expect(new Set(r.games.map((g) => g.externalId)).size).toBe(35);
  });

  it('reads the known outcome and termination for the mert19890 game', () => {
    const g = find('mert19890', '2026-10-03');
    expect(g.outcome).toBe('l');
    expect(g.termination).toBe('checkmate');
  });
});

describe('analysis on known games (real Stockfish, depth 11)', () => {
  const engine = createNodeEngine();
  const evalPos = makeEvaluator(engine);
  const results = new Map<string, GameAnalysisResult>();
  const run = async (name: string, g: NewGame): Promise<GameAnalysisResult> => {
    const hit = results.get(name);
    if (hit) return hit;
    const r = await analyzeGame(g, evalPos);
    results.set(name, r);
    return r;
  };

  beforeAll(async () => {
    await engine.boot();
  });

  it('Nahomxo (2026-10-01): mistake at ply 13 (7...Nh6) is a fork', async () => {
    const r = await run('nahom', find('Nahomxo', '2026-10-01'));
    const m = r.mistakes.find((x) => x.ply === 13);
    expect(m, JSON.stringify(r.mistakes.map((x) => [x.ply, x.category]))).toBeDefined();
    expect(m?.playedSan).toBe('Nh6');
    expect(m?.category).toBe('fork');
  });

  it('19293a (2026-10-05, user Black): zero mistakes', async () => {
    const g = find('19293a', '2026-10-05');
    expect(g.userColor).toBe('b');
    const r = await run('19293a', g);
    expect(r.mistakes).toHaveLength(0);
  });

  it('whole_cooked_chicken (2026-10-05): blunder at ply 6 (4.Nf3) classified ignored, mentions the bishop on f4', async () => {
    const r = await run('chicken', find('whole_cooked_chicken', '2026-10-05'));
    const m = r.mistakes.find((x) => x.ply === 6);
    expect(m, JSON.stringify(r.mistakes.map((x) => [x.ply, x.category, x.severity]))).toBeDefined();
    expect(m?.severity).toBe('blunder');
    expect(m?.category).toBe('ignored');
    expect(m?.explanation).toContain('bishop on f4');
  });

  it('YossufM (2026-10-01, user White): mistakes at plies 76, 78, 82, 84, shown as red (blunder verdict) in the walkthrough', async () => {
    const g = games.find((x) => x.black === 'YossufM' && x.white === 'huhsaaan' && (x.playedAt ?? '').startsWith('2026-10-01'));
    if (!g) throw new Error('YossufM fixture missing');
    const r = await run('yossuf', g);
    const plies = r.mistakes.map((x) => x.ply);
    for (const p of [76, 78, 82, 84]) expect(plies, `mistakes: ${plies.join(',')}`).toContain(p);
    // Walkthrough strip: red = blunder verdict (win chance drop of 20+ points). Moves 39, 40, 42, 43 (1-based white moves).
    const { steps } = walkSteps(g, r.evals.map(fromStored), r.mistakes);
    const red = steps.filter((x) => x.mine && x.v?.k === 'blunder').map((x) => x.ply / 2 + 1);
    expect(red).toEqual([39, 40, 42, 43]);
  });
});
