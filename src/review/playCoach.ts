// The thinking behind the Play page that does not need the engine: how strong the computer plays,
// what is worth pointing out on the board ("heads-up"), when to stop you, and how a game ended.
import { Chess } from '@/chess/compat';
import { pieceName } from '@/chess/tactics';
import type { Color } from '@/chess/types';
import { mateThreats, threatsAgainst } from './explain';
import type { Goal } from './scenarios';
import type { MoveClass } from './types';

export interface PlayLevel {
  name: string;
  blurb: string;
  /** Stockfish "Skill Level" 0..20 */
  skill: number;
  depth: number;
  /** chance of a random legal move instead of the engine's move (makes the weakest levels beatable) */
  rand: number;
  /** cap on thinking time, so strong levels still answer quickly */
  movetimeMs: number;
}

export const PLAY_LEVELS: PlayLevel[] = [
  { name: 'Very easy', blurb: 'Plays almost at random. Great for learning how the pieces move.', skill: 0, depth: 1, rand: 0.5, movetimeMs: 200 },
  { name: 'Easy', blurb: 'Makes plenty of mistakes you can punish.', skill: 0, depth: 1, rand: 0.25, movetimeMs: 200 },
  { name: 'Casual', blurb: 'Sees simple tactics but still slips up.', skill: 2, depth: 3, rand: 0.1, movetimeMs: 400 },
  { name: 'Club', blurb: 'A solid club player. Hanging a piece will cost you.', skill: 8, depth: 8, rand: 0.02, movetimeMs: 800 },
  { name: 'Strong', blurb: 'Rarely makes a mistake.', skill: 14, depth: 12, rand: 0, movetimeMs: 1000 },
  { name: 'Maximum', blurb: 'Full-strength Stockfish. It will not give you anything.', skill: 20, depth: 18, rand: 0, movetimeMs: 1500 },
];

/** How Blunder Check treats your moves: stop you before the computer replies, just tell you afterwards, or stay quiet. */
export type CoachMode = 'warn' | 'watch' | 'off';

/** Moves that make Blunder Check stop you. `strict` also stops inaccuracies. */
export function shouldWarn(cls: MoveClass, strict: boolean): boolean {
  if (cls === 'blunder' || cls === 'mistake' || cls === 'miss') return true;
  return strict && cls === 'inaccuracy';
}

export interface Callout {
  square: string;
  text: string;
}

export interface HeadsUp {
  /** you are in check and must answer it */
  check: boolean;
  /** things that can go wrong for you right now */
  dangers: Callout[];
  /** things you could take advantage of right now */
  chances: Callout[];
}

/** Cheap board checks for the side to move: what is attacked, what is loose, is there a mate. No engine needed. */
export function headsUp(fen: string, me: Color): HeadsUp {
  const empty: HeadsUp = { check: false, dangers: [], chances: [] };
  let c: Chess;
  try {
    c = new Chess(fen);
  } catch {
    return empty;
  }
  if (c.turn() !== me || c.isGameOver()) return empty;
  const opp: Color = me === 'w' ? 'b' : 'w';
  const check = c.inCheck();
  const dangers: Callout[] = [];
  const chances: Callout[] = [];

  if (check) {
    dangers.push({ square: '', text: 'You are in check. Deal with it first: move the king, block the check, or capture the piece giving check.' });
  } else {
    for (const m of mateThreats(fen, me).slice(0, 2)) {
      dangers.push({ square: '', text: `Careful: if you do nothing, they can play ${m} and checkmate you.` });
    }
  }
  for (const t of threatsAgainst(fen, me)) {
    dangers.push({
      square: t.square,
      text: `Your ${pieceName(t.type)} on ${t.square} ${t.reason === 'undefended' ? 'is attacked and nothing protects it.' : 'is attacked by a piece worth less than it, so trading would cost you.'}`,
    });
  }

  for (const m of c.moves({ verbose: true })) {
    c.move(m);
    const mate = c.isCheckmate();
    c.undo();
    if (mate) chances.push({ square: m.from, text: `You can give checkmate with ${m.san}!` });
  }
  for (const t of threatsAgainst(fen, opp)) {
    chances.push({
      square: t.square,
      text: `You can win their ${pieceName(t.type)} on ${t.square}: ${t.reason === 'undefended' ? 'nothing protects it.' : 'it is attacked by a cheaper piece of yours.'}`,
    });
  }
  return { check, dangers: dangers.slice(0, 4), chances: chances.slice(0, 3) };
}

export interface GameEnd {
  result: '1-0' | '0-1' | '1/2-1/2';
  outcome: 'win' | 'draw' | 'loss';
  title: string;
}

/** How a finished game ended from `me`'s point of view, or null while it is still going. */
export function endOf(c: Chess, me: Color): GameEnd | null {
  if (!c.isGameOver()) return null;
  if (c.isCheckmate()) {
    const iWon = c.turn() !== me;
    return { result: c.turn() === 'b' ? '1-0' : '0-1', outcome: iWon ? 'win' : 'loss', title: iWon ? 'Checkmate! You win!' : 'Checkmated.' };
  }
  const why = c.isStalemate()
    ? "Stalemate: the side to move has no legal move but is not in check, so it is a draw. (If you were winning, leave the enemy king a square next time.)"
    : c.isInsufficientMaterial()
      ? 'Draw: neither side has enough pieces left to checkmate.'
      : c.isThreefoldRepetition()
        ? 'Draw: the same position came up three times.'
        : 'Draw by the 50-move rule: 50 moves passed without a capture or a pawn move.';
  return { result: '1/2-1/2', outcome: 'draw', title: why };
}

export interface GoalResult {
  met: boolean;
  text: string;
}

/** Did you do what the practice position asked? */
export function goalResult(goal: Goal, outcome: GameEnd['outcome']): GoalResult {
  if (goal === 'win') {
    if (outcome === 'win') return { met: true, text: 'You converted the win. That is exactly the technique to remember.' };
    if (outcome === 'draw') return { met: false, text: 'This position is winning, but it ended in a draw. Read the tips and try again.' };
    return { met: false, text: 'This position is winning, but it was lost. Review the game to see where it slipped away.' };
  }
  if (goal === 'draw') {
    if (outcome === 'win') return { met: true, text: 'You even won! Holding this position is the goal, so that is a great result.' };
    if (outcome === 'draw') return { met: true, text: 'You held the draw. That is the correct result with best play.' };
    return { met: false, text: 'This position can be held, but it was lost. Review the game to find where.' };
  }
  return { met: outcome !== 'loss', text: outcome === 'loss' ? 'You lost this one. Review it and look at the moments the evaluation swung.' : 'Good game. Review it to see what Stockfish thought of your moves.' };
}

export interface MoveCounts {
  total: number;
  good: number;
  inaccuracies: number;
  mistakes: number;
  blunders: number;
}

const GOOD: MoveClass[] = ['best', 'excellent', 'good', 'great', 'brilliant', 'book', 'forced'];

/** Tally of your judged moves for the "so far" line. */
export function countMoves(classes: MoveClass[]): MoveCounts {
  const n: MoveCounts = { total: classes.length, good: 0, inaccuracies: 0, mistakes: 0, blunders: 0 };
  for (const c of classes) {
    if (GOOD.includes(c)) n.good++;
    else if (c === 'inaccuracy') n.inaccuracies++;
    else if (c === 'blunder') n.blunders++;
    else n.mistakes++;
  }
  return n;
}

export function countsText(n: MoveCounts): string {
  if (!n.total) return 'No moves checked yet.';
  const bits = [`${n.good} good`];
  if (n.inaccuracies) bits.push(`${n.inaccuracies} inaccurate`);
  if (n.mistakes) bits.push(`${n.mistakes} mistake${n.mistakes === 1 ? '' : 's'}`);
  if (n.blunders) bits.push(`${n.blunders} blunder${n.blunders === 1 ? '' : 's'}`);
  return `${n.total} move${n.total === 1 ? '' : 's'} checked: ${bits.join(', ')}.`;
}
