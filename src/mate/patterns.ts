// Classic mating patterns, each a short, fully legal line that ends in checkmate (verified by tests/mate.test.ts).
import { Chess } from '@/chess/compat';
// Each move has a plain-English reason, so you learn WHY it works and what to look for in your own games.
import type { Color } from '@/chess/types';
import { START_FEN } from '@/chess/types';

export interface MatePattern {
  id: string;
  title: string;
  /** one line: what the pattern is */
  blurb: string;
  /** the habit: what to look for in a real game */
  lookFor: string;
  /** which side the student plays */
  side: Color;
  startFen: string;
  /** SAN moves, both sides, with the reason for each */
  moves: [san: string, why: string][];
}

export const PATTERNS: MatePattern[] = [
  {
    id: 'back-rank',
    title: 'Back-rank mate',
    blurb: 'A king stuck behind its own pawns is mated by a rook or queen on the last row.',
    lookFor: 'Their king has not moved and its pawns are still on f7, g7 and h7 (or f2, g2, h2). Can a rook or queen reach their back row?',
    side: 'w',
    startFen: '6k1/5ppp/8/8/8/8/8/R3K3 w - - 0 1',
    moves: [['Ra8#', 'The rook goes to the back row. It checks the king along the whole row, so f8 and h8 are covered. The king\'s own pawns fill f7, g7 and h7, so it has no way out.']],
  },
  {
    id: 'ladder',
    title: 'Ladder mate (two rooks)',
    blurb: 'Two rooks take turns checking, one rank apart, and push the king to the edge like climbing a ladder.',
    lookFor: 'You have two rooks (or a queen and a rook) against a bare king. Cut off a whole row with one, then check with the other.',
    side: 'w',
    startFen: '7k/8/8/8/8/8/R7/1R2K3 w - - 0 1',
    moves: [
      ['Rb7', 'Quiet but deadly. The rook on b7 covers the entire 7th row, so the king can only go along the back row.'],
      ['Kg8', 'The only square left. The king steps along the edge.'],
      ['Ra8#', 'The other rook checks along the back row while the first rook still guards the 7th. The king has nowhere to go: this is the ladder.'],
    ],
  },
  {
    id: 'queen-kiss',
    title: 'Queen next to the king, protected',
    blurb: 'The queen lands right beside the king, and your own king protects her so he cannot take her.',
    lookFor: 'Their king is on the edge, your king is close. Can the queen check from a square your king guards?',
    side: 'w',
    startFen: '7k/5K2/8/8/8/8/8/6Q1 w - - 0 1',
    moves: [['Qg7#', 'The queen steps next to the king. If the king could capture her, it would escape, but your king on f7 protects the queen, so he cannot. Every other square next to him is covered by her.']],
  },
  {
    id: 'anastasia',
    title: 'Anastasia\'s mate',
    blurb: 'A knight and a rook trap a king that is boxed in by its own pawn on the edge.',
    lookFor: 'Their king sits on the h-file with a pawn on g7, and you have a knight on e7 and a rook that can reach the h-file.',
    side: 'w',
    startFen: '8/4N1pk/8/8/8/8/5K2/R7 w - - 0 1',
    moves: [['Rh1#', 'The rook checks down the open h-file. The knight on e7 already covers g8 and g6, the rook covers h8 and h6 behind and in front of the king, and his own pawn blocks g7.']],
  },
  {
    id: 'arabian',
    title: 'Arabian mate',
    blurb: 'A rook gives the check next to the king in the corner, and a knight protects the rook.',
    lookFor: 'Their king is in the corner. Your knight sits a knight\'s move from the squares next to the king, and your rook can land beside him.',
    side: 'w',
    startFen: '7k/R7/5N2/8/8/8/8/7K w - - 0 1',
    moves: [['Rh7#', 'The rook jumps next to the king. He cannot take it because the knight on f6 protects h7. The knight also covers g8, and the rook covers the whole 7th row, so g7 is covered too.']],
  },
  {
    id: 'smothered',
    title: 'Smothered mate',
    blurb: 'A knight checks a king that is completely surrounded by its own pieces.',
    lookFor: 'Their king is in a corner, hemmed in by its own rook and pawns. A knight check cannot be blocked and cannot be run from.',
    side: 'w',
    startFen: '6rk/6pp/8/6N1/8/8/8/7K w - - 0 1',
    moves: [['Nf7#', 'The knight checks from f7. The king cannot move: g8 holds his own rook, and g7 and h7 hold his own pawns. A knight\'s check cannot be blocked, and nothing can take it.']],
  },
  {
    id: 'scholars',
    title: 'Scholar\'s mate',
    blurb: 'The famous four-move trick: queen and bishop gang up on f7.',
    lookFor: 'The f7 pawn (or f2) is only defended by the king. If your queen and bishop both aim at it, the king cannot take back.',
    side: 'w',
    startFen: START_FEN,
    moves: [
      ['e4', 'Open lines for the queen and the bishop.'],
      ['e5', 'Black takes the centre too.'],
      ['Bc4', 'The bishop eyes f7, the weakest square near the king.'],
      ['Nc6', 'Black develops but does not notice the threat.'],
      ['Qh5', 'The queen also attacks f7. Now f7 is hit twice and defended once.'],
      ['Nf6', 'A mistake: Black attacks the queen but forgets f7.'],
      ['Qxf7#', 'The queen takes f7 and gives check. The king cannot take her because the bishop on c4 protects her, and every escape square is covered or blocked.'],
    ],
  },
  {
    id: 'fools',
    title: 'Fool\'s mate (as Black)',
    blurb: 'The fastest mate in chess, and a warning about what not to play as White.',
    lookFor: 'If White opens the f-pawn and the g-pawn, the diagonal to the king is wide open for the queen.',
    side: 'b',
    startFen: START_FEN,
    moves: [
      ['f3', 'White weakens the king\'s diagonal.'],
      ['e5', 'You take the centre and open the diagonal for your queen.'],
      ['g4', 'White makes it worse: now nothing guards the e1-h4 diagonal.'],
      ['Qh4#', 'Your queen checks from h4. The king cannot go anywhere: the pawn on f3 and the pieces around it are in the way, and nothing can block on f2 or g3.'],
    ],
  },
];

export const patternById = (id: string): MatePattern | undefined => PATTERNS.find((p) => p.id === id);

export interface PatternLine {
  uci: string[];
  sans: string[];
  whys: string[];
}

/** The pattern as UCI moves + captions, ready for MateStepper. */
export function patternLine(p: MatePattern): PatternLine {
  const c = new Chess(p.startFen);
  const uci: string[] = [];
  const sans: string[] = [];
  const whys: string[] = [];
  for (const [san, why] of p.moves) {
    const m = c.move(san);
    uci.push(m.from + m.to + (m.promotion ?? ''));
    sans.push(m.san);
    whys.push(`${m.color === 'w' ? 'White' : 'Black'} plays ${m.san}. ${why}`);
  }
  return { uci, sans, whys };
}
