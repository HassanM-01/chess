// Training items built from the user's own games (spec 6.5). Ported from prototype trainerPools()/allDrillItems().
import { categorize } from '@/analysis/categorize';
import type { AnalyzableGame, MistakeDraft } from '@/analysis/types';
import { Chess } from '@/chess/compat';
import { gameFens, moveInfo, sanOf } from '@/chess/helpers';
import { VAL, hangingInfo, hangingPieces, parseFen, pieceName } from '@/chess/tactics';
import type { Color } from '@/chess/types';
import type { StoredEval } from '@/engine/types';
import { fromStored, toStored } from '@/engine/types';
import { wpFor } from '@/engine/winprob';
import { generateVariantItems } from '@/puzzles/variants';
import type { JudgePayload, OwnMistakePayload, PunishPayload, ThreatPayload, TrainingItemDraft } from '@/db/types';

/** pick `n` items spread evenly across the list (deterministic) */
function spread<T>(items: T[], n: number): T[] {
  if (items.length <= n) return items;
  const out: T[] = [];
  for (let i = 0; i < n; i++) out.push(items[Math.floor(((i + 0.5) * items.length) / n)]);
  return out;
}

export interface GenerateOptions {
  gameId: string;
  opponent: string;
}

export function generateTrainingItems(
  game: AnalyzableGame,
  evals: StoredEval[],
  mistakes: MistakeDraft[],
  o: GenerateOptions,
): TrainingItemDraft[] {
  const me = game.userColor;
  if (!me) return [];
  const ev = evals.map(fromStored);
  const fens = gameFens(game.startFen, game.movesUci);
  const { gameId, opponent } = o;

  const threats: TrainingItemDraft[] = [];
  const calms: TrainingItemDraft[] = [];
  const blunders: TrainingItemDraft[] = [];
  const safes: TrainingItemDraft[] = [];
  const punishes: TrainingItemDraft[] = [];

  for (let i = 1; i < game.movesUci.length; i++) {
    if (fens[i].split(' ')[1] !== me) continue;
    const c0 = new Chess(fens[i]);
    if (c0.inCheck()) continue;
    const b = parseFen(fens[i]);
    const base = { fen: fens[i], me: me as Color, lastMove: game.movesUci[i - 1], opponent };
    const lastSan = game.movesSan[i - 1];

    // Spot the threat
    const hang = hangingPieces(b, me).filter((x) => VAL[x.piece.type] >= 3);
    if (hang.length) {
      const h0 = hang[0];
      const desc = hang
        .map(
          (x) =>
            `your ${pieceName(x.piece.type)} on ${x.square} (${x.reason === 'undefended' ? 'attacked and not defended' : 'attacked by a cheaper ' + pieceName(b[x.by[0]].type)})`,
        )
        .join(', and ');
      const payload: ThreatPayload = {
        ...base,
        pool: 'threat',
        lastSan,
        answer: hang.map((x) => x.square),
        attackers: hang.flatMap((x) => x.by.slice(0, 1).map((a) => a + x.square)),
        explain: `In danger: ${desc}. ` + (game.movesUci[i].slice(0, 2) === h0.square ? `In the game you moved it (${game.movesSan[i]}).` : `In the game you played ${game.movesSan[i]}.`),
      };
      threats.push({ kind: 'threat', gameId, ply: i, payload });
    } else if (i < 40) {
      const payload: ThreatPayload = {
        ...base,
        pool: 'calm',
        lastSan,
        answer: [],
        attackers: [],
        explain: 'Nothing of yours could be taken for free here, so you were free to make your own plan.',
      };
      calms.push({ kind: 'threat', gameId, ply: i, payload });
    }

    // Safe or blunder?
    const w0 = wpFor(ev[i], me);
    const drop = w0 - wpFor(ev[i + 1], me);
    const judgeBase = { ...base, move: game.movesUci[i], san: game.movesSan[i], reply: ev[i + 1].best };
    if (drop >= 20 && w0 > 8) {
      const m = mistakes.find((x) => x.ply === i);
      const txt = m ? m.explanation : (categorize(fens[i], fens[i + 1], game.movesUci[i], ev[i], ev[i + 1], me)?.text ?? `${game.movesSan[i]} gives away a lot.`);
      const payload: JudgePayload = {
        ...judgeBase,
        pool: 'blunder',
        verdict: 'blunder',
        explain: `Blunder. ${txt}` + (ev[i].best ? ` Better was ${sanOf(fens[i], ev[i].best)}.` : ''),
      };
      blunders.push({ kind: 'judge', gameId, ply: i, payload });
    } else if (drop <= 3 && w0 > 10 && w0 < 90) {
      const payload: JudgePayload = { ...judgeBase, pool: 'safe', verdict: 'safe', explain: `Safe. ${game.movesSan[i]} doesn't give anything away. Good move.` };
      safes.push({ kind: 'judge', gameId, ply: i, payload });
    }

    // Punish their mistake
    const gain = w0 - wpFor(ev[i - 1], me);
    const bm = ev[i].best ? moveInfo(fens[i], ev[i].best) : null;
    if (gain >= 20 && bm && (bm.captured || ev[i].mateWhite != null) && w0 > 60 && ev[i].best) {
      const found = game.movesUci[i] === ev[i].best;
      const hi = bm.captured ? hangingInfo(b, bm.to) : null;
      const mateForMe = ev[i].mateWhite != null && ev[i].mateWhite !== 0 && (me === 'w') === ((ev[i].mateWhite as number) > 0);
      const why = mateForMe
        ? `${bm.san} leads to checkmate.`
        : `${bm.san} takes their ${pieceName(bm.captured as never)}` +
          (hi ? (hi.reason === 'undefended' ? ', which nothing was defending.' : ' with a cheaper piece.') : ' and wins material.');
      const payload: PunishPayload = {
        ...base,
        pool: 'punish',
        best: ev[i].best as string,
        bestSan: bm.san,
        san: game.movesSan[i],
        uci: game.movesUci[i],
        text: found ? 'You found it in the game.' : `In the game you played ${game.movesSan[i]} instead.`,
        sub: `vs ${opponent}: they just played ${lastSan}, a mistake. Punish it.`,
        doneText: why + (found ? ' You found this in the game too.' : ` In the game you played ${game.movesSan[i]} and let them off the hook.`),
        evBest: toStored(ev[i]),
        lastMove: game.movesUci[i - 1],
      };
      punishes.push({ kind: 'punish', gameId, ply: i, payload });
    }
  }

  // Own mistakes: one per mistake that has a better move.
  const own: TrainingItemDraft[] = [];
  for (const m of mistakes) {
    if (!m.bestUci) continue;
    const payload: OwnMistakePayload = {
      pool: 'own',
      fen: m.fen,
      me: me as Color,
      lastMove: m.ply > 0 ? game.movesUci[m.ply - 1] : null,
      opponent,
      best: m.bestUci,
      bestSan: m.bestSan,
      san: m.playedSan,
      uci: m.playedUci,
      text: m.explanation,
      cat: m.category,
      evBest: evals[m.ply],
    };
    own.push({ kind: 'own_mistake', gameId, ply: m.ply, payload });
  }

  // Extra practice: mirrored / colour-swapped copies of each real mistake (no engine needed).
  const variants = generateVariantItems(game, evals, mistakes, { gameId, opponent });

  // Balance the pools: ~1 calm per 4 threats, safe moves about as many as blunders.
  const calmQuota = Math.max(1, Math.ceil(threats.length / 4));
  const safeQuota = Math.max(2, blunders.length);
  return [...own, ...variants, ...threats, ...spread(calms, calmQuota), ...blunders, ...spread(safes, safeQuota), ...punishes];
}
