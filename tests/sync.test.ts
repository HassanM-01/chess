import { describe, expect, it } from 'vitest';
import { ChesscomError, createChesscomClient, type ChesscomGame } from '@/chesscom/client';
import { parseArchiveUrl, selectMonths, syncChesscomGames } from '@/chesscom/sync';
import { createMemoryRepo } from '@/db/memoryRepo';
import { fakeChesscomGames, fakeClient } from './helpers/fixtures';

const NOW = new Date('2026-10-05T12:00:00Z');
const archives = ['2025/09', '2026/08', '2026/09', '2026/10'].map((m) => `https://api.chess.com/pub/player/x/games/${m}`);

describe('selectMonths', () => {
  it('parses archive URLs', () => {
    expect(parseArchiveUrl(archives[3])).toMatchObject({ year: 2026, month: 10 });
    expect(parseArchiveUrl('https://example.com')).toBeNull();
  });
  it('never synced: the last 2 months', () => {
    expect(selectMonths(archives, null).map((m) => `${m.year}-${m.month}`)).toEqual(['2026-9', '2026-10']);
  });
  it('synced before: every month from the last-sync month on', () => {
    expect(selectMonths(archives, '2026-09-15T00:00:00Z').map((m) => `${m.year}-${m.month}`)).toEqual(['2026-9', '2026-10']);
    expect(selectMonths(archives, '2026-08-01T00:00:00Z').map((m) => `${m.year}-${m.month}`)).toEqual(['2026-8', '2026-9', '2026-10']);
  });
});

describe('syncChesscomGames', () => {
  const inWindow = fakeChesscomGames().filter((g) => g.month >= '2026-09').length;
  const inLastMonth = fakeChesscomGames().filter((g) => g.month === '2026-10').length;

  it('first pull imports the last two months, one month at a time, and a second pull adds no duplicates', async () => {
    const repo = createMemoryRepo({ username: 'huhsaaan' });
    const { client, calls } = fakeClient();
    const progress: string[] = [];
    const r1 = await syncChesscomGames(repo, client, (p) => progress.push(`${p.stage}:${p.label ?? ''}`), () => NOW);
    expect(calls.months).toEqual(['2026-09', '2026-10']);
    expect(r1.newGames).toBe(inWindow);
    expect(progress).toContain('month:2026-10');
    expect((await repo.listGames()).length).toBe(inWindow);
    expect((await repo.getProfile()).lastSyncedAt).toBe(NOW.toISOString());

    const r2 = await syncChesscomGames(repo, client, undefined, () => NOW);
    expect(r2.newGames).toBe(0);
    // second pull only re-fetches the month of the last sync and onwards
    expect(r2.existing).toBe(inLastMonth);
    expect((await repo.listGames()).length).toBe(inWindow);
  });

  it('fills user color, outcome, termination and played_at from the PGN and API', async () => {
    const repo = createMemoryRepo({ username: 'huhsaaan' });
    await syncChesscomGames(repo, fakeClient().client, undefined, () => NOW);
    const g = (await repo.listGames()).find((x) => x.externalId === '184762250112');
    expect(g).toBeDefined();
    expect(g).toMatchObject({ userColor: 'b', outcome: 'l', termination: 'checkmate', source: 'chesscom', analysisStatus: 'pending' });
    expect(g?.playedAt?.startsWith('2026-10-03')).toBe(true);
    expect(g?.movesUci.length).toBe(g?.movesSan.length);
  });

  it('marks games under 6 plies as skipped (stored, never analyzed, not re-fetched) and ignores non-chess rules', async () => {
    const short: ChesscomGame = {
      url: 'https://www.chess.com/game/live/999000111',
      pgn: '[Event "Live Chess"]\n[White "huhsaaan"]\n[Black "someone"]\n[Result "1-0"]\n[Termination "huhsaaan won - game abandoned"]\n\n1. e4 e5 1-0',
      end_time: Math.floor(NOW.getTime() / 1000),
      time_class: 'blitz',
      rules: 'chess',
      white: { username: 'huhsaaan' },
      black: { username: 'someone' },
    };
    const variant: ChesscomGame = { ...short, url: 'https://www.chess.com/game/live/999000222', rules: 'chess960' };
    const repo = createMemoryRepo({ username: 'huhsaaan' });
    const r1 = await syncChesscomGames(repo, fakeClient([short, variant]).client, undefined, () => NOW);
    const games = await repo.listGames();
    const s = games.find((g) => g.externalId === '999000111');
    expect(s?.analysisStatus).toBe('skipped');
    expect(games.some((g) => g.externalId === '999000222')).toBe(false);
    expect(r1.skipped).toBe(1);
    expect(r1.pendingIds).not.toContain(s?.id);
    const r2 = await syncChesscomGames(repo, fakeClient([short, variant]).client, undefined, () => NOW);
    expect(r2.newGames).toBe(0);
  });

  it('requires a linked username', async () => {
    const repo = createMemoryRepo();
    await expect(syncChesscomGames(repo, fakeClient().client)).rejects.toBeInstanceOf(ChesscomError);
  });
});

describe('chess.com client', () => {
  const json = (body: unknown, status = 200): Response => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

  it('retries 429 up to 3 times waiting 2 s each', async () => {
    const waits: number[] = [];
    let calls = 0;
    const client = createChesscomClient({
      fetch: async () => (++calls <= 2 ? json({}, 429) : json({ archives: ['a'] })),
      sleep: async (ms) => void waits.push(ms),
    });
    expect(await client.getArchives('Someone')).toEqual(['a']);
    expect(waits).toEqual([2000, 2000]);
    expect(calls).toBe(3);
  });

  it('gives up after 3 retries with a friendly error', async () => {
    const client = createChesscomClient({ fetch: async () => json({}, 429), sleep: async () => undefined });
    await expect(client.getArchives('x1')).rejects.toMatchObject({ kind: 'ratelimited' });
  });

  it('falls back to the /api/chesscom proxy on a network/CORS error', async () => {
    const urls: string[] = [];
    const client = createChesscomClient({
      fetch: async (input) => {
        const u = String(input);
        urls.push(u);
        if (u.startsWith('https://api.chess.com')) throw new TypeError('Failed to fetch');
        return json({ username: 'HuhSaaan' });
      },
    });
    expect(await client.validateUsername('huhsaaan')).toBe('huhsaaan');
    expect(urls[0]).toBe('https://api.chess.com/pub/player/huhsaaan');
    expect(urls[1]).toBe('/api/chesscom?path=%2Fpub%2Fplayer%2Fhuhsaaan');
  });

  it('reports unknown users as notfound', async () => {
    const client = createChesscomClient({ fetch: async () => json({ message: 'nope' }, 404) });
    await expect(client.validateUsername('nobody-here')).rejects.toMatchObject({ kind: 'notfound' });
    await expect(client.validateUsername('!!')).rejects.toMatchObject({ kind: 'notfound' });
  });
});

describe('review fixes', () => {
  it('termination ignores the player name inside the header', async () => {
    const { terminationFromHeader } = await import('@/chesscom/parsePgn');
    expect(terminationFromHeader('checkmate_king won on time', '1-0')).toBe('time');
    expect(terminationFromHeader('timelord won - game abandoned', '1-0')).toBe('abandoned');
    expect(terminationFromHeader('xx_checkmate won by resignation', '0-1')).toBe('resignation');
    expect(terminationFromHeader('huhsaaan won by checkmate', '1-0')).toBe('checkmate');
    expect(terminationFromHeader('Game drawn by repetition', '1/2-1/2')).toBe('draw');
  });

  it('a malformed ECOUrl escape does not abort parsing', async () => {
    const { parseGame } = await import('@/chesscom/parsePgn');
    const g = parseGame('[White "a"]\n[Black "b"]\n[Result "1-0"]\n[ECOUrl "https://www.chess.com/openings/Bad%E0%A4%A"]\n\n1. e4 e5 2. Nf3 Nc6 1-0', { username: 'a', source: 'pgn' });
    expect(g?.movesUci).toHaveLength(4);
  });

  it('changing the chess.com username resets the sync cursor', async () => {
    const repo = createMemoryRepo({ username: 'huhsaaan' });
    await repo.updateProfile({ lastSyncedAt: '2026-10-05T00:00:00.000Z' });
    await repo.updateProfile({ chesscomUsername: 'someoneelse' });
    expect((await repo.getProfile()).lastSyncedAt).toBeNull();
  });

  it('a failing month does not lose the others and does not advance the cursor; total failure throws', async () => {
    const repo = createMemoryRepo({ username: 'huhsaaan' });
    const { client } = fakeClient();
    const flaky = { ...client, getMonth: async (u: string, y: number, m: number) => { if (m === 9) throw new ChesscomError('boom', 'http', 500); return client.getMonth(u, y, m); } };
    const r = await syncChesscomGames(repo, flaky, undefined, () => NOW);
    expect(r.failedMonths).toBe(1);
    expect(r.newGames).toBeGreaterThan(0);
    expect((await repo.getProfile()).lastSyncedAt).toBeNull();
    const dead = { ...client, getMonth: async () => { throw new ChesscomError('down', 'network'); } };
    await expect(syncChesscomGames(createMemoryRepo({ username: 'huhsaaan' }), dead)).rejects.toBeInstanceOf(ChesscomError);
  });

  it('after a direct 429 the client tries the proxy once', async () => {
    const urls: string[] = [];
    const client = createChesscomClient({
      sleep: async () => undefined,
      fetch: async (input) => {
        const u = String(input);
        urls.push(u);
        return u.startsWith('/api/chesscom') ? new Response(JSON.stringify({ archives: ['x'] }), { status: 200 }) : new Response('{}', { status: 429 });
      },
    });
    expect(await client.getArchives('abc')).toEqual(['x']);
    expect(urls.some((u) => u.startsWith('/api/chesscom'))).toBe(true);
  });
});
