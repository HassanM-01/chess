// The in-progress Play game lives in memory so it survives switching tabs (as in the prototype).
import { create } from 'zustand';
import { Chess, uciMove } from '@/chess/compat';
import { START_FEN, type Color, type Uci } from '@/chess/types';

let nextId = 1;

export interface PlayGame {
  /** unique per game: lets effects restart when "New" produces an identical position */
  id: number;
  fen0: string;
  moves: Uci[];
  me: Color;
  level: number;
  over: boolean;
  /** the user has made at least one move */
  started: boolean;
  /** custom start position (K+Q vs K lesson): no Blunder Check, no review */
  custom: boolean;
  caught: number;
  result: string | null;
  title: string | null;
}

export function newPlayGame(o: { fen?: string; me: Color; level: number; moves?: Uci[] }): PlayGame {
  return { id: nextId++, fen0: o.fen ?? START_FEN, moves: o.moves ?? [], me: o.me, level: o.level, over: false, started: !!o.moves?.length, custom: !!o.fen, caught: 0, result: null, title: null };
}

/** Replay a game's moves to get its current board. */
export function boardOf(g: PlayGame): Chess {
  const c = new Chess(g.fen0);
  for (const u of g.moves) uciMove(c, u);
  return c;
}

interface PlayStore {
  game: PlayGame | null;
  set: (g: PlayGame | null) => void;
  patch: (p: Partial<PlayGame>) => void;
}

export const usePlayStore = create<PlayStore>((set) => ({
  game: null,
  set: (game) => set({ game }),
  patch: (p) => set((s) => (s.game ? { game: { ...s.game, ...p } } : s)),
}));
