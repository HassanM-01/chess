// The user's game library: imported PGNs and games pulled from chess.com, kept in one JSON file.
import { create } from 'zustand';
import { ChesscomError, createChesscomClient, type ChesscomClient, type ChesscomGame } from '@/chesscom/client';
import { MIN_PLIES, hashStr, parseGame, parsePgnText } from '@/chesscom/parsePgn';
import type { NewGame } from '@/db/types';

export interface LibGame extends NewGame {
  id: string;
  addedAt: string;
}

/** chess.com API through the main process (no CORS, fixed host list). */
export function desktopChesscom(): ChesscomClient {
  return createChesscomClient({
    useProxyFallback: false,
    fetch: async (input) => {
      const r = await window.desktop!.http.get(String(input));
      return new Response(r.body, { status: r.status, headers: { 'content-type': 'application/json' } });
    },
  });
}

const idOf = (g: NewGame): string => `g_${hashStr(g.externalId ?? g.pgn)}`;

interface LibraryState {
  loaded: boolean;
  games: LibGame[];
  load(): Promise<void>;
  /** returns how many were new */
  add(games: NewGame[]): number;
  remove(id: string): void;
  importPgn(text: string, username: string): { added: number; errors: number };
  pullChesscom(username: string, months: number, onProgress?: (label: string) => void): Promise<{ added: number; months: number }>;
}

export const useLibrary = create<LibraryState>((set, get) => {
  const persist = (): void => void window.desktop?.store.write('games', get().games);
  return {
    loaded: false,
    games: [],
    async load() {
      const games = (await window.desktop?.store.read<LibGame[]>('games')) ?? [];
      set({ games, loaded: true });
    },
    add(incoming) {
      const have = new Set(get().games.map((g) => g.id));
      const now = new Date().toISOString();
      const fresh: LibGame[] = [];
      for (const g of incoming) {
        const id = idOf(g);
        if (have.has(id)) continue;
        have.add(id);
        fresh.push({ ...g, id, addedAt: now });
      }
      if (fresh.length) {
        set({ games: [...fresh, ...get().games].sort((a, b) => (b.playedAt ?? b.addedAt).localeCompare(a.playedAt ?? a.addedAt)) });
        persist();
      }
      return fresh.length;
    },
    remove(id) {
      set({ games: get().games.filter((g) => g.id !== id) });
      persist();
      void window.desktop?.store.remove(`reviews/${id}`);
    },
    importPgn(text, username) {
      const { games, errors } = parsePgnText(text, username || null);
      return { added: get().add(games), errors };
    },
    async pullChesscom(username, months, onProgress) {
      const client = desktopChesscom();
      const name = await client.validateUsername(username);
      onProgress?.('Looking up archives…');
      const archives = (await client.getArchives(name)).slice(-months);
      let added = 0;
      for (let i = 0; i < archives.length; i++) {
        const m = archives[i].match(/\/games\/(\d{4})\/(\d{1,2})\/?$/);
        if (!m) continue;
        onProgress?.(`Downloading ${m[1]}-${m[2].padStart(2, '0')} (${i + 1}/${archives.length})…`);
        let games: ChesscomGame[];
        try {
          games = await client.getMonth(name, +m[1], +m[2]);
        } catch (e) {
          if (e instanceof ChesscomError && e.kind === 'notfound') continue;
          throw e;
        }
        const parsed: NewGame[] = [];
        for (const cg of games) {
          if (cg.rules !== 'chess' || !cg.pgn) continue;
          const g = parseGame(cg.pgn, { username: name, source: 'chesscom', endTime: cg.end_time, timeClass: cg.time_class, url: cg.url });
          if (g && g.movesUci.length >= MIN_PLIES) parsed.push(g);
        }
        added += get().add(parsed);
      }
      return { added, months: archives.length };
    },
  };
});
