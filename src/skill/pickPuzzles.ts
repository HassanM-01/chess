// Puzzle selection (spec 6.4).
//  - weighted random by themeWeights (for the daily "mix")
//  - within a theme prefer puzzles near the user's theme rating (+-150), nearest first
//  - exclude puzzles attempted in the last 7 days (relaxed only if there are not enough left)
//  - ~20% of a mix are "review" puzzles the user previously failed
import type { Repo } from '@/db/repo';
import type { PuzzleRow, ThemeKey } from '@/db/types';
import { THEME_KEYS } from '@/content/themes';
import { DEFAULT_THEME_RATING } from './leitner';

export type Rng = () => number;

export function weightedPick<K extends string>(weights: Record<K, number>, rng: Rng): K {
  const entries = Object.entries(weights) as [K, number][];
  const total = entries.reduce((a, [, w]) => a + w, 0);
  let x = rng() * total;
  for (const [k, w] of entries) {
    x -= w;
    if (x <= 0) return k;
  }
  return entries[entries.length - 1][0];
}

export function shuffle<T>(a: T[], rng: Rng = Math.random): T[] {
  const out = a.slice();
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

/** Nearest to the user's rating first; a little jitter so equal-distance puzzles vary between sessions. */
export function rankByRating(cands: PuzzleRow[], skill: number, rng: Rng): PuzzleRow[] {
  return cands
    .map((p) => ({ p, d: Math.abs(p.rating - skill) + rng() * 60 }))
    .sort((a, b) => a.d - b.d)
    .map((x) => x.p);
}

export interface PickOptions {
  theme: ThemeKey | 'mix';
  n: number;
  themeWeights?: Record<ThemeKey, number> | null;
  rng?: Rng;
  now?: Date;
}

const WEEK_MS = 7 * 86_400_000;
const REVIEW_SHARE = 0.2;

export async function pickPuzzles(repo: Repo, o: PickOptions): Promise<PuzzleRow[]> {
  const rng = o.rng ?? Math.random;
  const now = (o.now ?? new Date()).getTime();
  const [attempts, skills] = await Promise.all([repo.listAttempts({ limit: 600 }), repo.listThemeSkill()]);
  const skillOf = (t: string): number => skills.find((s) => s.theme === t)?.rating ?? DEFAULT_THEME_RATING;

  const lastAttemptAt = new Map<string, number>();
  const failed = new Map<string, number>(); // puzzle id -> time of the latest failed attempt, if the latest attempt failed
  for (const a of attempts) {
    if (!a.puzzleId) continue;
    const t = new Date(a.createdAt).getTime();
    if ((lastAttemptAt.get(a.puzzleId) ?? 0) < t) {
      lastAttemptAt.set(a.puzzleId, t);
      if (a.correct && !a.usedHint) failed.delete(a.puzzleId);
      else failed.set(a.puzzleId, t);
    }
  }
  const recent = new Set([...lastAttemptAt].filter(([, t]) => now - t < WEEK_MS).map(([id]) => id));

  const chosen: PuzzleRow[] = [];
  const used = new Set<string>();
  const take = (p: PuzzleRow | undefined): boolean => {
    if (!p || used.has(p.id)) return false;
    used.add(p.id);
    chosen.push(p);
    return true;
  };

  // 1) review slots (mix only)
  if (o.theme === 'mix') {
    const reviewIds = [...failed.entries()].sort((a, b) => a[1] - b[1]).map(([id]) => id);
    if (reviewIds.length) {
      const rows = shuffle(await repo.getPuzzles(reviewIds.slice(0, 40)), rng);
      const want = Math.floor(o.n * REVIEW_SHARE);
      for (const p of rows) if (chosen.length < want) take(p);
    }
  }

  // 2) theme slots
  const weights: Record<ThemeKey, number> =
    o.theme === 'mix' ? ((o.themeWeights ?? Object.fromEntries(THEME_KEYS.map((k) => [k, 1]))) as Record<ThemeKey, number>) : ({ [o.theme]: 1 } as Record<ThemeKey, number>);
  const cache = new Map<string, PuzzleRow[]>();
  const candidatesFor = async (theme: ThemeKey, need: number): Promise<PuzzleRow[]> => {
    const hit = cache.get(theme);
    if (hit) return hit;
    const skill = skillOf(theme);
    let c = await repo.queryPuzzles({ theme, minRating: skill - 150, maxRating: skill + 150, limit: 300, excludeIds: [...recent] });
    if (c.length < need * 2) c = await repo.queryPuzzles({ theme, limit: 300, excludeIds: [...recent] });
    let ranked = rankByRating(c, skill, rng);
    if (ranked.length < need) {
      // Not enough unseen puzzles: fall back to the ones seen longest ago.
      const all = await repo.queryPuzzles({ theme, limit: 300 });
      const seenOld = all.filter((p) => recent.has(p.id)).sort((a, b) => (lastAttemptAt.get(a.id) ?? 0) - (lastAttemptAt.get(b.id) ?? 0));
      ranked = [...ranked, ...seenOld];
    }
    cache.set(theme, ranked);
    return ranked;
  };

  let guard = o.n * 8;
  while (chosen.length < o.n && guard-- > 0) {
    const theme = weightedPick(weights, rng);
    const list = await candidatesFor(theme, Math.max(2, o.n));
    const next = list.find((p) => !used.has(p.id));
    if (next) take(next);
    else {
      // This theme is exhausted; drop it from the weights.
      delete (weights as Partial<Record<ThemeKey, number>>)[theme];
      if (!Object.keys(weights).length) break;
    }
  }
  return shuffle(chosen, rng);
}
