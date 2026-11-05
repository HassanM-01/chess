// Names for the kinds of mistakes the explainer finds, and which training mode fixes each one.
import type { ExplainTag } from './explain';
import type { PuzzleGroup } from './puzzles';

export interface WeakInfo {
  /** "Moving pieces onto unsafe squares" */
  label: string;
  /** the training that targets it */
  practice: { mode: PuzzleGroup; theme?: string };
}

export const WEAK: Record<ExplainTag, WeakInfo> = {
  'hung-piece': { label: 'Moving a piece where it can be taken', practice: { mode: 'threat' } },
  'left-piece-hanging': { label: 'Leaving a piece without protection', practice: { mode: 'threat' } },
  'ignored-threat': { label: "Missing what the opponent's last move attacks", practice: { mode: 'threat' } },
  exposed: { label: 'Opening a line for the opponent', practice: { mode: 'judge' } },
  'allowed-mate': { label: 'Walking into checkmate', practice: { mode: 'mistake', theme: 'stopTheMate' } },
  'back-rank': { label: 'Back-rank weakness', practice: { mode: 'mistake', theme: 'stopTheMate' } },
  'missed-mate': { label: 'Missing a checkmate', practice: { mode: 'mate' } },
  'allowed-fork': { label: 'Walking into forks', practice: { mode: 'mistake', theme: 'avoidTheFork' } },
  'allowed-pin': { label: 'Pins and skewers', practice: { mode: 'judge' } },
  'bad-trade': { label: 'Trades that lose material', practice: { mode: 'judge' } },
  'lost-material': { label: 'Losing material in a sequence of captures', practice: { mode: 'judge' } },
  'missed-free-piece': { label: 'Missing free pieces', practice: { mode: 'tactic', theme: 'hangingPiece' } },
  'missed-fork': { label: 'Missing forks', practice: { mode: 'tactic', theme: 'fork' } },
  'missed-win': { label: 'Missing ways to win material', practice: { mode: 'tactic', theme: 'winMaterial' } },
  'early-queen': { label: 'Bringing the queen out too early', practice: { mode: 'judge' } },
  'rim-knight': { label: 'Putting knights on the edge', practice: { mode: 'judge' } },
  positional: { label: 'Quiet moves that slowly give up the advantage', practice: { mode: 'mistake' } },
};

/** The most frequent weaknesses first. */
export function topWeaknesses(tags: Partial<Record<ExplainTag, number>>, n = 4): { tag: ExplainTag; count: number }[] {
  return (Object.entries(tags) as [ExplainTag, number][])
    .filter(([, c]) => c > 0)
    .sort((a, b) => b[1] - a[1])
    .slice(0, n)
    .map(([tag, count]) => ({ tag, count }));
}
