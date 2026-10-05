// Hint text for the training runner (ported from prototype positionHint). Hint 1 is a clue in words about the position.
import { Chess, uciMove } from '@/chess/compat';
import { moveInfo } from '@/chess/helpers';
import { VAL, forkTargets, hangingPieces, parseFen, pieceName } from '@/chess/tactics';
import type { Uci } from '@/chess/types';

export function positionHint(fen: string, u: Uci, theme: string | null): string {
  const b = parseFen(fen);
  const me = fen.split(' ')[1] === 'b' ? 'b' : 'w';
  const opp = me === 'w' ? 'b' : 'w';
  const mv = moveInfo(fen, u);
  if (!mv) return 'Ask: what is attacked, and what is undefended? Then look for the move that makes a threat.';
  const theirLoose = hangingPieces(b, opp).filter((x) => VAL[x.piece.type] >= 3);
  const mineLoose = hangingPieces(b, me).filter((x) => VAL[x.piece.type] >= 3);
  if (theme === 'mate1' || theme === 'mate2') {
    return mv.san.includes('+') || mv.san.includes('#')
      ? 'Look at every check you can give. One of them leaves the king nowhere to go.'
      : "Look for a move that takes away the king's last escape squares.";
  }
  if (theme === 'stopmate') return 'They are threatening checkmate next move. Find the square they want to mate on, and cover it or get your king out.';
  if (mv.captured) {
    const x = theirLoose.find((y) => y.square === mv.to);
    if (x) return `Their ${pieceName(x.piece.type)} on ${x.square} is ${x.reason === 'undefended' ? 'not protected by anything' : 'attackable by one of your cheaper pieces'}.`;
  }
  const own = mineLoose.find((y) => y.square === mv.from);
  if (own) return `Your ${pieceName(own.piece.type)} on ${own.square} is in danger${own.reason === 'undefended' ? ': it is attacked and nothing defends it' : ': a cheaper piece is attacking it'}. Find it a safe square.`;
  if (mineLoose.length) return `Your ${pieceName(mineLoose[0].piece.type)} on ${mineLoose[0].square} is in danger. Save it, or find something even bigger.`;
  if (mv.san.includes('+')) return 'Start by looking at every check you can give.';
  if (mv.captured) return 'Look at every capture you can make. One of them wins material.';
  const c = new Chess(fen);
  uciMove(c, u);
  const ft = forkTargets(parseFen(c.fen()), mv.to);
  if (ft.length >= 2) return 'Look for a move that attacks two of their pieces at the same time.';
  return 'Ask: what is attacked, and what is undefended? Then look for the move that makes a threat.';
}

/** Hint 2: highlights the piece to move. */
export function pieceHint(fen: string, u: Uci): { text: string; from: string } | null {
  const mv = moveInfo(fen, u);
  if (!mv) return null;
  return { text: `Move your ${pieceName(mv.piece)} on ${mv.from} (highlighted in green). Where can it go that hurts them most?`, from: mv.from };
}
