// Practice positions for the Play page: middlegames and endgames to play out against the computer,
// plus the opening lines the app already teaches. Every start position is checked in tests/scenarios.test.ts,
// including a Stockfish check that "win" positions really are winning and "draw" positions really are drawn.
import { Chess } from '@/chess/compat';
import type { Color } from '@/chess/types';
import { OPENINGS, type OpeningKey, type OpeningLine } from '@/content/openings';

export type ScenarioKind = 'middlegame' | 'endgame';
/** win = the side you play should win; draw = hold the draw (a win is a bonus); play = just play it well */
export type Goal = 'win' | 'draw' | 'play';

export interface Scenario {
  id: string;
  kind: ScenarioKind;
  title: string;
  /** one line for the list */
  blurb: string;
  fen: string;
  /** the side you play */
  side: Color;
  goal: Goal;
  /** plain-English ideas to read before you start */
  tips: string[];
  /** suggested opponent (index into PLAY_LEVELS) */
  level: number;
  /** a rough range for Stockfish's score from `side`'s point of view, in centipawns (checked in tests) */
  expect: { min?: number; max?: number };
}

/** The position after a list of moves from the start, e.g. "e4 e5 Nf3". */
export function fenAfter(sans: string): string {
  const c = new Chess();
  for (const san of sans.split(/\s+/).filter(Boolean)) c.move(san);
  return c.fen();
}

/** The same position with some pieces taken off the board (to make "a piece up" / "a pawn down" practice). */
export function without(fen: string, squares: string[]): string {
  const c = new Chess(fen);
  for (const s of squares) c.remove(s as never);
  return c.fen();
}

const ITALIAN = 'e4 e5 Nf3 Nc6 Bc4 Bc5 c3 Nf6 d3 d6 O-O O-O Re1 a6 Bb3 Ba7 h3 h6 Nbd2 Re8';
const QGD = 'd4 d5 c4 e6 Nc3 Nf6 Bg5 Be7 e3 O-O Nf3 Nbd7 Rc1 c6 Bd3 dxc4 Bxc4 Nd5 Bxe7 Qxe7 O-O Nxc3 Rxc3 e5';

const MG_WIN = { min: 250 };
const MG_EQUAL = { min: -100, max: 100 };

export const MIDDLEGAMES: Scenario[] = [
  {
    id: 'mg-italian',
    kind: 'middlegame',
    title: 'Italian Game: a slow build-up',
    blurb: 'Both sides are developed and castled. Find a plan.',
    fen: fenAfter(ITALIAN),
    side: 'w',
    goal: 'play',
    level: 2,
    tips: [
      'Nobody is attacking yet, so improve your worst piece. A knight on d2 can travel to f1, then g3.',
      'The break d3-d4 fights for the centre. Do it when your pieces are ready.',
      'Before every move ask: what is my opponent threatening now?',
    ],
    expect: MG_EQUAL,
  },
  {
    id: 'mg-ruy',
    kind: 'middlegame',
    title: 'Ruy Lopez: the closed centre',
    blurb: 'A classic tense centre. You play Black.',
    fen: fenAfter('e4 e5 Nf3 Nc6 Bb5 a6 Ba4 Nf6 O-O Be7 Re1 b5 Bb3 d6 c3 O-O h3 Na5 Bc2 c5 d4 Qc7 Nbd2'),
    side: 'b',
    goal: 'play',
    level: 2,
    tips: [
      'The centre is tense: if you take on d4, White recaptures and the game opens up.',
      'Your queen on c7 already eyes the c-file and the e5 pawn. Keep the pawn on e5 protected.',
      'Knights love closed positions. Look for squares like c6, b7 and d7 to regroup them.',
    ],
    expect: MG_EQUAL,
  },
  {
    id: 'mg-london',
    kind: 'middlegame',
    title: 'London System: after ...e5',
    blurb: 'Your London setup is built. Time to use it.',
    fen: fenAfter('d4 Nf6 Bf4 g6 e3 Bg7 Nf3 O-O h3 d6 Nbd2 Nbd7 c3 e5 Bh2 Re8'),
    side: 'w',
    goal: 'play',
    level: 2,
    tips: [
      'Finish developing: Bd3 and castle. Your king is still in the middle.',
      'The pawn break e4 is the way to challenge Black. Prepare it so your d4 pawn is protected first.',
      'Keep the bishop on h2: it points at the whole board and cannot be trapped.',
    ],
    expect: MG_EQUAL,
  },
  {
    id: 'mg-qgd',
    kind: 'middlegame',
    title: "Queen's Gambit Declined: open lines",
    blurb: 'Pieces are traded and the centre is open. You play White.',
    fen: fenAfter(QGD),
    side: 'w',
    goal: 'play',
    level: 2,
    tips: [
      'Black has traded off some pieces, so your rook on c3 can swing to the kingside.',
      'Count what is attacked and defended before you capture anything in the centre.',
      'With fewer pieces on the board, king safety matters less and pawn structure matters more.',
    ],
    expect: MG_EQUAL,
  },
  {
    id: 'mg-sicilian',
    kind: 'middlegame',
    title: 'Sicilian: castled on opposite sides',
    blurb: 'White just pushed g4 to attack your king. You play Black.',
    fen: fenAfter('e4 c5 Nf3 d6 d4 cxd4 Nxd4 Nf6 Nc3 a6 Be3 e5 Nb3 Be6 f3 Be7 Qd2 O-O O-O-O Nbd7 g4'),
    side: 'b',
    goal: 'play',
    level: 2,
    tips: [
      'When kings are on opposite sides, speed matters. Attack their king with your own pawns: b5, a5, b4.',
      'Do not ignore their attack. Check each move: can their pawns or pieces reach your king first?',
      'The c-file is half open and their king is on c1. Put a rook there.',
    ],
    expect: MG_EQUAL,
  },
  {
    id: 'mg-caro',
    kind: 'middlegame',
    title: 'Caro-Kann Advance: your bishop outside',
    blurb: 'You play Black with the bishop already out on f5.',
    fen: fenAfter('e4 c6 d4 d5 e5 Bf5 Nf3 e6 Be2 c5 Be3 cxd4 Nxd4 Ne7 Nd2 Nd7 N4b3'),
    side: 'b',
    goal: 'play',
    level: 2,
    tips: [
      'Your bishop is outside the pawn chain, which is the whole point of this opening. Keep it safe: h6 gives it a retreat.',
      'The e5 pawn is cramping you. You can attack it with ...Nc6 and ...Qb6 or ...Qc7.',
      'Get your king safe: ...Be7 and ...O-O, or ...Nc6 first to put pressure on the centre.',
    ],
    expect: MG_EQUAL,
  },
  {
    id: 'mg-iqp',
    kind: 'middlegame',
    title: 'Playing against an isolated pawn',
    blurb: 'Black has a lone pawn on d5. Squeeze it.',
    fen: fenAfter('d4 d5 c4 e6 Nc3 c5 cxd5 exd5 Nf3 Nc6 g3 Nf6 Bg2 Be7 O-O O-O Bg5 cxd4 Nxd4 h6 Be3 Re8'),
    side: 'w',
    goal: 'play',
    level: 2,
    tips: [
      "A pawn with no pawn neighbours cannot be defended by pawns. Black's d5 pawn is the target.",
      'Put a piece in front of it (a "blockade"): a knight on d4 is perfect.',
      'Trading pieces helps you. In the endgame, a weak pawn is much harder to protect.',
    ],
    expect: MG_EQUAL,
  },
  {
    id: 'mg-piece-up',
    kind: 'middlegame',
    title: 'A knight up: finish the job',
    blurb: "You won Black's knight. Keep it safe and trade pieces.",
    fen: without(fenAfter(ITALIAN), ['c6']),
    side: 'w',
    goal: 'win',
    level: 2,
    tips: [
      'When you are ahead, trade pieces, not pawns. Every trade makes your extra piece count for more.',
      'Do not get greedy or careless. Before every move, check that none of your pieces can be taken for free.',
      "Keep your king safe and wait for your opponent's mistakes.",
    ],
    expect: MG_WIN,
  },
  {
    id: 'mg-pawn-down',
    kind: 'middlegame',
    title: 'A pawn down: fight back',
    blurb: "You are a pawn behind. Make it hard for the computer.",
    fen: without(fenAfter(ITALIAN), ['a2']),
    side: 'w',
    goal: 'draw',
    level: 2,
    tips: [
      'Do not panic and throw pieces away. A pawn down is not lost.',
      'Look for activity: open lines for your rooks and aim at their king.',
      'Avoid trades unless they help you. A small material gap grows when pieces come off.',
    ],
    expect: { min: -250, max: 0 },
  },
];

export const ENDGAMES: Scenario[] = [
  {
    id: 'eg-kqk',
    kind: 'endgame',
    title: 'Checkmate with king and queen',
    blurb: 'The first endgame everyone must know.',
    fen: '8/8/8/4k3/8/8/2Q5/4K3 w - - 0 1',
    side: 'w',
    goal: 'win',
    level: 5,
    tips: [
      'Use the queen to take squares away from the enemy king. Keep the queen a knight-move away so it cannot be captured.',
      'When the king is on the edge, bring your own king close, then give checkmate.',
      "The biggest danger is stalemate: if their king has no move and is not in check, it is a draw. Leave it a square.",
    ],
    expect: { min: 500 },
  },
  {
    id: 'eg-krk',
    kind: 'endgame',
    title: 'Checkmate with king and rook',
    blurb: 'Drive the king to the edge with the rook and your king.',
    fen: '8/8/8/4k3/8/8/8/R3K3 w - - 0 1',
    side: 'w',
    goal: 'win',
    level: 5,
    tips: [
      'Cut the enemy king off with the rook, then move your king up next to it.',
      'Push the king toward an edge with the rook and your king working together.',
      'Give the final check with the rook on the edge rank. Keep the rook safe from their king.',
    ],
    expect: { min: 500 },
  },
  {
    id: 'eg-kbbk',
    kind: 'endgame',
    title: 'Checkmate with two bishops',
    blurb: 'Two bishops on neighbouring diagonals trap the king.',
    fen: '8/8/8/4k3/8/8/8/2B1KB2 w - - 0 1',
    side: 'w',
    goal: 'win',
    level: 5,
    tips: [
      'Put the two bishops next to each other on diagonals so they form a wall the king cannot cross.',
      'Squeeze the wall toward a corner, bringing your king up to help.',
      'It takes about 20 moves. That is fine: the 50-move rule gives you plenty of time.',
    ],
    expect: { min: 500 },
  },
  {
    id: 'eg-two-pawns',
    kind: 'endgame',
    title: 'Queen a pawn: king and two pawns',
    blurb: 'Two pawns against a lone king. Make a queen.',
    fen: '8/8/4k3/8/8/4K3/4PP2/8 w - - 0 1',
    side: 'w',
    goal: 'win',
    level: 5,
    tips: [
      'Walk your king in front of the pawns. A king behind its pawns is not helping.',
      'Move pawns only when the king is next to them or the pawn cannot be reached.',
      'Once you have a queen, finish with the checkmate you already know.',
    ],
    expect: { min: 400 },
  },
  {
    id: 'eg-kpk-front',
    kind: 'endgame',
    title: 'King in front of the pawn',
    blurb: 'The simplest winning pawn ending.',
    fen: '3k4/8/3K4/3P4/8/8/8/8 w - - 0 1',
    side: 'w',
    goal: 'win',
    level: 5,
    tips: [
      'Your king is in front of the pawn. That is the winning setup.',
      'Move the king first and the pawn second. Keep your king ahead of the pawn.',
      'Be careful of stalemate when their king is in the corner or against the edge.',
    ],
    expect: { min: 500 },
  },
  {
    id: 'eg-opposition-win',
    kind: 'endgame',
    title: 'Win by taking the opposition',
    blurb: 'Kings face each other with one square between. Whoever must move gives way.',
    fen: '8/8/8/4k3/8/4K3/4P3/8 b - - 0 1',
    side: 'w',
    goal: 'win',
    level: 5,
    tips: [
      'Opposition: when the kings stand face to face with one square between them, the side that has to move must give way.',
      'Walk your king forward and sideways to gain the opposition, then step in front of the enemy king.',
      'Only push the pawn when your king is next to it and the enemy king cannot stop it.',
    ],
    expect: { min: 300 },
  },
  {
    id: 'eg-opposition-draw',
    kind: 'endgame',
    title: 'Hold the draw: take the opposition',
    blurb: 'You are Black and behind in the race. Defend accurately.',
    fen: '8/8/8/4k3/8/4K3/4P3/8 w - - 0 1',
    side: 'b',
    goal: 'draw',
    level: 5,
    tips: [
      'The defender needs the opposition. Keep your king directly facing theirs with one square between.',
      'If they step aside, step aside the same way to stay in front of them.',
      "If you can keep your king on the pawn's file and in front of it, the game is a draw.",
    ],
    expect: { min: -50, max: 50 },
  },
  {
    id: 'eg-lucena',
    kind: 'endgame',
    title: 'Rook endgame: the Lucena position',
    blurb: 'A pawn on the 7th with the king in front. Build the bridge.',
    fen: '1K6/1P1k4/8/8/8/8/r7/2R5 w - - 0 1',
    side: 'w',
    goal: 'win',
    level: 5,
    tips: [
      'Your king is stuck in front of the pawn. The trick is to move the rook to the fourth rank to build a bridge.',
      'Slide the rook along the fourth rank, then step your king out and use the rook to block the checks.',
      'This is one of the most useful rook endgames to know. Take your time.',
    ],
    expect: { min: 300 },
  },
  {
    id: 'eg-philidor',
    kind: 'endgame',
    title: 'Rook endgame: the Philidor defence',
    blurb: 'You are Black. Keep your rook on the 6th rank.',
    fen: '4k3/8/r7/3KP3/8/8/8/6R1 w - - 0 1',
    side: 'b',
    goal: 'draw',
    level: 5,
    tips: [
      'Keep your rook on the sixth rank so their king cannot step forward.',
      'When their pawn advances to the sixth, move your rook to the back rank and start giving checks from behind.',
      'This draws against any play. Stay patient and keep your king in front of the pawn.',
    ],
    expect: { min: -50, max: 50 },
  },
];

export const SCENARIOS: Scenario[] = [...MIDDLEGAMES, ...ENDGAMES];
export const scenarioById = (id: string): Scenario | undefined => SCENARIOS.find((s) => s.id === id);

// ---- opening drills ------------------------------------------------------------------------------------------

export interface DrillMove {
  san: string;
  /** why the move is played, in plain English */
  why: string;
  /** who plays it in the drill */
  by: Color;
}
export interface Drill {
  id: string;
  /** "London System" */
  opening: string;
  /** "Main setup vs ...d5" */
  line: string;
  /** the side you play */
  side: Color;
  moves: DrillMove[];
}

export interface OpeningChoice {
  key: OpeningKey;
  title: string;
  side: Color;
  blurb: string;
  lines: Drill[];
}

const drillOf = (key: OpeningKey, side: Color, opening: string, l: OpeningLine, i: number): Drill => ({
  id: `${key}:${i}`,
  opening,
  line: l.name,
  side,
  moves: l.moves.map(([san, why], ply) => ({ san, why, by: ply % 2 === 0 ? 'w' : 'b' })),
});

/** The opening lines the trainer teaches, as lists of moves with a reason for each. */
export const OPENING_CHOICES: OpeningChoice[] = (Object.keys(OPENINGS) as OpeningKey[]).map((key) => {
  const o = OPENINGS[key];
  return { key, title: o.title, side: o.side, blurb: o.blurb, lines: o.lines.map((l, i) => drillOf(key, o.side, o.title, l, i)) };
});

export const drillById = (id: string): Drill | undefined => OPENING_CHOICES.flatMap((o) => o.lines).find((d) => d.id === id);

/** The positions before each move of a drill (index = how many moves have been played). Null if the line contains an illegal move. */
export function drillFens(d: Drill): string[] | null {
  const c = new Chess();
  const out = [c.fen()];
  for (const m of d.moves) {
    try {
      c.move(m.san);
    } catch {
      return null;
    }
    out.push(c.fen());
  }
  return out;
}
