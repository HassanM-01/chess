// Puzzle mining (ported from the prototype's gen.js): beginner-strength self-play, keep positions where the engine finds
// exactly one clearly-best idea that matches a theme the user needs. Every kept puzzle was checked twice by the engine
// (a normal search, then a deeper one that must agree), so the solution is verified, never guessed.
import { pvSan } from '@/chess/helpers';
import { Chess, uciMove } from '@/chess/compat';
import { VAL, attackers, forkTargets, hangingPieces, NAME, parseFen } from '@/chess/tactics';
import { colorName, type Uci } from '@/chess/types';
import type { EngineLine } from '@/engine/types';
import type { ThemeKey } from '@/db/types';

export interface MinedPuzzle {
  theme: ThemeKey;
  fen: string;
  moves: Uci[];
  alts: Uci[];
  explain: string;
  lastMove: Uci | null;
  rating: number;
}

/** A line scored from the point of view of the side to move. */
export interface MoverLine {
  score: number;
  mate: number | null;
  pv: Uci[];
}

export function moverLine(l: EngineLine, turn: 'w' | 'b'): MoverLine {
  const sign = turn === 'w' ? 1 : -1;
  const mate = l.mateWhite == null ? null : sign * l.mateWhite;
  const score = mate != null ? (mate > 0 ? 100000 - mate : -100000 - mate) : sign * l.cpWhite;
  return { score, mate, pv: l.pv };
}

/** Rough difficulty per theme, used to match the user's per-theme skill rating. */
export const THEME_RATING: Record<ThemeKey, number> = { mate1: 500, free: 550, save: 600, fork: 700, stopmate: 700, winmat: 750, mate2: 800 };

export function classify(fen: string, first: Uci, top: MoverLine, second: MoverLine | undefined, prevScoreForMover: number): Omit<MinedPuzzle, 'fen' | 'lastMove' | 'rating'> | null {
  const ch = new Chess(fen);
  const b0 = parseFen(fen);
  const me = ch.turn();
  const opp = me === 'w' ? 'b' : 'w';
  const mv = uciMove(ch, first);
  if (!mv) return null;
  const b1 = parseFen(ch.fen());

  if (top.mate === 1) {
    const c2 = new Chess(fen);
    const alts = c2
      .moves({ verbose: true })
      .filter((m) => {
        c2.move(m);
        const ok = c2.isCheckmate();
        c2.undo();
        return ok;
      })
      .map((m) => m.from + m.to + (m.promotion ?? ''));
    return { theme: 'mate1', moves: [first], alts, explain: `${mv.san.replace('#', '')} is checkmate. The king is in check and has no safe square to escape to.` };
  }
  if (top.mate === 2) {
    if (second && second.mate != null && second.mate > 0 && second.mate <= 2) return null; // the first move must be unique
    if (top.pv.length < 3) return null;
    return { theme: 'mate2', moves: top.pv.slice(0, 3), alts: [], explain: `${mv.san} forces checkmate next move. Whatever they reply, you finish with a mate.` };
  }
  if (top.mate != null) return null;

  const gap = top.score - (second ? second.score : -9999);
  if (gap < 250) return null;
  if (second && second.mate != null && second.mate < 0 && top.score > -200) {
    return { theme: 'stopmate', moves: [first], alts: [], explain: `They were threatening checkmate. ${mv.san} is the only move that stops it. Always ask: what does their last move threaten?` };
  }
  const myHang = hangingPieces(b0, me).filter((h) => VAL[h.piece.type] >= 3);
  if (top.score >= 250 && prevScoreForMover <= 120) {
    if (mv.captured) {
      const recaptured = attackers(b1, mv.to, opp).length > 0;
      if (!recaptured && VAL[mv.captured] >= 3) {
        return { theme: 'free', moves: [first], alts: [], explain: `The ${colorName(opp).toLowerCase()} ${NAME[mv.captured]} on ${mv.to} had no defender. ${mv.san} wins it for free.` };
      }
    }
    const ft = forkTargets(b1, mv.to);
    if (ft.length >= 2) {
      const names = ft.map((t) => `${NAME[b1[t].type]} on ${t}`);
      return { theme: 'fork', moves: [first], alts: [], explain: `${mv.san} attacks two things at once: the ${names[0]} and the ${names[1]}. They can only save one.` };
    }
    if (mv.captured && VAL[mv.captured] > VAL[mv.piece]) {
      return { theme: 'winmat', moves: [first], alts: [], explain: `Your ${NAME[mv.piece]} takes a ${NAME[mv.captured]}, which is worth more. Even if they take back, you come out ahead.` };
    }
    const line = pvSan(fen, top.pv, 4);
    return {
      theme: 'winmat',
      moves: [first],
      alts: [],
      explain: `${mv.san} wins material.${line.length > 2 ? ` The main line runs ${line.join(', ')}.` : ''} Look for moves that attack something your opponent can't defend.`,
    };
  }
  if (top.score > -150 && top.score < 250 && myHang.length) {
    const h = myHang.find((x) => x.square === mv.from);
    const b1Hang = hangingPieces(b1, me).filter((x) => VAL[x.piece.type] >= 3);
    if (h && !b1Hang.length) {
      return { theme: 'save', moves: [first], alts: [], explain: `Your ${NAME[h.piece.type]} on ${h.square} was under attack${h.reason === 'undefended' ? ' with no defender' : ' by a cheaper piece'}. ${mv.san} moves it to safety. Every other move loses material.` };
    }
    if (!b1Hang.length) {
      return { theme: 'save', moves: [first], alts: [], explain: `Your ${NAME[myHang[0].piece.type]} on ${myHang[0].square} was in danger. ${mv.san} solves the problem. Every other move loses material.` };
    }
  }
  return null;
}
