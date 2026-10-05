import type { SessionItem } from './types';

/** Opponent name for "From your game vs X". */
export function opponentLabel(it: SessionItem): string {
  return it.kind === 'puz' ? '' : it.payload.opponent;
}
