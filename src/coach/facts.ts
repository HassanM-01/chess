// The "facts packet": everything the coach is allowed to say, as plain data computed by the engine and the app.
// The AI never gets raw positions to analyse; it gets conclusions the engine already reached and is told not to go beyond them.
import { opponentName } from '@/analysis/queue';
import { moveNumberLabel } from '@/chess/helpers';
import { CATS, weakInfo } from '@/content/cats';
import { LESSONS } from '@/content/lessons';
import { THEMES } from '@/content/themes';
import type { AttemptRow, GameRow, MistakeRow, ProgressRow, ThemeSkillRow, TrainingItem } from '@/db/types';
import { describeTrend, type SkillProfile } from '@/skill/computeSkillProfile';
import { pieceName } from '@/chess/tactics';
import { isDue } from '@/skill/leitner';

const DAY = 86_400_000;

export interface FactsInput {
  profile: SkillProfile;
  username: string | null;
  games: Pick<GameRow, 'id' | 'white' | 'black' | 'userColor' | 'playedAt' | 'createdAt' | 'source' | 'movesSan' | 'startFen' | 'whiteRating' | 'blackRating'>[];
  mistakes: Pick<MistakeRow, 'gameId' | 'ply' | 'playedSan' | 'bestSan' | 'category' | 'severity' | 'explanation' | 'playedAt' | 'createdAt'>[];
  attempts: Pick<AttemptRow, 'theme' | 'correct' | 'usedHint' | 'createdAt'>[];
  themeSkill: Pick<ThemeSkillRow, 'theme' | 'rating' | 'attempts'>[];
  training: Pick<TrainingItem, 'kind' | 'attempts' | 'dueAt' | 'payload'>[];
  progress?: Pick<ProgressRow, 'lessons'> | null;
  now?: Date;
}

export interface Facts {
  today: string;
  player: {
    chesscom_username: string | null;
    games_analyzed: number;
    record: { won: number; lost: number; drawn: number };
    blunders_per_game: number;
    mistakes_per_game: number;
    castled_by_move_12_in_pct: number;
    rating_now: number | null;
  };
  biggest_weaknesses: { name: string; kind: string; times: number; in_games: number; of_games: number; most_often_piece: string | null; what_it_means: string }[];
  mistakes_by_phase: Record<string, number>;
  how_losses_ended: Record<string, number>;
  two_week_trend: string[];
  training_last_7_days: {
    puzzles_and_drills_attempted: number;
    solved_first_try_pct: number | null;
    hints_used: number;
    by_theme: { theme: string; attempts: number; first_try_pct: number; skill_rating: number | null }[];
  };
  stock: { personal_puzzles_unplayed: number; own_mistakes_due_for_review: number; mirrored_copies_of_your_mistakes: number };
  lessons: { done: number; total: number; next: string | null };
  recent_mistakes: { against: string; date: string; move: string; played: string; better: string | null; type: string; severity: string; explanation: string }[];
}

const pct = (n: number, d: number): number | null => (d ? Math.round((100 * n) / d) : null);
const clip = (s: string, n: number): string => (s.length > n ? s.slice(0, n - 1) + '…' : s);

export function buildFacts(i: FactsInput): Facts {
  const now = i.now ?? new Date();
  const p = i.profile;
  const gameOf = new Map(i.games.map((g) => [g.id, g]));

  const weak = p.weaknesses.map((w) => {
    const info = weakInfo(w.key);
    const isHabit = w.key === 'nocastle' || w.key === 'earlyqueen';
    return {
      name: info.label,
      kind: isHabit ? 'habit' : 'mistake type',
      times: w.count,
      in_games: w.games,
      of_games: p.gamesAnalyzed,
      most_often_piece: w.topPiece ? pieceName(w.topPiece) : null,
      what_it_means: info.advice,
    };
  });

  const recent7 = i.attempts.filter((a) => now.getTime() - new Date(a.createdAt).getTime() <= 7 * DAY);
  const byTheme = new Map<string, { n: number; ok: number }>();
  for (const a of recent7) {
    if (!a.theme || !(a.theme in THEMES)) continue;
    const e = byTheme.get(a.theme) ?? { n: 0, ok: 0 };
    e.n++;
    if (a.correct && !a.usedHint) e.ok++;
    byTheme.set(a.theme, e);
  }
  const ratingOf = new Map(i.themeSkill.map((t) => [t.theme, Math.round(t.rating)]));
  const firstTry = recent7.filter((a) => a.correct && !a.usedHint).length;

  const recentMistakes = i.mistakes
    .slice()
    .sort((a, b) => (b.playedAt ?? b.createdAt).localeCompare(a.playedAt ?? a.createdAt))
    .slice(0, 6)
    .map((m) => {
      const g = gameOf.get(m.gameId);
      return {
        against: g ? opponentName(g) : 'an opponent',
        date: (m.playedAt ?? m.createdAt).slice(0, 10),
        move: g ? `${moveNumberLabel(g.startFen, m.ply)} ${m.playedSan}` : m.playedSan,
        played: m.playedSan,
        better: m.bestSan || null,
        type: CATS[m.category].short,
        severity: m.severity,
        explanation: clip(m.explanation, 220),
      };
    });

  const done = LESSONS.filter((l) => i.progress?.lessons[l.id]).length;
  const next = LESSONS.find((l) => !i.progress?.lessons[l.id]);

  // the user's most recent rating, from their latest real game
  const latest = i.games
    .filter((g) => g.userColor && (g.source === 'chesscom' || g.source === 'pgn'))
    .sort((a, b) => (b.playedAt ?? b.createdAt).localeCompare(a.playedAt ?? a.createdAt))[0];
  const rating = latest ? (latest.userColor === 'w' ? latest.whiteRating : latest.blackRating) : null;

  return {
    today: now.toISOString().slice(0, 10),
    player: {
      chesscom_username: i.username,
      games_analyzed: p.gamesAnalyzed,
      record: { won: p.record.w, lost: p.record.l, drawn: p.record.d },
      blunders_per_game: Math.round(p.blundersPerGame * 10) / 10,
      mistakes_per_game: Math.round(p.mistakesPerGame * 10) / 10,
      castled_by_move_12_in_pct: Math.round(p.castledEarlyRate * 100),
      rating_now: rating ?? null,
    },
    biggest_weaknesses: weak,
    mistakes_by_phase: { ...p.phases },
    how_losses_ended: { ...p.lossesBy },
    two_week_trend: p.trend.map(describeTrend).filter((x): x is string => !!x),
    training_last_7_days: {
      puzzles_and_drills_attempted: recent7.length,
      solved_first_try_pct: pct(firstTry, recent7.length),
      hints_used: recent7.filter((a) => a.usedHint).length,
      by_theme: [...byTheme.entries()].map(([t, e]) => ({
        theme: THEMES[t as keyof typeof THEMES].name,
        attempts: e.n,
        first_try_pct: Math.round((100 * e.ok) / e.n),
        skill_rating: ratingOf.get(t) ?? null,
      })),
    },
    stock: {
      personal_puzzles_unplayed: i.training.filter((t) => t.payload.pool === 'gen' && t.attempts === 0).length,
      own_mistakes_due_for_review: i.training.filter((t) => t.kind === 'own_mistake' && isDue(t.dueAt, now)).length,
      mirrored_copies_of_your_mistakes: i.training.filter((t) => t.kind === 'variant').length,
    },
    lessons: { done, total: LESSONS.length, next: next ? next.title : null },
    recent_mistakes: recentMistakes,
  };
}

/** Compact JSON for the prompt. The server clips whatever arrives, so keep it well under its limit. */
export function factsToText(f: Facts): string {
  return JSON.stringify(f);
}

/** How the coach talks about a finished training session. */
export interface SessionResult {
  /** 'puzzle' | 'drill' | 'threat' | 'judge' */
  kind: string;
  theme: string | null;
  correctFirstTry: boolean;
  usedHint: boolean;
}

export interface SessionDebrief {
  title: string;
  total: number;
  score: number;
  results: { what: string; ok: boolean; hint: boolean }[];
}

const KIND_NAME: Record<string, string> = {
  threat: 'spot the threat',
  judge: 'safe or blunder',
  drill: 'fix a mistake from your games',
  puzzle: 'puzzle',
};

export function buildSessionDebrief(title: string, score: number, results: SessionResult[]): SessionDebrief {
  return {
    title,
    total: results.length,
    score,
    results: results.map((r) => ({
      what: r.theme && r.theme in THEMES ? `${THEMES[r.theme as keyof typeof THEMES].name} puzzle` : (KIND_NAME[r.kind] ?? r.kind),
      ok: r.correctFirstTry,
      hint: r.usedHint,
    })),
  };
}
