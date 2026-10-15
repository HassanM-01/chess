// Caro-Kann simulator data: your Black setup checklist, and the anti-Caro-Kann plans the bot plays as White.
import type { BoardMap } from '@/chess/types';

export interface CaroStep {
  uci: string;
  san: string;
  /** done is decided by board state, not move history */
  done: (b: BoardMap) => boolean;
  why: string;
}

const home = (b: BoardMap, sq: string, type: string): boolean => !!b[sq] && b[sq].type === type && b[sq].color === 'b';
const whitePawn = (b: BoardMap, sq: string): boolean => !!b[sq] && b[sq].type === 'p' && b[sq].color === 'w';

/** In the Panov (White pawn on c4) the bishop usually stays home until ...e6, so that step does not apply. */
export const panovShape = (b: BoardMap): boolean => whitePawn(b, 'c4') && !!b.d5 && b.d5.color === 'b' && b.d5.type === 'p';

export const CARO_STEPS: CaroStep[] = [
  { uci: 'c7c6', san: 'c6', done: (b) => !home(b, 'c7', 'p'), why: 'The Caro-Kann move. It prepares ...d5 with a pawn guarding it, and leaves your light-squared bishop free.' },
  { uci: 'd7d5', san: 'd5', done: (b) => !home(b, 'd7', 'p'), why: 'Challenge the center right away. Your c6 pawn defends it.' },
  {
    uci: 'c8f5',
    san: 'Bf5',
    done: (b) => !home(b, 'c8', 'b') || panovShape(b),
    why: 'Bishop out BEFORE you play ...e6. That is the whole point of the Caro-Kann. If ...e6 comes first, this bishop gets locked behind your own pawns.',
  },
  { uci: 'e7e6', san: 'e6', done: (b) => !home(b, 'e7', 'p'), why: 'Closes the door behind your bishop and supports d5. Solid, and it frees your dark-squared bishop.' },
  { uci: 'g8f6', san: 'Nf6', done: (b) => !home(b, 'g8', 'n'), why: 'Develops the knight toward the center and adds a defender to d5.' },
  { uci: 'b8d7', san: 'Nd7', done: (b) => !home(b, 'b8', 'n'), why: "Knight to d7, not c6, so your c-pawn stays free to play ...c5. From d7 it supports ...Nf6 and ...e5." },
  { uci: 'f8e7', san: 'Be7', done: (b) => !home(b, 'f8', 'b'), why: 'Gets the last bishop out and clears the way to castle.' },
  { uci: 'e8g8', san: 'O-O', done: (b) => !home(b, 'e8', 'k'), why: 'Castle. Your king is safe and your rook joins the game.' },
];

export interface CaroPlan {
  name: string;
  /** White's moves in order (SAN). The bot plays the next sound one, and drops out of this list when you leave the theory. */
  moves: string[];
}

/** White's anti-Caro-Kann setups; the bot picks one at random per game. */
export const CARO_PLANS: CaroPlan[] = [
  { name: 'Advance (3.e5)', moves: ['e4', 'd4', 'e5', 'Nf3', 'Be2', 'O-O', 'Be3', 'Nbd2'] },
  { name: 'Advance with g4 and h4', moves: ['e4', 'd4', 'e5', 'g4', 'h4', 'Ne2', 'Nbc3'] },
  { name: 'Classical (3.Nc3)', moves: ['e4', 'd4', 'Nc3', 'Nxe4', 'Ng3', 'h4', 'Nf3', 'h5', 'Bd3'] },
  { name: 'Exchange (3.exd5)', moves: ['e4', 'd4', 'exd5', 'Bd3', 'c3', 'Bf4', 'Nf3', 'Nbd2'] },
  { name: 'Panov-Botvinnik (4.c4)', moves: ['e4', 'd4', 'exd5', 'c4', 'Nc3', 'Nf3', 'cxd5', 'Bd3', 'O-O'] },
  { name: 'Two Knights (2.Nf3)', moves: ['e4', 'Nf3', 'Nc3', 'Nxe4', 'Ng3', 'd4'] },
  { name: 'Fantasy (3.f3)', moves: ['e4', 'd4', 'f3', 'fxe4', 'Nf3', 'Bc4', 'O-O'] },
];

export interface CaroLevel {
  name: string;
  skill: number;
  depth: number;
  rand: number;
}

export const CARO_LEVELS: CaroLevel[] = [
  { name: 'Friend', skill: 2, depth: 3, rand: 0.1 },
  { name: 'Club', skill: 6, depth: 6, rand: 0.03 },
  { name: 'Strong', skill: 12, depth: 9, rand: 0 },
];
