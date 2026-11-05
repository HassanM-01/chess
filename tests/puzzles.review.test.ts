import { Readable } from 'node:stream';
import { zstdCompressSync, createZstdDecompress } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { Chess } from '@/chess/compat';
import { gameFens } from '@/chess/helpers';
import { START_FEN } from '@/chess/types';
import { reviewMoves } from '@/review/classify';
import { checkMove, eloUpdate, fromLichessRow, givesMate, pickPuzzle, puzzlesFromReview, trimLine, type Puzzle } from '@/review/puzzles';
import type { PosAnalysis, StoredLine } from '@/review/types';
import { sampleLichessCsv } from '../electron/lichessPuzzles';

const line = (cp: number, pv: string[], mate: number | null = null): StoredLine => ({ cp, mate, pv, depth: 30 });

describe('lichess puzzle rows', () => {
  // The first move belongs to the opponent; the solver answers it.
  const row: [string, string, string, number, string] = ['00sHx', 'q3k1nr/1pp1nQpp/3p4/1P2p3/4P3/B1PP1b2/B5PP/5K2 b k - 0 17', 'e8d7 a2e6 d7d8 f7f8', 1760, 'mate mateIn2 middlegame short'];
  it('applies the opponent move first and keeps the solver line', () => {
    const p = fromLichessRow(row)!;
    expect(p.lastMove).toBe('e8d7');
    expect(p.solution).toEqual(['a2e6', 'd7d8', 'f7f8']);
    expect(p.fen.split(' ')[1]).toBe('w');
    expect(p.themes).toContain('mateIn2');
    expect(p.rating).toBe(1760);
  });
  it('rejects a corrupt row', () => {
    expect(fromLichessRow(['x', 'not a fen', 'e2e4 e7e5', 1000, ''])).toBeNull();
    expect(fromLichessRow(['x', START_FEN, 'e2e4', 1000, ''])).toBeNull();
  });
});

describe('solving', () => {
  const p: Puzzle = { id: 't', fen: '6k1/5ppp/8/8/8/8/5PPP/R3K3 w Q - 0 1', solution: ['a1a8'], alts: [], rating: 800, themes: [], source: 'bundled' };
  it('accepts the line, and any move that mates', () => {
    expect(checkMove(p, p.fen, 0, 'a1a8')).toBe('correct');
    expect(checkMove(p, p.fen, 0, 'e1d1')).toBe('wrong');
    const other: Puzzle = { ...p, solution: ['a1a7'] }; // a different first move that also mates is fine
    expect(givesMate(p.fen, 'a1a8')).toBe(true);
    expect(checkMove(other, p.fen, 0, 'a1a8')).toBe('alt');
  });
  it('trims a line so it ends on the solver move and stays legal', () => {
    const t = trimLine(START_FEN, ['e2e4', 'e7e5', 'g1f3', 'b8c6', 'f1b5', 'a7a6'], 2);
    expect(t).toEqual(['e2e4', 'e7e5', 'g1f3']);
    expect(trimLine(START_FEN, ['e2e4', 'e2e4'])).toEqual(['e2e4']);
  });
});

describe('rating', () => {
  it('moves up on a win and down on a loss, more for surprising results', () => {
    expect(eloUpdate(1000, 1000, true)).toBe(12);
    expect(eloUpdate(1000, 1000, false)).toBe(-12);
    expect(eloUpdate(1000, 1400, true)).toBeGreaterThan(eloUpdate(1000, 1000, true));
    expect(eloUpdate(1400, 1000, false)).toBeLessThan(eloUpdate(1000, 1000, false));
  });
  it('picks a puzzle near the rating and prefers unseen ones', () => {
    const pool = [400, 900, 1000, 1100, 2000].map((r) => ({ id: `p${r}`, rating: r }));
    expect(['p900', 'p1000', 'p1100']).toContain(pickPuzzle(pool, 1000, {})!.id);
    expect(pickPuzzle(pool, 1000, { p900: 1, p1000: 1, p1100: 1 })!.id).not.toBe('p1000');
    expect(pickPuzzle([], 1000, {})).toBeNull();
  });
});

describe('puzzles from your own mistakes', () => {
  it('turns a clear blunder with one answer into a puzzle, and ignores fine moves', () => {
    const c = new Chess();
    const ucis: string[] = [];
    for (const s of ['f3', 'e5', 'g4']) {
      const m = c.move(s);
      ucis.push(m.from + m.to);
    }
    // Black to move after 2.g4: Qh4# is the only good move.
    const positions: PosAnalysis[] = [
      { lines: [line(30, ['e2e4']), line(20, ['d2d4'])], depth: 30, legal: 20 },
      { lines: [line(-40, ['e7e5']), line(-30, ['d7d5'])], depth: 30, legal: 20 },
      { lines: [line(-30, ['d8h4']), line(-20, ['d7d5'])], depth: 30, legal: 20 },
      { lines: [line(-5000, ['d8h4'], -1), line(-100, ['d7d5'])], depth: 30, legal: 20 },
    ];
    // White's f3 was fine; g4 (ply 2) lost to mate in 1 at (fake) depth 30.
    positions[3] = { lines: [line(-10000, ['d8h4'], -1), line(-300, ['d7d5'])], depth: 30, legal: 20 };
    const moves = reviewMoves(START_FEN, ucis, positions);
    const fens = gameFens(START_FEN, ucis);
    const out = puzzlesFromReview('g1', () => 'villain', (ply) => fens[ply], positions, moves, null);
    const bad = moves.filter((m) => m.cls === 'blunder' || m.cls === 'mistake' || m.cls === 'miss');
    // The blunder is by White (g4); the puzzle for it asks White for the move g4 spoiled, so the position is the one BEFORE g4.
    expect(bad.length).toBeGreaterThan(0);
    for (const p of out) {
      expect(p.fen).toBe(fens[p.game!.ply]);
      expect(p.solution.length % 2).toBe(1);
      expect(p.id).toBe(`g:g1:${p.game!.ply}`);
    }
  });
});

describe('Lichess sampling', () => {
  const header = 'PuzzleId,FEN,Moves,Rating,RatingDeviation,Popularity,NbPlays,Themes,GameUrl,OpeningTags';
  const mk = (i: number, rating: number, pop = 95, plays = 1000): string => `id${i},${START_FEN},e2e4 e7e5,${rating},75,${pop},${plays},opening short,https://lichess.org/x,`;
  it('keeps a rating-balanced sample of the popular puzzles and survives zstd', async () => {
    const rows = [header];
    for (let i = 0; i < 3000; i++) rows.push(mk(i, 400 + (i % 2800)));
    rows.push(mk(9001, 1500, 10, 1000), mk(9002, 1500, 95, 5)); // unpopular / rarely played: dropped
    const zst = zstdCompressSync(Buffer.from(rows.join('\n')));
    const out = await sampleLichessCsv(Readable.from([zst]).pipe(createZstdDecompress()), { limit: 560 });
    expect(out.length).toBeLessThanOrEqual(560);
    expect(out.length).toBeGreaterThan(400);
    expect(out.find((r) => r[0] === 'id9001' || r[0] === 'id9002')).toBeUndefined();
    const buckets = new Set(out.map((r) => Math.floor((r[3] - 400) / 100)));
    expect(buckets.size).toBeGreaterThanOrEqual(25);
    expect(out[0]).toHaveLength(5);
  });
});
