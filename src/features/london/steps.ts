// London System simulator data (ported from the prototype; spec section 9).
import type { BoardMap } from '@/chess/types';

export interface LondonStep {
  uci: string;
  san: string;
  /** done is decided by board state, not move history */
  done: (b: BoardMap) => boolean;
  why: string;
}

const homePawn = (b: BoardMap, sq: string): boolean => !!b[sq] && b[sq].type === 'p' && b[sq].color === 'w';

export const LONDON_STEPS: LondonStep[] = [
  { uci: 'd2d4', san: 'd4', done: (b) => !homePawn(b, 'd2'), why: 'Take the center with the d-pawn. Everything in the London is built around this pawn.' },
  { uci: 'c1f4', san: 'Bf4', done: (b) => !(b.c1 && b.c1.type === 'b'), why: 'Bishop out to f4 BEFORE you play e3. If e3 comes first, this bishop gets locked behind your own pawns.' },
  { uci: 'e2e3', san: 'e3', done: (b) => !homePawn(b, 'e2'), why: 'Supports the d4 pawn and opens a path for your other bishop.' },
  { uci: 'g1f3', san: 'Nf3', done: (b) => !(b.g1 && b.g1.type === 'n'), why: 'Develops the knight toward the center. Later it can jump to e5.' },
  { uci: 'c2c3', san: 'c3', done: (b) => !homePawn(b, 'c2'), why: 'Completes the pawn triangle c3, d4, e3. Very hard for Black to break.' },
  { uci: 'f1d3', san: 'Bd3', done: (b) => !(b.f1 && b.f1.type === 'b'), why: "Bishop to d3, aiming at h7 and Black's kingside." },
  { uci: 'b1d2', san: 'Nbd2', done: (b) => !(b.b1 && b.b1.type === 'n'), why: "Knight to d2, not c3, so it doesn't block your c-pawn. From d2 it supports e4 and Ne5." },
  { uci: 'e1g1', san: 'O-O', done: (b) => !(b.e1 && b.e1.type === 'k'), why: 'Castle. Your king is safe and your rook joins the game.' },
  { uci: 'h2h3', san: 'h3', done: (b) => !homePawn(b, 'h2'), why: 'Gives your f4 bishop a safe retreat on h2 and stops ...Nh5 or ...Bg4 from bothering you.' },
];

export interface LondonPlan {
  name: string;
  moves: string[];
}

/** Black's anti-London setups; the bot picks one at random per game. */
export const LONDON_PLANS: LondonPlan[] = [
  { name: 'Classical', moves: ['d5', 'Nf6', 'e6', 'c5', 'Nc6', 'Bd6', 'O-O', 'Qc7', 'b6'] },
  { name: 'Queen raid on b2', moves: ['d5', 'c5', 'Nc6', 'Qb6', 'Nf6', 'Bf5', 'e6', 'Be7'] },
  { name: "King's Indian", moves: ['Nf6', 'g6', 'Bg7', 'O-O', 'd6', 'Nbd7', 'c5', 'Qe8'] },
  { name: 'Knight hunts your bishop', moves: ['d5', 'Nf6', 'c5', 'e6', 'Nh5', 'Nc6', 'Bd6'] },
  { name: 'Mirror', moves: ['d5', 'Nf6', 'Bf5', 'e6', 'c5', 'Nc6', 'Bd6', 'O-O'] },
];

export interface LondonLevel {
  name: string;
  skill: number;
  depth: number;
  rand: number;
}

export const LONDON_LEVELS: LondonLevel[] = [
  { name: 'Friend', skill: 2, depth: 3, rand: 0.1 },
  { name: 'Club', skill: 6, depth: 6, rand: 0.03 },
  { name: 'Strong', skill: 12, depth: 9, rand: 0 },
];
