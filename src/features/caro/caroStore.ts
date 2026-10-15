import { create } from 'zustand';
import { Chess, uciMove } from '@/chess/compat';
import type { Uci } from '@/chess/types';
import type { Advice } from '@/features/london/advice';
import { CARO_PLANS, type CaroPlan } from './steps';

let nextId = 1;

export interface CaroGame {
  id: number;
  moves: Uci[];
  plan: CaroPlan;
  /** plan moves the bot already used */
  used: string[];
  level: number;
  over: boolean;
  result: string | null;
  title: string | null;
  /** coach advice for the current position and the FEN it belongs to */
  adv: Advice | null;
  advFen: string | null;
  score: { caro: number; total: number };
}

export function newCaroGame(level: number, o: { moves?: Uci[]; plan?: CaroPlan } = {}): CaroGame {
  const plan = o.plan ?? CARO_PLANS[Math.floor(Math.random() * CARO_PLANS.length)];
  return { id: nextId++, moves: o.moves ?? [], plan, used: [], level, over: false, result: null, title: null, adv: null, advFen: null, score: { caro: 0, total: 0 } };
}

export function caroBoard(g: CaroGame): Chess {
  const c = new Chess();
  for (const u of g.moves) uciMove(c, u);
  return c;
}

interface CaroStore {
  game: CaroGame | null;
  set: (g: CaroGame | null) => void;
  patch: (p: Partial<CaroGame>) => void;
}

export const useCaroStore = create<CaroStore>((set) => ({
  game: null,
  set: (game) => set({ game }),
  patch: (p) => set((s) => (s.game ? { game: { ...s.game, ...p } } : s)),
}));
