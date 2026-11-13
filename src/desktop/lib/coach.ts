// Talking to the optional AI coach through the main process (which holds the encrypted API key).
import { useSyncExternalStore } from 'react';
import { COACH_SYSTEM, coachMessages } from '@/review/coachFacts';

let keyState: boolean | null = null;
const listeners = new Set<() => void>();
const emit = (): void => listeners.forEach((l) => l());

export async function refreshCoachKey(): Promise<boolean> {
  try {
    keyState = (await window.desktop?.coach.hasKey()) ?? false;
  } catch {
    keyState = false;
  }
  emit();
  return keyState;
}

/** true / false once known, null while the first check runs */
export function useCoachKey(): boolean | null {
  const v = useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    () => keyState,
  );
  if (v === null && typeof window !== 'undefined') void refreshCoachKey();
  return v;
}

export async function saveCoachKey(key: string): Promise<void> {
  await window.desktop!.coach.setKey(key);
  await refreshCoachKey();
}

export async function removeCoachKey(): Promise<void> {
  await window.desktop!.coach.clearKey();
  await refreshCoachKey();
}

export type CoachTurn = { role: 'user' | 'assistant'; content: string };

/** Ask about a position. `history` is the conversation so far, ending with the student's latest message (empty = the opening question). */
export async function askCoach(factsJson: string, history: CoachTurn[]): Promise<string> {
  try {
    return await window.desktop!.coach.ask({ system: COACH_SYSTEM, messages: coachMessages(factsJson, history) });
  } catch (e) {
    // Electron wraps errors thrown in the main process; keep only the useful sentence
    throw new Error((e instanceof Error ? e.message : String(e)).replace(/^Error invoking remote method '[^']+': (Error: )?/, ''));
  }
}
