// The data-access seam. The app talks to this interface; there are two implementations:
//  - supabaseRepo  (real backend, Row Level Security)
//  - memoryRepo    (local mode / tests: in-memory, optionally persisted to localStorage)
import type { GameSummary, MistakeDraft } from '@/analysis/types';
import type { StoredEval } from '@/engine/types';
import type {
  AnalysisStatus,
  AttemptRow,
  GameAnalysisRow,
  GameRow,
  MistakeRow,
  NewAttempt,
  NewGame,
  Profile,
  ProgressRow,
  PuzzleRow,
  SkillSnapshotRow,
  ThemeSkillRow,
  TrainingItem,
  TrainingItemDraft,
} from './types';

export interface SaveAnalysisInput {
  gameId: string;
  engine: string;
  depth: number;
  evals: StoredEval[];
  summary: GameSummary;
  mistakes: MistakeDraft[];
  trainingItems: TrainingItemDraft[];
}

export interface PuzzleQuery {
  theme: string;
  minRating?: number;
  maxRating?: number;
  limit?: number;
  /** puzzle ids to leave out */
  excludeIds?: string[];
}

export type ProfilePatch = Partial<Pick<Profile, 'displayName' | 'chesscomUsername' | 'settings' | 'lastSyncedAt'>>;

export interface Repo {
  readonly userId: string;
  readonly mode: 'supabase' | 'local';

  getProfile(): Promise<Profile>;
  updateProfile(patch: ProfilePatch): Promise<Profile>;

  listGames(): Promise<GameRow[]>;
  getGame(id: string): Promise<GameRow | null>;
  /** Insert, ignoring rows whose (userId, externalId) already exists. Returns only the new rows. */
  insertGames(games: NewGame[]): Promise<GameRow[]>;
  setGameStatus(id: string, status: AnalysisStatus): Promise<void>;
  /** Reset games stuck in 'running' (tab closed mid-analysis) back to 'pending'. */
  resetRunningGames(): Promise<number>;
  setGamePublic(id: string, isPublic: boolean): Promise<void>;
  setGameUserColor(id: string, color: 'w' | 'b'): Promise<void>;
  deleteGame(id: string): Promise<void>;

  getAnalysis(gameId: string): Promise<GameAnalysisRow | null>;
  listAnalyses(): Promise<GameAnalysisRow[]>;
  saveAnalysis(input: SaveAnalysisInput): Promise<MistakeRow[]>;

  listMistakes(): Promise<MistakeRow[]>;

  listTrainingItems(): Promise<TrainingItem[]>;
  /** Insert training items that are not tied to an analysis run (generated puzzles, backfilled variants). Duplicates are skipped. */
  addTrainingItems(items: TrainingItemDraft[]): Promise<number>;
  updateTrainingItem(id: string, patch: Partial<Pick<TrainingItem, 'box' | 'dueAt' | 'attempts' | 'correct' | 'lastResult'>>): Promise<void>;

  insertAttempt(a: NewAttempt): Promise<void>;
  listAttempts(opts?: { sinceIso?: string; limit?: number }): Promise<AttemptRow[]>;

  listThemeSkill(): Promise<ThemeSkillRow[]>;
  upsertThemeSkill(row: Pick<ThemeSkillRow, 'theme' | 'rating' | 'attempts'>): Promise<void>;

  insertSnapshot(profile: unknown, gamesAnalyzed: number): Promise<void>;
  listSnapshots(limit?: number): Promise<SkillSnapshotRow[]>;

  getProgress(): Promise<ProgressRow>;
  updateProgress(patch: Partial<Pick<ProgressRow, 'lessons' | 'openings' | 'daily' | 'play' | 'coach'>>): Promise<ProgressRow>;

  queryPuzzles(q: PuzzleQuery): Promise<PuzzleRow[]>;
  countPuzzlesByTheme(): Promise<Record<string, number>>;
  getPuzzles(ids: string[]): Promise<PuzzleRow[]>;
}
