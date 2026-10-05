export interface BotLevel {
  name: string;
  /** Stockfish "Skill Level" */
  skill: number;
  depth: number;
  /** probability of a random legal move instead of the engine's move */
  rand: number;
}

/** Bot levels for the Play screen (ported from the prototype). */
export const LEVELS: BotLevel[] = [
  { name: 'Beginner', skill: 0, depth: 1, rand: 0.3 },
  { name: 'Friend', skill: 2, depth: 3, rand: 0.12 },
  { name: 'Club', skill: 6, depth: 6, rand: 0.03 },
  { name: 'Strong', skill: 12, depth: 9, rand: 0 },
  { name: 'Full', skill: 20, depth: 12, rand: 0 },
];
