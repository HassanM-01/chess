// Puzzle bank + the player's puzzle rating. Everything is local.
import { create } from 'zustand';
import { loadBundledPuzzles } from '@/data/bundledPuzzles';
import { mineGame } from '@/review/mineGames';
import type { ExplainTag } from '@/review/explain';
import { countsForRating, eloUpdate, fromLichessRow, pickPuzzle, type Puzzle, type PuzzleGroup } from '@/review/puzzles';
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

export type PuzzleMode = PuzzleGroup;

/** What the user's reviewed games show they get wrong most often. */
export interface WeakSpots {
  tags: Partial<Record<ExplainTag, number>>;
  /** the user's inaccuracies, mistakes, misses and blunders across all reviewed games */
  badMoves: number;
  games: number;
}

interface PuzzleState {
  loaded: boolean;
  progress: PuzzleProgress;
  rated: Puzzle[];
  /** every puzzle built from your reviewed games, all modes together */
  game: Puzzle[];
  weak: WeakSpots;
  mining: boolean;
  lichessCount: number;
  lichessImportedAt: string | null;
  load(): Promise<void>;
  /** rebuild the game-based modes from every reviewed game in the library */
  refreshMine(): Promise<void>;
  reloadLichess(): Promise<void>;
  poolFor(mode: PuzzleMode, theme: string | null): Puzzle[];
  next(mode: PuzzleMode, theme: string | null): Puzzle | null;
  /** record a finished puzzle; returns the rating change */
  finish(p: Puzzle, ok: boolean): number;
  /** lower the rating so the rated trainer serves easier puzzles (the easiest ones are rated about 500) */
  easier(): void;
}

const rand = <T,>(xs: T[]): T => xs[Math.floor(Math.random() * xs.length)];
const tick = (): Promise<void> => new Promise((r) => setTimeout(r, 0));

/** Choose the next puzzle from your own games: new ones first, then the ones you got wrong, then anything. */
export function pickFromGames(pool: Puzzle[], p: PuzzleProgress, avoid?: string): Puzzle | null {
  const pool2 = pool.length > 1 && avoid ? pool.filter((x) => x.id !== avoid) : pool;
  if (!pool2.length) return null;
  const unseen = pool2.filter((x) => !(x.id in p.seen));
  if (unseen.length) return rand(unseen);
  const last = new Map<string, boolean>();
  for (const h of p.history) last.set(h.id, h.ok);
  const missed = pool2.filter((x) => last.get(x.id) === false);
  if (missed.length) return rand(missed);
  return rand(pool2.slice().sort((a, b) => (p.seen[a.id] ?? 0) - (p.seen[b.id] ?? 0)).slice(0, Math.max(10, Math.ceil(pool2.length / 3))));
}

/** per-game results, so reopening the screen does not redo the work */
const mined = new Map<string, { stamp: string; puzzles: Puzzle[]; weak: WeakSpots['tags']; bad: number }>();

export const usePuzzles = create<PuzzleState>((set, get) => {
  const save = (): void => void window.desktop?.store.write('puzzle-progress', get().progress);
  return {
    loaded: false,
    progress: FRESH,
    rated: [],
    game: [],
    weak: { tags: {}, badMoves: 0, games: 0 },
    mining: false,
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
        group: 'rated',
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
      for (const p of li) p.group = 'rated';
      set({ rated: [...bundled, ...li], lichessCount: li.length, lichessImportedAt: f.importedAt });
    },
    async refreshMine() {
      if (get().mining) return;
      set({ mining: true });
      try {
        const all: Puzzle[] = [];
        const tags: WeakSpots['tags'] = {};
        let bad = 0;
        let games = 0;
        for (const g of useLibrary.getState().games) {
          const r = await window.desktop?.store.read<StoredReview>(`reviews/${g.id}`);
          if (!r || r.version !== 1 || r.positions.length < 2) continue;
          const stamp = `${r.updatedAt}:${r.positions.length}:${g.userColor ?? ''}`;
          let e = mined.get(g.id);
          if (!e || e.stamp !== stamp) {
            const res = mineGame({ id: g.id, startFen: g.startFen, movesUci: g.movesUci, white: g.white, black: g.black, userColor: g.userColor }, r.positions);
            e = { stamp, puzzles: res.puzzles, weak: res.weak, bad: res.badMoves };
            mined.set(g.id, e);
            await tick(); // keep the window responsive while a big library is processed
          }
          games++;
          all.push(...e.puzzles);
          bad += e.bad;
          for (const [k, v] of Object.entries(e.weak)) tags[k as ExplainTag] = (tags[k as ExplainTag] ?? 0) + (v ?? 0);
        }
        set({ game: all, weak: { tags, badMoves: bad, games } });
      } finally {
        set({ mining: false });
      }
    },
    poolFor(mode, theme) {
      const s = get();
      const pool = mode === 'rated' ? s.rated : s.game.filter((p) => p.group === mode);
      return pool.filter((p) => !theme || p.themes.includes(theme));
    },
    next(mode, theme) {
      const s = get();
      const pool = s.poolFor(mode, theme);
      if (mode === 'rated') return pickPuzzle(pool, s.progress.rating, s.progress.seen);
      return pickFromGames(pool, s.progress);
    },
    easier() {
      const pr = get().progress;
      set({ progress: { ...pr, rating: Math.max(300, pr.rating - 250) } });
      save();
    },
    finish(p, ok) {
      const pr = get().progress;
      const delta = countsForRating(p) ? eloUpdate(pr.rating, p.rating, ok) : 0;
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
