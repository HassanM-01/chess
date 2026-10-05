// The 12 ordered lessons, ported from the prototype (content.js).
import type { OpeningKey } from './openings';
import type { ThemeKey } from '@/db/types';

export type LessonPractice =
  | { kind: 'puzzles'; theme: ThemeKey; n: number; label: string }
  | { kind: 'opening'; set: OpeningKey; /** -1 = cycle through every line */ line: number; label: string }
  | { kind: 'play'; label: string; /** custom start position (e.g. K+Q vs K) */ fen?: string };

export interface Lesson {
  id: string;
  title: string;
  mins: number;
  cards: string[];
  practice: LessonPractice;
}

export const LESSONS: Lesson[] = [
  {
    "id": "values",
    "title": "What pieces are worth",
    "mins": 3,
    "cards": [
      "Every piece has a point value. Pawn 1, knight 3, bishop 3, rook 5, queen 9. The king can't be traded, so protect it above all.",
      "A trade is fair when both sides give up the same value (knight for bishop). Giving a rook for a knight loses 2 points.",
      "Before you capture, count: how many of your pieces attack that square, and how many of theirs defend it? Capture only if you come out ahead.",
      "Most beginner games are decided by one side giving away a piece for free. Keep your points and you will start winning."
    ],
    "practice": {
      "kind": "puzzles",
      "theme": "free",
      "n": 5,
      "label": "Take 5 free pieces"
    }
  },
  {
    "id": "check",
    "title": "The Blunder Check habit",
    "mins": 3,
    "cards": [
      "Before EVERY move, ask three questions. This one habit will win you more games than any opening.",
      "1. What does their last move threaten? Look at what the piece that just moved attacks now.",
      "2. Is the square I'm moving to safe? Count attackers and defenders on it.",
      "3. What did my move leave behind? A piece that moves can stop defending something else.",
      "Practice it for real: play the bot with Blunder Check on. It stops you when a move loses material and tells you why."
    ],
    "practice": {
      "kind": "play",
      "label": "Play one game with Blunder Check on"
    }
  },
  {
    "id": "save",
    "title": "Save your pieces",
    "mins": 2,
    "cards": [
      "When a piece is attacked, you have four options: move it, defend it, block the attack, or counter-attack something bigger.",
      "Moving it is usually simplest. Make sure the new square is safe too.",
      "Watch for attacks by cheaper pieces. A pawn attacking your knight is a real threat even if the knight is defended."
    ],
    "practice": {
      "kind": "puzzles",
      "theme": "save",
      "n": 6,
      "label": "Solve 6 \"save your piece\" puzzles"
    }
  },
  {
    "id": "free",
    "title": "Take free pieces",
    "mins": 2,
    "cards": [
      "Your friends leave pieces hanging too. Every turn, scan the board: is any of their pieces attacked by me and not defended?",
      "Also look for pieces you can win with a cheaper piece. Pawn takes knight is a good deal even if they take back."
    ],
    "practice": {
      "kind": "puzzles",
      "theme": "free",
      "n": 6,
      "label": "Solve 6 \"free piece\" puzzles"
    }
  },
  {
    "id": "forks",
    "title": "Forks",
    "mins": 3,
    "cards": [
      "A fork is one piece attacking two targets at once. They can only save one.",
      "Knights are the best forkers because their L-shaped jump is hard to see. Watch for knight checks that also hit your queen or rook.",
      "Queens fork too, often with a check plus an attack on a loose piece.",
      "Defense: don't leave your king, queen, and rooks a knight's jump apart from each other."
    ],
    "practice": {
      "kind": "puzzles",
      "theme": "fork",
      "n": 6,
      "label": "Solve 6 fork puzzles"
    }
  },
  {
    "id": "mate1",
    "title": "Checkmate in one",
    "mins": 2,
    "cards": [
      "Checkmate happens when the king is in check and has no safe square, no way to block, and no way to capture the attacker.",
      "The back-rank mate is the most common: a king stuck behind its own pawns gets mated by a rook or queen on the last row.",
      "Always check your checks. Every turn, look at every check you can give. One of them might end the game."
    ],
    "practice": {
      "kind": "puzzles",
      "theme": "mate1",
      "n": 6,
      "label": "Solve 6 mate-in-one puzzles"
    }
  },
  {
    "id": "scholar",
    "title": "Stop the early queen attack",
    "mins": 3,
    "cards": [
      "Many beginners try the Scholar's Mate: queen and bishop gang up on f7 (or f2) for a quick checkmate.",
      "The defense is simple once you know it. Defend e5 with ...Nc6, block with ...g6, then block again with ...Nf6.",
      "Their queen came out early, so you get to develop while kicking it around."
    ],
    "practice": {
      "kind": "opening",
      "set": "vsE4",
      "line": 1,
      "label": "Practice the defense"
    }
  },
  {
    "id": "principles",
    "title": "Opening rules",
    "mins": 3,
    "cards": [
      "You don't need to memorize openings. Follow five rules and you'll reach a good middlegame every time.",
      "1. Put a pawn in the center (e4 or d4).",
      "2. Develop knights and bishops before anything else.",
      "3. Castle early, usually within the first 10 moves.",
      "4. Don't bring your queen out early. It gets chased around and you lose time.",
      "5. Don't move the same piece twice in the opening unless you have to."
    ],
    "practice": {
      "kind": "opening",
      "set": "italian",
      "line": 0,
      "label": "Walk through a model opening"
    }
  },
  {
    "id": "italian",
    "title": "Your White opening: the Italian",
    "mins": 5,
    "cards": [
      "As White, play e4, Nf3, Bc4, then castle. Add c3 and d3 for a solid center.",
      "You'll use the same setup against almost anything Black does, so you'll know your plan every game."
    ],
    "practice": {
      "kind": "opening",
      "set": "italian",
      "line": -1,
      "label": "Practice all 4 Italian lines"
    }
  },
  {
    "id": "black",
    "title": "Your Black openings",
    "mins": 5,
    "cards": [
      "Against 1.e4, play 1...e5 and develop your knights and bishops, then castle.",
      "Against 1.d4, play 1...d5, then ...Nf6 and ...e6. Solid and hard to crack.",
      "Against anything else, follow the opening rules."
    ],
    "practice": {
      "kind": "opening",
      "set": "vsE4",
      "line": -1,
      "label": "Practice Black lines"
    }
  },
  {
    "id": "mate2",
    "title": "Checkmate in two",
    "mins": 3,
    "cards": [
      "Many mates take two moves: a check that forces the king to a bad square, then the finishing blow.",
      "Look for checks first, then captures, then threats. Checks limit what your opponent can do."
    ],
    "practice": {
      "kind": "puzzles",
      "theme": "mate2",
      "n": 5,
      "label": "Solve 5 mate-in-two puzzles"
    }
  },
  {
    "id": "kq",
    "title": "Win with a queen: K+Q vs K",
    "mins": 5,
    "cards": [
      "When you are way ahead, you still need to finish. King and queen against a lone king is a must-know mate.",
      "Use the queen to shrink the box the enemy king lives in, a knight's move away from it. Careful: never leave the king with zero moves unless it's in check. That's stalemate, a draw.",
      "When the king is stuck on the edge, bring your own king close, then deliver mate with the queen next to the enemy king, protected by your king."
    ],
    "practice": {
      "kind": "play",
      "fen": "8/8/8/4k3/8/8/8/3QK3 w - - 0 1",
      "label": "Checkmate the lone king"
    }
  }
] as Lesson[];
