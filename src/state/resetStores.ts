import { useLondonStore } from '@/features/london/londonStore';
import { usePlayStore } from '@/features/play/playStore';
import { useSessionStore } from '@/features/train/sessionStore';

/** Clears per-user in-memory state (games in progress, training sessions) on sign-out / account switch. */
export function resetUserStores(): void {
  usePlayStore.getState().set(null);
  useLondonStore.getState().set(null);
  useSessionStore.setState({ items: [], options: { title: '' }, cursor: { idx: 0, score: 0, missed: [], finished: false, results: [] } });
}
