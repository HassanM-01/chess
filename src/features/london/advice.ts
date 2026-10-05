// The London coach (ported from prototype londonAdvice, spec section 9).
// Priority: 1 mate, 2 own piece hanging, 2.5 recapture first (NEW), 3 free capture,
// 4 standard answers (incl. NEW: a pawn attacking the f4 bishop), 5 next safe setup move, 6 middlegame plans.
import { categorize } from '@/analysis/categorize';
import { whyBest } from '@/analysis/walk';
import { Chess, type Move } from '@/chess/compat';
import { moveInfo, moveToUci, sanOf } from '@/chess/helpers';
import { VAL, attackers, attacksFrom, hangingInfo, hangingPieces, parseFen, pieceName } from '@/chess/tactics';
import type { Uci } from '@/chess/types';
import type { Evaluator } from '@/engine/evalPos';
import { wpFor } from '@/engine/winprob';
import { LONDON_STEPS } from './steps';

export type AdviceKind = 'tactic' | 'danger' | 'recapture' | 'answer' | 'careful' | 'setup' | 'plan';

export interface Advice {
  uci: Uci | null;
  kind: AdviceKind;
  title: string;
  text: string;
  /** setup step SAN (kind === 'setup') */
  step?: string;
}

export interface AdviceContext {
  /** Black's move that just happened, if any (verbose chess.js move) */
  lastMove?: Pick<Move, 'to' | 'captured' | 'color' | 'san'> | null;
}

export async function londonAdvice(fen: string, evalPos: Evaluator, ctx: AdviceContext = {}): Promise<Advice> {
  const c = new Chess(fen);
  const b = parseFen(fen);
  const best = await evalPos(fen, 11);
  const legal = c.moves({ verbose: true });
  const byUci = (u: string): Move | undefined => legal.find((m) => m.from + m.to === u.slice(0, 4));
  const bySan = (s: string): Move | undefined => legal.find((m) => m.san.replace(/[+#]/g, '') === s);
  const bestWp = wpFor(best, 'w');
  const safe = async (m: Move): Promise<boolean> => {
    const c2 = new Chess(fen);
    c2.move(m.san);
    const e = await evalPos(c2.fen(), 10);
    return bestWp - wpFor(e, 'w') < 12;
  };
  const bestSanTxt = best.best ? sanOf(fen, best.best) : '';

  // 1. Mate available
  if (best.mateWhite != null && best.mateWhite > 0) {
    return {
      uci: best.best,
      kind: 'tactic',
      title: 'You have a checkmate!',
      text: best.mateWhite === 1 ? `${bestSanTxt} is checkmate.` : `There's a forced checkmate starting with ${bestSanTxt}. Look at your checks.`,
    };
  }

  // 2. Own piece hanging. (A pawn attacking the f4 bishop is handled by the dedicated London rule in item 4.)
  const pawnHitsBishop = (x: { square: string; piece: { type: string }; by: string[] }): boolean => x.square === 'f4' && x.piece.type === 'b' && x.by.some((a) => b[a]?.type === 'p');
  const hang = hangingPieces(b, 'w').filter((x) => VAL[x.piece.type] >= 3 && !pawnHitsBishop(x));
  if (hang.length) {
    const x = hang[0];
    return {
      uci: best.best,
      kind: 'danger',
      title: `Your ${pieceName(x.piece.type)} on ${x.square} is in danger`,
      text: `It's ${x.reason === 'undefended' ? 'attacked and nothing defends it' : 'attacked by a cheaper piece'}. ${whyBest(fen, best.best) || bestSanTxt + ' handles it.'} The setup can wait. Saving material comes first.`,
    };
  }

  // 2.5 NEW: Black just captured something of yours: take it back before following the checklist.
  const last = ctx.lastMove;
  if (last && last.color === 'b' && last.captured) {
    const recaptures = legal.filter((m) => m.to === last.to && m.captured);
    if (recaptures.length) {
      let choice: Move | undefined = best.best ? recaptures.find((m) => m.from + m.to === (best.best as string).slice(0, 4)) : undefined;
      if (!choice) {
        let bestScore = -Infinity;
        for (const m of recaptures) {
          const c2 = new Chess(fen);
          c2.move(m.san);
          const e = await evalPos(c2.fen(), 10);
          const wp = wpFor(e, 'w');
          if (wp > bestScore) {
            bestScore = wp;
            choice = m;
          }
        }
      }
      if (choice && (await safe(choice))) {
        return {
          uci: moveToUci(choice),
          kind: 'recapture',
          title: `Recapture first: ${choice.san}`,
          text: `They just took your ${pieceName(last.captured)} on ${last.to}. Take it back with ${choice.san} before you continue the setup. The checklist can wait when material is on the line.`,
        };
      }
    }
  }

  // 3. Free capture
  const bm = best.best ? moveInfo(fen, best.best) : null;
  if (bm && bm.captured && VAL[bm.captured] >= 3 && hangingInfo(b, bm.to)) {
    return { uci: best.best, kind: 'tactic', title: 'Free piece!', text: `${whyBest(fen, best.best)} Always take free material before continuing your setup.` };
  }

  // 4. Standard answers to Black's London tries
  const bq = Object.keys(b).find((s) => b[s].type === 'q' && b[s].color === 'b');
  if (bq === 'b6' && b.b2 && b.b2.type === 'p' && b.b2.color === 'w' && attackers(b, 'b2', 'w').length === 0 && attacksFrom(b, 'b6').includes('b2')) {
    for (const s of ['Qb3', 'Qc1', 'b3', 'Qc2']) {
      const m = bySan(s);
      if (m && (await safe(m))) {
        return {
          uci: moveToUci(m),
          kind: 'answer',
          title: 'Black is going after your b2 pawn',
          text: `This is the most common trick against the London. Your bishop left c1, so nothing protects b2. ${
            s === 'Qb3'
              ? 'Qb3 defends it and offers a queen trade. If Black trades, the game gets simpler, and your a-pawn recaptures toward the center.'
              : s === 'Qc1'
                ? 'Qc1 quietly defends b2.'
                : s + ' takes care of it.'
          }`,
        };
      }
    }
  }
  if (b.f4 && b.f4.type === 'b' && b.f4.color === 'w') {
    const att = attackers(b, 'f4', 'b');
    // NEW: a pawn attacks the f4 bishop (...e5 or ...g5). Real user lost this bishop in three straight games.
    const pawnSq = att.find((a) => b[a].type === 'p');
    if (pawnSq) {
      const takes = legal.filter((m) => m.to === pawnSq && m.captured).sort((x, y) => (x.piece === 'p' ? -1 : 0) - (y.piece === 'p' ? -1 : 0));
      const retreats = ['Bg3', 'Bh2', 'Bg5', 'Be5'].map(bySan).filter((m): m is Move => !!m);
      for (const m of [...takes, ...retreats]) {
        if (await safe(m)) {
          const take = !!m.captured;
          return {
            uci: moveToUci(m),
            kind: 'answer',
            title: 'A pawn is attacking your bishop',
            text: `A pawn is attacking your bishop. Move it or take the pawn first. ${
              take ? `${m.san} wins the pawn and solves the problem.` : `${m.san} keeps your best bishop safe.`
            } Don't carry on with the setup (like Nf3) while your bishop is under attack.`,
          };
        }
      }
      if (best.best) {
        return {
          uci: best.best,
          kind: 'answer',
          title: 'A pawn is attacking your bishop',
          text: `A pawn is attacking your bishop. Move it or take the pawn first. ${bestSanTxt} is the best way to deal with it.`,
        };
      }
    }
    if (att.some((a) => b[a].type === 'n')) {
      for (const s of ['Be5', 'Bg5', 'Bg3']) {
        const m = bySan(s);
        if (m && (await safe(m))) {
          return {
            uci: moveToUci(m),
            kind: 'answer',
            title: 'The knight is hunting your bishop',
            text: `Black's knight wants to trade itself for your f4 bishop, your best piece in the London. ${s} keeps the bishop. This is why h3 is part of the setup: it gives the bishop a home on h2.`,
          };
        }
      }
    }
    if (att.some((a) => b[a].type === 'b')) {
      for (const s of ['Bg3', 'Bxd6']) {
        const m = bySan(s);
        if (m && (await safe(m))) {
          return {
            uci: moveToUci(m),
            kind: 'answer',
            title: 'Black offers to trade bishops',
            text: s === 'Bg3' ? "Bg3 keeps your bishop. It's the strongest piece in your setup, so don't give it away for free." : 'Taking is fine here.',
          };
        }
      }
    }
  }

  // 5. Next safe setup move (e3 never before Bf4). If a setup move is unsafe, skip ahead and explain why.
  const order = LONDON_STEPS.filter((st) => !st.done(b));
  let blocked: { san: string; why: string } | null = null;
  for (const st of order) {
    if (st.uci === 'e2e3' && b.c1 && b.c1.type === 'b' && byUci('c1f4')) continue; // bishop first
    const m = byUci(st.uci);
    if (!m) continue;
    if (await safe(m)) {
      const left = order.length;
      const pre = blocked ? `${blocked.san} has to wait: ${blocked.why} So do this part of the setup first. ` : '';
      return {
        uci: moveToUci(m),
        kind: 'setup',
        step: st.san,
        title: `Setup: ${m.san}`,
        text: pre + st.why + (left > 1 ? ` (${left - 1} setup move${left - 1 === 1 ? '' : 's'} left after this.)` : ' That finishes your London setup!'),
      };
    } else if (!blocked) {
      const c2 = new Chess(fen);
      c2.move(m.san);
      const e1 = await evalPos(c2.fen(), 10);
      const cat = categorize(fen, c2.fen(), moveToUci(m), best, e1, 'w');
      const rep = e1.best ? sanOf(c2.fen(), e1.best) : '';
      blocked = { san: m.san, why: cat && cat.cat !== 'other' ? cat.text.replace(/^After [^,]+, /, 'right now, ') : `right now Black would answer with ${rep} and come out better.` };
    }
  }
  if (blocked) {
    return {
      uci: best.best,
      kind: 'careful',
      title: `Careful: ${blocked.san} doesn't work right now`,
      text: `Normally ${blocked.san} is next, but ${blocked.why} Play ${bestSanTxt} first. ${whyBest(fen, best.best)}`,
    };
  }

  // 6. Middlegame plans
  const plan: string[] = [];
  if (b.f3 && b.f3.type === 'n') plan.push('jump a knight to e5');
  if (b.e3 && b.e3.type === 'p') plan.push('prepare the e4 push');
  plan.push('bring your queen to e2 or f3 and your rooks to the center');
  return {
    uci: best.best,
    kind: 'plan',
    title: `Setup complete. Best now: ${bestSanTxt}`,
    text: `${whyBest(fen, best.best) || ''} London plans from here: ${plan.join(', ')}. Before every move, check what Black's last move threatens.`,
  };
}
