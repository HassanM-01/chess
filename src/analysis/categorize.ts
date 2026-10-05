// Mistake classifier, ported from prototype `categorize()` (spec 6.2).
// Priority order: missed_mate, allowed_mate, hung/ignored, fork, missed_free, other.
import { Chess, uciMove } from '@/chess/compat';
import { moveInfo, sanOf } from '@/chess/helpers';
import { VAL, attackers, forkTargets, hangingInfo, parseFen, pieceName } from '@/chess/tactics';
import type { Color, PieceType, Square, Uci } from '@/chess/types';
import type { PosEval } from '@/engine/types';
import type { MistakeCategory } from './types';

export type EvalLite = Pick<PosEval, 'cpWhite' | 'mateWhite' | 'best'>;

export interface Categorized {
  cat: MistakeCategory;
  sq?: Square;
  piece?: PieceType | null;
  text: string;
}

export function categorize(f0: string, f1: string, uci: Uci, e0: EvalLite, e1: EvalLite, me: Color): Categorized | null {
  const b0 = parseFen(f0);
  const b1 = parseFen(f1);
  const mv = moveInfo(f0, uci);
  if (!mv) return null;
  const san = mv.san;
  const bestSan = sanOf(f0, e0.best);
  const replySan = sanOf(f1, e1.best);
  const mateMine = (e: EvalLite): boolean => e.mateWhite != null && (me === 'w' ? e.mateWhite > 0 : e.mateWhite < 0);
  const mateTheirs = (e: EvalLite): boolean => e.mateWhite != null && !mateMine(e);

  if (mateMine(e0) && !mateMine(e1)) {
    const n = Math.abs(e0.mateWhite as number);
    return {
      cat: 'missed_mate',
      text:
        n === 1
          ? `${bestSan} was checkmate in one! Always look at every check you can give.`
          : `You had a forced checkmate in ${n}, starting with ${bestSan}.`,
    };
  }
  if (mateTheirs(e1) && !mateTheirs(e0) && Math.abs(e1.mateWhite as number) <= 4) {
    return {
      cat: 'allowed_mate',
      text:
        Math.abs(e1.mateWhite as number) === 1
          ? `After ${san}, they have checkmate with ${replySan}.`
          : `After ${san}, they can force checkmate, starting with ${replySan}.`,
    };
  }

  const rep = e1.best ? moveInfo(f1, e1.best) : null;
  if (rep && rep.captured && VAL[rep.captured] >= 3) {
    const sq = rep.to;
    const name = pieceName(rep.captured);
    // Even trades are not hung pieces.
    const isTrade = !!mv.captured && rep.to === mv.to && VAL[mv.captured] >= VAL[rep.captured];
    const evenSwap = attackers(b1, sq, me).length > 0 && VAL[rep.piece] >= VAL[rep.captured];
    if (!isTrade && !evenSwap) {
      if (mv.to === sq) {
        const hi = hangingInfo(b1, sq);
        return {
          cat: 'hung',
          sq,
          piece: rep.captured,
          text:
            `You moved your ${name} to ${sq}, where they can take it with ${replySan}.` +
            (hi && hi.reason === 'undefended' ? ' Nothing defends it there.' : hi && hi.reason === 'cheaper' ? ' A cheaper piece attacks it there.' : ''),
        };
      }
      const was = b0[sq] && b0[sq].color === me ? hangingInfo(b0, sq) : null;
      if (was) {
        return {
          cat: 'ignored',
          sq,
          piece: rep.captured,
          text: `Your ${name} on ${sq} was already under attack, and ${san} didn't save it. They can take it with ${replySan}.`,
        };
      }
      return {
        cat: 'hung',
        sq,
        piece: rep.captured,
        text: `After ${san}, your ${name} on ${sq} loses its protection. They can take it with ${replySan}.`,
      };
    }
  }

  if (rep && e1.best) {
    const c2 = new Chess(f1);
    uciMove(c2, e1.best);
    const b2 = parseFen(c2.fen());
    const ft = forkTargets(b2, rep.to).filter((t) => b2[t].color === me);
    if (ft.length >= 2) {
      const names = ft.slice(0, 2).map((t) => (b2[t].type === 'k' ? 'king' : `${pieceName(b2[t].type)} on ${t}`));
      const firstNonKing = ft.find((t) => b2[t].type !== 'k');
      return {
        cat: 'fork',
        piece: firstNonKing ? b2[firstNonKing].type : null,
        text: `After ${san}, they have ${replySan}, which attacks your ${names[0]} and your ${names[1]} at the same time.`,
      };
    }
  }

  const bm = e0.best ? moveInfo(f0, e0.best) : null;
  if (bm && bm.captured && VAL[bm.captured] >= 3 && !(mv.to === bm.to && mv.captured)) {
    const hi = hangingInfo(b0, bm.to);
    if (hi) {
      return {
        cat: 'missed_free',
        sq: bm.to,
        text: `Their ${pieceName(bm.captured)} on ${bm.to} was ${hi.reason === 'undefended' ? 'undefended' : 'attacked by your cheaper piece'}. ${bestSan} would have won it.`,
      };
    }
  }
  if (rep && rep.captured) return { cat: 'other', text: `${san} let them win a pawn with ${replySan}. ${bestSan ? bestSan + ' was better.' : ''}` };
  return { cat: 'other', text: `${san} handed them the advantage. ${bestSan ? bestSan + ' was a stronger choice.' : ''}` };
}
