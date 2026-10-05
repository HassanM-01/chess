// Turns each of the user's real mistakes into three more practice positions ("same pattern, new look").
// No engine is needed: the stored evals are carried across the symmetry, and the explanation is re-derived by the same
// classifier that wrote the original, so squares and piece names in the text match the new board.
import { categorize } from '@/analysis/categorize';
import type { AnalyzableGame, MistakeDraft } from '@/analysis/types';
import { Chess, uciMove } from '@/chess/compat';
import { gameFens, sanOf } from '@/chess/helpers';
import { otherColor, type Color } from '@/chess/types';
import type { OwnMistakePayload, TrainingItemDraft } from '@/db/types';
import type { StoredEval } from '@/engine/types';
import { fromStored } from '@/engine/types';
import { involvesCastling, legalIn, transformEval, transformFen, transformUci, VARIANT_KINDS, type VariantKind } from './transform';

/** variants of mistake at ply p use ply = p + OFFSET * (index + 1), keeping (user, kind, game, ply) unique */
export const VARIANT_PLY_OFFSET = 1000;

export function generateVariantItems(
  game: AnalyzableGame,
  evals: StoredEval[],
  mistakes: Pick<MistakeDraft, 'ply' | 'playedUci' | 'playedSan' | 'bestUci' | 'bestSan' | 'replySan' | 'category'>[],
  o: { gameId: string; opponent: string },
): TrainingItemDraft[] {
  const me = game.userColor;
  if (!me) return [];
  const fens = gameFens(game.startFen, game.movesUci);
  const out: TrainingItemDraft[] = [];

  for (const m of mistakes) {
    if (!m.bestUci || involvesCastling(m.playedSan, m.bestSan, m.replySan)) continue;
    VARIANT_KINDS.forEach((kind: VariantKind, idx) => {
      const fen0 = transformFen(fens[m.ply], kind);
      const played = transformUci(m.playedUci, kind) as string;
      const best = transformUci(m.bestUci, kind) as string;
      if (!legalIn(fen0, played) || !legalIn(fen0, best)) return;
      const c = new Chess(fen0);
      uciMove(c, played);
      const fen1 = c.fen();
      const e0 = fromStored(transformEval(evals[m.ply], kind));
      const e1 = fromStored(transformEval(evals[m.ply + 1], kind));
      const vMe: Color = kind === 'mirror' ? me : otherColor(me);
      const cat = categorize(fen0, fen1, played, e0, e1, vMe);
      if (!cat || cat.cat !== m.category) return; // the symmetry should preserve it; if not, don't risk a wrong lesson
      const prev = m.ply > 0 ? transformUci(game.movesUci[m.ply - 1], kind) : null;
      const payload: OwnMistakePayload = {
        pool: 'own',
        variant: kind,
        srcPly: m.ply,
        fen: fen0,
        me: vMe,
        lastMove: prev,
        opponent: o.opponent,
        best,
        bestSan: sanOf(fen0, best),
        san: sanOf(fen0, played),
        uci: played,
        text: cat.text,
        cat: cat.cat,
        evBest: transformEval(evals[m.ply], kind),
      };
      out.push({ kind: 'variant', gameId: o.gameId, ply: m.ply + VARIANT_PLY_OFFSET * (idx + 1), srcPly: m.ply, payload });
    });
  }
  return out;
}
