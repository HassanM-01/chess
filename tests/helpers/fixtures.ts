import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { ChesscomClient, ChesscomGame } from '@/chesscom/client';
import { splitPgns } from '@/chesscom/parsePgn';
import type { PuzzleRow } from '@/db/types';

export const REF_DIR = join(__dirname, '..', '..', 'reference', 'data');
export const PGN_TEXT = readFileSync(join(REF_DIR, 'huhsaaan-games.pgn'), 'utf8');

const header = (pgn: string, key: string): string => pgn.match(new RegExp(`\\[${key} "([^"]*)"\\]`))?.[1] ?? '';

/** The 35 real games shaped like chess.com API month responses. */
export function fakeChesscomGames(): { month: string; game: ChesscomGame }[] {
  return splitPgns(PGN_TEXT).map((pgn) => {
    const date = header(pgn, 'Date').replace(/\./g, '-');
    const end = Math.floor(new Date(`${date}T12:00:00Z`).getTime() / 1000);
    return {
      month: date.slice(0, 7),
      game: {
        url: header(pgn, 'Link'),
        pgn,
        end_time: end,
        time_class: 'rapid',
        rules: 'chess',
        white: { username: header(pgn, 'White') },
        black: { username: header(pgn, 'Black') },
      },
    };
  });
}

export interface FakeClientCalls {
  archives: number;
  months: string[];
}

export function fakeClient(extra: ChesscomGame[] = [], extraMonth = '2026-10'): { client: ChesscomClient; calls: FakeClientCalls } {
  const all = fakeChesscomGames();
  const calls: FakeClientCalls = { archives: 0, months: [] };
  const months = [...new Set([...all.map((g) => g.month), extraMonth])].sort();
  const client: ChesscomClient = {
    async validateUsername(u) {
      return u.toLowerCase();
    },
    async getArchives() {
      calls.archives++;
      return months.map((m) => `https://api.chess.com/pub/player/huhsaaan/games/${m.replace('-', '/')}`);
    },
    async getMonth(_u, y, m) {
      const key = `${y}-${String(m).padStart(2, '0')}`;
      calls.months.push(key);
      const base = all.filter((g) => g.month === key).map((g) => g.game);
      return key === extraMonth ? [...base, ...extra] : base;
    },
  };
  return { client, calls };
}

export function bundledPuzzles(): PuzzleRow[] {
  const raw = JSON.parse(readFileSync(join(__dirname, '..', '..', 'data', 'puzzles.json'), 'utf8')) as {
    id: string;
    theme: PuzzleRow['themes'][number];
    fen: string;
    moves: string[];
    explain: string;
    lastMove?: string;
    alts?: string[];
  }[];
  return raw.map((p) => ({
    id: `bc_${p.id}`,
    fen: p.fen,
    moves: p.moves,
    themes: [p.theme],
    rating: 600,
    explanation: p.explain,
    source: 'bundled',
    lastMove: p.lastMove ?? null,
    alts: p.alts,
  }));
}
