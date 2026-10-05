// The mining loops: they decide where candidate positions come from and keep the books. classify() in mine.ts decides
// what a keeper looks like.
import { Chess, uciMove } from '@/chess/compat';
import { VAL, hangingPieces, material, parseFen } from '@/chess/tactics';
import type { Uci } from '@/chess/types';
import type { Engine } from '@/engine/engine';
import type { ThemeKey } from '@/db/types';
import { THEME_RATING, classify, moverLine, type MinedPuzzle, type MoverLine } from './mine';

export interface MineOptions {
  engine: Pick<Engine, 'run'>;
  /** how many more of each theme are wanted */
  wanted: Partial<Record<ThemeKey, number>>;
  /** positions (fen without move counters) that already exist, so nothing is mined twice */
  seen: Set<string>;
  onFound: (p: MinedPuzzle) => void | Promise<void>;
  onProgress?: (p: { games: number; found: number; remaining: number; source: 'your-games' | 'self-play' }) => void;
  shouldStop?: () => boolean;
  rng?: () => number;
  /** search depth used while scanning positions (default 11) and when double-checking a candidate (default 15) */
  scanDepth?: number;
  verifyDepth?: number;
  /** stop after this many milliseconds (default 3 minutes) */
  maxMs?: number;
  /** safety valve for tests */
  maxGames?: number;
}

export const fenKey = (fen: string): string => fen.split(' ').slice(0, 2).join(' ');

function lcg(seed: number): () => number {
  let s = seed % 2147483647;
  if (s <= 0) s += 2147483646;
  return () => {
    s = (s * 16807) % 2147483647;
    return (s - 1) / 2147483646;
  };
}

const OPENINGS: Uci[][] = [
  [],
  ['e2e4', 'e7e5'],
  ['e2e4', 'e7e5', 'g1f3', 'b8c6'],
  ['e2e4', 'e7e5', 'g1f3', 'b8c6', 'f1c4'],
  ['d2d4', 'd7d5'],
  ['e2e4', 'c7c5'],
  ['e2e4', 'e7e5', 'd1h5'],
  ['e2e4', 'e7e5', 'f1c4', 'g8f6'],
  ['d2d4', 'g8f6'],
  ['e2e4', 'd7d5'],
  ['e2e4', 'e7e6'],
  ['c2c4', 'e7e5'],
  ['g1f3', 'd7d5'],
  ['e2e4', 'e7e5', 'g1f3', 'd7d6'],
  ['e2e4', 'e7e5', 'b1c3'],
  ['d2d4', 'd7d5', 'c1f4'],
  ['d2d4', 'd7d5', 'c1f4', 'e7e5'],
];

type Scan = { top: MoverLine; second?: MoverLine };
type Source = 'your-games' | 'self-play';

/** Shared bookkeeping and the "is this position a keeper?" check used by both sources. */
function makeMiner(o: MineOptions) {
  const scan = o.scanDepth ?? 11;
  const verify = o.verifyDepth ?? 15;
  const deadline = Date.now() + (o.maxMs ?? 180_000);
  const remaining: Partial<Record<ThemeKey, number>> = { ...o.wanted };
  const left = (): number => Object.values(remaining).reduce((a, b) => a + (b ?? 0), 0);
  const state = { found: 0, games: 0 };
  const stop = (): boolean => !!o.shouldStop?.() || Date.now() > deadline || left() <= 0 || (o.maxGames != null && state.games >= o.maxGames);

  const analyse = async (fen: string, depth: number): Promise<Scan | null> => {
    const r = await o.engine.run(fen, { depth, skill: 20, multipv: 2, priority: 'background' });
    const turn = fen.split(' ')[1] === 'b' ? 'b' : 'w';
    if (!r.lines.length) return null;
    return { top: moverLine(r.lines[0], turn), second: r.lines[1] ? moverLine(r.lines[1], turn) : undefined };
  };

  /** Scan one position (unless the caller already has a scan) and keep it if it is a clear, verified puzzle. */
  async function consider(
    fen: string,
    prevForMover: number,
    lastMove: Uci | null,
    perGame: Partial<Record<ThemeKey, boolean>>,
    gameTotal: { n: number },
    source: Source,
    scanned?: Scan,
  ): Promise<Scan | null> {
    const a = scanned ?? (await analyse(fen, scan));
    if (!a || !a.top.pv.length) return a;
    if (o.seen.has(fenKey(fen)) || new Chess(fen).moves().length < 3) return a;
    const c = classify(fen, a.top.pv[0], a.top, a.second, prevForMover);
    if (!c || (remaining[c.theme] ?? 0) <= 0 || perGame[c.theme] || gameTotal.n >= 2) return a;
    const mm = material(parseFen(fen));
    if (Math.abs(mm.w - mm.b) > 6) return a;
    // Double-check with a deeper search: the same move must still win and the theme must not change.
    const v = await analyse(fen, verify);
    const c2 = v && v.top.pv[0] === a.top.pv[0] ? classify(fen, v.top.pv[0], v.top, v.second, prevForMover) : null;
    if (c2 && c2.theme === c.theme) {
      o.seen.add(fenKey(fen));
      remaining[c.theme] = (remaining[c.theme] ?? 0) - 1;
      perGame[c.theme] = true;
      gameTotal.n++;
      state.found++;
      await o.onFound({ ...c2, fen, lastMove, rating: THEME_RATING[c2.theme] });
      o.onProgress?.({ games: state.games, found: state.found, remaining: left(), source });
    }
    return a;
  }
  return { consider, analyse, stop, left, state, scan };
}

/** A game the app already analyzed: its positions and the stored engine evals (one per position). */
export interface AnalyzedGame {
  fens: string[];
  evals: [number, number | null, string | null][];
  moves: Uci[];
}

type StoredLike = [number, number | null, string | null];

/** Cheap pre-filter on stored evals: could this position hold a puzzle? (Avoids engine work on quiet positions.) */
export function isCandidate(fen: string, evalsPrev: StoredLike, evalsHere: StoredLike): { prevForMover: number } | null {
  const turn = fen.split(' ')[1] === 'b' ? 'b' : 'w';
  const here = moverLine({ cpWhite: evalsHere[0], mateWhite: evalsHere[1], pv: [] }, turn);
  const prev = moverLine({ cpWhite: evalsPrev[0], mateWhite: evalsPrev[1], pv: [] }, turn); // same side's view one move earlier
  if (here.mate != null && here.mate > 0 && here.mate <= 2) return { prevForMover: prev.score };
  if (here.score >= 250 && prev.score <= 120) return { prevForMover: prev.score }; // they just let something go
  const hang = hangingPieces(parseFen(fen), turn).filter((h) => VAL[h.piece.type] >= 3);
  if (hang.length && here.score > -150 && here.score < 250) return { prevForMover: prev.score }; // a piece to rescue
  if (here.mate == null && here.score > -200 && prev.mate != null) return { prevForMover: prev.score }; // a mate threat just got stopped
  return null;
}

/**
 * Source 1: the user's own analyzed games. Tactical moments from real games at the user's level, by the user or their
 * opponents. Fast (stored evals pre-filter the positions) and the most personal source there is.
 */
export async function mineFromGames(o: MineOptions, games: AnalyzedGame[]): Promise<{ found: number; games: number }> {
  const m = makeMiner(o);
  for (const g of games) {
    if (m.stop()) break;
    m.state.games++;
    const perGame: Partial<Record<ThemeKey, boolean>> = {};
    const gameTotal = { n: 0 };
    for (let i = 6; i < g.fens.length - 1 && !m.stop(); i++) {
      const cand = isCandidate(g.fens[i], g.evals[i - 1], g.evals[i]);
      if (!cand) continue;
      await m.consider(g.fens[i], cand.prevForMover, g.moves[i - 1] ?? null, perGame, gameTotal, 'your-games');
    }
    o.onProgress?.({ games: m.state.games, found: m.state.found, remaining: m.left(), source: 'your-games' });
  }
  return { found: m.state.found, games: m.state.games };
}

/** Source 2: beginner-level self-play, to top up themes the user's own games cannot supply. */
export async function minePuzzles(o: MineOptions): Promise<{ found: number; games: number }> {
  const rng = o.rng ?? lcg(Date.now() % 2147483646);
  const m = makeMiner(o);
  while (!m.stop()) {
    m.state.games++;
    const ch = new Chess();
    for (const u of OPENINGS[Math.floor(rng() * OPENINGS.length)]) uciMove(ch, u);
    const skW = Math.floor(rng() * 5);
    const skB = Math.floor(rng() * 5);
    let prevTop: MoverLine | null = null;
    const perGame: Partial<Record<ThemeKey, boolean>> = {};
    const gameTotal = { n: 0 };

    for (let ply = 0; ply < 120 && !ch.isGameOver() && !m.stop(); ply++) {
      const fen = ch.fen();
      const hist = ch.history({ verbose: true });
      const last = hist[hist.length - 1];
      const scanned: Scan | null =
        prevTop && hist.length >= 6
          ? await m.consider(fen, -prevTop.score, last ? last.from + last.to : null, perGame, gameTotal, 'self-play')
          : await m.analyse(fen, m.scan);
      if (!scanned) break;
      // Play on: mostly the weak bot's move, sometimes a random one (that is where beginner-style blunders come from).
      let next: Uci | null = null;
      if (hist.length >= 4 && rng() < 0.18) {
        const ms = ch.moves({ verbose: true });
        const mv = ms[Math.floor(rng() * ms.length)];
        next = mv.from + mv.to + (mv.promotion ?? '');
      } else {
        const r = await o.engine.run(fen, { depth: 6, skill: ch.turn() === 'w' ? skW : skB, multipv: 1, priority: 'background' });
        next = r.best;
      }
      if (!next || !uciMove(ch, next)) break;
      prevTop = scanned.top;
    }
    o.onProgress?.({ games: m.state.games, found: m.state.found, remaining: m.left(), source: 'self-play' });
  }
  return { found: m.state.found, games: m.state.games };
}
