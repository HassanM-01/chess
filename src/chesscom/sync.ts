// "Pull recent games" (spec 5). Network + parsing + insert only; the analysis queue is started by the caller.
import type { Repo } from '@/db/repo';
import type { NewGame } from '@/db/types';
import { ChesscomError, type ChesscomClient, type ChesscomGame } from './client';
import { MIN_PLIES, externalIdFromUrl, parseGame } from './parsePgn';

export interface SyncProgress {
  stage: 'archives' | 'month' | 'saving';
  /** 1-based month index being fetched */
  month?: number;
  months?: number;
  label?: string;
}

export interface SyncResult {
  newGames: number;
  /** games stored as 'skipped' (too short) */
  skipped: number;
  /** games that were already stored */
  existing: number;
  unreadable: number;
  months: number;
  /** ids of rows that need analysis (status pending) */
  pendingIds: string[];
}

interface ArchiveMonth {
  year: number;
  month: number;
  url: string;
}

export function parseArchiveUrl(url: string): ArchiveMonth | null {
  const m = url.match(/\/games\/(\d{4})\/(\d{1,2})\/?$/);
  return m ? { year: +m[1], month: +m[2], url } : null;
}

/** Which archive months to fetch. Never synced: the last 2. Otherwise: every month at/after the last-sync month. */
export function selectMonths(archives: string[], lastSyncedAt: string | null): ArchiveMonth[] {
  const months = archives.map(parseArchiveUrl).filter((m): m is ArchiveMonth => !!m);
  months.sort((a, b) => a.year * 12 + a.month - (b.year * 12 + b.month));
  if (!lastSyncedAt) return months.slice(-2);
  const d = new Date(lastSyncedAt);
  const floor = d.getUTCFullYear() * 12 + (d.getUTCMonth() + 1);
  return months.filter((m) => m.year * 12 + m.month >= floor);
}

export async function syncChesscomGames(
  repo: Repo,
  client: ChesscomClient,
  onProgress?: (p: SyncProgress) => void,
  now: () => Date = () => new Date(),
): Promise<SyncResult> {
  const profile = await repo.getProfile();
  const username = profile.chesscomUsername;
  if (!username) throw new ChesscomError('Link your chess.com username first.', 'notfound');

  onProgress?.({ stage: 'archives' });
  const archives = await client.getArchives(username);
  const months = selectMonths(archives, profile.lastSyncedAt);

  const known = new Set((await repo.listGames()).map((g) => g.externalId).filter((x): x is string => !!x));
  const result: SyncResult = { newGames: 0, skipped: 0, existing: 0, unreadable: 0, months: months.length, pendingIds: [] };

  // One month at a time: chess.com rate-limits parallel requests.
  for (let i = 0; i < months.length; i++) {
    const m = months[i];
    onProgress?.({ stage: 'month', month: i + 1, months: months.length, label: `${m.year}-${String(m.month).padStart(2, '0')}` });
    const games = await client.getMonth(username, m.year, m.month);
    const batch: NewGame[] = [];
    for (const g of games) {
      const prepared = prepareGame(g, username, known);
      if (prepared === 'existing') result.existing++;
      else if (prepared === 'skip-rules') continue;
      else if (prepared === 'unreadable') result.unreadable++;
      else {
        if (prepared.analysisStatus === 'skipped') result.skipped++;
        batch.push(prepared);
        if (prepared.externalId) known.add(prepared.externalId);
      }
    }
    if (batch.length) {
      onProgress?.({ stage: 'saving', month: i + 1, months: months.length });
      const inserted = await repo.insertGames(batch);
      result.newGames += inserted.filter((r) => r.analysisStatus !== 'skipped').length;
      result.pendingIds.push(...inserted.filter((r) => r.analysisStatus === 'pending').map((r) => r.id));
    }
  }

  await repo.updateProfile({ lastSyncedAt: now().toISOString() });
  return result;
}

function prepareGame(g: ChesscomGame, username: string, known: Set<string>): NewGame | 'existing' | 'skip-rules' | 'unreadable' {
  if (g.rules !== 'chess') return 'skip-rules';
  const ext = externalIdFromUrl(g.url);
  if (ext && known.has(ext)) return 'existing';
  if (!g.pgn) return 'unreadable';
  const parsed = parseGame(g.pgn, { username, source: 'chesscom', endTime: g.end_time, timeClass: g.time_class, url: g.url });
  if (!parsed) return 'unreadable';
  // Too-short games (instant abandons) are stored as 'skipped' so they are not re-fetched or analyzed.
  if (parsed.movesUci.length < MIN_PLIES) parsed.analysisStatus = 'skipped';
  return parsed;
}
