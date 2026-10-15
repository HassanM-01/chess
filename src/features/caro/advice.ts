// The Caro-Kann coach: same priorities as the London coach, played from Black's side.
// Priority: 1 mate, 2 own piece hanging, 2.5 recapture first, 3 free capture, 4 standard answers (bishop attacked, b7 hit,
// d5 under pressure, the ...c5 break against the Advance), 5 next safe setup move, 6 middlegame plans.
import { categorize } from '@/analysis/categorize';
import { whyBest } from '@/analysis/walk';
import { Chess, type Move } from '@/chess/compat';
import { moveInfo, moveToUci, sanOf } from '@/chess/helpers';
import { VAL, attackers, hangingInfo, hangingPieces, parseFen, pieceName } from '@/chess/tactics';
import type { Evaluator } from '@/engine/evalPos';
import { wpFor } from '@/engine/winprob';
import type { Advice, AdviceContext } from '@/features/london/advice';
import { CARO_STEPS, panovShape } from './steps';

const RETREATS = ['g6', 'h7', 'd7', 'e6', 'g4', 'e4', 'c8'];

export async function caroAdvice(fen: string, evalPos: Evaluator, ctx: AdviceContext = {}): Promise<Advice> {
  const c = new Chess(fen);
  const b = parseFen(fen);
  const best = await evalPos(fen, 11);
  const legal = c.moves({ verbose: true });
  const byUci = (u: string): Move | undefined => legal.find((m) => m.from + m.to === u.slice(0, 4));
  const bySan = (s: string): Move | undefined => legal.find((m) => m.san.replace(/[+#]/g, '') === s);
  const bestWp = wpFor(best, 'b');
  const safe = async (m: Move): Promise<boolean> => {
    const c2 = new Chess(fen);
    c2.move(m.san);
    const e = await evalPos(c2.fen(), 10);
    return bestWp - wpFor(e, 'b') < 12;
  };
  const bestSanTxt = best.best ? sanOf(fen, best.best) : '';

  // 1. Mate available (a negative mate distance is mate for Black)
  if (best.mateWhite != null && best.mateWhite < 0) {
    return {
      uci: best.best,
      kind: 'tactic',
      title: 'You have a checkmate!',
      text: best.mateWhite === -1 ? `${bestSanTxt} is checkmate.` : `There's a forced checkmate starting with ${bestSanTxt}. Look at your checks.`,
    };
  }

  // 2. Own piece hanging. (A pawn or knight attacking your bishop is handled by the dedicated rule in item 4.)
  const minorHitsBishop = (x: { piece: { type: string }; by: string[] }): boolean => x.piece.type === 'b' && x.by.some((a) => b[a]?.type === 'p' || b[a]?.type === 'n');
  const hang = hangingPieces(b, 'b').filter((x) => VAL[x.piece.type] >= 3 && !minorHitsBishop(x));
  if (hang.length) {
    const x = hang[0];
    return {
      uci: best.best,
      kind: 'danger',
      title: `Your ${pieceName(x.piece.type)} on ${x.square} is in danger`,
      text: `It's ${x.reason === 'undefended' ? 'attacked and nothing defends it' : 'attacked by a cheaper piece'}. ${whyBest(fen, best.best) || bestSanTxt + ' handles it.'} The setup can wait. Saving material comes first.`,
    };
  }

  // 2.5 White just captured something of yours: take it back before following the checklist.
  const last = ctx.lastMove;
  if (last && last.color === 'w' && last.captured) {
    const recaptures = legal.filter((m) => m.to === last.to && m.captured);
    if (recaptures.length) {
      let choice: Move | undefined = best.best ? recaptures.find((m) => m.from + m.to === (best.best as string).slice(0, 4)) : undefined;
      if (!choice) {
        let bestScore = -Infinity;
        for (const m of recaptures) {
          const c2 = new Chess(fen);
          c2.move(m.san);
          const e = await evalPos(c2.fen(), 10);
          const wp = wpFor(e, 'b');
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

  // 4. Standard answers to White's tries against the Caro-Kann
  // 4a. A white pawn or knight attacks your outside bishop (...Bf5 / ...Bg4 / ...Bg6).
  for (const sq of Object.keys(b).filter((s) => b[s].type === 'b' && b[s].color === 'b')) {
    const att = attackers(b, sq, 'w');
    const pawnSq = att.find((a) => b[a].type === 'p');
    const knightHits = att.some((a) => b[a].type === 'n');
    if (!pawnSq && !knightHits) continue;
    const takes = pawnSq ? legal.filter((m) => m.to === pawnSq && m.captured).sort((x, y) => (x.piece === 'b' ? -1 : 0) - (y.piece === 'b' ? -1 : 0)) : [];
    const retreats = legal
      .filter((m) => m.from === sq && !m.captured && m.piece === 'b')
      .sort((x, y) => (RETREATS.indexOf(x.to) < 0 ? 99 : RETREATS.indexOf(x.to)) - (RETREATS.indexOf(y.to) < 0 ? 99 : RETREATS.indexOf(y.to)));
    for (const m of [...takes, ...retreats]) {
      if (await safe(m)) {
        return pawnSq
          ? {
              uci: moveToUci(m),
              kind: 'answer',
              title: 'A pawn is attacking your bishop',
              text: `A pawn is attacking your bishop. Move it or take the pawn first. ${
                m.captured ? `${m.san} wins the pawn and solves the problem.` : `${m.san} keeps your best bishop safe and on its good diagonal.`
              } Don't carry on with the setup (like ...e6) while your bishop is under attack.`,
            }
          : {
              uci: moveToUci(m),
              kind: 'answer',
              title: 'The knight is hunting your bishop',
              text: `White's knight wants to chase your bishop. ${m.san} keeps it. Your bishop is the piece the Caro-Kann is built around, so don't give it away for free.`,
            };
      }
    }
    if (best.best) {
      return {
        uci: best.best,
        kind: 'answer',
        title: pawnSq ? 'A pawn is attacking your bishop' : 'The knight is hunting your bishop',
        text: pawnSq ? `A pawn is attacking your bishop. Move it or take the pawn first. ${bestSanTxt} is the best way to deal with it.` : `White's knight is attacking your bishop. ${bestSanTxt} is the best way to deal with it.`,
      };
    }
  }

  // 4b. The queen goes after b7 (Qb3 is the classic try, in the Exchange and the Advance).
  const wq = Object.keys(b).find((s) => b[s].type === 'q' && b[s].color === 'w');
  if (wq && b.b7 && b.b7.type === 'p' && b.b7.color === 'b' && attackers(b, 'b7', 'b').length === 0 && attackers(b, 'b7', 'w').some((a) => b[a].type === 'q')) {
    const advance = !!b.e5 && b.e5.type === 'p' && b.e5.color === 'w';
    for (const s of advance ? ['Qb6', 'Qc7', 'Qd7', 'b6'] : ['Qd7', 'Qb6', 'Qc7', 'b6']) {
      const m = bySan(s);
      if (m && (await safe(m))) {
        return {
          uci: moveToUci(m),
          kind: 'answer',
          title: 'White is going after your b7 pawn',
          text: `The queen on ${wq} attacks b7, a classic against the Caro-Kann. ${
            s === 'Qd7' ? 'Qd7 defends b7 and d5 in one move, and keeps your pieces connected.' : s === 'Qb6' ? 'Qb6 defends b7 and offers a queen trade, which is fine for you: the Caro-Kann endgames are very solid.' : s === 'b6' ? 'b6 solves it with a pawn, though it loosens the long diagonal.' : s + ' defends b7 and keeps the queen active.'
          }`,
        };
      }
    }
  }

  // 4c. Your d5 pawn is attacked more times than it is defended (the Panov, the Exchange).
  if (b.d5 && b.d5.type === 'p' && b.d5.color === 'b' && attackers(b, 'd5', 'w').length > attackers(b, 'd5', 'b').length) {
    for (const s of ['Nf6', 'e6', 'Nc6', 'Qd7', 'Qb6']) {
      const m = bySan(s);
      if (m && (await safe(m))) {
        const defenders = attackers(b, 'd5', 'b').length;
        return {
          uci: moveToUci(m),
          kind: 'answer',
          title: 'Your d5 pawn needs another defender',
          text: `White is attacking d5 ${attackers(b, 'd5', 'w').length} times and you defend it ${defenders === 0 ? 'zero times' : defenders === 1 ? 'once' : defenders + ' times'}. ${s} adds a defender. Count attackers and defenders before you develop anything else.`,
        };
      }
    }
  }

  // 4d. Against the Advance, the plan is ...c5 as soon as the bishop is out and ...e6 is in.
  if (b.e5 && b.e5.type === 'p' && b.e5.color === 'w' && b.d4 && b.d4.type === 'p' && b.d4.color === 'w' && b.e6 && b.e6.color === 'b' && b.e6.type === 'p' && !b.c5 && !(b.c8 && b.c8.type === 'b')) {
    const m = bySan('c5');
    if (m && (await safe(m))) {
      return {
        uci: moveToUci(m),
        kind: 'plan',
        title: 'Hit the base of the chain: ...c5',
        text: "White's pawns on e5 and d4 are a chain, and the d4 pawn is the base. ...c5 attacks it, which is your main plan against the Advance. Your bishop is already outside, so you can afford it.",
      };
    }
  }

  // 5. Next safe setup move (...e6 never before ...Bf5). If a setup move is unsafe, skip ahead and explain why.
  const order = CARO_STEPS.filter((st) => !st.done(b));
  let blocked: { san: string; why: string } | null = null;
  for (const st of order) {
    if (st.uci === 'e7e6' && b.c8 && b.c8.type === 'b' && !panovShape(b) && byUci('c8f5')) continue; // bishop first
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
        text: pre + st.why + (left > 1 ? ` (${left - 1} setup move${left - 1 === 1 ? '' : 's'} left after this.)` : ' That finishes your Caro-Kann setup!'),
      };
    } else if (!blocked) {
      const c2 = new Chess(fen);
      c2.move(m.san);
      const e1 = await evalPos(c2.fen(), 10);
      const cat = categorize(fen, c2.fen(), moveToUci(m), best, e1, 'b');
      const rep = e1.best ? sanOf(c2.fen(), e1.best) : '';
      blocked = { san: m.san, why: cat && cat.cat !== 'other' ? cat.text.replace(/^After [^,]+, /, 'right now, ') : `right now White would answer with ${rep} and come out better.` };
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
  if (b.d4 && b.d4.type === 'p' && b.d4.color === 'w' && !b.c5) plan.push('challenge the center with ...c5');
  else if (b.d4 && b.d4.type === 'p' && b.d4.color === 'w') plan.push('keep pressure on d4');
  else plan.push('open the center with ...e5 or ...c5 when your pieces are ready');
  plan.push('bring your queen to c7 or b6 and your rooks to the center files');
  return {
    uci: best.best,
    kind: 'plan',
    title: `Setup complete. Best now: ${bestSanTxt}`,
    text: `${whyBest(fen, best.best) || ''} Caro-Kann plans from here: ${plan.join(', ')}. Your structure is solid, so be patient and check what White's last move threatens before every move.`,
  };
}
