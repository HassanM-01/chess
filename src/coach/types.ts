// The coach's output shapes. The AI only ever writes TEXT and picks ACTIONS from a fixed list; every chess fact in the
// facts packet comes from the engine and the app's own analysis.
import type { ThemeKey } from '@/db/types';

export type CoachAction =
  | 'trainer' //   the 15-position game trainer
  | 'mix' //       the daily puzzle mix
  | 'fix' //       fix your mistakes (own mistakes + mirrored copies)
  | 'threat' //    spot the threat
  | 'judge' //     safe or blunder?
  | 'punish' //    punish their mistakes
  | 'play' //      play the bot with Blunder Check
  | 'london' //    the London simulator
  | 'review_last' // walk through the last game
  | 'pull' //      pull recent games
  | `puzzles:${ThemeKey}`
  | `lesson:${string}`;

export interface CoachHabit {
  title: string;
  why: string;
  fix: string;
}

export interface CoachPlanItem {
  day: string;
  title: string;
  minutes: number;
  action: CoachAction;
}

export interface CoachReport {
  headline: string;
  diagnosis: string;
  strengths: string;
  habits: CoachHabit[];
  plan: CoachPlanItem[];
  encouragement: string;
}

export interface StoredCoachReport {
  generatedAt: string;
  /** games analyzed when it was written, to tell when it is getting stale */
  forGames: number;
  report: CoachReport;
}

export interface CoachState {
  report?: StoredCoachReport;
}

export interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
}
