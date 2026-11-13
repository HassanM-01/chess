// The Play page's state: the game in progress (kept while you look at other tabs), your settings, and which
// practice positions you have played. Settings and progress are saved on this computer.
import { create } from 'zustand';
import { Chess, uciMove } from '@/chess/compat';
import { START_FEN, type Color, type Uci } from '@/chess/types';
import type { Judgement } from '@/review/judge';
import type { CoachMode, GameEnd } from '@/review/playCoach';
import type { Goal } from '@/review/scenarios';

export type PlayKind = 'free' | 'opening' | 'middlegame' | 'endgame';

export interface Verdict {
  /** index of the move in the game (0 = the first move) */
  ply: number;
  san: string;
  uci: Uci;
  /** checking = Stockfish is still looking; unavailable = it could not be judged */
  status: 'checking' | 'done' | 'unavailable';
  judgement: Judgement | null;
}

export interface Session {
  id: number;
  kind: PlayKind;
  title: string;
  /** shown in the side panel before and during a practice game */
  tips: string[];
  goal: Goal;
  scenarioId: string | null;
  startFen: string;
  moves: Uci[];
  me: Color;
  /** index into PLAY_LEVELS */
  level: number;
  over: boolean;
  end: GameEnd | null;
  /** an opening drill in progress: the computer's replies and the moves you must find are scripted until it ends */
  drillId: string | null;
  /** judgements of your own moves, by ply */
  verdicts: Record<number, Verdict>;
  /** bad moves you took back after Blunder Check stopped you */
  caught: number;
  /** id of the saved game in the library once you press "Review this game" */
  savedGameId: string | null;
}

export interface PlayPrefs {
  level: number;
  color: 'w' | 'b' | 'r';
  coach: CoachMode;
  /** also stop you on inaccuracies, not only mistakes and blunders */
  strict: boolean;
  /** show Stockfish's live lines and the evaluation bar */
  showEngine: boolean;
  /** point out loose pieces, threats and chances on the board */
  headsUp: boolean;
}

export const DEFAULT_PREFS: PlayPrefs = { level: 1, color: 'w', coach: 'warn', strict: false, showEngine: true, headsUp: true };

export interface ScenarioProgress {
  plays: number;
  met: number;
  last: string;
}

export interface StartOptions {
  kind: PlayKind;
  title: string;
  tips?: string[];
  goal?: Goal;
  scenarioId?: string | null;
  fen?: string;
  /** the side you play; 'r' picks at random */
  me: Color | 'r';
  level: number;
  drillId?: string | null;
  moves?: Uci[];
}

let nextId = 1;

export function newSession(o: StartOptions): Session {
  const me: Color = o.me === 'r' ? (Math.random() < 0.5 ? 'w' : 'b') : o.me;
  return {
    id: nextId++,
    kind: o.kind,
    title: o.title,
    tips: o.tips ?? [],
    goal: o.goal ?? 'play',
    scenarioId: o.scenarioId ?? null,
    startFen: o.fen ?? START_FEN,
    moves: o.moves ?? [],
    me,
    level: o.level,
    over: false,
    end: null,
    drillId: o.drillId ?? null,
    verdicts: {},
    caught: 0,
    savedGameId: null,
  };
}

/** The board after the session's moves. */
export function boardOf(s: Pick<Session, 'startFen' | 'moves'>): Chess {
  const c = new Chess(s.startFen);
  for (const u of s.moves) uciMove(c, u);
  return c;
}

interface PlayState {
  loaded: boolean;
  prefs: PlayPrefs;
  progress: Record<string, ScenarioProgress>;
  session: Session | null;
  load(): Promise<void>;
  setPrefs(p: Partial<PlayPrefs>): void;
  start(o: StartOptions): Session;
  patch(p: Partial<Session>): void;
  setVerdict(v: Verdict): void;
  /** leave the game and go back to the list */
  close(): void;
  recordResult(scenarioId: string, met: boolean): void;
}

export const usePlay = create<PlayState>((set, get) => ({
  loaded: false,
  prefs: DEFAULT_PREFS,
  progress: {},
  session: null,
  async load() {
    if (get().loaded) return;
    const prefs = (await window.desktop?.store.read<Partial<PlayPrefs>>('play-prefs')) ?? {};
    const progress = (await window.desktop?.store.read<Record<string, ScenarioProgress>>('play-progress')) ?? {};
    set({ prefs: { ...DEFAULT_PREFS, ...prefs }, progress, loaded: true });
  },
  setPrefs(p) {
    const prefs = { ...get().prefs, ...p };
    set({ prefs });
    void window.desktop?.store.write('play-prefs', prefs);
  },
  start(o) {
    const session = newSession(o);
    set({ session });
    return session;
  },
  patch(p) {
    set((st) => (st.session ? { session: { ...st.session, ...p } } : st));
  },
  setVerdict(v) {
    set((st) => (st.session ? { session: { ...st.session, verdicts: { ...st.session.verdicts, [v.ply]: v } } } : st));
  },
  close() {
    set({ session: null });
  },
  recordResult(scenarioId, met) {
    const old = get().progress[scenarioId] ?? { plays: 0, met: 0, last: '' };
    const progress = { ...get().progress, [scenarioId]: { plays: old.plays + 1, met: old.met + (met ? 1 : 0), last: new Date().toISOString() } };
    set({ progress });
    void window.desktop?.store.write('play-progress', progress);
  },
}));
