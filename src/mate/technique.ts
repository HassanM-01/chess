// Checkmate technique: the endgames where you must BUILD the mate (K+Q v K, K+R v K, K+R+R v K).
// Pure logic: start positions, which stage of the plan you are in, and how a move is graded against the engine's mate distance.
import { Chess } from '@/chess/compat';
import { attackers, attacksFrom, parseFen } from '@/chess/tactics';
import { FILES, type Color, type Square, type Uci } from '@/chess/types';

export type TechniqueKind = 'kq' | 'kr' | 'rr';

export interface TechniqueInfo {
  kind: TechniqueKind;
  title: string;
  blurb: string;
  /** white pieces besides the king */
  pieces: ('q' | 'r')[];
}

export const TECHNIQUES: TechniqueInfo[] = [
  { kind: 'kq', title: 'King and queen vs king', blurb: 'Shrink the box with the queen a knight\'s move away, then walk your king up for the final check.', pieces: ['q'] },
  { kind: 'kr', title: 'King and rook vs king', blurb: 'Fence the king in with the rook, march your king to face his, then check on the edge.', pieces: ['r'] },
  { kind: 'rr', title: 'Two rooks vs king', blurb: 'The ladder: one rook checks, the other cuts off the next row, and the king is pushed to the edge.', pieces: ['r', 'r'] },
];

export const techniqueByKind = (k: string): TechniqueInfo | undefined => TECHNIQUES.find((t) => t.kind === k);

type Rng = () => number;

const sq = (f: number, r: number): Square => FILES[f] + (r + 1);
const dist = (a: Square, b: Square): number => Math.max(Math.abs(a.charCodeAt(0) - b.charCodeAt(0)), Math.abs(+a[1] - +b[1]));
export const onEdge = (s: Square): boolean => s[0] === 'a' || s[0] === 'h' || s[1] === '1' || s[1] === '8';

/** A random legal starting position: White (the student) to move, Black has only a king. */
export function randomStart(kind: TechniqueKind, rng: Rng = Math.random): string {
  const info = techniqueByKind(kind) as TechniqueInfo;
  for (let tries = 0; tries < 500; tries++) {
    const pick = (): Square => sq(Math.floor(rng() * 8), Math.floor(rng() * 8));
    // mostly start with the king in the middle (that is where you need the box), sometimes anywhere
    const central = rng() < 0.7;
    const bk = central ? sq(1 + Math.floor(rng() * 6), 1 + Math.floor(rng() * 6)) : pick();
    const wk = pick();
    if (dist(wk, bk) < 3) continue;
    const used = new Set<Square>([wk, bk]);
    const placed: { type: 'q' | 'r'; at: Square }[] = [];
    let ok = true;
    for (const type of info.pieces) {
      const at = pick();
      // not on top of another piece, and not for free next to the black king
      if (used.has(at) || dist(at, bk) < 2) {
        ok = false;
        break;
      }
      used.add(at);
      placed.push({ type, at });
    }
    if (!ok) continue;
    const board: Record<Square, string> = { [wk]: 'K', [bk]: 'k' };
    for (const p of placed) board[p.at] = p.type.toUpperCase();
    const rows: string[] = [];
    for (let r = 7; r >= 0; r--) {
      let row = '';
      let empty = 0;
      for (let f = 0; f < 8; f++) {
        const p = board[sq(f, r)];
        if (p) {
          if (empty) row += empty;
          empty = 0;
          row += p;
        } else empty++;
      }
      rows.push(row + (empty || ''));
    }
    const placement = rows.join('/');
    // Black must not already be in check (it would be illegal with White to move), and the position must not be over.
    try {
      const asBlack = new Chess(`${placement} b - - 0 1`);
      if (asBlack.inCheck()) continue;
      const c = new Chess(`${placement} w - - 0 1`);
      if (c.isGameOver()) continue;
      return c.fen();
    } catch {
      continue;
    }
  }
  // fallback that is always valid
  return info.kind === 'kq' ? '8/8/8/4k3/8/8/8/Q3K3 w - - 0 1' : info.kind === 'kr' ? '8/8/8/4k3/8/8/8/R3K3 w - - 0 1' : '8/8/8/4k3/8/8/8/R3K2R w - - 0 1';
}

export type StageId = 'mate-in-one' | 'center' | 'edge-far' | 'edge-close';

export interface Stage {
  id: StageId;
  title: string;
  /** the plan, in plain words */
  plan: string;
}

function kingSquares(fen: string): { white: Square; black: Square } {
  const c = new Chess(fen);
  let white = 'a1';
  let black = 'a1';
  for (const row of c.board()) for (const p of row) if (p && p.type === 'k') (p.color === 'w' ? (white = p.square) : (black = p.square));
  return { white, black };
}

const PLANS: Record<TechniqueKind, Record<StageId, { title: string; plan: string }>> = {
  kq: {
    'mate-in-one': { title: 'Mate is available', plan: 'Look for a queen check where the king cannot take her (your king protects her, or the king is on the edge with the queen a square away) and has no escape square.' },
    center: { title: 'Shrink the box', plan: 'The king is in the middle. Do NOT chase it with checks. Put the queen a knight\'s move away from the king: she cuts off a whole side of the board and he cannot touch her. Then shrink the box one step at a time.' },
    'edge-far': { title: 'Bring your king', plan: 'The king is on the edge, but your king is far away, and the queen alone cannot mate. Keep the queen a knight\'s move away to hold the box, and walk your king toward his. Checks right now only waste time.' },
    'edge-close': { title: 'Close in, mind stalemate', plan: 'Your king is near. Keep the king boxed, and look for the queen move that leaves him exactly one square, then mate. Before every move ask: does he still have a legal move? If he has none and you are not giving check, it is stalemate (a draw).' },
  },
  kr: {
    'mate-in-one': { title: 'Mate is available', plan: 'Look for the rook check on the edge row that the king cannot step away from, with your king standing in front of his (the opposition).' },
    center: { title: 'Build the fence', plan: 'Use the rook as a fence: put it on a row or file next to the king, far enough that he cannot attack it. He can only stay on his side. Then slide the fence one step at a time to shrink his side.' },
    'edge-far': { title: 'Bring your king', plan: 'The king is on the edge. The rook holds the fence, so walk your king toward his. You need your king facing his (the opposition) before the rook check can mate.' },
    'edge-close': { title: 'Opposition, then check', plan: 'Your king stands two squares in front of his, facing. Now the rook gives check along the edge row. If he steps away from your king, repeat the fence. Do not let the rook be taken.' },
  },
  rr: {
    'mate-in-one': { title: 'Mate is available', plan: 'One rook checks along the last row while the other already covers the row next to it. The king has nowhere to go.' },
    center: { title: 'Start the ladder', plan: 'Put one rook on a row right next to the king (he cannot cross it), then use the other rook to cut off the next row. They leapfrog each other down the board.' },
    'edge-far': { title: 'Keep climbing', plan: 'Check with one rook, and the king must step to the next row; the other rook then cuts off the row after that. Keep the rooks far from the king so he cannot attack them.' },
    'edge-close': { title: 'Finish the ladder', plan: 'The king is on the last row. Cut off the row next to him with one rook, and check along the last row with the other. That is mate.' },
  },
};

/** Which part of the plan applies to this position. `mateIn` is the engine's mate distance for the side to move, if known. */
export function stageOf(kind: TechniqueKind, fen: string, mateIn: number | null): Stage {
  const { white, black } = kingSquares(fen);
  let id: StageId;
  if (mateIn === 1) id = 'mate-in-one';
  else if (!onEdge(black)) id = 'center';
  else id = dist(white, black) > 3 ? 'edge-far' : 'edge-close';
  return { id, ...PLANS[kind][id] };
}

// ---- the box: how many squares can the enemy king still reach? -------------------------------------------------------------

/** Squares the lone king can still walk to (flood fill over squares White does not cover), including the one he stands on. */
export function boxSquares(fen: string): Square[] {
  const board = parseFen(fen);
  const bk = Object.keys(board).find((s) => board[s].type === 'k' && board[s].color === 'b');
  if (!bk) return [];
  // judge coverage with the black king lifted off the board, so a rook's ray also covers the square behind him
  const without = { ...board };
  delete without[bk];
  const covered = (sq: Square): boolean => attackers(without, sq, 'w').length > 0;
  const seen = new Set<Square>([bk]);
  const queue: Square[] = [bk];
  while (queue.length) {
    const cur = queue.shift() as Square;
    const f = FILES.indexOf(cur[0]);
    const r = +cur[1];
    for (let df = -1; df <= 1; df++) {
      for (let dr = -1; dr <= 1; dr++) {
        if (!df && !dr) continue;
        const nf = f + df;
        const nr = r + dr;
        if (nf < 0 || nf > 7 || nr < 1 || nr > 8) continue;
        const next = FILES[nf] + nr;
        // never "reach" a square by taking the king
        if (seen.has(next) || covered(next) || (board[next] && board[next].type === 'k')) continue;
        seen.add(next);
        queue.push(next);
      }
    }
  }
  return [...seen];
}

/** Can the black king take one of White's pieces right now? (Only pieces nothing protects can be taken.) */
export function hangingToKing(fen: string): Square | null {
  const board = parseFen(fen);
  const bk = Object.keys(board).find((s) => board[s].type === 'k' && board[s].color === 'b');
  if (!bk) return null;
  const without = { ...board };
  delete without[bk];
  for (const target of attacksFrom(board, bk)) {
    if (board[target] && board[target].color === 'w' && board[target].type !== 'k' && attackers(without, target, 'w').length === 0) return target;
  }
  return null;
}

export type Verdict = 'mate' | 'tighten' | 'progress' | 'hold' | 'loosen' | 'lost-win' | 'stalemate';

export interface Grade {
  verdict: Verdict;
  text: string;
  boxBefore: number;
  boxAfter: number;
}

/**
 * Grade a student move by what it did to the box. Rules decide mate, stalemate and hung pieces; the box decides the rest.
 * `fenBefore` has White to move, `fenAfter` has Black to move.
 */
export function gradeMove(fenBefore: string, fenAfter: string): Grade {
  const before = boxSquares(fenBefore).length;
  const c = new Chess(fenAfter);
  const after = boxSquares(fenAfter).length;
  if (c.isCheckmate()) return { verdict: 'mate', text: 'Checkmate!', boxBefore: before, boxAfter: after };
  if (c.isStalemate()) {
    return {
      verdict: 'stalemate',
      text: 'Stalemate: Black has no legal move but is not in check, so it is a draw. Undo, and leave the king a square to move to (or give check).',
      boxBefore: before,
      boxAfter: after,
    };
  }
  const hung = hangingToKing(fenAfter);
  if (hung) {
    return { verdict: 'lost-win', text: `Careful: the king can simply take your piece on ${hung}, because nothing protects it. Undo, and keep it a knight's move away or next to your king.`, boxBefore: before, boxAfter: after };
  }
  const kBefore = kingSquares(fenBefore);
  const kAfter = kingSquares(fenAfter);
  const closer = dist(kAfter.white, kAfter.black) < dist(kBefore.white, kBefore.black);
  if (after < before) return { verdict: 'tighten', text: `Good plan: the box shrank from ${before} squares to ${after}.`, boxBefore: before, boxAfter: after };
  if (after === before && closer) return { verdict: 'progress', text: 'Good: your king steps closer while the box stays the same. You need it near for the final check.', boxBefore: before, boxAfter: after };
  if (after === before) return { verdict: 'hold', text: 'Safe, but the box did not get smaller. Is there a move that takes away more squares, or brings your king closer?', boxBefore: before, boxAfter: after };
  return { verdict: 'loosen', text: `That gave the king room: the box grew from ${before} squares to ${after}. Checks that do not shrink the box just push him around. Try a quiet move.`, boxBefore: before, boxAfter: after };
}

export const colorOf = (fen: string): Color => (fen.split(' ')[1] === 'b' ? 'b' : 'w');
export type { Uci };
