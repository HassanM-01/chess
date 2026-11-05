// Runs and stores game reviews. One game at a time uses the whole engine; a queue lets you line several up.
import { create } from 'zustand';
import type { EngineLine } from '@/engine/types';
import { reviewMoves, summarizeReview } from '@/review/classify';
import { analyzePositions } from '@/review/runReview';
import type { PosAnalysis, ReviewSettings, StoredReview } from '@/review/types';
import { getEngine } from '../lib/desktopEngine';
import { resolveEngineOptions, useSettings } from './settings';
import { useLibrary } from './library';

export interface ReviewIndexEntry {
  complete: boolean;
  depth: number;
  engine: string;
  accuracyW: number;
  accuracyB: number;
  blunders: [number, number];
  updatedAt: string;
}

export interface JobState {
  gameId: string;
  /** position being searched (0-based) and how many positions the game has */
  index: number;
  total: number;
  depth: number;
  lines: EngineLine[];
  startedAt: number;
}

interface ReviewsState {
  loaded: boolean;
  reviews: Record<string, StoredReview>;
  index: Record<string, ReviewIndexEntry>;
  job: JobState | null;
  queue: string[];
  error: string | null;
  load(): Promise<void>;
  /** read a review from disk into memory (no-op when cached) */
  open(gameId: string): Promise<StoredReview | null>;
  enqueue(gameId: string, opts?: { force?: boolean }): void;
  cancel(): void;
  remove(gameId: string): void;
}

let cancelRequested = false;
let abort = new AbortController();
let running = false;
const settingsKey = (s: ReviewSettings): string => `${s.depth}/${s.movetimeMs}/${s.multipv}`;

export const useReviews = create<ReviewsState>((set, get) => {
  const saveIndex = (): void => void window.desktop?.store.write('review-index', get().index);

  async function pump(): Promise<void> {
    if (running) return;
    running = true;
    cancelRequested = false;
    abort = new AbortController();
    try {
      while (get().queue.length && !cancelRequested) {
        const gameId = get().queue[0];
        try {
          await runOne(gameId);
        } catch (e) {
          if (!cancelRequested) set({ error: e instanceof Error ? e.message : String(e) });
        }
        set({ queue: get().queue.filter((q) => q !== gameId), job: null });
      }
    } finally {
      running = false;
      set({ job: null, queue: cancelRequested ? [] : get().queue });
    }
  }

  async function runOne(gameId: string): Promise<void> {
    const game = useLibrary.getState().games.find((g) => g.id === gameId);
    if (!game) return;
    const s = useSettings.getState();
    const settings: ReviewSettings = { depth: s.depth, movetimeMs: s.movetimeMs, multipv: s.multipv };
    const opts = await resolveEngineOptions();
    const engine = getEngine();
    const existing = get().reviews[gameId] ?? (await get().open(gameId));
    const sameSettings = existing && settingsKey(existing.settings) === settingsKey(settings);
    const resume = existing && sameSettings && !existing.complete ? existing.positions : [];
    const now = new Date().toISOString();
    const base: StoredReview = {
      version: 1,
      gameId,
      engine: engine.name || 'Stockfish',
      threads: opts.threads,
      hashMb: opts.hashMb,
      settings,
      positions: resume,
      complete: false,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
    };
    const total = game.movesUci.length + 1;
    let lastPaint = 0;
    let lastSave = 0;
    const publish = (positions: PosAnalysis[], complete: boolean): StoredReview => {
      const r: StoredReview = { ...base, engine: engine.name || base.engine, positions, complete, updatedAt: new Date().toISOString() };
      set({ reviews: { ...get().reviews, [gameId]: r } });
      return r;
    };
    publish(resume, false);
    set({ job: { gameId, index: resume.length, total, depth: 0, lines: [], startedAt: Date.now() }, error: null });
    const positions = await analyzePositions(game.startFen, game.movesUci, engine, settings, {
      resume,
      shouldCancel: () => cancelRequested,
      signal: abort.signal,
      onSearch: (index, lines, depth) => {
        const t = performance.now();
        if (t - lastPaint < 120) return;
        lastPaint = t;
        set({ job: { gameId, index, total, depth, lines, startedAt: get().job?.startedAt ?? Date.now() } });
      },
      onPosition: (index, pos) => {
        const prev = get().reviews[gameId]?.positions ?? [];
        const next = prev.length === index ? [...prev, pos] : prev;
        const r = publish(next, false);
        set({ job: { gameId, index: index + 1, total, depth: 0, lines: [], startedAt: get().job?.startedAt ?? Date.now() } });
        if (Date.now() - lastSave > 1500) {
          lastSave = Date.now();
          void window.desktop?.store.write(`reviews/${gameId}`, r);
        }
      },
    }).catch((e: unknown) => {
      // Keep whatever was finished, so "Resume" continues from there.
      const part = get().reviews[gameId];
      if (part) void window.desktop?.store.write(`reviews/${gameId}`, part);
      throw e;
    });
    const done = publish(positions, true);
    await window.desktop?.store.write(`reviews/${gameId}`, done);
    const moves = reviewMoves(game.startFen, game.movesUci, positions);
    const sum = summarizeReview(moves, positions);
    set({
      index: {
        ...get().index,
        [gameId]: {
          complete: true,
          depth: Math.round(positions.reduce((a, p) => a + p.depth, 0) / Math.max(1, positions.length)),
          engine: done.engine,
          accuracyW: sum.white.accuracy,
          accuracyB: sum.black.accuracy,
          blunders: [sum.white.counts.blunder, sum.black.counts.blunder],
          updatedAt: done.updatedAt,
        },
      },
    });
    saveIndex();
  }

  return {
    loaded: false,
    reviews: {},
    index: {},
    job: null,
    queue: [],
    error: null,
    async load() {
      const index = (await window.desktop?.store.read<Record<string, ReviewIndexEntry>>('review-index')) ?? {};
      set({ index, loaded: true });
    },
    async open(gameId) {
      const cached = get().reviews[gameId];
      if (cached) return cached;
      const r = await window.desktop?.store.read<StoredReview>(`reviews/${gameId}`);
      if (r && r.version === 1) {
        set({ reviews: { ...get().reviews, [gameId]: r } });
        return r;
      }
      return null;
    },
    enqueue(gameId, o) {
      if (o?.force) {
        const { [gameId]: _drop, ...rest } = get().reviews;
        set({ reviews: rest });
        void window.desktop?.store.remove(`reviews/${gameId}`);
        const { [gameId]: _i, ...idx } = get().index;
        set({ index: idx });
        saveIndex();
      }
      if (get().queue.includes(gameId)) return;
      set({ queue: [...get().queue, gameId] });
      void pump();
    },
    cancel() {
      cancelRequested = true;
      abort.abort(); // stops the search in progress; the finished positions stay saved
    },
    remove(gameId) {
      const { [gameId]: _r, ...rest } = get().reviews;
      const { [gameId]: _i, ...idx } = get().index;
      set({ reviews: rest, index: idx });
      void window.desktop?.store.remove(`reviews/${gameId}`);
      saveIndex();
    },
  };
});
