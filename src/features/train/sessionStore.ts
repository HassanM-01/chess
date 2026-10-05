import { create } from 'zustand';
import type { SessionItem, SessionOptions } from './types';

export interface SessionCursor {
  idx: number;
  score: number;
  missed: SessionItem[];
  finished: boolean;
}

const FRESH: SessionCursor = { idx: 0, score: 0, missed: [], finished: false };

interface SessionStore {
  items: SessionItem[];
  options: SessionOptions;
  /** bumps each time a session (re)starts, so the runner resets */
  run: number;
  /** progress is kept here so leaving to look at a game (See game) and coming back resumes the session */
  cursor: SessionCursor;
  start: (items: SessionItem[], options: SessionOptions) => void;
  setCursor: (patch: Partial<SessionCursor>) => void;
}

export const useSessionStore = create<SessionStore>((set) => ({
  items: [],
  options: { title: '' },
  run: 0,
  cursor: FRESH,
  start: (items, options) => set((s) => ({ items, options, run: s.run + 1, cursor: { ...FRESH, missed: [] } })),
  setCursor: (patch) => set((s) => ({ cursor: { ...s.cursor, ...patch } })),
}));
