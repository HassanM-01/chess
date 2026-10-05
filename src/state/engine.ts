import { useSyncExternalStore } from 'react';
import { getEngine } from '@/engine/browser';
import { makeEvaluator } from '@/engine/evalPos';
import type { EngineStatus } from '@/engine/types';

const engine = getEngine();
const subscribe = (cb: () => void): (() => void) => engine.subscribe(cb);

export function useEngineStatus(): EngineStatus {
  return useSyncExternalStore(subscribe, () => engine.status, () => 'idle' as EngineStatus);
}

export const engineLabel = (s: EngineStatus): string =>
  ({ idle: 'Engine: sleeping', loading: 'Engine: loading…', ready: 'Engine: ready', failed: 'Engine: unavailable' })[s];

/** Shared evaluator for interactive features (bot, Blunder Check, hints, London coach). */
export const evalPos = makeEvaluator(engine);
export { engine };
