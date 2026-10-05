// Chooses which training items go into a game-trainer session (spec 6.5 / 6.6).
import type { GeneratedPayload, ThemeKey, TrainingItem, TrainingPool } from '@/db/types';
import { isDue } from './leitner';
import { shuffle, type Rng } from './pickPuzzles';

export const MIX_SIZE = 15;

export type TrainerMode = 'threat' | 'judge' | 'punish' | 'mix' | 'fix';

export function poolsOf(items: TrainingItem[]): Record<TrainingPool, TrainingItem[]> {
  const out: Record<TrainingPool, TrainingItem[]> = { own: [], threat: [], calm: [], blunder: [], safe: [], punish: [], gen: [] };
  for (const it of items) out[it.payload.pool].push(it);
  return out;
}

/** n items from a pool: due ones first (shuffled), then the soonest-due of the rest. */
export function takeFrom(pool: TrainingItem[], n: number, now: Date, rng: Rng): TrainingItem[] {
  const due = shuffle(pool.filter((i) => isDue(i.dueAt, now)), rng);
  if (due.length >= n) return due.slice(0, n);
  const rest = pool.filter((i) => !isDue(i.dueAt, now)).sort((a, b) => a.dueAt.localeCompare(b.dueAt));
  return [...due, ...rest].slice(0, n);
}

/** Own-mistake items that are due for review (the "Fix your mistakes" queue). */
export const dueOwn = (items: TrainingItem[], now: Date = new Date()): TrainingItem[] => items.filter((i) => i.payload.pool === 'own' && isDue(i.dueAt, now));

export interface TrainerCounts {
  threat: number;
  judge: number;
  punish: number;
  fix: number;
  fixDue: number;
}

export function trainerCounts(items: TrainingItem[], now: Date = new Date()): TrainerCounts {
  const p = poolsOf(items);
  return { threat: p.threat.length + p.calm.length, judge: p.blunder.length + p.safe.length, punish: p.punish.length, fix: p.own.length, fixDue: dueOwn(items, now).length };
}

export function buildTrainerSession(items: TrainingItem[], mode: TrainerMode, now: Date = new Date(), rng: Rng = Math.random): TrainingItem[] {
  const p = poolsOf(items);
  const take = (pool: TrainingItem[], n: number): TrainingItem[] => takeFrom(pool, n, now, rng);
  switch (mode) {
    case 'threat':
      return shuffle([...take(p.threat, 8), ...take(p.calm, 2)], rng);
    case 'judge':
      return shuffle([...take(p.blunder, 5), ...take(p.safe, 5)], rng);
    case 'punish':
      return take(p.punish, 8);
    case 'fix':
      return shuffle(take(dueOwn(items, now).length ? dueOwn(items, now) : p.own, 8), rng);
    case 'mix':
    default: {
      // 15 positions: 3 threat, 1 calm, 2 judge (blunder), 2 safe-judge, 2 punish, 3 due own mistakes.
      const own = take(dueOwn(items, now), 3);
      const picked = [...take(p.threat, 3), ...take(p.calm, 1), ...take(p.blunder, 2), ...take(p.safe, 2), ...take(p.punish, 2), ...own];
      // Short on one kind? Top up to 15 from the remaining due items of any kind.
      if (picked.length < MIX_SIZE) {
        const have = new Set(picked.map((i) => i.id));
        const rest = shuffle(items.filter((i) => !have.has(i.id) && isDue(i.dueAt, now)), rng);
        picked.push(...rest.slice(0, MIX_SIZE - picked.length));
      }
      return shuffle(picked, rng);
    }
  }
}

/**
 * Personal (generated) puzzles for a puzzle session. Unseen and due ones first; for the daily mix the themes are drawn in
 * proportion to the user's weaknesses, and within a theme the puzzles closest to the user's level come first.
 */
export function pickGenerated(
  items: TrainingItem[],
  theme: ThemeKey | 'mix',
  n: number,
  opts: { weights?: Record<ThemeKey, number> | null; ratings?: Partial<Record<string, number>>; now?: Date; rng?: Rng } = {},
): TrainingItem[] {
  const rng = opts.rng ?? Math.random;
  const now = opts.now ?? new Date();
  const pool = items.filter((i) => i.payload.pool === 'gen' && (theme === 'mix' || i.payload.theme === theme) && isDue(i.dueAt, now));
  const buckets = new Map<ThemeKey, TrainingItem[]>();
  for (const it of pool) {
    const t = (it.payload as GeneratedPayload).theme;
    buckets.set(t, [...(buckets.get(t) ?? []), it]);
  }
  for (const [t, list] of buckets) {
    const skill = opts.ratings?.[t] ?? 800;
    buckets.set(
      t,
      list
        .map((i) => ({ i, k: (i.attempts > 0 ? 1000 : 0) + Math.abs((i.payload as GeneratedPayload).rating - skill) + rng() * 60 }))
        .sort((a, b) => a.k - b.k)
        .map((x) => x.i),
    );
  }
  const out: TrainingItem[] = [];
  while (out.length < n && buckets.size) {
    const keys = [...buckets.keys()];
    const w = keys.map((k) => (theme === 'mix' ? (opts.weights?.[k] ?? 1) : 1));
    let x = rng() * w.reduce((a, b) => a + b, 0);
    let pick = keys[keys.length - 1];
    for (let i = 0; i < keys.length; i++) {
      x -= w[i];
      if (x <= 0) {
        pick = keys[i];
        break;
      }
    }
    const list = buckets.get(pick) as TrainingItem[];
    out.push(list.shift() as TrainingItem);
    if (!list.length) buckets.delete(pick);
  }
  return out;
}
