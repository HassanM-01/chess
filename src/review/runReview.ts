// Runs the engine over every position of a game and collects what the classifier needs.
import { Chess } from '@/chess/compat';
import { gameFens } from '@/chess/helpers';
import type { Uci } from '@/chess/types';
import type { Engine } from '@/engine/engine';
import type { EngineLine, PosEval } from '@/engine/types';
import type { PosAnalysis, ReviewSettings, StoredLine } from './types';

export type ReviewEngine = Pick<Engine, 'run'>;

const PV_KEEP = 14;
/** a forced mate seen at least this deep is trusted */
const MATE_MIN_DEPTH = 22;

const toStoredLine = (l: EngineLine, fallbackDepth: number): StoredLine => ({
  cp: Math.round(l.cpWhite),
  mate: l.mateWhite,
  wdl: l.wdl,
  pv: l.pv.slice(0, PV_KEEP),
  depth: l.depth ?? fallbackDepth,
});

export function toPosAnalysis(e: PosEval, legal: number): PosAnalysis {
  return { lines: e.lines.map((l) => toStoredLine(l, e.depth ?? 0)), depth: e.depth ?? 0, legal };
}

/** Checkmate / draw positions need no search. White's score is +-10000 when White is the one who mated. */
export function terminalAnalysis(fen: string): PosAnalysis | null {
  const c = new Chess(fen);
  if (c.isCheckmate()) {
    const whiteMated = c.turn() === 'w';
    return { lines: [{ cp: whiteMated ? -10000 : 10000, mate: null, pv: [], depth: 0 }], depth: 0, legal: 0, terminal: 'mate' };
  }
  if (c.isGameOver()) return { lines: [{ cp: 0, mate: null, pv: [], depth: 0 }], depth: 0, legal: 0, terminal: 'draw' };
  return null;
}

export interface ReviewHooks {
  /** a position finished (called in order) */
  onPosition?: (index: number, pos: PosAnalysis) => void;
  /** the engine reached a new depth on the position being searched */
  onSearch?: (index: number, lines: EngineLine[], depth: number) => void;
  shouldCancel?: () => boolean;
  /** analyses already done with the same settings: positions [0, resume.length) are reused */
  resume?: PosAnalysis[];
  /** aborting stops the search in progress; the position it was working on is discarded */
  signal?: AbortSignal;
}

/**
 * Analyze every position (before move 1 through after the last move). MultiPV lines come back sorted best first.
 * Positions with a single legal move get a short search: the answer is known, only the evaluation is wanted.
 */
export async function analyzePositions(
  startFen: string,
  movesUci: Uci[],
  engine: ReviewEngine,
  settings: ReviewSettings,
  hooks: ReviewHooks = {},
): Promise<PosAnalysis[]> {
  const fens = gameFens(startFen, movesUci);
  const out: PosAnalysis[] = hooks.resume ? hooks.resume.slice() : [];
  for (let i = out.length; i < fens.length; i++) {
    if (hooks.shouldCancel?.()) throw new Error('cancelled');
    const term = terminalAnalysis(fens[i]);
    if (term) {
      out.push(term);
      hooks.onPosition?.(i, term);
      continue;
    }
    const legal = new Chess(fens[i]).moves().length;
    const forced = legal === 1;
    if (hooks.signal?.aborted) throw new Error('cancelled');
    // A forced mate that has been confirmed deep enough needs no more time: stop that search early.
    const early = new AbortController();
    const relay = (): void => early.abort();
    hooks.signal?.addEventListener('abort', relay, { once: true });
    const e = await engine.run(fens[i], {
      depth: forced ? Math.min(settings.depth, 24) : settings.depth,
      movetimeMs: forced ? Math.min(settings.movetimeMs, 2_000) : settings.movetimeMs,
      multipv: forced ? 1 : settings.multipv,
      priority: 'background',
      interruptible: false,
      // A fresh hash table at the start keeps a re-run reproducible; later positions share it, which makes them faster.
      newGame: i === 0,
      signal: early.signal,
      onInfo: (lines, depth) => {
        hooks.onSearch?.(i, lines, depth);
        const top = lines[0];
        if (top && top.mateWhite != null && depth >= Math.max(MATE_MIN_DEPTH, Math.abs(top.mateWhite) * 2 + 10)) early.abort();
      },
    }).finally(() => hooks.signal?.removeEventListener('abort', relay));
    if (hooks.shouldCancel?.()) throw new Error('cancelled');
    if (!e.lines.length) throw new Error('The engine returned no analysis');
    const pos = toPosAnalysis(e, legal);
    out.push(pos);
    hooks.onPosition?.(i, pos);
  }
  return out;
}
