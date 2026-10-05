// Chooses which training items go into a game-trainer session (spec 6.5 / 6.6).
import type { TrainingItem, TrainingPool } from '@/db/types';
import { isDue } from './leitner';
import { shuffle, type Rng } from './pickPuzzles';

export const MIX_SIZE = 15;

export type TrainerMode = 'threat' | 'judge' | 'punish' | 'mix' | 'fix';

export function poolsOf(items: TrainingItem[]): Record<TrainingPool, TrainingItem[]> {
  const out: Record<TrainingPool, TrainingItem[]> = { own: [], threat: [], calm: [], blunder: [], safe: [], punish: [] };
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
