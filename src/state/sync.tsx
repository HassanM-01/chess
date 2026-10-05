// Global controller for "Pull recent games" + the analysis queue, so progress survives navigation.
import { createContext, useContext, useEffect, useMemo, useSyncExternalStore, type ReactNode } from 'react';
import { useQueryClient, type QueryClient } from '@tanstack/react-query';
import { AnalysisQueue, type QueueState } from '@/analysis/queue';
import { ChesscomError, createChesscomClient, type ChesscomClient } from '@/chesscom/client';
import { syncChesscomGames } from '@/chesscom/sync';
import type { Repo } from '@/db/repo';
import { getEngine } from '@/engine/browser';
import { makeEvaluator, type Evaluator } from '@/engine/evalPos';
import { backfillVariants } from '@/puzzles/backfill';
import { PuzzleFactory, type FactoryState } from '@/puzzles/factory';
import { snapshotSkillProfile } from '@/skill/profileData';
import { useRepo } from './auth';
import { invalidateAll } from './queries';
import { toast } from './toast';

export type SyncPhase = 'idle' | 'pulling' | 'analyzing' | 'error';

export interface SyncState {
  phase: SyncPhase;
  /** short status line: "Pulling games…", "Analyzing 3 of 12…" */
  label: string;
  /** 0..1 while analyzing */
  fraction: number;
  error: string | null;
  /** current opponent while analyzing */
  game: string;
}

const IDLE: SyncState = { phase: 'idle', label: '', fraction: 0, error: null, game: '' };

export class SyncController {
  state: SyncState = IDLE;
  readonly queue: AnalysisQueue;
  /** builds personal puzzles from the user's games and weaknesses */
  readonly factory: PuzzleFactory;
  private listeners = new Set<() => void>();
  private busy: Promise<void> | null = null;
  get qcRef(): QueryClient {
    return this.qc;
  }

  constructor(
    private repo: Repo,
    private qc: QueryClient,
    private client: ChesscomClient = createChesscomClient(),
    evalPos: Evaluator = makeEvaluator(getEngine()),
  ) {
    this.queue = new AnalysisQueue(repo, evalPos);
    this.factory = new PuzzleFactory(repo, getEngine(), qc);
    let lastDone = 0;
    this.queue.subscribe(() => {
      const q = this.queue.state;
      if (q.running) {
        this.set({
          phase: 'analyzing',
          label: `Analyzing ${Math.min(q.done + 1, q.total)} of ${q.total}…`,
          fraction: q.fraction,
          game: q.label,
        });
      }
      if (q.done > lastDone) void invalidateAll(this.qc, this.repo.userId);
      lastDone = q.running ? q.done : 0;
    });
  }

  subscribe = (cb: () => void): (() => void) => {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  };
  getState = (): SyncState => this.state;
  private set(patch: Partial<SyncState>): void {
    this.state = { ...this.state, ...patch };
    this.listeners.forEach((l) => l());
  }

  get running(): boolean {
    return this.busy !== null;
  }

  /** Pull recent games from chess.com, then analyze everything pending. */
  pull(): Promise<void> {
    if (this.busy) return this.busy;
    this.busy = this.doPull().finally(() => {
      this.busy = null;
    });
    return this.busy;
  }

  /** Analyze whatever is pending (PGN import, resumed games, bot games). */
  analyzePending(quiet = true): Promise<void> {
    if (this.busy) return this.busy;
    this.busy = this.doAnalyze(quiet).finally(() => {
      this.busy = null;
    });
    return this.busy;
  }

  private async doPull(): Promise<void> {
    this.set({ phase: 'pulling', label: 'Pulling games…', fraction: 0, error: null, game: '' });
    let newGames = 0;
    try {
      const res = await syncChesscomGames(this.repo, this.client, (p) => {
        const month = p.months && p.months > 1 ? ` (month ${p.month} of ${p.months})` : '';
        this.set({ label: `Pulling games…${p.stage === 'month' ? month : ''}` });
      });
      newGames = res.newGames;
      await invalidateAll(this.qc, this.repo.userId);
    } catch (e) {
      const msg = e instanceof ChesscomError ? e.message : 'Could not pull your games. Check your connection and try again.';
      this.set({ phase: 'error', label: '', error: msg });
      toast(msg);
      return;
    }
    const analyzed = await this.runQueue();
    await this.finish(analyzed, newGames, false);
  }

  private async doAnalyze(quiet: boolean): Promise<void> {
    this.set({ phase: 'analyzing', label: 'Analyzing…', fraction: 0, error: null });
    const analyzed = await this.runQueue();
    await this.finish(analyzed, analyzed, quiet);
  }

  private async runQueue(): Promise<number> {
    try {
      await getEngine().boot();
      return await this.queue.run();
    } catch (e) {
      console.warn('analysis run failed', e);
      this.set({ phase: 'error', label: '', error: 'The chess engine could not start in this browser.' });
      toast('The chess engine could not start in this browser.');
      return 0;
    }
  }

  private async finish(analyzed: number, newGames: number, quiet: boolean): Promise<void> {
    if (analyzed > 0) {
      try {
        await snapshotSkillProfile(this.repo);
      } catch (e) {
        console.warn('snapshot failed', e);
      }
    }
    await invalidateAll(this.qc, this.repo.userId);
    if (this.state.phase !== 'error') this.set({ phase: 'idle', label: '', fraction: 0, game: '' });
    // New games mean new habits: top up the personal puzzle stock in the background (a short run; the Train screen can do more).
    if (analyzed > 0) void this.factory.build({ maxMs: 90_000 });
    if (quiet && analyzed === 0) return;
    if (analyzed > 0) toast(`${analyzed} new game${analyzed === 1 ? '' : 's'} analyzed. Your coach report is updated.`);
    else if (newGames === 0 && this.state.phase !== 'error') toast("No new games. You're up to date.");
  }
}

const SyncContext = createContext<SyncController | null>(null);

export function SyncProvider({ children }: { children: ReactNode }): JSX.Element {
  const repo = useRepo();
  const qc = useQueryClient();
  const controller = useMemo(() => new SyncController(repo, qc), [repo, qc]);

  // Resume analysis left unfinished by a closed tab (spec 6.2): shortly after load.
  useEffect(() => {
    const t = setTimeout(() => {
      void repo
        .listGames()
        .then((gs) => {
          if (gs.some((g) => g.analysisStatus === 'pending' || g.analysisStatus === 'running')) void controller.analyzePending(true);
          else void backfillVariants(repo).then((n) => { if (n) void invalidateAll(controller.qcRef, repo.userId); });
        })
        .catch(() => undefined);
    }, 1500);
    return () => {
      clearTimeout(t);
      controller.queue.cancel();
    };
  }, [repo, controller]);

  // Warm the engine a little after load so it is ready when needed.
  useEffect(() => {
    const t = setTimeout(() => void getEngine().boot().catch(() => undefined), 2500);
    return () => clearTimeout(t);
  }, []);

  return <SyncContext.Provider value={controller}>{children}</SyncContext.Provider>;
}

export function useSyncController(): SyncController {
  const c = useContext(SyncContext);
  if (!c) throw new Error('useSyncController must be used inside <SyncProvider>');
  return c;
}

export function useFactoryState(): FactoryState {
  const f = useSyncController().factory;
  return useSyncExternalStore(f.subscribe, f.getState, f.getState);
}

export function useSyncState(): SyncState {
  const c = useSyncController();
  return useSyncExternalStore(c.subscribe, c.getState, c.getState);
}

export type { QueueState };
