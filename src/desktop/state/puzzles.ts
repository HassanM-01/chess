// Puzzle bank + the player's puzzle rating. Everything is local.
import { create } from 'zustand';
import { loadBundledPuzzles } from '@/data/bundledPuzzles';
import { gameFens } from '@/chess/helpers';
import { reviewMoves } from '@/review/classify';
import { eloUpdate, fromLichessRow, pickPuzzle, puzzlesFromReview, type Puzzle } from '@/review/puzzles';
import type { StoredReview } from '@/review/types';
import { useLibrary } from './library';

export interface PuzzleProgress {
  rating: number;
  solved: number;
  failed: number;
  streak: number;
  bestStreak: number;
  /** puzzle id -> when it was last seen (ms) */
  seen: Record<string, number>;
  /** puzzle ids solved cleanly */
  done: Record<string, true>;
  history: { id: string; ok: boolean; delta: number; rating: number; at: number }[];
}

const FRESH: PuzzleProgress = { rating: 1000, solved: 0, failed: 0, streak: 0, bestStreak: 0, seen: {}, done: {}, history: [] };

interface LichessFile {
  version: 1;
  importedAt: string;
  rows: [string, string, string, number, string][];
}

interface PuzzleState {
  loaded: boolean;
  progress: PuzzleProgress;
  rated: Puzzle[];
  mine: Puzzle[];
  lichessCount: number;
  lichessImportedAt: string | null;
  load(): Promise<void>;
  /** rebuild "My mistakes" from every finished review in the library */
  refreshMine(): Promise<void>;
  reloadLichess(): Promise<void>;
  next(mode: 'rated' | 'mine', theme: string | null): Puzzle | null;
  /** record a finished puzzle; returns the rating change */
  finish(p: Puzzle, ok: boolean): number;
}

export const usePuzzles = create<PuzzleState>((set, get) => {
  const save = (): void => void window.desktop?.store.write('puzzle-progress', get().progress);
  return {
    loaded: false,
    progress: FRESH,
    rated: [],
    mine: [],
    lichessCount: 0,
    lichessImportedAt: null,
    async load() {
      const [progress, bundled] = await Promise.all([window.desktop?.store.read<PuzzleProgress>('puzzle-progress'), loadBundledPuzzles()]);
      const rated: Puzzle[] = bundled.map((b) => ({
        id: `bc:${b.id}`,
        fen: b.fen,
        solution: b.moves,
        alts: b.alts ?? [],
        rating: 500 + Math.round(((b.moves.length - 1) / 2) * 100),
        themes: b.themes,
        source: 'bundled',
        lastMove: b.lastMove ?? null,
      }));
      set({ progress: { ...FRESH, ...(progress ?? {}) }, rated, loaded: true });
      await get().reloadLichess();
    },
    async reloadLichess() {
      const f = await window.desktop?.store.read<LichessFile>('lichess-puzzles');
      const bundled = get().rated.filter((p) => p.source === 'bundled');
      if (!f?.rows?.length) {
        set({ rated: bundled, lichessCount: 0, lichessImportedAt: null });
        return;
      }
      const li = f.rows.map(fromLichessRow).filter((p): p is Puzzle => !!p);
      set({ rated: [...bundled, ...li], lichessCount: li.length, lichessImportedAt: f.importedAt });
    },
    async refreshMine() {
      const out: Puzzle[] = [];
      for (const g of useLibrary.getState().games) {
        const r = await window.desktop?.store.read<StoredReview>(`reviews/${g.id}`);
        if (!r || r.version !== 1 || r.positions.length < 2) continue;
        const moves = reviewMoves(g.startFen, g.movesUci, r.positions);
        const fens = gameFens(g.startFen, g.movesUci);
        const ps = puzzlesFromReview(g.id, (c) => (c === 'w' ? g.white : g.black) ?? 'opponent', (ply) => fens[ply], r.positions, moves, g.userColor);
        // show the opponent's previous move on the board
        for (const p of ps) {
          const ply = p.game!.ply;
          p.lastMove = ply > 0 ? g.movesUci[ply - 1] : null;
        }
        out.push(...ps);
      }
      set({ mine: out });
    },
    next(mode, theme) {
      const s = get();
      const pool = (mode === 'mine' ? s.mine : s.rated).filter((p) => !theme || p.themes.includes(theme));
      if (mode === 'mine') {
        const todo = pool.filter((p) => !s.progress.done[p.id]);
        return (todo.length ? todo : pool)[Math.floor(Math.random() * (todo.length ? todo.length : pool.length))] ?? null;
      }
      return pickPuzzle(pool, s.progress.rating, s.progress.seen);
    },
    finish(p, ok) {
      const pr = get().progress;
      const rated = p.source !== 'game';
      const delta = rated ? eloUpdate(pr.rating, p.rating, ok) : 0;
      const streak = ok ? pr.streak + 1 : 0;
      const rating = Math.max(100, pr.rating + delta);
      const progress: PuzzleProgress = {
        ...pr,
        rating,
        solved: pr.solved + (ok ? 1 : 0),
        failed: pr.failed + (ok ? 0 : 1),
        streak,
        bestStreak: Math.max(pr.bestStreak, streak),
        seen: { ...pr.seen, [p.id]: Date.now() },
        done: ok ? { ...pr.done, [p.id]: true } : pr.done,
        history: [...pr.history, { id: p.id, ok, delta, rating, at: Date.now() }].slice(-300),
      };
      set({ progress });
      save();
      return delta;
    },
  };
});

