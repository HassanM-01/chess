// Analysis queue (spec 6.2): analyzes every `pending` game, newest first, one at a time, resumable.
import type { Repo } from '@/db/repo';
import type { GameRow } from '@/db/types';
import type { Evaluator } from '@/engine/evalPos';
import { generateTrainingItems } from '@/skill/trainingItems';
import { ANALYSIS_DEPTH, ENGINE_TAG, analyzeFromEvals, evaluateGame } from './analyzeGame';

export interface QueueState {
  running: boolean;
  /** games in this run */
  total: number;
  /** finished games in this run (analyzed or errored) */
  done: number;
  /** 0..1 progress across the whole run */
  fraction: number;
  /** "vs Nahomxo" */
  label: string;
  errors: number;
  /** games analyzed successfully in the last completed/ongoing run */
  analyzed: number;
}

const IDLE: QueueState = { running: false, total: 0, done: 0, fraction: 0, label: '', errors: 0, analyzed: 0 };

export const opponentName = (g: Pick<GameRow, 'userColor' | 'white' | 'black'>): string =>
  (g.userColor === 'w' ? g.black : g.userColor === 'b' ? g.white : `${g.white ?? '?'} vs ${g.black ?? '?'}`) ?? 'opponent';

export class AnalysisQueue {
  private _state: QueueState = IDLE;
  private listeners = new Set<() => void>();
  private current: Promise<number> | null = null;
  private cancelled = false;

  constructor(
    private repo: Repo,
    private evalPos: Evaluator,
  ) {}

  get state(): QueueState {
    return this._state;
  }
  subscribe(cb: () => void): () => void {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  }
  private set(patch: Partial<QueueState>): void {
    this._state = { ...this._state, ...patch };
    this.listeners.forEach((l) => l());
  }

  cancel(): void {
    this.cancelled = true;
  }

  /** Reset games left in `running` by a closed tab, then analyze everything pending. Resolves with the number analyzed. */
  run(): Promise<number> {
    if (this.current) return this.current;
    this.current = this.loop().finally(() => {
      this.current = null;
    });
    return this.current;
  }

  private async loop(): Promise<number> {
    this.cancelled = false;
    this._state = { ...IDLE };
    await this.repo.resetRunningGames();
    let analyzed = 0;
    // Re-read the pending list after each batch so games added mid-run (a second "Pull") are picked up.
    for (;;) {
      const pending = (await this.repo.listGames())
        .filter((g) => g.analysisStatus === 'pending')
        .sort((a, b) => (b.playedAt ?? b.createdAt).localeCompare(a.playedAt ?? a.createdAt));
      if (!pending.length || this.cancelled) break;
      const base = this._state.running ? this._state.done : 0;
      this.set({ running: true, total: base + pending.length, done: base, fraction: base / (base + pending.length), analyzed });
      for (let i = 0; i < pending.length; i++) {
        if (this.cancelled) break;
        const g = pending[i];
        this.set({ label: `vs ${opponentName(g)}` });
        try {
          await this.analyzeOne(g, (f) => {
            const total = this._state.total || 1;
            this.set({ fraction: (this._state.done + f) / total });
          });
          analyzed++;
        } catch (e) {
          if (this.cancelled) {
            await this.repo.setGameStatus(g.id, 'pending').catch(() => undefined);
            break;
          }
          console.warn('analysis failed', g.id, e);
          await this.repo.setGameStatus(g.id, 'error').catch(() => undefined);
          this.set({ errors: this._state.errors + 1 });
        }
        this.set({ done: this._state.done + 1, analyzed });
      }
    }
    this.set({ running: false, fraction: analyzed || this._state.total ? 1 : 0, label: '', analyzed });
    return analyzed;
  }

  /** Analyze a single game and persist everything (analysis, mistakes, training items). */
  async analyzeOne(g: GameRow, onProgress?: (fraction: number) => void): Promise<void> {
    await this.repo.setGameStatus(g.id, 'running');
    const evals = await evaluateGame(g, this.evalPos, onProgress, () => this.cancelled);
    const { mistakes, summary } = analyzeFromEvals(g, evals);
    const trainingItems = generateTrainingItems(g, evals, mistakes, { gameId: g.id, opponent: opponentName(g) });
    await this.repo.saveAnalysis({ gameId: g.id, engine: ENGINE_TAG, depth: ANALYSIS_DEPTH, evals, summary, mistakes, trainingItems });
  }
}
