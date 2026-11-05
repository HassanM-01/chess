// Turns one reviewed game into training material. Nothing here runs the engine: it only reads the deep analysis the review
// already saved, so a game that took ten minutes to analyze keeps paying off in every training mode.
//
//   mistake  your own blunders, mistakes and misses ("find the move you missed")
//   punish   the opponent's blunders and mistakes ("they slipped: find the winning reply")
//   mate     forced checkmates in 1, 2 or 3 that appeared in your games
//   tactic   free pieces, forks, winning material, saving a piece, stopping a mate
//   threat   "which of your pieces are in danger?" (or: nothing is)
//   judge    "was this move a blunder or safe?"
import { Chess, uciMove } from '@/chess/compat';
import { gameFens, moveNumberLabel } from '@/chess/helpers';
import { NAME, VAL, attackers, hangingPieces, material, parseFen } from '@/chess/tactics';
import type { Color, Square, Uci } from '@/chess/types';
import { THEME_RATING, classify, moverLine } from '@/puzzles/mine';
import { reviewMoves } from './classify';
import { epFor } from './expected';
import { explainBestMove, explainMove, type ExplainTag, type Explanation } from './explain';
import { puzzlesFromReview, trimLine, type Puzzle } from './puzzles';
import type { MoveReview, PosAnalysis, StoredLine } from './types';

export interface GameForMining {
  id: string;
  startFen: string;
  movesUci: Uci[];
  white: string | null;
  black: string | null;
  userColor: Color | null;
}

export interface MiningResult {
  puzzles: Puzzle[];
  /** how often each kind of error appeared in the user's own weak moves in this game */
  weak: Partial<Record<ExplainTag, number>>;
  /** user moves that were inaccuracies, mistakes, misses or blunders */
  badMoves: number;
}

const other = (c: Color): Color => (c === 'w' ? 'b' : 'w');
const toEngine = (l: StoredLine): { cpWhite: number; mateWhite: number | null; pv: Uci[] } => ({ cpWhite: l.cp, mateWhite: l.mate, pv: l.pv });
const mateFor = (l: StoredLine | undefined, who: Color): number | null => (l && l.mate != null && l.mate !== 0 && l.mate > 0 === (who === 'w') ? Math.abs(l.mate) : null);

const TACTIC_THEME: Record<string, string> = { free: 'hangingPiece', fork: 'fork', winmat: 'winMaterial', save: 'saveYourPiece', stopmate: 'stopTheMate' };
const MATE_RATING = [0, 600, 900, 1200];
/** the theme a mistake of this kind trains, so it can be practised on its own */
const MISTAKE_THEME: Partial<Record<ExplainTag, string>> = {
  'allowed-mate': 'stopTheMate',
  'back-rank': 'stopTheMate',
  'hung-piece': 'saveYourPiece',
  'left-piece-hanging': 'saveYourPiece',
  'ignored-threat': 'saveYourPiece',
  exposed: 'saveYourPiece',
  'allowed-fork': 'avoidTheFork',
  'missed-free-piece': 'hangingPiece',
  'missed-fork': 'fork',
  'missed-win': 'winMaterial',
};

/** Which of the mover's pieces (knight or better) can really be captured for gain by the opponent, with legal moves only. */
export function realThreats(fen: string, mover: Color): { square: Square; by: Square; type: string; reason: 'undefended' | 'cheaper' }[] {
  let board;
  try {
    board = parseFen(fen);
  } catch {
    return [];
  }
  const loose = hangingPieces(board, mover).filter((h) => VAL[h.piece.type] >= 3);
  if (!loose.length) return [];
  // can the opponent actually capture it? flip the turn and ask the rules (pins and checks included)
  const parts = fen.split(' ');
  parts[1] = other(mover);
  parts[3] = '-';
  let c: Chess;
  try {
    c = new Chess(parts.join(' '));
  } catch {
    return [];
  }
  const caps = c.moves({ verbose: true }).filter((m) => m.captured);
  const out: { square: Square; by: Square; type: string; reason: 'undefended' | 'cheaper' }[] = [];
  for (const h of loose) {
    const hit = caps.filter((m) => m.to === h.square).sort((a, z) => VAL[a.piece] - VAL[z.piece])[0];
    if (hit) out.push({ square: h.square, by: hit.from, type: h.piece.type, reason: h.reason });
  }
  return out;
}

/** Nothing of the mover's can be taken, not even a pawn, and the mover is not in check. */
function isCalm(fen: string, mover: Color): boolean {
  try {
    const c = new Chess(fen);
    if (c.inCheck()) return false;
    return hangingPieces(parseFen(fen), mover).length === 0;
  } catch {
    return false;
  }
}

export function mineGame(g: GameForMining, positions: PosAnalysis[]): MiningResult {
  const out: Puzzle[] = [];
  const weak: Partial<Record<ExplainTag, number>> = {};
  if (positions.length < 2) return { puzzles: out, weak, badMoves: 0 };
  const fens = gameFens(g.startFen, g.movesUci);
  const moves = reviewMoves(g.startFen, g.movesUci, positions);
  const nameOf = (c: Color): string => (c === 'w' ? g.white : g.black) ?? (c === 'w' ? 'White' : 'Black');
  const mine = (c: Color): boolean => !g.userColor || c === g.userColor;

  const cache = new Map<number, Explanation | null>();
  const explainAt = (ply: number): Explanation | null => {
    if (cache.has(ply)) return cache.get(ply) ?? null;
    const m: MoveReview | undefined = moves[ply];
    const ex = m ? explainMove({ fenBefore: fens[ply], move: m, before: positions[ply], after: positions[ply + 1], prev: moves[ply - 1], userColor: g.userColor }) : null;
    cache.set(ply, ex);
    return ex;
  };
  const from = (ply: number): { gameId: string; ply: number } => ({ gameId: g.id, ply });
  const lastMoveOf = (i: number): Uci | null => (i > 0 ? g.movesUci[i - 1] : null);

  // ---- what the user keeps getting wrong ------------------------------------------------------------------------
  let badMoves = 0;
  for (const m of moves) {
    if (!['inaccuracy', 'mistake', 'miss', 'blunder'].includes(m.cls) || (g.userColor && m.color !== g.userColor)) continue;
    badMoves++;
    const ex = explainAt(m.ply);
    for (const t of ex?.tags ?? []) weak[t] = (weak[t] ?? 0) + 1;
  }

  // ---- mistake: your own errors ---------------------------------------------------------------------------------
  for (const p of puzzlesFromReview(g.id, nameOf, (ply) => fens[ply], positions, moves, g.userColor)) {
    const ply = p.game!.ply;
    const ex = explainAt(ply);
    p.lastMove = lastMoveOf(ply);
    p.context = `In this game you played ${p.game!.played} here (${moveNumberLabel(g.startFen, ply)}).`;
    p.explain = ex ? [...ex.what, ...(ex.better ? [ex.better] : [])] : [];
    p.lesson = ex?.lesson;
    for (const t of ex?.tags ?? []) {
      const theme = MISTAKE_THEME[t];
      if (theme && !p.themes.includes(theme)) p.themes.unshift(theme);
    }
    out.push(p);
  }

  // ---- punish: the opponent slipped, find the winning reply ------------------------------------------------------
  for (const m of moves) {
    if (m.cls !== 'blunder' && m.cls !== 'mistake') continue;
    if (g.userColor && m.color === g.userColor) continue;
    const pos = positions[m.ply + 1];
    if (!pos?.lines[0] || pos.legal < 2 || pos.terminal) continue;
    const solver = other(m.color);
    const epTop = epFor(pos.lines[0], solver);
    const gap = pos.lines[1] ? epTop - epFor(pos.lines[1], solver) : 1;
    if (epTop < 0.6 || gap < 0.12 || m.loss < 0.15) continue;
    const fen = fens[m.ply + 1];
    const solution = trimLine(fen, pos.lines[0].pv);
    if (!solution.length) continue;
    const ex = explainAt(m.ply);
    const mate = mateFor(pos.lines[0], solver);
    out.push({
      id: `p:${g.id}:${m.ply + 1}`,
      fen,
      solution,
      alts: [],
      rating: 0,
      themes: [mate ? `mateIn${mate}` : 'punish', 'yourOpponentSlipped'],
      source: 'game',
      kind: 'solve',
      group: 'punish',
      lastMove: m.uci,
      from: from(m.ply + 1),
      context: `${nameOf(m.color)} just played ${m.san}, a ${m.cls}. Find the best reply.`,
      explain: [...(ex ? ex.what.slice(0, 2) : []), `The best reply: ${explainBestMove(fen, pos)}`].filter(Boolean),
      lesson: 'When your opponent makes a mistake, stop and look at every capture and check before you move. Punishing a mistake is the fastest way to win.',
    });
  }

  // ---- mate: forced checkmates that appeared in the game -----------------------------------------------------------
  let skipUntil = -1;
  for (let i = 0; i < positions.length - 1; i++) {
    if (i <= skipUntil) continue;
    const pos = positions[i];
    if (!pos?.lines[0] || pos.terminal || pos.legal < 2) continue;
    const mover = fens[i].split(' ')[1] === 'b' ? 'b' : 'w';
    const n = mateFor(pos.lines[0], mover);
    if (!n || n > 3) continue;
    const n2 = mateFor(pos.lines[1], mover);
    if (n >= 2 && n2 != null && n2 <= n) continue; // two different equally fast mates: not a clean puzzle
    const solution = trimLine(fens[i], pos.lines[0].pv, n);
    if (solution.length !== 2 * n - 1) continue;
    try {
      const c = new Chess(fens[i]);
      for (const u of solution) uciMove(c, u);
      if (!c.isCheckmate()) continue;
    } catch {
      continue;
    }
    skipUntil = i + 2 * n - 1; // the same mating attack shows up again, one move shorter, in the next positions
    const wasPlayed = g.movesUci[i] === solution[0];
    out.push({
      id: `m:${g.id}:${i}`,
      fen: fens[i],
      solution,
      alts: [],
      rating: MATE_RATING[n],
      themes: [`mateIn${n}`, 'mate'],
      source: 'game',
      kind: 'solve',
      group: 'mate',
      lastMove: lastMoveOf(i),
      from: from(i),
      context: `Checkmate in ${n}. ${wasPlayed && mine(mover) ? 'You found it in the game.' : mine(mover) ? 'In the game you missed it.' : "This was your opponent's chance."}`,
      explain: [explainBestMove(fens[i], pos)].filter(Boolean),
      lesson: 'Before any other move, look at every check you can give. Checks are forcing, so they are easy to calculate.',
    });
  }

  // ---- tactic: free pieces, forks, winning material, saving a piece, stopping a mate ---------------------------------------
  const perTheme: Record<string, number> = {};
  let tactics = 0;
  for (let i = 6; i < positions.length - 1 && tactics < 5; i++) {
    const pos = positions[i];
    const prev = positions[i - 1];
    if (!pos?.lines[0] || !prev?.lines[0] || pos.terminal || pos.legal < 3) continue;
    const turn: Color = fens[i].split(' ')[1] === 'b' ? 'b' : 'w';
    const top = moverLine(toEngine(pos.lines[0]), turn);
    const second = pos.lines[1] ? moverLine(toEngine(pos.lines[1]), turn) : undefined;
    if (top.mate != null || !top.pv.length) continue; // mates are their own mode
    if (top.score - (second ? second.score : -9999) < 250) continue; // there must be exactly one good idea
    const prevScore = moverLine(toEngine(prev.lines[0]), turn).score;
    const c = classify(fens[i], top.pv[0], top, second, prevScore);
    if (!c || c.theme === 'mate1' || c.theme === 'mate2') continue;
    if ((perTheme[c.theme] ?? 0) >= 2) continue;
    const mm = material(parseFen(fens[i]));
    if (Math.abs(mm.w - mm.b) > 6) continue;
    perTheme[c.theme] = (perTheme[c.theme] ?? 0) + 1;
    tactics++;
    const exp = explainBestMove(fens[i], pos);
    out.push({
      id: `t:${g.id}:${i}`,
      fen: fens[i],
      solution: c.moves,
      alts: c.alts,
      rating: THEME_RATING[c.theme],
      themes: [TACTIC_THEME[c.theme] ?? c.theme],
      source: 'game',
      kind: 'solve',
      group: 'tactic',
      lastMove: lastMoveOf(i),
      from: from(i),
      explain: [c.explain, exp && !exp.startsWith(c.explain.slice(0, 12)) ? exp : ''].filter(Boolean),
      lesson: 'Each turn, ask: what is attacked, and what is undefended? Then look for the move that attacks something they cannot defend.',
    });
  }

  // ---- threat: which of your pieces are in danger? ---------------------------------------------------------------------
  let threats = 0;
  let calms = 0;
  let lastTaken = -10;
  for (let i = 7; i < positions.length - 1 && (threats < 3 || calms < 2); i++) {
    if (i - lastTaken < 5) continue;
    const pos = positions[i];
    if (!pos?.lines[0] || pos.terminal) continue;
    const fen = fens[i];
    const mover: Color = fen.split(' ')[1] === 'b' ? 'b' : 'w';
    const found = realThreats(fen, mover);
    const lastSan = i > 0 ? moves[i - 1]?.san ?? null : null;
    if (found.length && threats < 3) {
      threats++;
      lastTaken = i;
      const b = parseFen(fen);
      const lines = found.map((t) => `Your ${NAME[t.type as keyof typeof NAME]} on ${t.square} is attacked by the ${NAME[b[t.by].type]} on ${t.by}${t.reason === 'undefended' ? ' and nothing protects it' : ', which is worth less, so taking it wins material'}.`);
      out.push({
        id: `th:${g.id}:${i}`,
        fen,
        solution: [],
        alts: [],
        rating: 0,
        themes: ['threat'],
        source: 'game',
        kind: 'threat',
        group: 'threat',
        lastMove: lastMoveOf(i),
        from: from(i),
        threat: { danger: found.map((t) => t.square), arrows: found.map((t) => ({ from: t.by, to: t.square })), lastSan },
        context: lastSan ? `${nameOf(other(mover))} just played ${lastSan}.` : undefined,
        explain: [...lines, `The engine's answer here: ${explainBestMove(fen, pos)}`].filter(Boolean),
        lesson: 'Start every turn by asking what their last move attacks. Check every piece of yours: is it protected?',
      });
    } else if (!found.length && calms < 2 && isCalm(fen, mover) && i % 2 === 0) {
      calms++;
      lastTaken = i;
      out.push({
        id: `th:${g.id}:${i}`,
        fen,
        solution: [],
        alts: [],
        rating: 0,
        themes: ['calm'],
        source: 'game',
        kind: 'threat',
        group: 'threat',
        lastMove: lastMoveOf(i),
        from: from(i),
        threat: { danger: [], arrows: [], lastSan },
        context: lastSan ? `${nameOf(other(mover))} just played ${lastSan}.` : undefined,
        explain: ['Nothing of yours is attacked and unprotected. You are free to follow your own plan.', `A good move here: ${explainBestMove(fen, pos)}`].filter(Boolean),
        lesson: 'Do not panic when nothing is in danger. Use the free move to improve your position.',
      });
    }
  }

  // ---- judge: blunder or safe? -------------------------------------------------------------------------------------------
  let blunders = 0;
  let safes = 0;
  for (const m of moves) {
    const isBlunder = m.cls === 'blunder';
    const isGood = m.ply >= 6 && (m.cls === 'best' || m.cls === 'excellent' || m.cls === 'great' || m.cls === 'brilliant');
    if (!(isBlunder && blunders < 2) && !(isGood && safes < 2)) continue;
    const fen = fens[m.ply];
    const mv = new Chess(fen);
    const info = uciMove(mv, m.uci);
    if (!info) continue;
    // "safe" examples should look worth a second thought: a capture, a check, or a piece stepping onto an attacked square
    const after = parseFen(mv.fen());
    const tempting = !!info.captured || info.san.includes('+') || (info.piece !== 'p' && attackers(after, info.to, other(m.color)).length > 0);
    if (isGood && !tempting) continue;
    if (isBlunder && !positions[m.ply + 1]?.lines[0]) continue;
    const ex = explainAt(m.ply);
    const byUser = !!g.userColor && m.color === g.userColor;
    if (isBlunder) blunders++;
    else safes++;
    out.push({
      id: `j:${g.id}:${m.ply}`,
      fen,
      solution: [],
      alts: [],
      rating: 0,
      themes: ['judge'],
      source: 'game',
      kind: 'judge',
      group: 'judge',
      lastMove: lastMoveOf(m.ply),
      from: from(m.ply),
      judge: { move: m.uci, san: m.san, verdict: isBlunder ? 'blunder' : 'safe', reply: isBlunder ? positions[m.ply + 1].lines[0].pv[0] ?? null : null, cls: m.cls, byUser },
      explain: ex ? [...(isBlunder ? [ex.headline + '.'] : []), ...ex.what, ...(ex.better ? [ex.better] : [])] : [],
      lesson: ex?.lesson ?? 'Before you move, check what the move leaves undefended and what it allows.',
    });
  }

  return { puzzles: out, weak, badMoves };
}
