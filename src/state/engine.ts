import { useSyncExternalStore } from 'react';
import { getEngine } from '@/engine/browser';
import { makeEvaluator } from '@/engine/evalPos';
import { strongStore, type StrongState } from '@/engine/strong';
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

/** State of the optional strong engine download on this device (see src/engine/strong.ts). */
export function useStrongEngine(): StrongState {
  return useSyncExternalStore(strongStore.subscribe, strongStore.getState, () => ({ phase: 'unavailable' }) as StrongState);
}
