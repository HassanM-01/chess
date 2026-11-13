// Plain-English explanations of why a move was good or bad.
//
// This is not a language model guessing. Every sentence is built from something that can be checked: the engine's own lines
// (what happens after the move, what the best move leads to) and the rules of chess (which piece attacks which, who protects what).
// If no clear tactical reason exists, it says so and shows the engine's line instead of inventing one.
import { Chess, uciMove, type Move } from '@/chess/compat';
import { sanOf } from '@/chess/helpers';
import { NAME, VAL, attackers, forkTargets, hangingInfo, hangingPieces, parseFen } from '@/chess/tactics';
import { colorName, FILES, type BoardMap, type Color, type PieceType, type Square, type Uci } from '@/chess/types';
import { epFor } from './expected';
import { materialBalance } from './material';
import type { MoveReview, PosAnalysis, StoredLine } from './types';

export type ExplainTag =
  | 'hung-piece' //          moved a piece where it can be taken for free (or for a bad trade)
  | 'left-piece-hanging' //  moved a piece that was protecting another one
  | 'ignored-threat' //      an attacked piece was left to be captured
  | 'exposed' //             opened a line that lets the opponent capture something
  | 'allowed-mate'
  | 'back-rank'
  | 'missed-mate'
  | 'allowed-fork'
  | 'allowed-pin' //         a pin or skewer
  | 'bad-trade'
  | 'lost-material' //       other ways of losing material
  | 'missed-free-piece'
  | 'missed-fork'
  | 'missed-win' //          a material-winning line that was not played
  | 'early-queen'
  | 'rim-knight'
  | 'positional'; //         no tactic, the position simply got worse

export interface Explanation {
  /** one short line, e.g. "Your knight can be captured for free" */
  headline: string;
  /** what went wrong / what the move did, as short paragraphs */
  what: string[];
  /** why the engine's move was better (only for weak moves) */
  better?: string;
  /** the habit to take away */
  lesson?: string;
  tags: ExplainTag[];
  /** squares involved, to highlight on the board */
  danger: Square[];
  /** the opponent's punishing reply, if there is one */
  punish: Uci | null;
}

export interface ExplainInput {
  fenBefore: string;
  move: MoveReview;
  /** analysis of the position before the move / after it */
  before: PosAnalysis;
  after: PosAnalysis;
  /** the opponent's previous move (for "Miss" and "ignored a threat") */
  prev?: MoveReview;
  /** which side the user plays; null = unknown (wording says White/Black) */
  userColor: Color | null;
}

// ---- small helpers --------------------------------------------------------------------------------------------

const cap = (s: string): string => (s ? s[0].toUpperCase() + s.slice(1) : s);
const pts = (n: number): string => `${n} point${n === 1 ? '' : 's'}`;
const piece = (t: PieceType): string => NAME[t];

interface Side {
  sub: string;
  poss: string;
  /** object form: "them", "you" */
  obj: string;
  /** stand-alone possessive: "yours", "White's" */
  own: string;
}
interface Names {
  me: Side;
  they: Side;
}

function namesFor(userColor: Color | null, mover: Color): Names {
  if (userColor == null) {
    const other: Color = mover === 'w' ? 'b' : 'w';
    return { me: { sub: colorName(mover), poss: `${colorName(mover)}'s`, obj: colorName(mover), own: `${colorName(mover)}'s` }, they: { sub: colorName(other), poss: `${colorName(other)}'s`, obj: colorName(other), own: `${colorName(other)}'s` } };
  }
  if (userColor === mover) return { me: { sub: 'you', poss: 'your', obj: 'you', own: 'yours' }, they: { sub: 'they', poss: 'their', obj: 'them', own: 'theirs' } };
  return { me: { sub: 'your opponent', poss: 'their', obj: 'your opponent', own: 'theirs' }, they: { sub: 'you', poss: 'your', obj: 'you', own: 'yours' } };
}

export const mateIn = (l: StoredLine | undefined, who: Color): number | null => (l && l.mate != null && l.mate !== 0 && l.mate > 0 === (who === 'w') ? Math.abs(l.mate) : null);

/** "clearly winning", "roughly equal"... from the mover's expected points */
export function evalWords(ep: number): string {
  if (ep >= 0.9) return 'winning';
  if (ep >= 0.75) return 'clearly better';
  if (ep >= 0.6) return 'better';
  if (ep >= 0.54) return 'slightly better';
  if (ep > 0.46) return 'roughly equal';
  if (ep > 0.4) return 'slightly worse';
  if (ep > 0.25) return 'worse';
  if (ep > 0.1) return 'clearly worse';
  return 'losing';
}

/** Numbered SAN like "12.Nxe5 Nxe5 13.Qd4". */
export function sanLine(fen: string, ucis: Uci[], n = 6): string {
  let c: Chess;
  try {
    c = new Chess(fen);
  } catch {
    return '';
  }
  let num = +fen.split(' ')[5] || 1;
  const out: string[] = [];
  for (let i = 0; i < Math.min(n, ucis.length); i++) {
    const white = c.turn() === 'w';
    const m = uciMove(c, ucis[i]);
    if (!m) break;
    if (white) out.push(`${num}.${m.san}`);
    else {
      out.push(i === 0 ? `${num}...${m.san}` : m.san);
      num++;
    }
  }
  return out.join(' ');
}

interface Settled {
  /** material change for `color` at the end of the line (pawn=1, minor=3, rook=5, queen=9) */
  delta: number;
  /** the most `color` was ever down along the line (>= 0 means never behind) */
  worst: number;
  moves: Move[];
  reliable: boolean;
  mates: boolean;
}

/** Play `line` from `fen` and see what happens to material. The line is cut at the last move that is not a capture, so an exchange is never judged half-way. */
export function settle(fen: string, line: Uci[], color: Color, maxPlies = 8): Settled {
  const empty: Settled = { delta: 0, worst: 0, moves: [], reliable: false, mates: false };
  let c: Chess;
  try {
    c = new Chess(fen);
  } catch {
    return empty;
  }
  const base = materialBalance(fen, color);
  const used: Move[] = [];
  const bal: number[] = [0];
  for (const u of line.slice(0, maxPlies)) {
    const m = uciMove(c, u);
    if (!m) break;
    used.push(m);
    bal.push(materialBalance(c.fen(), color) - base);
  }
  if (!used.length) return empty;
  const mates = c.isCheckmate();
  let k = used.length;
  if (!mates) {
    // back off to the last quiet move (unless the whole line is short: then the engine itself stopped there)
    while (k > 1 && used[k - 1].captured) k--;
    if (k < 2 && used.length >= 2) k = Math.min(2, used.length);
  }
  return { delta: bal[k], worst: Math.min(...bal.slice(0, k + 1)), moves: used.slice(0, k), reliable: k >= 2 || mates, mates };
}

const cheapest = (b: BoardMap, sqs: Square[]): Square => sqs.slice().sort((a, z) => VAL[b[a].type] - VAL[b[z].type])[0];

/** A sliding piece that lines up two of the victim's pieces: pin or skewer. */
function lineUp(b: BoardMap, from: Square, victim: Color): { kind: 'pin' | 'skewer'; front: Square; back: Square } | null {
  const p = b[from];
  if (!p || (p.type !== 'b' && p.type !== 'r' && p.type !== 'q')) return null;
  const dirs = p.type === 'b' ? [[1, 1], [1, -1], [-1, 1], [-1, -1]] : p.type === 'r' ? [[1, 0], [-1, 0], [0, 1], [0, -1]] : [[1, 1], [1, -1], [-1, 1], [-1, -1], [1, 0], [-1, 0], [0, 1], [0, -1]];
  for (const [dx, dy] of dirs) {
    let x = FILES.indexOf(from[0]) + dx;
    let y = +from[1] - 1 + dy;
    const seen: Square[] = [];
    while (x >= 0 && x < 8 && y >= 0 && y < 8 && seen.length < 2) {
      const s = FILES[x] + (y + 1);
      if (b[s]) seen.push(s);
      x += dx;
      y += dy;
    }
    if (seen.length < 2) continue;
    const [front, back] = seen;
    if (b[front].color !== victim || b[back].color !== victim) continue;
    const vf = VAL[b[front].type];
    const vb = VAL[b[back].type];
    if (b[back].type === 'k' || vb > vf) return { kind: 'pin', front, back };
    if (vf > vb && vf >= 5) return { kind: 'skewer', front, back };
  }
  return null;
}

const LESSON: Record<ExplainTag, string> = {
  'hung-piece': 'Before every move, ask: after this, can they take anything of mine for free? Check the square you are moving to.',
  'left-piece-hanging': 'Every piece should be protected. Before moving a piece, ask what it is currently protecting.',
  'ignored-threat': 'At the start of every turn, ask: what did their last move attack? Deal with that first.',
  exposed: 'Moving a piece can open a line for your opponent. Look at what was standing behind it.',
  'allowed-mate': 'Before you move, look at every check and capture they have. Keep your king safe above everything else.',
  'back-rank': 'Give your king an escape square (a pawn move like h3 or h6) so one rook cannot checkmate it on the back rank.',
  'missed-mate': 'Every turn, look at every check you can give first. Checkmate beats everything else.',
  'allowed-fork': 'A knight can attack two pieces at once. Before moving, look at where their knight can jump next.',
  'allowed-pin': 'Watch for long diagonals and open files. A piece lined up in front of your king or queen is in danger.',
  'bad-trade': 'Count before trading: add up what you give and what you get. Piece values: pawn 1, knight 3, bishop 3, rook 5, queen 9.',
  'lost-material': 'Count the material before and after the whole sequence of captures, not just the first one.',
  'missed-free-piece': 'Each turn, scan for enemy pieces that nothing protects. Free material is the easiest way to win.',
  'missed-fork': 'Look for moves that attack two things at once. They can only save one.',
  'missed-win': 'When they make a mistake, look at every capture and every check before playing a quiet move.',
  'early-queen': 'Develop knights and bishops first. A queen out early just gets chased around.',
  'rim-knight': 'A knight on the edge sees half as many squares. Knights belong near the centre.',
  positional: 'Not every mistake loses a piece. Improve your worst-placed piece, fight for the centre, and keep your king safe.',
};

const HEADLINE: Record<ExplainTag, (n: Names) => string> = {
  'hung-piece': (n) => `${cap(n.me.poss)} piece can be taken`,
  'left-piece-hanging': (n) => `${cap(n.me.sub)} left a piece without protection`,
  'ignored-threat': (n) => `${cap(n.me.sub)} ignored a threat`,
  exposed: (n) => `${cap(n.me.sub)} opened a line for the opponent`,
  'allowed-mate': (n) => `This lets ${n.they.obj} checkmate`,
  'back-rank': () => 'This allows a back-rank checkmate',
  'missed-mate': (n) => `${cap(n.me.sub)} missed a checkmate`,
  'allowed-fork': () => 'This walks into a fork',
  'allowed-pin': () => 'This allows a pin or skewer',
  'bad-trade': () => 'This trade loses material',
  'lost-material': () => 'This loses material',
  'missed-free-piece': (n) => `${cap(n.me.sub)} missed a free piece`,
  'missed-fork': (n) => `${cap(n.me.sub)} missed a fork`,
  'missed-win': (n) => `${cap(n.me.sub)} missed a way to win material`,
  'early-queen': () => 'The queen came out too early',
  'rim-knight': () => 'A knight on the edge',
  positional: () => 'A weaker plan',
};

// ---- the explainer ---------------------------------------------------------------------------------------------

interface Ctx {
  fen0: string;
  b0: BoardMap;
  fen1: string;
  b1: BoardMap;
  me: Color;
  opp: Color;
  mv: Move;
  m: MoveReview;
  A: PosAnalysis;
  B: PosAnalysis;
  N: Names;
  prev?: MoveReview;
}

function boardAfter(fen: string, u: Uci | null | undefined): { fen: string; board: BoardMap; move: Move } | null {
  if (!u) return null;
  try {
    const c = new Chess(fen);
    const move = uciMove(c, u);
    return move ? { fen: c.fen(), board: parseFen(c.fen()), move } : null;
  } catch {
    return null;
  }
}

/** Checkmates the other side would have if it were their turn right now (what they are threatening). */
export function mateThreats(fen: string, me: Color): string[] {
  try {
    const parts = fen.split(' ');
    parts[1] = me === 'w' ? 'b' : 'w';
    parts[3] = '-';
    const c = new Chess(parts.join(' '));
    const out: string[] = [];
    for (const m of c.moves({ verbose: true })) {
      c.move(m);
      if (c.isCheckmate()) out.push(m.san);
      c.undo();
    }
    return out;
  } catch {
    return [];
  }
}

/** What whatBestDoes needs: the position, who is to move and the engine's lines. `m` and `B` are only needed to describe the move actually played. */
type BestCtx = Pick<Ctx, 'fen0' | 'b0' | 'me' | 'opp' | 'N' | 'A'> & Partial<Pick<Ctx, 'm' | 'B'>>;

/** What the engine's top move achieves, in words. `forPlayed` = describing the move that was actually played. */
function whatBestDoes(x: BestCtx, forPlayed: boolean): string {
  const { N, A, fen0, b0, me, opp } = x;
  const line = forPlayed && x.m ? [x.m.uci, ...(x.B?.lines[0]?.pv ?? [])] : (A.lines[0]?.pv ?? []);
  const first = line[0];
  const bb = boardAfter(fen0, first);
  if (!bb) return '';
  const san = bb.move.san;
  const lead = san;
  if (forPlayed && x.B?.terminal === 'mate') return `${lead} is checkmate.`;
  const mate = forPlayed ? mateIn(x.B?.lines[0], me) : mateIn(A.lines[0], me);
  if (mate != null) return mate === 1 ? `${lead} is checkmate.` : `${lead} forces checkmate in ${mate}: ${sanLine(fen0, line, mate * 2 - 1)}.`;

  // wins a loose piece
  if (bb.move.captured) {
    const target = bb.move.to;
    const was = hangingInfo(b0, target);
    if (was && was.piece.color === opp) {
      const free = was.reason === 'undefended';
      return `${lead} takes ${N.they.poss} ${piece(bb.move.captured)} on ${target}, which ${free ? 'nothing protected' : 'was attacked by a cheaper piece, so taking it wins the exchange'}.`;
    }
    if (VAL[bb.move.captured] > VAL[bb.move.piece]) return `${lead} takes a ${piece(bb.move.captured)} with a ${piece(bb.move.piece)}, which is worth less, so ${N.me.sub} comes out ahead.`;
  }
  // fork
  const ft = forkTargets(bb.board, bb.move.to).filter((t) => bb.board[t].color === opp);
  if (ft.length >= 2) {
    const names = ft.slice(0, 2).map((t) => (bb.board[t].type === 'k' ? 'king' : `${piece(bb.board[t].type)} on ${t}`));
    return `${lead} attacks ${N.they.poss} ${names[0]} and ${names[1]} at the same time. They can only save one.`;
  }
  // saves a piece
  const mine = hangingPieces(b0, me).filter((h) => VAL[h.piece.type] >= 3);
  for (const h of mine) {
    if (bb.move.from === h.square) return `${lead} moves ${N.me.poss} ${piece(h.piece.type)} on ${h.square} out of danger.`;
    if (!hangingInfo(bb.board, h.square)) return `${lead} protects ${N.me.poss} ${piece(h.piece.type)} on ${h.square}, which was under attack.`;
  }
  // stops a checkmate they were threatening
  const threats = mateThreats(fen0, me);
  if (threats.length && mateThreats(bb.fen, me).length === 0) {
    return `They were threatening checkmate with ${threats[0]}. ${lead} stops it${bb.move.san.includes('+') ? ' with check' : ''}.`;
  }
  if (bb.move.san.includes('+')) return `${lead} gives check and keeps ${N.me.poss} initiative.`;
  const s = settle(fen0, line, me);
  if (s.reliable && s.delta >= 1) return `${lead} comes out ${pts(s.delta)} of material ahead after ${sanLine(fen0, line, s.moves.length)}.`;
  if (bb.move.flags.includes('k') || bb.move.flags.includes('q')) return `${lead} castles, tucking the king away and bringing a rook into play.`;
  const homeRank = me === 'w' ? '1' : '8';
  if ((bb.move.piece === 'n' || bb.move.piece === 'b') && bb.move.from[1] === homeRank) return `${lead} brings a ${piece(bb.move.piece)} into the game, where it controls more squares.`;
  if (bb.move.piece === 'p' && ['d4', 'e4', 'd5', 'e5'].includes(bb.move.to)) return `${lead} puts a pawn in the centre, which gives ${N.me.poss} pieces room to move.`;
  return '';
}

function shiftSentence(x: Ctx): string {
  const before = evalWords(x.m.epBest);
  const after = evalWords(x.m.epAfter);
  if (before === after) return '';
  return `${cap(x.N.me.poss)} position went from ${before} to ${after}.`;
}

function whyBetter(x: Ctx, thing: string | null): string {
  const best = x.m.bestSan;
  if (!best || x.m.bestUci === x.m.uci) return '';
  const what = whatBestDoes(x, false);
  const line = x.A.lines[0]?.pv ?? [];
  const cont = line.length >= 3 ? ` A likely continuation: ${sanLine(x.fen0, line, 5)}.` : '';
  if (what) return `${what}${thing ? ` ${thing}` : ''}${cont}`;
  return `${best} was the engine's choice, keeping ${x.N.me.poss} position ${evalWords(x.m.epBest)}.${cont}`;
}

function primaryReason(x: Ctx): { tag: ExplainTag; what: string[]; danger: Square[] } {
  const { N, mv, m, A, B, b0, b1, me, opp } = x;
  const refut = B.lines[0]?.pv ?? [];
  const reply = refut[0] ? boardAfter(x.fen1, refut[0]) : null;
  const replySan = reply?.move.san ?? '';
  const myMate = mateIn(A.lines[0], me);
  const theirMate = mateIn(B.lines[0], opp);
  const played = settle(x.fen0, [m.uci, ...refut], me);
  const bestLn = settle(x.fen0, A.lines[0]?.pv ?? [], me);
  const lost = -played.delta;
  const costLine = (): string => {
    const ln = sanLine(x.fen0, [m.uci, ...refut], Math.max(played.moves.length, 3));
    return ln ? ` The likely continuation is ${ln}, which costs ${N.me.sub} about ${pts(Math.max(1, lost))} of material.` : '';
  };

  /** the engine's move wins material (a free piece, a fork, or a line) and the played move did not */
  const missed = (): { tag: ExplainTag; what: string[]; danger: Square[] } | null => {
    const bm = boardAfter(x.fen0, m.bestUci);
    if (!bm || !bestLn.reliable || bestLn.delta < 2 || played.delta >= bestLn.delta) return null;
    const target = bm.move.to;
    const loose = bm.move.captured ? hangingInfo(b0, target) : null;
    if (loose && loose.piece.color === opp) {
      return {
        tag: 'missed-free-piece',
        what: [`${cap(N.they.poss)} ${piece(loose.piece.type)} on ${target} was ${loose.reason === 'undefended' ? 'not protected by anything' : 'attacked by a cheaper piece'}. ${m.bestSan} would have won it.`, `${m.san} let the chance go.`],
        danger: [target],
      };
    }
    const ft = forkTargets(bm.board, bm.move.to).filter((s) => bm.board[s].color === opp);
    if (ft.length >= 2) {
      return {
        tag: 'missed-fork',
        what: [`${m.bestSan} would have attacked two pieces at once, and ${N.they.sub} could only save one. ${m.san} missed it.`],
        danger: [bm.move.to, ...ft.slice(0, 2)],
      };
    }
    return {
      tag: 'missed-win',
      what: [`${m.bestSan} wins material by force: ${sanLine(x.fen0, A.lines[0].pv, bestLn.moves.length)} leaves ${N.me.sub} ${pts(bestLn.delta)} ahead. ${m.san} gave that up.`],
      danger: [bm.move.from, bm.move.to],
    };
  };

  // 1. a forced mate was there and is gone
  if (myMate != null && mateIn(B.lines[0], me) == null) {
    const line = A.lines[0].pv;
    return {
      tag: 'missed-mate',
      what: [
        myMate === 1 ? `${cap(N.me.sub)} had checkmate in one: ${m.bestSan}.` : `${cap(N.me.sub)} had a forced checkmate in ${myMate}: ${sanLine(x.fen0, line, myMate * 2 - 1)}.`,
        `${m.san} let ${N.they.obj} off the hook.`,
      ],
      danger: m.bestUci ? [m.bestUci.slice(0, 2), m.bestUci.slice(2, 4)] : [],
    };
  }

  // 2. the move allows a forced mate
  if (theirMate != null && mateIn(A.lines[0], opp) == null && reply) {
    const out: string[] = [];
    let tag: ExplainTag = 'allowed-mate';
    if (theirMate === 1) {
      out.push(`After ${m.san}, ${N.they.sub} can checkmate right away with ${replySan}.`);
      try {
        const c2 = new Chess(x.fen1);
        uciMove(c2, refut[0]);
        if (c2.isCheckmate()) {
          const king = Object.keys(parseFen(c2.fen())).find((s) => parseFen(c2.fen())[s].type === 'k' && parseFen(c2.fen())[s].color === me);
          const backRank = me === 'w' ? '1' : '8';
          if (king && king[1] === backRank && (reply.move.piece === 'r' || reply.move.piece === 'q') && reply.move.to[1] === backRank) {
            tag = 'back-rank';
            out.push(`This is a back-rank mate: ${N.me.poss} king is trapped behind its own pawns and has no square to escape to.`);
          }
        }
      } catch {
        /* keep the plain text */
      }
    } else {
      out.push(`After ${m.san}, ${N.they.sub} can force checkmate in ${theirMate}, starting with ${replySan}: ${sanLine(x.fen1, refut, theirMate * 2 - 1)}.`);
    }
    return { tag, what: out, danger: [reply.move.from, reply.move.to] };
  }

  // 3. the move loses material along the engine's best reply
  if (played.reliable && lost >= 2 && bestLn.delta >= played.delta + 2) {
    const rc = reply?.move.captured;
    if (reply && rc && reply.move.to === mv.to) {
      const att = attackers(b1, mv.to, opp);
      const def = attackers(b1, mv.to, me);
      const by = att.length ? cheapest(b1, att) : reply.move.from;
      const who = `${piece(b1[by]?.type ?? reply.move.piece)} on ${by}`;
      const out = [
        mv.captured
          ? `${cap(N.me.sub)} took a ${piece(mv.captured)} on ${mv.to}, but ${N.they.sub} can take back with the ${who} (${replySan}).`
          : `${cap(N.me.sub)} moved ${N.me.poss} ${piece(mv.piece)} to ${mv.to}, where ${N.they.sub} can capture it with the ${who} (${replySan}).`,
      ];
      let tag: ExplainTag = 'hung-piece';
      if (!def.length) out.push(`Nothing of ${N.me.own} protects it there, so ${N.they.sub} can win it for free.`);
      else if (VAL[b1[by]?.type ?? 'p'] < VAL[mv.piece]) out.push(`It is protected, but ${N.they.poss} ${piece(b1[by].type)} is worth less than ${N.me.poss} ${piece(mv.piece)}, so the trade still loses material.`);
      else {
        tag = 'bad-trade';
        out.push('Even with the recapture, the whole sequence of captures ends up costing material.');
      }
      out.push(costLine().trim());
      return { tag, what: out.filter(Boolean), danger: [mv.to, reply.move.from] };
    }
    if (reply && rc) {
      const t = reply.move.to;
      const def0 = attackers(b0, t, me);
      const def1 = attackers(b1, t, me);
      const wasLoose = b0[t] && b0[t].color === me ? hangingInfo(b0, t) : null;
      const out: string[] = [];
      let tag: ExplainTag = 'lost-material';
      if (wasLoose && mv.from !== t) {
        tag = 'ignored-threat';
        out.push(`${cap(N.me.poss)} ${piece(rc)} on ${t} was already under attack${x.prev ? ` after ${x.prev.san}` : ''}, and ${m.san} did not deal with it.`);
        out.push(`${cap(N.they.sub)} can simply take it with ${replySan}.`);
      } else if (def0.includes(mv.from) && def1.length === 0) {
        tag = 'left-piece-hanging';
        out.push(`The ${piece(mv.piece)} that moved was the one protecting ${N.me.poss} ${piece(rc)} on ${t}. Now nothing defends it, and ${N.they.sub} can take it with ${replySan}.`);
      } else if (attackers(b0, t, opp).length === 0 && attackers(b1, t, opp).length > 0) {
        tag = 'exposed';
        out.push(`${m.san} opened a line: ${N.they.poss} ${piece(reply.move.piece)} on ${reply.move.from} can now capture ${N.me.poss} ${piece(rc)} on ${t} (${replySan}).`);
      } else {
        out.push(`${cap(N.they.sub)} can win ${N.me.poss} ${piece(rc)} on ${t} with ${replySan}.`);
      }
      out.push(costLine().trim());
      return { tag, what: out.filter(Boolean), danger: [t, reply.move.from] };
    }
    if (reply) {
      const ft = forkTargets(reply.board, reply.move.to).filter((s) => reply.board[s].color === me);
      if (ft.length >= 2) {
        const names = ft.slice(0, 2).map((s) => (reply.board[s].type === 'k' ? 'king' : `${piece(reply.board[s].type)} on ${s}`));
        return {
          tag: 'allowed-fork',
          what: [`After ${m.san}, ${N.they.poss} ${piece(reply.move.piece)} can jump to ${reply.move.to} (${replySan}) and attack ${N.me.poss} ${names[0]} and ${names[1]} at the same time. ${cap(N.me.sub)} can only save one.`, costLine().trim()].filter(Boolean),
          danger: [reply.move.to, ...ft.slice(0, 2)],
        };
      }
      const lu = lineUp(reply.board, reply.move.to, me);
      if (lu) {
        const f = piece(reply.board[lu.front].type);
        const bk = piece(reply.board[lu.back].type);
        return {
          tag: 'allowed-pin',
          what: [
            lu.kind === 'pin'
              ? `${cap(N.they.sub)} can play ${replySan}, which pins ${N.me.poss} ${f} on ${lu.front} to the ${bk} on ${lu.back}. The ${f} cannot move without losing the ${bk}.`
              : `${cap(N.they.sub)} can play ${replySan}, attacking ${N.me.poss} ${f} on ${lu.front}. When it moves away, the ${bk} on ${lu.back} behind it falls.`,
            costLine().trim(),
          ].filter(Boolean),
          danger: [lu.front, lu.back, reply.move.to],
        };
      }
    }
    const chance = missed();
    if (chance) return chance;
    return { tag: 'lost-material', what: [`The engine's best line loses material for ${N.me.sub}.${costLine()}`], danger: reply ? [reply.move.from, reply.move.to] : [] };
  }

  // 4. nothing is lost, but something better was available
  const chance = missed();
  if (chance) return chance;

  // 5. quiet mistakes: the usual opening habits, else a plain honest statement
  if (m.ply < 16 && mv.piece === 'q' && !mv.captured) {
    return { tag: 'early-queen', what: [`Bringing the queen out this early lets ${N.they.sub} develop with tempo by attacking it, while ${N.me.poss} other pieces stay at home.`], danger: [mv.to] };
  }
  if (m.ply < 24 && mv.piece === 'n' && (mv.to[0] === 'a' || mv.to[0] === 'h')) {
    return { tag: 'rim-knight', what: [`A knight on ${mv.to} controls only a few squares. In the centre it would attack twice as many.`], danger: [mv.to] };
  }
  const tail = refut.length >= 2 ? ` The engine expects ${sanLine(x.fen0, [m.uci, ...refut], 4)}.` : '';
  return {
    tag: 'positional',
    what: [`There is no single piece to point at here. ${m.san} simply gives ${N.they.obj} a better version of the position.${tail}`],
    danger: [],
  };
}

function explainBad(x: Ctx): Explanation {
  const { N, m } = x;
  const r = primaryReason(x);
  const what = r.what.slice();
  if (m.cls === 'miss' && x.prev) what.unshift(`${cap(N.they.poss)} last move (${x.prev.san}) was a mistake, and this was the moment to punish it.`);
  const shift = shiftSentence(x);
  if (shift) what.push(shift);
  const better = whyBetter(x, null);
  return {
    headline: HEADLINE[r.tag](N),
    what,
    better: better || undefined,
    lesson: LESSON[r.tag],
    tags: [r.tag],
    danger: r.danger,
    punish: x.B.lines[0]?.pv[0] ?? null,
  };
}

function explainGreat(x: Ctx): Explanation {
  const { N, m, A } = x;
  const what: string[] = [];
  const own = whatBestDoes(x, true);
  if (own) what.push(own);
  const alt = A.lines[1];
  if (alt?.pv[0]) {
    const altSan = sanOf(x.fen0, alt.pv[0]);
    const s = settle(x.fen0, alt.pv, x.me);
    const altMate = mateIn(alt, x.opp);
    const gap = Math.round((m.epBest - epFor(alt, x.me)) * 100);
    const consequence = altMate != null ? 'runs into checkmate' : s.reliable && s.delta <= -2 ? `loses about ${pts(-s.delta)} of material` : `gives away roughly ${Math.max(gap, 1)}% of ${N.me.poss} winning chances`;
    what.push(`Almost every other move fails here. Even the next best, ${altSan}, ${consequence}.`);
  }
  if (m.note) what.push(m.note + '.');
  return { headline: `${m.san} is the only good move`, what, tags: [], danger: [], punish: null };
}

function explainBrilliant(x: Ctx): Explanation {
  const { N, m } = x;
  const line = [m.uci, ...(x.B.lines[0]?.pv ?? [])];
  const s = settle(x.fen0, line, x.me, 8);
  const what: string[] = [];
  const gave = Math.max(0, -s.worst);
  what.push(
    gave > 0
      ? `${cap(N.me.sub)} gave up material (about ${pts(gave)}) on purpose. It looks risky, but the engine confirms it is the best way to continue.`
      : `${cap(N.me.sub)} found a move that looks risky but is the best way to continue.`,
  );
  const ln = sanLine(x.fen0, line, 6);
  if (ln) what.push(`The idea: ${ln}. ${cap(N.me.poss)} position ends up ${evalWords(m.epAfter)}.`);
  return { headline: `${m.san} is a brilliant sacrifice`, what, tags: [], danger: [], punish: null };
}

function explainSolid(x: Ctx): Explanation {
  const { m, N } = x;
  const top = x.m.bestUci === m.uci;
  const what: string[] = [];
  const own = top ? whatBestDoes(x, true) : '';
  if (own) what.push(own);
  if (!top && m.bestSan && m.bestSan !== m.san) {
    const b = whatBestDoes(x, false);
    what.push(b ? `${b} That was slightly stronger than ${m.san}.` : `${m.bestSan} was slightly stronger.`);
  }
  if (!what.length) what.push(top ? 'The engine agrees: nothing is better here.' : `${cap(N.me.sub)} played a sensible move.`);
  return { headline: top ? `${m.san} is the best move` : `${m.san} is fine`, what, tags: [], danger: [], punish: null };
}

/** Explain one move. Works for every class; weak moves also get a "why the best move was better" paragraph and a lesson. */
export function explainMove(i: ExplainInput): Explanation | null {
  const { move: m, before: A, after: B } = i;
  if (!A?.lines[0] || !B?.lines[0]) return null;
  let c: Chess;
  try {
    c = new Chess(i.fenBefore);
  } catch {
    return null;
  }
  const me: Color = c.turn();
  const mv = uciMove(c, m.uci);
  if (!mv) return null;
  const x: Ctx = {
    fen0: i.fenBefore,
    b0: parseFen(i.fenBefore),
    fen1: c.fen(),
    b1: parseFen(c.fen()),
    me,
    opp: me === 'w' ? 'b' : 'w',
    mv,
    m,
    A,
    B,
    N: namesFor(i.userColor, me),
    prev: i.prev,
  };
  switch (m.cls) {
    case 'inaccuracy':
    case 'mistake':
    case 'miss':
    case 'blunder':
      return explainBad(x);
    case 'great':
      return explainGreat(x);
    case 'brilliant':
      return explainBrilliant(x);
    case 'best':
    case 'excellent':
    case 'good':
      return explainSolid(x);
    default:
      return null;
  }
}

/**
 * What the engine's best move does in this position and the line it leads to, for puzzle solutions.
 * `pos` is the engine's analysis of `fen`; the side to move is the solver.
 */
export function explainBestMove(fen: string, pos: PosAnalysis): string {
  if (!pos?.lines[0]?.pv.length) return '';
  let me: Color;
  try {
    me = new Chess(fen).turn();
  } catch {
    return '';
  }
  const x: BestCtx = { fen0: fen, b0: parseFen(fen), me, opp: me === 'w' ? 'b' : 'w', N: namesFor(me, me), A: pos };
  const what = whatBestDoes(x, false);
  const line = pos.lines[0].pv;
  const cont = line.length >= 3 && !what.includes('forces checkmate') ? ` A likely continuation: ${sanLine(fen, line, 5)}.` : '';
  return (what || `${sanOf(fen, line[0])} is the engine's choice.`) + cont;
}

/** A short "what does this position threaten / what should I look at" for Spot-the-threat style prompts. */
export function threatsAgainst(fen: string, color: Color): { square: Square; by: Square[]; reason: 'undefended' | 'cheaper'; type: PieceType }[] {
  const b = parseFen(fen);
  return hangingPieces(b, color)
    .filter((h) => VAL[h.piece.type] >= 3)
    .map((h) => ({ square: h.square, by: h.by, reason: h.reason, type: h.piece.type }));
}

