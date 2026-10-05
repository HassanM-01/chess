import { create } from 'zustand';
import { Chess, uciMove } from '@/chess/compat';
import type { Uci } from '@/chess/types';
import type { Advice } from './advice';
import { LONDON_PLANS, type LondonPlan } from './steps';

export interface LondonGame {
  moves: Uci[];
  plan: LondonPlan;
  /** plan moves the bot already used */
  used: string[];
  level: number;
  over: boolean;
  result: string | null;
  title: string | null;
  /** coach advice for the current position and the FEN it belongs to */
  adv: Advice | null;
  advFen: string | null;
  score: { london: number; total: number };
}

export function newLondonGame(level: number, o: { moves?: Uci[]; plan?: LondonPlan } = {}): LondonGame {
  const plan = o.plan ?? LONDON_PLANS[Math.floor(Math.random() * LONDON_PLANS.length)];
  return { moves: o.moves ?? [], plan, used: [], level, over: false, result: null, title: null, adv: null, advFen: null, score: { london: 0, total: 0 } };
}

export function londonBoard(g: LondonGame): Chess {
  const c = new Chess();
  for (const u of g.moves) uciMove(c, u);
  return c;
}

interface LondonStore {
  game: LondonGame | null;
  set: (g: LondonGame | null) => void;
  patch: (p: Partial<LondonGame>) => void;
}

export const useLondonStore = create<LondonStore>((set) => ({
  game: null,
  set: (game) => set({ game }),
  patch: (p) => set((s) => (s.game ? { game: { ...s.game, ...p } } : s)),
}));
