// Domain types for the Supabase tables (spec section 4), camelCase. The Supabase repo maps to/from snake_case rows.
import type { GameSummary, MistakeCategory, MistakeDraft, Outcome, Severity, Termination } from '@/analysis/types';
import type { Phase } from '@/chess/tactics';
import type { CoachState } from '@/coach/types';
import type { Color, PieceType, Square, Uci } from '@/chess/types';
import type { StoredEval } from '@/engine/types';

export type GameSource = 'chesscom' | 'pgn' | 'bot' | 'london';
export type AnalysisStatus = 'pending' | 'running' | 'done' | 'error' | 'skipped';
export type TrainingKind = 'own_mistake' | 'threat' | 'judge' | 'punish' | 'variant' | 'generated';
export type ThemeKey = 'save' | 'free' | 'fork' | 'stopmate' | 'mate1' | 'mate2' | 'winmat';

export interface ProfileSettings {
  /** bot level index 0..4 */
  level?: number;
  /** 'w' | 'b' | 'r' (random) */
  color?: 'w' | 'b' | 'r';
  blunderCheck?: boolean;
  londonGuide?: boolean;
  londonLevel?: number;
  /** walkthrough quiz toggle */
  wtQuiz?: boolean;
  theme?: 'light' | 'dark' | 'system';
}

export interface Profile {
  id: string;
  displayName: string | null;
  chesscomUsername: string | null;
  settings: ProfileSettings;
  lastSyncedAt: string | null;
  createdAt: string;
}

export interface GameRow {
  id: string;
  userId: string;
  source: GameSource;
  externalId: string | null;
  pgn: string;
  startFen: string;
  movesUci: Uci[];
  movesSan: string[];
  white: string | null;
  black: string | null;
  whiteRating: number | null;
  blackRating: number | null;
  userColor: Color | null;
  result: string | null;
  outcome: Outcome | null;
  termination: Termination | null;
  timeClass: string | null;
  opening: string | null;
  eco: string | null;
  playedAt: string | null;
  analysisStatus: AnalysisStatus;
  isPublic: boolean;
  createdAt: string;
}

/** What parsers / bot games provide; the repo fills id, userId, createdAt. */
export type NewGame = Omit<GameRow, 'id' | 'userId' | 'createdAt' | 'analysisStatus' | 'isPublic'> & {
  analysisStatus?: AnalysisStatus;
  isPublic?: boolean;
};

export interface GameAnalysisRow {
  gameId: string;
  userId: string;
  engine: string;
  depth: number;
  evals: StoredEval[];
  summary: GameSummary;
  createdAt: string;
}

export interface MistakeRow extends Omit<MistakeDraft, 'piece' | 'square'> {
  id: string;
  userId: string;
  gameId: string;
  piece: PieceType | null;
  square: Square | null;
  category: MistakeCategory;
  severity: Severity;
  phase: Phase;
  playedAt: string | null;
  createdAt: string;
}

export interface PuzzleRow {
  id: string;
  fen: string; // solver to move
  moves: Uci[]; // solver, reply, solver, ...
  themes: ThemeKey[];
  rating: number;
  explanation: string | null;
  source: string;
  /** the opponent move just played (shown as last-move highlight) */
  lastMove?: Uci | null;
  /** alternative accepted first moves (mate1 / stopmate) */
  alts?: Uci[];
}

// ---- training items ----------------------------------------------------------------------

export type TrainingPool = 'own' | 'threat' | 'calm' | 'blunder' | 'safe' | 'punish' | 'gen';

interface PayloadBase {
  pool: TrainingPool;
  fen: string;
  me: Color;
  lastMove: Uci | null;
  /** opponent name, shown as "From your game vs X" */
  opponent: string;
}
export interface OwnMistakePayload extends PayloadBase {
  pool: 'own';
  /** set when this is a mirrored / colour-swapped copy of one of the user's real mistakes */
  variant?: 'mirror' | 'swap' | 'both';
  /** ply of the original mistake (for "See game") */
  srcPly?: number;
  best: Uci;
  bestSan: string;
  san: string;
  uci: Uci;
  text: string;
  cat: MistakeCategory;
  evBest: StoredEval;
}
export interface ThreatPayload extends PayloadBase {
  pool: 'threat' | 'calm';
  lastSan: string;
  /** squares of your pieces in danger (empty = nothing is in danger) */
  answer: Square[];
  /** attacker->target pairs like 'f6e4' for arrows */
  attackers: string[];
  explain: string;
}
export interface JudgePayload extends PayloadBase {
  pool: 'blunder' | 'safe';
  move: Uci;
  san: string;
  reply: Uci | null;
  verdict: 'safe' | 'blunder';
  explain: string;
}
export interface PunishPayload extends PayloadBase {
  pool: 'punish';
  best: Uci;
  bestSan: string;
  san: string;
  uci: Uci;
  text: string;
  sub: string;
  doneText: string;
  evBest: StoredEval;
}
/** A puzzle the app built for this user (self-play mining, verified by the engine to have one clear solution). */
export interface GeneratedPayload extends PayloadBase {
  pool: 'gen';
  theme: ThemeKey;
  /** solver move, reply, solver move ... */
  moves: Uci[];
  /** other accepted first moves (mate in one with several mates) */
  alts?: Uci[];
  explain: string;
  rating: number;
}
export type TrainingPayload = OwnMistakePayload | ThreatPayload | JudgePayload | PunishPayload | GeneratedPayload;

export interface TrainingItemDraft {
  kind: TrainingKind;
  /** null for generated puzzles, which belong to no game */
  gameId: string | null;
  ply: number;
  /** variants point at the mistake they were made from (so re-analysis removes them with it) */
  srcPly?: number;
  mistakeId?: string | null;
  payload: TrainingPayload;
}

export interface TrainingItem {
  id: string;
  userId: string;
  kind: TrainingKind;
  mistakeId: string | null;
  gameId: string | null;
  ply: number | null;
  payload: TrainingPayload;
  box: number;
  dueAt: string;
  attempts: number;
  correct: number;
  lastResult: boolean | null;
  createdAt: string;
}

export interface AttemptRow {
  id: number;
  userId: string;
  puzzleId: string | null;
  trainingItemId: string | null;
  theme: string | null;
  correct: boolean;
  usedHint: boolean;
  ms: number | null;
  createdAt: string;
}
export type NewAttempt = Omit<AttemptRow, 'id' | 'userId' | 'createdAt'> & { createdAt?: string };

export interface ThemeSkillRow {
  userId: string;
  theme: string;
  rating: number;
  attempts: number;
  updatedAt: string;
}

export interface SkillSnapshotRow {
  id: number;
  userId: string;
  profile: unknown; // SkillProfile (see skill/computeSkillProfile.ts)
  gamesAnalyzed: number;
  createdAt: string;
}

export interface DailyState {
  /** local date key YYYY-MM-DD */
  date?: string;
  trainer?: boolean;
  puzzles?: number;
  lesson?: number;
  played?: boolean;
  drills?: number;
}
export interface PlayStats {
  caught?: number;
  games?: number;
  wins?: number;
  london?: { games?: number; wins?: number };
}
export interface ProgressRow {
  userId: string;
  /** the AI coach's latest report (see src/coach) */
  coach: CoachState;
  lessons: Record<string, boolean>;
  openings: Record<string, number>;
  daily: DailyState;
  play: PlayStats & Record<string, unknown>;
  updatedAt: string;
}
