// Skill profile (spec 6.3). Pure function: mistakes + games + summaries + attempts -> what the user should train.
import type { MistakeCategory } from '@/analysis/types';
import type { WeaknessKey } from '@/content/cats';
import { THEME_KEYS } from '@/content/themes';
import type { Phase } from '@/chess/tactics';
import type { PieceType } from '@/chess/types';
import type { AttemptRow, GameAnalysisRow, GameRow, MistakeRow, ThemeKey } from '@/db/types';

export interface Weakness {
  key: WeaknessKey;
  /** severity-weighted, recency-weighted mistakes per analyzed game */
  score: number;
  /** number of mistakes (habits: number of games showing the habit) */
  count: number;
  /** number of games it showed up in */
  games: number;
  topPiece?: PieceType;
}

export interface TrendEntry {
  key: string;
  /** mistakes per game in the last 14 days */
  recent: number;
  /** mistakes per game in the 14 days before that */
  previous: number;
}

export interface SkillProfile {
  gamesAnalyzed: number;
  record: { w: number; l: number; d: number };
  weaknesses: Weakness[];
  phases: Record<Phase, number>;
  /** how the user's LOSSES ended (checkmate, resignation, time...) */
  lossesBy: Record<string, number>;
  castledEarlyRate: number;
  blundersPerGame: number;
  mistakesPerGame: number;
  themeWeights: Record<ThemeKey, number>;
  trend: TrendEntry[];
  /** the most common piece lost to hung/ignored/fork mistakes */
  topPiece: PieceType | null;
  /** games where the user was worse after ~10 moves */
  openingBad: number;
  openingGames: number;
}

export const SEVERITY_WEIGHT = { blunder: 1.0, mistake: 0.6 } as const;
export const HALF_LIFE_DAYS = 14;
const DAY_MS = 86_400_000;

export const recencyWeight = (daysAgo: number): number => Math.pow(0.5, Math.max(0, daysAgo) / HALF_LIFE_DAYS);

/** category -> puzzle themes it feeds */
export const CATEGORY_THEMES: Record<MistakeCategory, ThemeKey[]> = {
  hung: ['save'],
  ignored: ['save'],
  missed_free: ['free'],
  fork: ['fork'],
  missed_mate: ['mate1', 'mate2'],
  allowed_mate: ['stopmate'],
  other: ['winmat'],
};

export interface SkillInput {
  /** the user's mistakes (only mistakes from games that count toward the profile) */
  mistakes: Pick<MistakeRow, 'gameId' | 'category' | 'severity' | 'phase' | 'piece' | 'playedAt' | 'createdAt'>[];
  /** analyzed games (done) that count (user color known, not bot games) */
  games: Pick<GameRow, 'id' | 'outcome' | 'playedAt' | 'createdAt'>[];
  summaries: Pick<GameAnalysisRow, 'gameId' | 'summary'>[];
  attempts: Pick<AttemptRow, 'theme' | 'correct' | 'createdAt'>[];
  now?: Date;
}

const gameTime = (g: { playedAt: string | null; createdAt: string }): number => new Date(g.playedAt ?? g.createdAt).getTime();
const mistakeTime = (m: { playedAt: string | null; createdAt: string }): number => new Date(m.playedAt ?? m.createdAt).getTime();

export function computeSkillProfile(input: SkillInput): SkillProfile {
  const now = (input.now ?? new Date()).getTime();
  const games = input.games;
  const gameIds = new Set(games.map((g) => g.id));
  const mistakes = input.mistakes.filter((m) => gameIds.has(m.gameId));
  const summaryOf = new Map(input.summaries.map((s) => [s.gameId, s.summary]));
  const n = games.length;

  const record = { w: 0, l: 0, d: 0 };
  for (const g of games) if (g.outcome) record[g.outcome]++;

  // ---- weakness scores per category
  const score: Partial<Record<MistakeCategory, number>> = {};
  const count: Partial<Record<MistakeCategory, number>> = {};
  const gamesWith: Partial<Record<MistakeCategory, Set<string>>> = {};
  const pieces: Partial<Record<MistakeCategory, Partial<Record<PieceType, number>>>> = {};
  const phases: Record<Phase, number> = { opening: 0, middlegame: 0, endgame: 0 };
  const allPieces: Partial<Record<PieceType, number>> = {};
  let blunders = 0;
  for (const m of mistakes) {
    const days = (now - mistakeTime(m)) / DAY_MS;
    score[m.category] = (score[m.category] ?? 0) + SEVERITY_WEIGHT[m.severity] * recencyWeight(days);
    count[m.category] = (count[m.category] ?? 0) + 1;
    (gamesWith[m.category] ??= new Set()).add(m.gameId);
    phases[m.phase]++;
    if (m.severity === 'blunder') blunders++;
    if (m.piece && (m.category === 'hung' || m.category === 'ignored' || m.category === 'fork')) {
      const p = (pieces[m.category] ??= {});
      p[m.piece] = (p[m.piece] ?? 0) + 1;
      allPieces[m.piece] = (allPieces[m.piece] ?? 0) + 1;
    }
  }
  const top = <T extends string>(o: Partial<Record<T, number>> | undefined): T | undefined => {
    if (!o) return undefined;
    const e = Object.entries(o) as [T, number][];
    e.sort((a, b) => b[1] - a[1]);
    return e[0]?.[0];
  };

  const ranked = (Object.keys(score) as MistakeCategory[])
    .filter((k) => k !== 'other')
    .map<Weakness>((k) => ({
      key: k,
      score: n ? (score[k] ?? 0) / n : 0,
      count: count[k] ?? 0,
      games: gamesWith[k]?.size ?? 0,
      topPiece: top(pieces[k]),
    }))
    .sort((a, b) => b.score - a.score);
  const weaknesses: Weakness[] = [];

  // ---- habit flags
  let castledEarly = 0;
  let earlyQueen = 0;
  let evalGames = 0;
  let openingBad = 0;
  for (const g of games) {
    const s = summaryOf.get(g.id);
    if (!s) continue;
    if (s.castled_move != null && s.castled_move <= 12) castledEarly++;
    if (s.early_queen) earlyQueen++;
    if (s.eval_after_10 != null) {
      evalGames++;
      if (s.eval_after_10 < 35) openingBad++;
    }
  }
  if (n >= 3 && castledEarly / n < 0.5) weaknesses.push({ key: 'nocastle', score: (n - castledEarly) / n, count: n - castledEarly, games: n - castledEarly });
  if (n >= 3 && earlyQueen / n >= 0.4) weaknesses.push({ key: 'earlyqueen', score: earlyQueen / n, count: earlyQueen, games: earlyQueen });

  // Habits take their slots first; categories (already sorted by score) fill the rest, 4 in total.
  const habitCount = weaknesses.length;
  weaknesses.unshift(...ranked.slice(0, Math.max(0, 4 - habitCount)));

  // ---- how losses ended
  const lossesBy: Record<string, number> = {};
  for (const g of games) {
    if (g.outcome !== 'l') continue;
    const how = summaryOf.get(g.id)?.how_ended ?? 'other';
    lossesBy[how] = (lossesBy[how] ?? 0) + 1;
  }

  // ---- theme weights: base 1 + 3 x normalized weakness + 2 if recent accuracy < 60%
  const themeScore: Partial<Record<ThemeKey, number>> = {};
  for (const [cat, sc] of Object.entries(score) as [MistakeCategory, number][]) {
    for (const t of CATEGORY_THEMES[cat]) themeScore[t] = (themeScore[t] ?? 0) + sc;
  }
  const maxThemeScore = Math.max(0, ...Object.values(themeScore));
  const recentByTheme = new Map<string, boolean[]>();
  for (const a of [...input.attempts].sort((x, y) => (x.createdAt < y.createdAt ? 1 : -1))) {
    if (!a.theme) continue;
    const arr = recentByTheme.get(a.theme) ?? [];
    if (arr.length < 20) arr.push(a.correct);
    recentByTheme.set(a.theme, arr);
  }
  const themeWeights = {} as Record<ThemeKey, number>;
  for (const t of THEME_KEYS) {
    let w = 1;
    if (maxThemeScore > 0) w += 3 * ((themeScore[t] ?? 0) / maxThemeScore);
    const r = recentByTheme.get(t);
    if (r && r.length >= 1 && r.filter(Boolean).length / r.length < 0.6) w += 2;
    themeWeights[t] = w;
  }

  // ---- trend: mistakes per game, last 14 days vs the 14 before
  const gamesIn = (from: number, to: number): number => games.filter((g) => gameTime(g) >= from && gameTime(g) < to).length;
  const t0 = now - 14 * DAY_MS;
  const t1 = now - 28 * DAY_MS;
  const gRecent = gamesIn(t0, now + DAY_MS);
  const gPrev = gamesIn(t1, t0);
  const trend: TrendEntry[] = [];
  if (gRecent > 0 && gPrev > 0) {
    const bucket = (key: (m: (typeof mistakes)[number]) => boolean, from: number, to: number): number =>
      mistakes.filter((m) => key(m) && mistakeTime(m) >= from && mistakeTime(m) < to).length;
    const keys: [string, (m: (typeof mistakes)[number]) => boolean][] = [
      ['hung', (m) => m.category === 'hung' || m.category === 'ignored'],
      ['missed_free', (m) => m.category === 'missed_free'],
      ['fork', (m) => m.category === 'fork'],
      ['missed_mate', (m) => m.category === 'missed_mate'],
      ['allowed_mate', (m) => m.category === 'allowed_mate'],
      ['blunders', (m) => m.severity === 'blunder'],
    ];
    for (const [key, f] of keys) {
      const recent = bucket(f, t0, now + DAY_MS) / gRecent;
      const previous = bucket(f, t1, t0) / gPrev;
      if (recent > 0 || previous > 0) trend.push({ key, recent: Math.round(recent * 100) / 100, previous: Math.round(previous * 100) / 100 });
    }
  }

  return {
    gamesAnalyzed: n,
    record,
    weaknesses: weaknesses.slice(0, 4),
    phases,
    lossesBy,
    castledEarlyRate: n ? castledEarly / n : 0,
    blundersPerGame: n ? blunders / n : 0,
    mistakesPerGame: n ? mistakes.length / n : 0,
    themeWeights,
    trend,
    topPiece: top(allPieces) ?? null,
    openingBad,
    openingGames: evalGames,
  };
}

/** Human sentence for a trend entry, e.g. "Hanging pieces: down 40% vs the previous 2 weeks". */
export function describeTrend(t: TrendEntry): string | null {
  const names: Record<string, string> = {
    hung: 'Hanging pieces',
    missed_free: 'Missed free pieces',
    fork: 'Forks allowed',
    missed_mate: 'Missed checkmates',
    allowed_mate: 'Checkmates allowed',
    blunders: 'Blunders per game',
  };
  const name = names[t.key] ?? t.key;
  if (t.previous === 0 && t.recent === 0) return null;
  if (t.previous === 0) return `${name}: new in the last 2 weeks`;
  const pct = Math.round(((t.recent - t.previous) / t.previous) * 100);
  if (Math.abs(pct) < 5) return `${name}: about the same as the previous 2 weeks`;
  return `${name}: ${pct < 0 ? 'down' : 'up'} ${Math.abs(pct)}% vs the previous 2 weeks`;
}
