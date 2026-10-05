import type { GeneratedPayload, JudgePayload, OwnMistakePayload, PunishPayload, PuzzleRow, ThreatPayload, TrainingItem } from '@/db/types';

/** One thing to solve in a session. */
export type SessionItem =
  /** a puzzle; `item` is set when it is a personal (generated) puzzle that has its own spaced-repetition schedule */
  | { kind: 'puz'; id: string; puzzle: PuzzleRow; item?: TrainingItem }
  | { kind: 'drill'; id: string; item: TrainingItem; payload: OwnMistakePayload | PunishPayload }
  | { kind: 'threat'; id: string; item: TrainingItem; payload: ThreatPayload }
  | { kind: 'judge'; id: string; item: TrainingItem; payload: JudgePayload };

export interface SessionOptions {
  title: string;
  /** hide the theme prompt (daily mix: "Find the best move.") */
  hideTheme?: boolean;
  /** called when a session finishes (lessons mark themselves done) */
  onDone?: (score: number, total: number) => void;
  /** where "Done" goes */
  returnTo?: string;
  /** daily-plan item completed by finishing this session */
  dailyKey?: 'trainer';
}

export function toSessionItem(ti: TrainingItem): SessionItem {
  const p = ti.payload;
  if (p.pool === 'threat' || p.pool === 'calm') return { kind: 'threat', id: ti.id, item: ti, payload: p };
  if (p.pool === 'blunder' || p.pool === 'safe') return { kind: 'judge', id: ti.id, item: ti, payload: p };
  return { kind: 'drill', id: ti.id, item: ti, payload: p as OwnMistakePayload | PunishPayload };
}

export const puzzleItem = (puzzle: PuzzleRow): SessionItem => ({ kind: 'puz', id: puzzle.id, puzzle });

/** A personal puzzle, shaped like a bank puzzle so the runner treats them the same way. */
export function genToSessionItem(ti: TrainingItem): SessionItem {
  const p = ti.payload as GeneratedPayload;
  return {
    kind: 'puz',
    id: ti.id,
    item: ti,
    puzzle: { id: ti.id, fen: p.fen, moves: p.moves, themes: [p.theme], rating: p.rating, explanation: p.explain, source: 'personal', lastMove: p.lastMove, alts: p.alts },
  };
}
