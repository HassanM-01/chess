// "Explain it like I'm new": every move described in words (not notation), the position described piece by piece, and a
// step-by-step breakdown. Like explain.ts, everything here is computed from the board and the engine's lines.
import { Chess, uciMove } from '@/chess/compat';
import { NAME, VAL, hangingPieces, parseFen } from '@/chess/tactics';
import type { Color, PieceType, Uci } from '@/chess/types';
import { epFor } from './expected';
import { evalWords, explainBestMove, explainMove, mateIn, settle, type ExplainInput } from './explain';
import type { PosAnalysis } from './types';

export interface Step {
  title: string;
  /** short sentences, one per line */
  lines: string[];
}

const PLURAL: Record<PieceType, string> = { p: 'pawns', n: 'knights', b: 'bishops', r: 'rooks', q: 'queens', k: 'kings' };
export const POINTS_NOTE = 'Points: pawn 1, knight 3, bishop 3, rook 5, queen 9. The side with more points is usually winning.';

const plural = (sub: string): boolean => sub === 'You' || sub === 'They';
const verb = (sub: string, base: string): string => (plural(sub) ? base : base === 'take' ? 'takes' : base === 'turn' ? 'turns' : base === 'castle' ? 'castles' : `${base}s`);

/** "You move the bishop from c4 to f7 and take a pawn. That is check!" */
export function moveInWords(fen: string, uci: Uci, subject: 'You' | 'They' | 'White' | 'Black'): string {
  let c: Chess;
  try {
    c = new Chess(fen);
  } catch {
    return '';
  }
  const m = uciMove(c, uci);
  if (!m) return '';
  let t: string;
  if (m.flags.includes('k') || m.flags.includes('q')) {
    t = `${subject} ${verb(subject, 'castle')} ${m.flags.includes('k') ? 'kingside' : 'queenside'}: the king steps two squares and the rook hops over to protect it.`;
  } else if (m.captured) {
    t = m.flags.includes('e')
      ? `${subject} ${verb(subject, 'take')} a pawn "en passant" with the pawn from ${m.from}, landing on ${m.to}`
      : `${subject} ${verb(subject, 'take')} the ${NAME[m.captured]} on ${m.to} with the ${NAME[m.piece]} from ${m.from}`;
  } else {
    t = `${subject} ${verb(subject, 'move')} the ${NAME[m.piece]} from ${m.from} to ${m.to}`;
  }
  if (m.promotion) t += ` and ${verb(subject, 'turn')} the pawn into a ${NAME[m.promotion]}`;
  if (!t.endsWith('.')) t += '.';
  if (m.san.includes('#')) t += ' That is checkmate, the game is over!';
  else if (m.san.includes('+')) t += ' That is check: the king is attacked and has to deal with it right now.';
  return t;
}

/** The moves of a line, one plain sentence each: "You move ... They take ...". `me` is who "You" is. */
export function walkthrough(fen: string, ucis: Uci[], me: Color, n = 6): string[] {
  let c: Chess;
  try {
    c = new Chess(fen);
  } catch {
    return [];
  }
  const out: string[] = [];
  for (const u of ucis.slice(0, n)) {
    const sub = c.turn() === me ? 'You' : 'They';
    const t = moveInWords(c.fen(), u, sub);
    if (!t || !uciMove(c, u)) break;
    out.push(t);
  }
  return out;
}

function inventory(fen: string, color: Color): { text: string; points: number } {
  const counts: Partial<Record<PieceType, number>> = {};
  let points = 0;
  for (const p of Object.values(parseFen(fen))) {
    if (p.color !== color || p.type === 'k') continue;
    counts[p.type] = (counts[p.type] ?? 0) + 1;
    points += VAL[p.type];
  }
  const order: PieceType[] = ['q', 'r', 'b', 'n', 'p'];
  const parts = order.filter((t) => counts[t]).map((t) => `${counts[t]} ${counts[t] === 1 ? NAME[t] : PLURAL[t]}`);
  return { text: parts.length ? parts.join(', ') : 'no pieces besides the king', points };
}

/** The board in words: who has what, what is in check, and which pieces are attacked with nothing protecting them. */
export function situationWords(fen: string, me: Color): string[] {
  const out: string[] = [];
  const opp: Color = me === 'w' ? 'b' : 'w';
  const mine = inventory(fen, me);
  const theirs = inventory(fen, opp);
  out.push(`You have ${mine.text} (${mine.points} points). They have ${theirs.text} (${theirs.points} points).`);
  const diff = mine.points - theirs.points;
  out.push(diff === 0 ? 'So material is even.' : diff > 0 ? `So you are ahead by ${diff} point${diff === 1 ? '' : 's'}.` : `So you are behind by ${-diff} point${diff === -1 ? '' : 's'}.`);
  try {
    const c = new Chess(fen);
    if (c.inCheck()) out.push(`${c.turn() === me ? 'Your' : 'Their'} king is in check right now.`);
  } catch {
    /* ignore */
  }
  const b = parseFen(fen);
  const loose = (color: Color, owner: 'Your' | 'Their', by: 'their' | 'your'): string[] =>
    hangingPieces(b, color)
      .filter((h) => VAL[h.piece.type] >= 1)
      .slice(0, 3)
      .map((h) => {
        const attacker = h.by.map((s) => `${NAME[b[s].type]} on ${s}`)[0];
        const tail = h.reason === 'undefended' ? ' and nothing protects it.' : ', which is worth less, so even a trade would lose points.';
        return `${owner} ${NAME[h.piece.type]} on ${h.square} is attacked by ${by} ${attacker}${tail}`;
      });
  out.push(...loose(opp, 'Their', 'your'), ...loose(me, 'Your', 'their'));
  return out;
}

function resultWords(fen: string, line: Uci[], me: Color, ep: number): string[] {
  const s = settle(fen, line, me);
  if (s.mates) return ['The line ends in checkmate, so the game is won.'];
  const out: string[] = [];
  if (s.reliable && s.delta >= 1) out.push(`After these moves you are ${s.delta} point${s.delta === 1 ? '' : 's'} better off than before.`);
  else if (s.reliable && s.delta <= -1) out.push(`After these moves you are ${-s.delta} point${s.delta === -1 ? '' : 's'} worse off than before.`);
  else out.push('Nobody wins or loses material in these moves.');
  out.push(`The engine rates your position as ${evalWords(ep)} afterwards.`);
  return out;
}

/** A step-by-step breakdown of the engine's best move in a position (for puzzles and "what should I play?"). `pos.lines[0]` is the line to explain. */
export function bestMoveSteps(fen: string, pos: PosAnalysis): Step[] {
  let me: Color;
  try {
    me = new Chess(fen).turn();
  } catch {
    return [];
  }
  const top = pos.lines[0];
  if (!top?.pv.length) return [];
  const why = explainBestMove(fen, pos);
  const walk = walkthrough(fen, top.pv, me, 6);
  const mate = mateIn(top, me);
  return [
    { title: '1. Look at the board', lines: [...situationWords(fen, me), POINTS_NOTE] },
    { title: '2. The move', lines: [moveInWords(fen, top.pv[0], 'You'), ...(why ? [`Why: ${why.replace(/ A likely continuation:.*$/, '')}`] : [])] },
    { title: '3. What happens next', lines: walk.length > 1 ? walk.map((t, i) => `${i + 1}. ${t}`) : ['The game is decided right away.'] },
    { title: '4. Why that is good', lines: mate ? [`This forces checkmate in ${mate}, so nothing they do can save them.`] : resultWords(fen, top.pv, me, epFor(top, me)) },
  ];
}

/** A step-by-step breakdown of one move in a game: what was played, what it allows, and what was better. */
export function moveSteps(x: ExplainInput): Step[] {
  const { fenBefore: fen0, move: m, before: A, after: B } = x;
  let mover: Color;
  try {
    mover = new Chess(fen0).turn();
  } catch {
    return [];
  }
  const me: Color = x.userColor ?? mover;
  const who = (c: Color): 'You' | 'They' | 'White' | 'Black' => (x.userColor ? (c === me ? 'You' : 'They') : c === 'w' ? 'White' : 'Black');
  const lossPct = Math.round(m.loss * 100);
  const bad = m.cls === 'inaccuracy' || m.cls === 'mistake' || m.cls === 'miss' || m.cls === 'blunder';
  const steps: Step[] = [{ title: '1. Look at the board before the move', lines: [...situationWords(fen0, me), POINTS_NOTE] }];
  steps.push({
    title: '2. What was played',
    lines: [moveInWords(fen0, m.uci, who(mover)), bad ? `The engine calls this ${m.cls === 'miss' ? 'a miss' : `a ${m.cls}`}. It gave up about ${lossPct}% of the winning chances.` : `The engine calls this ${m.cls === 'book' ? 'a book move (a well-known opening move)' : `${m.cls}`}.`],
  });
  const refut = B?.lines[0]?.pv ?? [];
  if (bad && refut.length) {
    const walk = walkthrough(fen0, [m.uci, ...refut], me, 5);
    steps.push({ title: '3. What can happen next', lines: walk.map((t, i) => `${i + 1}. ${t}`) });
  }
  if (bad && m.bestUci && A?.lines[0]) {
    const why = explainBestMove(fen0, A);
    steps.push({
      title: bad && refut.length ? '4. What would have been better' : '3. What would have been better',
      lines: [moveInWords(fen0, m.bestUci, who(mover)), ...(why ? [`Why: ${why.replace(/ A likely continuation:.*$/, '')}`] : []), ...walkthrough(fen0, A.lines[0].pv, me, 4).slice(1).map((t) => `Then: ${t}`)],
    });
  }
  const ex = explainMove(x);
  if (ex?.lesson) steps.push({ title: `${steps.length + 1}. The rule to remember`, lines: [ex.lesson] });
  return steps;
}

