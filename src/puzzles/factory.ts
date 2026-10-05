// The puzzle factory: decides WHAT this user needs (from their skill profile), then builds it.
//   1. mine tactical moments from the user's own analyzed games (fast, most personal)
//   2. top up with beginner-level self-play for themes the games could not supply
// Everything it keeps was verified by the engine. Results are stored as training items, so they share spaced repetition.
import type { QueryClient } from '@tanstack/react-query';
import { gameFens } from '@/chess/helpers';
import { sideToMove } from '@/chess/helpers';
import { THEME_KEYS } from '@/content/themes';
import type { Repo } from '@/db/repo';
import type { GeneratedPayload, ThemeKey, TrainingItemDraft } from '@/db/types';
import type { Engine } from '@/engine/engine';
import { loadSkillProfile } from '@/skill/profileData';
import type { MinedPuzzle } from './mine';
import { fenKey, mineFromGames, minePuzzles, type AnalyzedGame, type MineOptions } from './mineRun';

/** How many unplayed personal puzzles to keep in stock overall; split across themes by need. */
export const STOCK_GOAL = 30;
export const MIN_PER_THEME = 2;

export interface FactoryState {
  phase: 'idle' | 'running' | 'done' | 'error';
  found: number;
  /** puzzles still wanted when the run started */
  target: number;
  label: string;
  error: string | null;
}

const IDLE: FactoryState = { phase: 'idle', found: 0, target: 0, label: '', error: null };

/** Split `goal` puzzles across themes in proportion to the user's weights, never fewer than a floor per theme. */
export function stockTargets(weights: Record<ThemeKey, number>, goal = STOCK_GOAL, floor = MIN_PER_THEME): Record<ThemeKey, number> {
  const sum = THEME_KEYS.reduce((a, k) => a + (weights[k] ?? 1), 0) || 1;
  const out = {} as Record<ThemeKey, number>;
  for (const k of THEME_KEYS) out[k] = Math.max(floor, Math.round((goal * (weights[k] ?? 1)) / sum));
  return out;
}

export function toDraft(p: MinedPuzzle, ordinal: number): TrainingItemDraft {
  const payload: GeneratedPayload = {
    pool: 'gen',
    theme: p.theme,
    fen: p.fen,
    me: sideToMove(p.fen),
    lastMove: p.lastMove,
    opponent: '',
    moves: p.moves,
    alts: p.alts.length ? p.alts : undefined,
    explain: p.explain,
    rating: p.rating,
  };
  return { kind: 'generated', gameId: null, ply: ordinal, payload };
}

export interface BuildOptions {
  /** override what to build (tests); otherwise derived from the skill profile */
  wanted?: Partial<Record<ThemeKey, number>>;
  maxMs?: number;
  /** include beginner-level self-play after mining the user's games (default true) */
  selfPlay?: boolean;
  scanDepth?: number;
  verifyDepth?: number;
  rng?: () => number;
}

export class PuzzleFactory {
  state: FactoryState = IDLE;
  private listeners = new Set<() => void>();
  private cancelled = false;
  private current: Promise<number> | null = null;

  constructor(
    private repo: Repo,
    private engine: Pick<Engine, 'run'>,
    private qc?: QueryClient,
  ) {}

  subscribe = (cb: () => void): (() => void) => {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  };
  getState = (): FactoryState => this.state;
  private set(patch: Partial<FactoryState>): void {
    this.state = { ...this.state, ...patch };
    this.listeners.forEach((l) => l());
  }
  cancel(): void {
    this.cancelled = true;
  }
  get running(): boolean {
    return this.current !== null;
  }

  /** What is missing, per theme, given the user's weaknesses and the personal puzzles already in stock. */
  async plan(): Promise<{ wanted: Partial<Record<ThemeKey, number>>; seen: Set<string>; total: number }> {
    const [profile, items] = await Promise.all([loadSkillProfile(this.repo), this.repo.listTrainingItems()]);
    const targets = stockTargets(profile.themeWeights);
    const seen = new Set<string>();
    const stock: Partial<Record<ThemeKey, number>> = {};
    for (const it of items) {
      if (it.payload.pool !== 'gen') continue;
      seen.add(fenKey(it.payload.fen));
      if (it.attempts === 0) stock[it.payload.theme] = (stock[it.payload.theme] ?? 0) + 1;
    }
    const wanted: Partial<Record<ThemeKey, number>> = {};
    let total = 0;
    for (const k of THEME_KEYS) {
      const need = Math.max(0, targets[k] - (stock[k] ?? 0));
      if (need > 0) {
        wanted[k] = need;
        total += need;
      }
    }
    return { wanted, seen, total };
  }

  /** Build personal puzzles. Resolves with how many were added. Safe to call repeatedly: a second call joins the first. */
  build(o: BuildOptions = {}): Promise<number> {
    if (this.current) return this.current;
    this.current = this.run(o).finally(() => {
      this.current = null;
    });
    return this.current;
  }

  private async run(o: BuildOptions): Promise<number> {
    this.cancelled = false;
    this.foundByTheme = {};
    this.set({ ...IDLE, phase: 'running', label: 'Looking at what you need…' });
    try {
      const plan = await this.plan();
      const wanted = o.wanted ?? plan.wanted;
      const total = Object.values(wanted).reduce((a, b) => a + (b ?? 0), 0);
      if (total === 0) {
        this.set({ phase: 'done', label: 'Your puzzle stock is full.', target: 0 });
        return 0;
      }
      this.set({ target: total, label: 'Searching your own games…' });
      let ordinal = Math.floor(Date.now() / 1000) % 2_000_000_000;
      let added = 0;
      const base: MineOptions = {
        engine: this.engine,
        wanted,
        seen: plan.seen,
        scanDepth: o.scanDepth,
        verifyDepth: o.verifyDepth,
        rng: o.rng,
        maxMs: o.maxMs ?? 180_000,
        shouldStop: () => this.cancelled,
        onFound: async (p) => {
          const n = await this.repo.addTrainingItems([toDraft(p, ordinal++)]);
          added += n;
          if (n) this.foundByTheme[p.theme] = (this.foundByTheme[p.theme] ?? 0) + 1;
          this.set({ found: added, label: `Made ${added} for you…` });
          void this.qc?.invalidateQueries({ queryKey: [this.repo.userId, 'training'] });
        },
        onProgress: ({ source }) => {
          if (source === 'self-play') this.set({ label: `Made ${added} for you. Building more targeted at your weak spots…` });
        },
      };

      const deadline = Date.now() + (o.maxMs ?? 180_000);
      const games = await this.analyzedGames();
      await mineFromGames(base, games);
      // whatever the user's games could not supply is made by self-play, with the time that is left
      const remainingWanted = this.stillWanted(wanted);
      if (o.selfPlay !== false && !this.cancelled && Date.now() < deadline && Object.keys(remainingWanted).length) {
        this.set({ label: `Made ${added} for you. Building more targeted at your weak spots…` });
        await minePuzzles({ ...base, wanted: remainingWanted, maxMs: Math.max(1000, deadline - Date.now()) });
      }
      this.set({ phase: 'done', found: added, label: added ? `Made ${added} new puzzle${added === 1 ? '' : 's'} for you.` : 'No new puzzles this time. They will come as you play more games.' });
      return added;
    } catch (e) {
      console.warn('puzzle factory failed', e);
      const needsMigration = /enum|training_kind|invalid input value/i.test(String((e as Error)?.message ?? e));
      this.set({
        phase: 'error',
        error: needsMigration ? 'The database needs the 0004 migration before personal puzzles can be saved.' : 'Could not build puzzles right now.',
        label: '',
      });
      return 0;
    } finally {
      void this.qc?.invalidateQueries({ queryKey: [this.repo.userId, 'training'] });
    }
  }

  private foundByTheme: Partial<Record<ThemeKey, number>> = {};
  private stillWanted(wanted: Partial<Record<ThemeKey, number>>): Partial<Record<ThemeKey, number>> {
    const out: Partial<Record<ThemeKey, number>> = {};
    for (const k of THEME_KEYS) {
      const left = (wanted[k] ?? 0) - (this.foundByTheme[k] ?? 0);
      if (left > 0) out[k] = left;
    }
    return out;
  }

  private async analyzedGames(): Promise<AnalyzedGame[]> {
    const [games, analyses] = await Promise.all([this.repo.listGames(), this.repo.listAnalyses()]);
    const evalsOf = new Map(analyses.map((a) => [a.gameId, a.evals]));
    // newest games first: they reflect the user's current habits
    return games
      .filter((g) => evalsOf.has(g.id) && (g.source === 'chesscom' || g.source === 'pgn'))
      .sort((a, b) => (b.playedAt ?? b.createdAt).localeCompare(a.playedAt ?? a.createdAt))
      .map((g) => ({ fens: gameFens(g.startFen, g.movesUci), evals: evalsOf.get(g.id) as AnalyzedGame['evals'], moves: g.movesUci }));
  }
}
