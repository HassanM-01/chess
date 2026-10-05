// Supabase implementation of Repo. Row Level Security does the real protection; every query is still scoped to userId.
import type { SupabaseClient } from '@supabase/supabase-js';
import type { GameSummary, MistakeCategory, Severity, Termination, Outcome } from '@/analysis/types';
import type { Phase } from '@/chess/tactics';
import type { Color, PieceType } from '@/chess/types';
import type { StoredEval } from '@/engine/types';
import type { ProfilePatch, PuzzleQuery, Repo, SaveAnalysisInput } from './repo';
import type {
  AnalysisStatus,
  AttemptRow,
  GameAnalysisRow,
  GameRow,
  GameSource,
  MistakeRow,
  NewAttempt,
  NewGame,
  Profile,
  ProfileSettings,
  ProgressRow,
  PuzzleRow,
  SkillSnapshotRow,
  ThemeKey,
  ThemeSkillRow,
  TrainingItem,
  TrainingKind,
  TrainingPayload,
} from './types';

// ---- snake_case row shapes ----------------------------------------------------------------------
interface ProfileDb {
  id: string;
  display_name: string | null;
  chesscom_username: string | null;
  settings: ProfileSettings | null;
  last_synced_at: string | null;
  created_at: string;
}
interface GameDb {
  id: string;
  user_id: string;
  source: GameSource;
  external_id: string | null;
  pgn: string;
  start_fen: string;
  moves_uci: string[];
  moves_san: string[];
  white: string | null;
  black: string | null;
  white_rating: number | null;
  black_rating: number | null;
  user_color: string | null;
  result: string | null;
  outcome: string | null;
  termination: string | null;
  time_class: string | null;
  opening: string | null;
  eco: string | null;
  played_at: string | null;
  analysis_status: AnalysisStatus;
  is_public: boolean;
  created_at: string;
}
interface AnalysisDb {
  game_id: string;
  user_id: string;
  engine: string;
  depth: number;
  evals: StoredEval[];
  summary: GameSummary;
  created_at: string;
}
interface MistakeDb {
  id: string;
  user_id: string;
  game_id: string;
  ply: number;
  fen: string;
  played_uci: string;
  played_san: string;
  best_uci: string | null;
  best_san: string | null;
  reply_uci: string | null;
  reply_san: string | null;
  category: MistakeCategory;
  severity: Severity;
  phase: Phase;
  piece: string | null;
  square: string | null;
  win_drop: number;
  explanation: string;
  played_at: string | null;
  created_at: string;
}
interface TrainingDb {
  id: string;
  user_id: string;
  kind: TrainingKind;
  mistake_id: string | null;
  game_id: string | null;
  ply: number | null;
  payload: TrainingPayload;
  box: number;
  due_at: string;
  attempts: number;
  correct: number;
  last_result: boolean | null;
  created_at: string;
}
interface AttemptDb {
  id: number;
  user_id: string;
  puzzle_id: string | null;
  training_item_id: string | null;
  theme: string | null;
  correct: boolean;
  used_hint: boolean;
  ms: number | null;
  created_at: string;
}
interface PuzzleDb {
  id: string;
  fen: string;
  moves: string[];
  themes: string[];
  rating: number;
  explanation: string | null;
  source: string;
  last_move: string | null;
  alts: string[] | null;
}
interface ProgressDb {
  user_id: string;
  lessons: Record<string, boolean>;
  openings: Record<string, number>;
  daily: ProgressRow['daily'];
  play: ProgressRow['play'];
  updated_at: string;
}

// ---- mappers -------------------------------------------------------------------------------------
export const mapProfile = (r: ProfileDb): Profile => ({
  id: r.id,
  displayName: r.display_name,
  chesscomUsername: r.chesscom_username,
  settings: r.settings ?? {},
  lastSyncedAt: r.last_synced_at,
  createdAt: r.created_at,
});

export const mapGame = (r: GameDb): GameRow => ({
  id: r.id,
  userId: r.user_id,
  source: r.source,
  externalId: r.external_id,
  pgn: r.pgn,
  startFen: r.start_fen,
  movesUci: r.moves_uci,
  movesSan: r.moves_san,
  white: r.white,
  black: r.black,
  whiteRating: r.white_rating,
  blackRating: r.black_rating,
  userColor: (r.user_color?.trim() as Color | undefined) ?? null,
  result: r.result,
  outcome: (r.outcome?.trim() as Outcome | undefined) ?? null,
  termination: r.termination as Termination | null,
  timeClass: r.time_class,
  opening: r.opening,
  eco: r.eco,
  playedAt: r.played_at,
  analysisStatus: r.analysis_status,
  isPublic: r.is_public,
  createdAt: r.created_at,
});

const gameToDb = (g: NewGame, userId: string): Record<string, unknown> => ({
  user_id: userId,
  source: g.source,
  external_id: g.externalId,
  pgn: g.pgn,
  start_fen: g.startFen,
  moves_uci: g.movesUci,
  moves_san: g.movesSan,
  white: g.white,
  black: g.black,
  white_rating: g.whiteRating,
  black_rating: g.blackRating,
  user_color: g.userColor,
  result: g.result,
  outcome: g.outcome,
  termination: g.termination,
  time_class: g.timeClass,
  opening: g.opening,
  eco: g.eco,
  played_at: g.playedAt,
  analysis_status: g.analysisStatus ?? 'pending',
  is_public: g.isPublic ?? false,
});

export const mapAnalysis = (r: AnalysisDb): GameAnalysisRow => ({
  gameId: r.game_id,
  userId: r.user_id,
  engine: r.engine,
  depth: r.depth,
  evals: r.evals,
  summary: r.summary,
  createdAt: r.created_at,
});

const mapMistake = (r: MistakeDb): MistakeRow => ({
  id: r.id,
  userId: r.user_id,
  gameId: r.game_id,
  ply: r.ply,
  fen: r.fen,
  playedUci: r.played_uci,
  playedSan: r.played_san,
  bestUci: r.best_uci,
  bestSan: r.best_san ?? '',
  replyUci: r.reply_uci,
  replySan: r.reply_san ?? '',
  category: r.category,
  severity: r.severity,
  phase: r.phase,
  piece: (r.piece?.trim() as PieceType | undefined) ?? null,
  square: r.square,
  winDrop: r.win_drop,
  explanation: r.explanation,
  playedAt: r.played_at,
  createdAt: r.created_at,
});

const mapTraining = (r: TrainingDb): TrainingItem => ({
  id: r.id,
  userId: r.user_id,
  kind: r.kind,
  mistakeId: r.mistake_id,
  gameId: r.game_id,
  ply: r.ply,
  payload: r.payload,
  box: r.box,
  dueAt: r.due_at,
  attempts: r.attempts,
  correct: r.correct,
  lastResult: r.last_result,
  createdAt: r.created_at,
});

const mapAttempt = (r: AttemptDb): AttemptRow => ({
  id: r.id,
  userId: r.user_id,
  puzzleId: r.puzzle_id,
  trainingItemId: r.training_item_id,
  theme: r.theme,
  correct: r.correct,
  usedHint: r.used_hint,
  ms: r.ms,
  createdAt: r.created_at,
});

export const mapPuzzle = (r: PuzzleDb): PuzzleRow => ({
  id: r.id,
  fen: r.fen,
  moves: r.moves,
  themes: r.themes as ThemeKey[],
  rating: r.rating,
  explanation: r.explanation,
  source: r.source,
  lastMove: r.last_move,
  alts: r.alts ?? undefined,
});

const mapProgress = (r: ProgressDb): ProgressRow => ({
  userId: r.user_id,
  lessons: r.lessons ?? {},
  openings: r.openings ?? {},
  daily: r.daily ?? {},
  play: r.play ?? {},
  updatedAt: r.updated_at,
});

// ---- helpers ---------------------------------------------------------------------------------------
class DbError extends Error {
  constructor(
    message: string,
    readonly code?: string,
  ) {
    super(message);
  }
}
function ok<T>(res: { data: T | null; error: { message: string; code?: string } | null }): T {
  if (res.error) throw new DbError(res.error.message, res.error.code);
  return res.data as T;
}
const chunk = <T>(a: T[], n: number): T[][] => {
  const out: T[][] = [];
  for (let i = 0; i < a.length; i += n) out.push(a.slice(i, i + n));
  return out;
};
const PAGE = 1000;

export function createSupabaseRepo(sb: SupabaseClient, userId: string): Repo {
  /** page through a select; PostgREST caps responses at 1000 rows */
  async function selectAll<T>(table: string, build: (q: ReturnType<SupabaseClient['from']>) => unknown): Promise<T[]> {
    const rows: T[] = [];
    for (let from = 0; ; from += PAGE) {
      const q = build(sb.from(table)) as { range(a: number, b: number): PromiseLike<{ data: T[] | null; error: { message: string; code?: string } | null }> };
      const page = ok(await q.range(from, from + PAGE - 1)) ?? [];
      rows.push(...page);
      if (page.length < PAGE) break;
    }
    return rows;
  }

  const repo: Repo = {
    userId,
    mode: 'supabase',

    async getProfile() {
      const { data, error } = await sb.from('profiles').select('*').eq('id', userId).maybeSingle();
      if (error) throw new DbError(error.message, error.code);
      if (data) return mapProfile(data as ProfileDb);
      // The signup trigger should have created it; create defensively if an old user predates it.
      throw new DbError('Profile not found');
    },
    async updateProfile(patch: ProfilePatch) {
      const cur = await repo.getProfile();
      const row: Record<string, unknown> = {};
      if (patch.displayName !== undefined) row.display_name = patch.displayName;
      if (patch.chesscomUsername !== undefined) row.chesscom_username = patch.chesscomUsername ? patch.chesscomUsername.trim().toLowerCase() : null;
      if (patch.settings !== undefined) row.settings = { ...cur.settings, ...patch.settings };
      if (patch.lastSyncedAt !== undefined) row.last_synced_at = patch.lastSyncedAt;
      if (!Object.keys(row).length) return cur;
      return mapProfile(ok(await sb.from('profiles').update(row).eq('id', userId).select('*').single()) as ProfileDb);
    },

    async listGames() {
      const rows = await selectAll<GameDb>('games', (q) => q.select('*').eq('user_id', userId).order('played_at', { ascending: false, nullsFirst: false }).order('id'));
      return rows.map(mapGame);
    },
    async getGame(id) {
      const { data, error } = await sb.from('games').select('*').eq('id', id).eq('user_id', userId).maybeSingle();
      if (error) throw new DbError(error.message, error.code);
      return data ? mapGame(data as GameDb) : null;
    },
    async insertGames(games) {
      const out: GameRow[] = [];
      for (const part of chunk(games, 50)) {
        const rows = part.map((g) => gameToDb(g, userId));
        const res = ok(
          await sb
            .from('games')
            .upsert(rows, { onConflict: 'user_id,external_id', ignoreDuplicates: true })
            .select('*'),
        ) as GameDb[] | null;
        out.push(...(res ?? []).map(mapGame));
      }
      return out;
    },
    async setGameStatus(id, status) {
      ok(await sb.from('games').update({ analysis_status: status }).eq('id', id).eq('user_id', userId).select('id'));
    },
    async resetRunningGames() {
      const res = ok(await sb.from('games').update({ analysis_status: 'pending' }).eq('user_id', userId).eq('analysis_status', 'running').select('id')) as { id: string }[] | null;
      return res?.length ?? 0;
    },
    async setGamePublic(id, isPublic) {
      ok(await sb.from('games').update({ is_public: isPublic }).eq('id', id).eq('user_id', userId).select('id'));
    },
    async setGameUserColor(id, color) {
      const g = await repo.getGame(id);
      if (!g) return;
      const r = g.result;
      const outcome = r === '1/2-1/2' ? 'd' : r === '1-0' ? (color === 'w' ? 'w' : 'l') : r === '0-1' ? (color === 'b' ? 'w' : 'l') : null;
      ok(await sb.from('games').update({ user_color: color, outcome, analysis_status: 'pending' }).eq('id', id).eq('user_id', userId).select('id'));
      ok(await sb.from('game_analysis').delete().eq('game_id', id).eq('user_id', userId).select('game_id'));
      ok(await sb.from('mistakes').delete().eq('game_id', id).eq('user_id', userId).select('id'));
      ok(await sb.from('training_items').delete().eq('game_id', id).eq('user_id', userId).select('id'));
    },
    async deleteGame(id) {
      ok(await sb.from('games').delete().eq('id', id).eq('user_id', userId).select('id'));
    },

    async getAnalysis(gameId) {
      const { data, error } = await sb.from('game_analysis').select('*').eq('game_id', gameId).eq('user_id', userId).maybeSingle();
      if (error) throw new DbError(error.message, error.code);
      return data ? mapAnalysis(data as AnalysisDb) : null;
    },
    async listAnalyses() {
      const rows = await selectAll<AnalysisDb>('game_analysis', (q) => q.select('game_id,user_id,engine,depth,summary,created_at,evals').eq('user_id', userId).order('game_id'));
      return rows.map(mapAnalysis);
    },
    async saveAnalysis(input: SaveAnalysisInput) {
      const game = await repo.getGame(input.gameId);
      if (!game) throw new DbError('game not found');
      ok(
        await sb.from('game_analysis').upsert(
          { game_id: input.gameId, user_id: userId, engine: input.engine, depth: input.depth, evals: input.evals, summary: input.summary },
          { onConflict: 'game_id' },
        ).select('game_id'),
      );
      // Re-analysis replaces mistakes (their own_mistake training items cascade away).
      ok(await sb.from('mistakes').delete().eq('game_id', input.gameId).eq('user_id', userId).select('id'));
      let mistakes: MistakeRow[] = [];
      if (input.mistakes.length) {
        const rows = input.mistakes.map((m) => ({
          user_id: userId,
          game_id: input.gameId,
          ply: m.ply,
          fen: m.fen,
          played_uci: m.playedUci,
          played_san: m.playedSan,
          best_uci: m.bestUci,
          best_san: m.bestSan,
          reply_uci: m.replyUci,
          reply_san: m.replySan,
          category: m.category,
          severity: m.severity,
          phase: m.phase,
          piece: m.piece,
          square: m.square,
          win_drop: m.winDrop,
          explanation: m.explanation,
          played_at: game.playedAt,
        }));
        mistakes = (ok(await sb.from('mistakes').insert(rows).select('*')) as MistakeDb[]).map(mapMistake);
      }
      const idByPly = new Map(mistakes.map((m) => [m.ply, m.id]));
      if (input.trainingItems.length) {
        const rows = input.trainingItems.map((t) => ({
          user_id: userId,
          kind: t.kind,
          game_id: t.gameId,
          ply: t.ply,
          mistake_id: t.kind === 'own_mistake' ? (idByPly.get(t.ply) ?? null) : null,
          payload: t.payload,
        }));
        for (const part of chunk(rows, 100)) {
          ok(await sb.from('training_items').upsert(part, { onConflict: 'user_id,kind,game_id,ply', ignoreDuplicates: true }).select('id'));
        }
      }
      ok(await sb.from('games').update({ analysis_status: 'done' }).eq('id', input.gameId).eq('user_id', userId).select('id'));
      return mistakes;
    },

    async listMistakes() {
      const rows = await selectAll<MistakeDb>('mistakes', (q) => q.select('*').eq('user_id', userId).order('id'));
      return rows.map(mapMistake);
    },

    async listTrainingItems() {
      const rows = await selectAll<TrainingDb>('training_items', (q) => q.select('*').eq('user_id', userId).order('id'));
      return rows.map(mapTraining);
    },
    async updateTrainingItem(id, patch) {
      const row: Record<string, unknown> = {};
      if (patch.box !== undefined) row.box = patch.box;
      if (patch.dueAt !== undefined) row.due_at = patch.dueAt;
      if (patch.attempts !== undefined) row.attempts = patch.attempts;
      if (patch.correct !== undefined) row.correct = patch.correct;
      if (patch.lastResult !== undefined) row.last_result = patch.lastResult;
      ok(await sb.from('training_items').update(row).eq('id', id).eq('user_id', userId).select('id'));
    },

    async insertAttempt(a: NewAttempt) {
      ok(
        await sb.from('attempts').insert({
          user_id: userId,
          puzzle_id: a.puzzleId,
          training_item_id: a.trainingItemId,
          theme: a.theme,
          correct: a.correct,
          used_hint: a.usedHint,
          ms: a.ms,
          ...(a.createdAt ? { created_at: a.createdAt } : {}),
        }).select('id'),
      );
    },
    async listAttempts(o = {}) {
      let q = sb.from('attempts').select('*').eq('user_id', userId).order('created_at', { ascending: false });
      if (o.sinceIso) q = q.gte('created_at', o.sinceIso);
      q = q.limit(o.limit ?? 1000);
      return (ok(await q) as AttemptDb[]).map(mapAttempt);
    },

    async listThemeSkill() {
      const rows = ok(await sb.from('theme_skill').select('*').eq('user_id', userId)) as { user_id: string; theme: string; rating: number; attempts: number; updated_at: string }[];
      return rows.map<ThemeSkillRow>((r) => ({ userId: r.user_id, theme: r.theme, rating: r.rating, attempts: r.attempts, updatedAt: r.updated_at }));
    },
    async upsertThemeSkill(row) {
      ok(
        await sb.from('theme_skill').upsert(
          { user_id: userId, theme: row.theme, rating: row.rating, attempts: row.attempts, updated_at: new Date().toISOString() },
          { onConflict: 'user_id,theme' },
        ).select('theme'),
      );
    },

    async insertSnapshot(profile, gamesAnalyzed) {
      ok(await sb.from('skill_snapshots').insert({ user_id: userId, profile, games_analyzed: gamesAnalyzed }).select('id'));
    },
    async listSnapshots(limit = 50) {
      const rows = ok(await sb.from('skill_snapshots').select('*').eq('user_id', userId).order('created_at', { ascending: false }).limit(limit)) as {
        id: number;
        user_id: string;
        profile: unknown;
        games_analyzed: number;
        created_at: string;
      }[];
      return rows.map<SkillSnapshotRow>((r) => ({ id: r.id, userId: r.user_id, profile: r.profile, gamesAnalyzed: r.games_analyzed, createdAt: r.created_at }));
    },

    async getProgress() {
      const { data, error } = await sb.from('progress').select('*').eq('user_id', userId).maybeSingle();
      if (error) throw new DbError(error.message, error.code);
      if (data) return mapProgress(data as ProgressDb);
      return mapProgress(ok(await sb.from('progress').upsert({ user_id: userId }, { onConflict: 'user_id' }).select('*').single()) as ProgressDb);
    },
    async updateProgress(patch) {
      const row = { ...patch, updated_at: new Date().toISOString() };
      return mapProgress(ok(await sb.from('progress').update(row).eq('user_id', userId).select('*').single()) as ProgressDb);
    },

    async queryPuzzles(q: PuzzleQuery) {
      const exclude = new Set(q.excludeIds ?? []);
      let query = sb.from('puzzles').select('*').contains('themes', [q.theme]);
      if (q.minRating != null) query = query.gte('rating', q.minRating);
      if (q.maxRating != null) query = query.lte('rating', q.maxRating);
      query = query.limit((q.limit ?? 300) + exclude.size);
      const rows = ok(await query) as PuzzleDb[];
      const mapped = rows.filter((r) => !exclude.has(r.id)).map(mapPuzzle);
      return q.limit ? mapped.slice(0, q.limit) : mapped;
    },
    async countPuzzlesByTheme() {
      const themes: ThemeKey[] = ['save', 'free', 'fork', 'stopmate', 'mate1', 'mate2', 'winmat'];
      const out: Record<string, number> = {};
      await Promise.all(
        themes.map(async (t) => {
          const { count, error } = await sb.from('puzzles').select('id', { count: 'exact', head: true }).contains('themes', [t]);
          if (error) throw new DbError(error.message, error.code);
          out[t] = count ?? 0;
        }),
      );
      return out;
    },
    async getPuzzles(ids) {
      if (!ids.length) return [];
      const out: PuzzleRow[] = [];
      for (const part of chunk(ids, 100)) out.push(...(ok(await sb.from('puzzles').select('*').in('id', part)) as PuzzleDb[]).map(mapPuzzle));
      return out;
    },
  };
  return repo;
}

/** Public read-only fetch for /share/:gameId (works signed out thanks to the is_public RLS policy). */
export async function fetchPublicGame(sb: SupabaseClient, gameId: string): Promise<{ game: GameRow; analysis: GameAnalysisRow } | null> {
  const g = await sb.from('games').select('*').eq('id', gameId).eq('is_public', true).maybeSingle();
  if (g.error) throw new DbError(g.error.message, g.error.code);
  if (!g.data) return null;
  const a = await sb.from('game_analysis').select('*').eq('game_id', gameId).maybeSingle();
  if (a.error) throw new DbError(a.error.message, a.error.code);
  if (!a.data) return null;
  return { game: mapGame(g.data as GameDb), analysis: mapAnalysis(a.data as AnalysisDb) };
}
