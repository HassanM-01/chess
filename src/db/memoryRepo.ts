// In-memory Repo for local mode (no Supabase configured) and tests. Optionally persisted to a Storage.
import type { PuzzleRow } from './types';
import type { ProfilePatch, PuzzleQuery, Repo, SaveAnalysisInput } from './repo';
import type {
  AttemptRow,
  GameAnalysisRow,
  GameRow,
  MistakeRow,
  NewAttempt,
  NewGame,
  Profile,
  ProgressRow,
  SkillSnapshotRow,
  ThemeSkillRow,
  TrainingItem,
} from './types';

interface State {
  profile: Profile;
  games: GameRow[];
  analyses: GameAnalysisRow[];
  mistakes: MistakeRow[];
  training: TrainingItem[];
  attempts: AttemptRow[];
  themeSkill: ThemeSkillRow[];
  snapshots: SkillSnapshotRow[];
  progress: ProgressRow;
  attemptSeq: number;
  snapshotSeq: number;
}

const uuid = (): string => crypto.randomUUID();
const nowIso = (): string => new Date().toISOString();
const clone = <T>(x: T): T => structuredClone(x);

export interface MemoryRepoOptions {
  userId?: string;
  storage?: Pick<Storage, 'getItem' | 'setItem'> | null;
  storageKey?: string;
  puzzles?: PuzzleRow[];
  /** username to pre-fill the profile with */
  username?: string | null;
}

function emptyState(userId: string, username: string | null): State {
  const t = nowIso();
  return {
    profile: { id: userId, displayName: null, chesscomUsername: username, settings: {}, lastSyncedAt: null, createdAt: t },
    games: [],
    analyses: [],
    mistakes: [],
    training: [],
    attempts: [],
    themeSkill: [],
    snapshots: [],
    progress: { userId, lessons: {}, openings: {}, daily: {}, play: {}, updatedAt: t },
    attemptSeq: 1,
    snapshotSeq: 1,
  };
}

export function createMemoryRepo(opts: MemoryRepoOptions = {}): Repo & { _state: State; flush(): void } {
  const userId = opts.userId ?? 'local-user';
  const key = opts.storageKey ?? `bc-local-v1:${userId}`;
  const storage = opts.storage ?? null;
  const puzzles = opts.puzzles ?? [];
  let st = emptyState(userId, opts.username ?? null);
  if (storage) {
    try {
      const raw = storage.getItem(key);
      if (raw) st = { ...st, ...(JSON.parse(raw) as Partial<State>) };
    } catch {
      /* corrupt local data: start fresh */
    }
  }
  let timer: ReturnType<typeof setTimeout> | undefined;
  const flush = (): void => {
    if (!storage) return;
    try {
      storage.setItem(key, JSON.stringify(st));
    } catch {
      /* quota exceeded: ignore */
    }
  };
  const save = (): void => {
    if (!storage) return;
    clearTimeout(timer);
    timer = setTimeout(flush, 250);
  };

  const repo: Repo & { _state: State; flush(): void } = {
    userId,
    mode: 'local',
    get _state() {
      return st;
    },
    flush,

    async getProfile() {
      return clone(st.profile);
    },
    async updateProfile(patch: ProfilePatch) {
      const norm = patch.chesscomUsername !== undefined ? { chesscomUsername: patch.chesscomUsername ? patch.chesscomUsername.trim().toLowerCase() : null } : {};
      st.profile = { ...st.profile, ...patch, ...norm, settings: patch.settings ? { ...st.profile.settings, ...patch.settings } : st.profile.settings };
      save();
      return clone(st.profile);
    },

    async listGames() {
      return clone(st.games);
    },
    async getGame(id) {
      const g = st.games.find((x) => x.id === id);
      return g ? clone(g) : null;
    },
    async insertGames(games: NewGame[]) {
      const have = new Set(st.games.map((g) => g.externalId).filter((x): x is string => !!x));
      const out: GameRow[] = [];
      for (const g of games) {
        if (g.externalId) {
          if (have.has(g.externalId)) continue;
          have.add(g.externalId);
        }
        const row: GameRow = {
          ...g,
          id: uuid(),
          userId,
          analysisStatus: g.analysisStatus ?? 'pending',
          isPublic: g.isPublic ?? false,
          createdAt: nowIso(),
        };
        st.games.push(row);
        out.push(row);
      }
      save();
      return clone(out);
    },
    async setGameStatus(id, status) {
      const g = st.games.find((x) => x.id === id);
      if (g) g.analysisStatus = status;
      save();
    },
    async resetRunningGames() {
      let n = 0;
      for (const g of st.games) {
        if (g.analysisStatus === 'running') {
          g.analysisStatus = 'pending';
          n++;
        }
      }
      if (n) save();
      return n;
    },
    async setGamePublic(id, isPublic) {
      const g = st.games.find((x) => x.id === id);
      if (g) g.isPublic = isPublic;
      save();
    },
    async setGameUserColor(id, color) {
      const g = st.games.find((x) => x.id === id);
      if (g) {
        g.userColor = color;
        const r = g.result;
        g.outcome = r === '1/2-1/2' ? 'd' : r === '1-0' ? (color === 'w' ? 'w' : 'l') : r === '0-1' ? (color === 'b' ? 'w' : 'l') : null;
        g.analysisStatus = 'pending';
        st.analyses = st.analyses.filter((a) => a.gameId !== id);
        st.mistakes = st.mistakes.filter((m) => m.gameId !== id);
        st.training = st.training.filter((t) => t.gameId !== id);
      }
      save();
    },
    async deleteGame(id) {
      st.games = st.games.filter((g) => g.id !== id);
      st.analyses = st.analyses.filter((a) => a.gameId !== id);
      st.mistakes = st.mistakes.filter((m) => m.gameId !== id);
      st.training = st.training.filter((t) => t.gameId !== id);
      save();
    },

    async getAnalysis(gameId) {
      const a = st.analyses.find((x) => x.gameId === gameId);
      return a ? clone(a) : null;
    },
    async listAnalyses() {
      return clone(st.analyses);
    },
    async saveAnalysis(input: SaveAnalysisInput) {
      const game = st.games.find((g) => g.id === input.gameId);
      if (!game) throw new Error('game not found');
      st.analyses = st.analyses.filter((a) => a.gameId !== input.gameId);
      st.analyses.push({
        gameId: input.gameId,
        userId,
        engine: input.engine,
        depth: input.depth,
        evals: input.evals,
        summary: input.summary,
        createdAt: nowIso(),
      });
      st.mistakes = st.mistakes.filter((m) => m.gameId !== input.gameId);
      const byPly = new Map<number, string>();
      const rows: MistakeRow[] = input.mistakes.map((m) => {
        const id = uuid();
        byPly.set(m.ply, id);
        return { ...m, id, userId, gameId: input.gameId, playedAt: game.playedAt, createdAt: nowIso() };
      });
      st.mistakes.push(...rows);
      st.training = st.training.filter((t) => !(t.gameId === input.gameId && t.kind === 'own_mistake'));
      for (const d of input.trainingItems) {
        const exists = st.training.some((t) => t.kind === d.kind && t.gameId === d.gameId && t.ply === d.ply);
        if (exists) continue;
        st.training.push({
          id: uuid(),
          userId,
          kind: d.kind,
          mistakeId: d.kind === 'own_mistake' ? (byPly.get(d.ply) ?? null) : null,
          gameId: d.gameId,
          ply: d.ply,
          payload: d.payload,
          box: 0,
          dueAt: nowIso(),
          attempts: 0,
          correct: 0,
          lastResult: null,
          createdAt: nowIso(),
        });
      }
      game.analysisStatus = 'done';
      save();
      return clone(rows);
    },

    async listMistakes() {
      return clone(st.mistakes);
    },

    async listTrainingItems() {
      return clone(st.training);
    },
    async updateTrainingItem(id, patch) {
      const t = st.training.find((x) => x.id === id);
      if (t) Object.assign(t, patch);
      save();
    },

    async insertAttempt(a: NewAttempt) {
      st.attempts.push({ ...a, id: st.attemptSeq++, userId, createdAt: a.createdAt ?? nowIso() });
      save();
    },
    async listAttempts(o = {}) {
      let r = st.attempts.slice();
      if (o.sinceIso) r = r.filter((a) => a.createdAt >= (o.sinceIso as string));
      r.sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
      if (o.limit) r = r.slice(0, o.limit);
      return clone(r);
    },

    async listThemeSkill() {
      return clone(st.themeSkill);
    },
    async upsertThemeSkill(row) {
      const i = st.themeSkill.findIndex((t) => t.theme === row.theme);
      const next: ThemeSkillRow = { userId, ...row, updatedAt: nowIso() };
      if (i >= 0) st.themeSkill[i] = next;
      else st.themeSkill.push(next);
      save();
    },

    async insertSnapshot(profile, gamesAnalyzed) {
      st.snapshots.push({ id: st.snapshotSeq++, userId, profile: clone(profile), gamesAnalyzed, createdAt: nowIso() });
      save();
    },
    async listSnapshots(limit = 50) {
      return clone(st.snapshots.slice().sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1)).slice(0, limit));
    },

    async getProgress() {
      return clone(st.progress);
    },
    async updateProgress(patch) {
      st.progress = { ...st.progress, ...patch, updatedAt: nowIso() };
      save();
      return clone(st.progress);
    },

    async queryPuzzles(q: PuzzleQuery) {
      const ex = new Set(q.excludeIds ?? []);
      let r = puzzles.filter((p) => p.themes.includes(q.theme as never) && !ex.has(p.id));
      if (q.minRating != null) r = r.filter((p) => p.rating >= (q.minRating as number));
      if (q.maxRating != null) r = r.filter((p) => p.rating <= (q.maxRating as number));
      return clone(q.limit ? r.slice(0, q.limit) : r);
    },
    async countPuzzlesByTheme() {
      const out: Record<string, number> = {};
      for (const p of puzzles) for (const t of p.themes) out[t] = (out[t] ?? 0) + 1;
      return out;
    },
    async getPuzzles(ids) {
      const s = new Set(ids);
      return clone(puzzles.filter((p) => s.has(p.id)));
    },
  };
  return repo;
}
