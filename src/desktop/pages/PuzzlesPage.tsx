// Training in the style of chess.com's puzzles, but fed by your own reviewed games: seven ways to practise,
// each followed by a plain-English explanation of why the answer works.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { Chess, uciMove } from '@/chess/compat';
import { pvSan, sanOf } from '@/chess/helpers';
import type { Color } from '@/chess/types';
import { Board, arrowOf, arrowsOf, type Arrow, type MarkKind } from '@/components/Board';
import { pieceHint, positionHint } from '@/features/train/hints';
import { explainBestMove } from '@/review/explain';
import { puzzleFacts } from '@/review/coachFacts';
import { judgeMove } from '@/review/judge';
import { checkMove, countsForRating, sideOf, type Puzzle } from '@/review/puzzles';
import { toPosAnalysis } from '@/review/runReview';
import { bestMoveSteps, type Step } from '@/review/words';
import { WEAK, topWeaknesses } from '@/review/weak';
import { getEngine } from '../lib/desktopEngine';
import { useLibrary } from '../state/library';
import { CoachBox } from '../ui/CoachBox';
import { Steps, NoteCard, type TryNote } from '../ui/Steps';
import { usePuzzles, type PuzzleMode } from '../state/puzzles';

type Status = 'solving' | 'solved' | 'failed' | 'revealed';

interface Run {
  puzzle: Puzzle;
  fen: string;
  step: number;
  status: Status;
  /** had a wrong try or used help: the puzzle counts as failed for the rating */
  tainted: boolean;
  wrong: number;
  hint: 0 | 1 | 2 | 3;
  delta: number | null;
  last: string | null;
  startedAt: number;
  finishedAt: number | null;
  feedback: 'idle' | 'right' | 'wrong';
  /** spot the threat: squares tapped so far */
  picked: string[];
  /** safe or blunder: the answer given */
  answer: 'blunder' | 'safe' | null;
  /** a move you tried that is not the listed answer: Stockfish is judging it (the move's name) */
  checking: string | null;
  /** the verdict on a move you tried: also good, or why it does not work */
  note: TryNote | null;
  /** the last move you tried that was not the listed answer */
  tried: { san: string; good: boolean; reasons: string[] } | null;
}

const THEME_NAMES: Record<string, string> = {
  mate: 'Mate',
  mateIn1: 'Mate in 1',
  mateIn2: 'Mate in 2',
  mateIn3: 'Mate in 3',
  fork: 'Fork',
  pin: 'Pin',
  skewer: 'Skewer',
  sacrifice: 'Sacrifice',
  discoveredAttack: 'Discovered attack',
  hangingPiece: 'Free piece',
  backRankMate: 'Back-rank mate',
  endgame: 'Endgame',
  middlegame: 'Middlegame',
  opening: 'Opening',
  crushing: 'Crushing',
  advantage: 'Advantage',
  yourMistake: 'From your game',
  yourOpponentSlipped: 'They slipped',
  punish: 'Punish the mistake',
  winMaterial: 'Win material',
  saveYourPiece: 'Save your piece',
  stopTheMate: 'Stop the mate',
  avoidTheFork: 'Avoid the fork',
  defence: 'Defend',
  threat: 'Threat',
  calm: 'Calm position',
  judge: 'Safe or blunder',
};
const RATED_THEMES = ['mateIn1', 'mateIn2', 'mateIn3', 'fork', 'pin', 'skewer', 'sacrifice', 'discoveredAttack', 'hangingPiece', 'backRankMate', 'endgame'];
const HIDDEN_THEMES = new Set(['yourMistake', 'yourOpponentSlipped', 'mate', 'threat', 'calm', 'judge', 'crushing', 'advantage', 'punish']);

const MODES: { key: PuzzleMode; label: string; blurb: string; counts: boolean }[] = [
  { key: 'rated', label: 'Rated puzzles', blurb: 'The classic trainer. Your rating goes up and down.', counts: true },
  { key: 'mistake', label: 'Fix my mistakes', blurb: 'Positions from your games where you went wrong. Practice: does not change your rating.', counts: false },
  { key: 'punish', label: 'Punish their mistakes', blurb: 'Your opponent slipped. Find the winning reply. Counts toward your rating.', counts: true },
  { key: 'mate', label: 'Checkmate', blurb: 'Mates in 1, 2 and 3 that came up in your games. Counts toward your rating.', counts: true },
  { key: 'tactic', label: 'Tactics from my games', blurb: 'Free pieces, forks, winning material, saving a piece. Counts toward your rating.', counts: true },
  { key: 'threat', label: 'Spot the threat', blurb: 'Which of your pieces are in danger? Or is nothing? Practice: does not change your rating.', counts: false },
  { key: 'judge', label: 'Safe or blunder?', blurb: 'Judge a move before it is explained. Practice: does not change your rating.', counts: false },
];

function fresh(p: Puzzle): Run {
  return { puzzle: p, fen: p.fen, step: 0, status: 'solving', tainted: false, wrong: 0, hint: 0, delta: null, last: p.lastMove ?? null, startedAt: Date.now(), finishedAt: null, feedback: 'idle', picked: [], answer: null, checking: null, note: null, tried: null };
}

function applyUci(fen: string, uci: string): string | null {
  try {
    const c = new Chess(fen);
    return uciMove(c, uci) ? c.fen() : null;
  } catch {
    return null;
  }
}

function hintTheme(p: Puzzle): string | null {
  if (p.themes.includes('mateIn1')) return 'mate1';
  if (p.themes.includes('mateIn2') || p.themes.includes('mateIn3')) return 'mate2';
  if (p.themes.includes('stopTheMate')) return 'stopmate';
  return null;
}

const sameSet = (a: string[], b: string[]): boolean => a.length === b.length && a.every((x) => b.includes(x));

export function PuzzlesPage(): JSX.Element {
  const store = usePuzzles();
  const games = useLibrary((s) => s.games);
  const [params] = useSearchParams();
  const wanted = params.get('mode');
  const startMode = (MODES.some((m) => m.key === wanted) ? wanted : 'rated') as PuzzleMode;
  const [mode, setMode] = useState<PuzzleMode>(startMode);
  const [touched, setTouched] = useState(startMode !== 'rated');
  const [theme, setTheme] = useState<string | null>(null);
  const [run, setRun] = useState<Run | null>(null);
  const [live, setLive] = useState<{ id: string; text: string; steps: Step[]; busy: boolean } | null>(null);
  const [showSteps, setShowSteps] = useState(false);
  const runRef = useRef<Run | null>(null);
  const [tick, setTick] = useState(0);
  const timers = useRef<number[]>([]);
  const [imp, setImp] = useState<{ busy: boolean; phase: string; fraction: number; count: number; error: string }>({ busy: false, phase: '', fraction: 0, count: 0, error: '' });

  useEffect(() => {
    if (!store.loaded) void store.load();
  }, [store]);
  useEffect(() => {
    if (store.loaded) void usePuzzles.getState().refreshMine();
  }, [store.loaded, games]);
  useEffect(() => () => timers.current.forEach(clearTimeout), []);
  useEffect(() => {
    const t = setInterval(() => setTick((x) => x + 1), 1000);
    return () => clearInterval(t);
  }, []);

  const later = (fn: () => void, ms: number): void => {
    timers.current.push(window.setTimeout(fn, ms));
  };

  const load = useCallback(
    (m: PuzzleMode = mode, th: string | null = theme) => {
      timers.current.forEach(clearTimeout);
      timers.current = [];
      const p = usePuzzles.getState().next(m, th);
      setLive(null);
      setShowSteps(false);
      setRun(p ? fresh(p) : null);
    },
    [mode, theme],
  );

  const choose = (m: PuzzleMode, th: string | null = null): void => {
    setTouched(true);
    setMode(m);
    setTheme(th);
    load(m, th);
  };

  // Start on "Fix my mistakes" as soon as there are puzzles from your own games, unless you already picked something.
  useEffect(() => {
    if (!touched && !store.mining && mode === 'rated' && store.game.some((p) => p.group === 'mistake')) {
      setMode('mistake');
      load('mistake', null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [store.game, store.mining, touched]);

  useEffect(() => {
    if (store.loaded && !run) load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [store.loaded, store.game.length, store.rated.length]);

  const finish = (r: Run, ok: boolean, status: Status): Run => {
    const delta = usePuzzles.getState().finish(r.puzzle, ok);
    return { ...r, status, delta, finishedAt: Date.now() };
  };

  const p = run?.puzzle;
  const kind = p?.kind ?? 'solve';
  const solver: Color = run ? sideOf(run.puzzle.fen) : 'w';

  useEffect(() => {
    runRef.current = run;
  });

  // When a puzzle ends, Stockfish works out the plain explanation (if there is none yet) and the step-by-step breakdown.
  useEffect(() => {
    if (!run || run.status === 'solving' || kind !== 'solve') return;
    const puz = run.puzzle;
    let dead = false;
    setLive({ id: puz.id, text: '', steps: [], busy: true });
    void (async () => {
      try {
        const e = await getEngine().run(puz.fen, { depth: 20, movetimeMs: 1500, multipv: 3, priority: 'interactive' });
        const pos = toPosAnalysis(e, new Chess(puz.fen).moves().length);
        const idx = pos.lines.findIndex((l) => l.pv[0] === puz.solution[0]);
        if (idx < 0) {
          if (!dead) setLive({ id: puz.id, text: '', steps: [], busy: false });
          return;
        }
        const mine = { ...pos, lines: [pos.lines[idx], ...pos.lines.filter((_, i) => i !== idx)] };
        const text = puz.explain?.length ? '' : explainBestMove(puz.fen, mine);
        if (!dead) setLive({ id: puz.id, text, steps: bestMoveSteps(puz.fen, mine), busy: false });
      } catch {
        if (!dead) setLive({ id: puz.id, text: '', steps: [], busy: false });
      }
    })();
    return () => {
      dead = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [run?.puzzle.id, run?.status]);

  // You played something other than the listed answer: let Stockfish judge it. A move that is also good is accepted.
  const tryOther = async (r0: Run, uci: string): Promise<void> => {
    const san = sanOf(r0.fen, uci);
    const after = applyUci(r0.fen, uci);
    setRun({ ...r0, fen: after ?? r0.fen, last: uci, checking: san, note: null, feedback: 'idle' });
    let j: Awaited<ReturnType<typeof judgeMove>> = null;
    try {
      j = await judgeMove(getEngine(), r0.fen, uci, { depth: 20, movetimeMs: 1500 });
    } catch {
      j = null;
    }
    const cur = runRef.current;
    if (!cur || cur.puzzle.id !== r0.puzzle.id || cur.checking !== san) return; // you moved on to another puzzle
    const mateOnly = r0.puzzle.themes.some((t) => /^mateIn|^mate$/.test(t));
    const ex = j?.explanation ?? null;
    const expected = r0.puzzle.solution[r0.step];
    if (j && j.good && (!mateOnly || j.keepsMate)) {
      const lines = [
        j.move.bestUci === uci ? `${san} is the engine's top choice too.` : `The engine's favourite was ${j.move.bestSan}, but ${san} is nearly as strong.`,
        ...(ex ? ex.what : []),
        `The puzzle's own answer was ${sanOf(r0.fen, expected)}.`,
      ];
      setRun(finish({ ...cur, fen: after ?? cur.fen, last: uci, checking: null, tried: { san, good: true, reasons: ex?.what ?? [] }, note: { tone: 'good', title: `${san} is also a good move!`, lines }, feedback: 'right' }, !cur.tainted, cur.tainted ? 'failed' : 'solved'));
      return;
    }
    // Do not give the answer away while the puzzle is still open: say why this move fails, not what to play instead.
    const spoils = !!ex?.tags.some((t) => t.startsWith('missed-'));
    let note: TryNote | null = null;
    if (j && mateOnly && j.good) {
      note = { tone: 'bad', title: `${san} is decent, but there is checkmate`, lines: ['This keeps your advantage, but the position has a forced checkmate. Look for a check that leaves the king nowhere to go.'] };
    } else if (j && ex && !spoils) {
      note = { tone: 'bad', title: `Why ${san} does not work`, lines: ex.what, lesson: ex.lesson };
    } else if (j) {
      note = { tone: 'bad', title: `${san} lets a better chance go`, lines: ['It is not a disaster, but there is something stronger here. Look at every check, every capture, and every piece they cannot protect.'] };
    }
    setRun({ ...cur, fen: r0.fen, last: r0.last, checking: null, tainted: true, wrong: cur.wrong + 1, feedback: 'wrong', note, tried: { san, good: false, reasons: ex?.what ?? [] } });
    later(() => setRun((r) => (r ? { ...r, feedback: 'idle' } : r)), 900);
  };

  // ---- solve: play the moves --------------------------------------------------------------------------------------
  const onMove = (uci: string): void => {
    if (!run || run.status !== 'solving' || kind !== 'solve' || run.checking) return;
    const res = checkMove(run.puzzle, run.fen, run.step, uci);
    if (res === 'wrong') {
      void tryOther(run, uci);
      return;
    }
    const c = new Chess(run.fen);
    if (!uciMove(c, uci)) return;
    const mates = c.isCheckmate();
    const done = mates || run.step + 1 >= run.puzzle.solution.length || res === 'alt';
    if (done) {
      setRun(finish({ ...run, fen: c.fen(), last: uci, feedback: 'right', note: null }, !run.tainted, run.tainted ? 'failed' : 'solved'));
      return;
    }
    const reply = run.puzzle.solution[run.step + 1];
    setRun({ ...run, fen: c.fen(), last: uci, step: run.step + 1, feedback: 'right' });
    later(() => {
      setRun((r) => {
        if (!r) return r;
        const cc = new Chess(r.fen);
        if (!uciMove(cc, reply)) return r;
        return { ...r, fen: cc.fen(), last: reply, step: r.step + 1, feedback: 'idle' };
      });
    }, 450);
  };

  const showSolution = (): void => {
    if (!run || run.status !== 'solving' || kind !== 'solve' || run.checking) return;
    setRun(finish({ ...run, tainted: true, note: null }, false, 'revealed'));
    let fen = run.fen;
    run.puzzle.solution.slice(run.step).forEach((u, i) => {
      later(() => {
        const c = new Chess(fen);
        if (!uciMove(c, u)) return;
        fen = c.fen();
        setRun((r) => (r ? { ...r, fen, last: u } : r));
      }, 500 * (i + 1));
    });
  };

  const hint = (): void => {
    if (!run || run.status !== 'solving' || kind !== 'solve' || run.checking) return;
    setRun({ ...run, tainted: true, hint: Math.min(3, run.hint + 1) as 1 | 2 | 3 });
  };

  // ---- spot the threat: tap the pieces in danger -------------------------------------------------------------------
  const tap = (sq: string): void => {
    if (!run || run.status !== 'solving' || kind !== 'threat') return;
    const piece = new Chess(run.fen).get(sq as never);
    if (!piece || piece.color !== solver) return;
    setRun({ ...run, picked: run.picked.includes(sq) ? run.picked.filter((x) => x !== sq) : [...run.picked, sq] });
  };
  const submitThreat = (picked: string[]): void => {
    if (!run || run.status !== 'solving' || !run.puzzle.threat) return;
    const ok = sameSet(picked, run.puzzle.threat.danger);
    setRun(finish({ ...run, picked }, ok, ok ? 'solved' : 'failed'));
  };

  // ---- safe or blunder ---------------------------------------------------------------------------------------------
  const judge = (a: 'blunder' | 'safe'): void => {
    if (!run || run.status !== 'solving' || !run.puzzle.judge) return;
    const ok = a === run.puzzle.judge.verdict;
    const after = applyUci(run.fen, run.puzzle.judge.move);
    setRun(finish({ ...run, answer: a, fen: after ?? run.fen, last: run.puzzle.judge.move }, ok, ok ? 'solved' : 'failed'));
  };

  // ---- what the board shows ----------------------------------------------------------------------------------------
  const expected = run && run.status === 'solving' && kind === 'solve' ? run.puzzle.solution[run.step] : null;
  const marks: Record<string, MarkKind> = {};
  let arrows: Arrow[] = [];
  if (run && kind === 'solve') {
    if (expected && run.hint >= 2) marks[expected.slice(0, 2)] = 'sel';
    if (expected && run.hint >= 3) arrows = arrowsOf(arrowOf(expected, 'good'));
  }
  if (run && kind === 'threat' && run.puzzle.threat) {
    if (run.status === 'solving') run.picked.forEach((s) => (marks[s] = 'sel'));
    else {
      run.puzzle.threat.danger.forEach((s) => (marks[s] = 'bad'));
      run.picked.filter((s) => !run.puzzle.threat!.danger.includes(s)).forEach((s) => (marks[s] = 'sel'));
      arrows = run.puzzle.threat.arrows.map((a) => ({ from: a.from, to: a.to, color: 'bad' as const }));
    }
  }
  if (run && kind === 'judge' && run.puzzle.judge) {
    if (run.status === 'solving') arrows = arrowsOf(arrowOf(run.puzzle.judge.move, 'info'));
    else if (run.puzzle.judge.verdict === 'blunder') arrows = arrowsOf(arrowOf(run.puzzle.judge.reply, 'bad'));
  }

  const seconds = run ? Math.floor(((run.finishedAt ?? Date.now()) - run.startedAt) / 1000) : 0;
  void tick;

  const startImport = async (): Promise<void> => {
    setImp({ busy: true, phase: 'Starting…', fraction: 0, count: 0, error: '' });
    const off = window.desktop!.puzzles.onProgress((pp) => setImp((x) => ({ ...x, phase: pp.phase, fraction: pp.fraction || x.fraction, count: pp.count || x.count })));
    try {
      const r = await window.desktop!.puzzles.importLichess({ limit: 40_000 });
      await usePuzzles.getState().reloadLichess();
      setImp({ busy: false, phase: '', fraction: 1, count: r.count, error: '' });
      load('rated', theme);
    } catch (e) {
      setImp({ busy: false, phase: '', fraction: 0, count: 0, error: e instanceof Error ? e.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '') : String(e) });
    } finally {
      off();
    }
  };

  const pr = store.progress;
  const countOf = (m: PuzzleMode): number => (m === 'rated' ? store.rated.length : store.game.filter((x) => x.group === m).length);
  const themeOptions = useMemo(() => {
    if (mode === 'rated') return RATED_THEMES.filter((t) => store.rated.some((x) => x.themes.includes(t)));
    const set = new Set<string>();
    store.game.filter((x) => x.group === mode).forEach((x) => x.themes.forEach((t) => !HIDDEN_THEMES.has(t) && set.add(t)));
    return [...set];
  }, [mode, store.rated, store.game]);
  const weak = topWeaknesses(store.weak.tags, 4);
  const sol = run?.status === 'revealed' || run?.status === 'failed' ? pvSan(run.puzzle.fen, run.puzzle.solution, 6).join(' ') : '';
  const over = !!run && run.status !== 'solving';
  const sideName = solver === 'w' ? 'White' : 'Black';
  const modeInfo = MODES.find((m) => m.key === mode)!;

  const counts = !run || countsForRating(run.puzzle);
  const banner = ((): { cls: string; text: string } | null => {
    if (!run) return null;
    const j = run.puzzle.judge;
    if (kind === 'threat') {
      if (run.status === 'solving') return { cls: '', text: run.picked.length ? `${run.picked.length} piece${run.picked.length === 1 ? '' : 's'} chosen. Check your answer when ready.` : 'Tap every piece of yours that is in danger. If nothing is, say so.' };
      return run.status === 'solved' ? { cls: 'good', text: 'Correct!' } : { cls: 'bad', text: run.puzzle.threat?.danger.length ? 'Not quite. The pieces in danger are marked in red.' : 'Not quite. Nothing was in danger here.' };
    }
    if (kind === 'judge' && j) {
      const who = sideOf(run.puzzle.fen) === 'w' ? 'White' : 'Black';
      if (run.status === 'solving') return { cls: '', text: `${who} plays ${j.san}. Is that a blunder, or a safe move?` };
      return run.status === 'solved' ? { cls: 'good', text: `Correct! ${j.san} was ${j.verdict === 'blunder' ? 'a blunder' : 'safe'}.` } : { cls: 'bad', text: `Not quite. ${j.san} was ${j.verdict === 'blunder' ? 'a blunder' : 'a safe move'}.` };
    }
    if (run.checking) return { cls: '', text: `Checking ${run.checking} with Stockfish…` };
    if (run.status === 'solving') return { cls: run.feedback === 'wrong' ? 'bad' : '', text: run.feedback === 'wrong' ? 'That is not the move. Try again.' : run.step === 0 ? 'Find the best move.' : 'Good. Keep going.' };
    if (run.status === 'solved') return { cls: 'good', text: `Puzzle solved!${counts && run.delta ? ` ${run.delta > 0 ? '+' : ''}${run.delta}` : ''}` };
    if (run.status === 'failed') return { cls: 'bad', text: `Solved, but not cleanly.${counts && run.delta ? ` ${run.delta}` : ''}` };
    return { cls: 'bad', text: `Solution: ${sol}${run.delta ? `  (${run.delta})` : ''}` };
  })();

  const hintText = ((): string => {
    if (!run || kind !== 'solve' || run.status !== 'solving' || run.hint < 1) return '';
    const u = run.puzzle.solution[run.step];
    if (run.hint === 1) return positionHint(run.fen, u, hintTheme(run.puzzle));
    const ph = pieceHint(run.fen, u);
    return ph ? ph.text : '';
  })();

  return (
    <div className="dk-puzzles" data-testid="puzzles-page">
      <section className="dk-boardcol">
        <div className="player-bar">
          <b>{run ? `${sideName} to move` : 'Puzzles'}</b>
          {run && <span className="muted small" data-testid="puzzle-rated-label">{run.puzzle.source === 'game' ? (counts ? `${modeInfo.label} · rated ${run.puzzle.rating}` : `${modeInfo.label} · practice, not rated`) : `Puzzle rating ${run.puzzle.rating}`}</span>}
          <span className="grow" />
          <span className="pill">{Math.floor(seconds / 60)}:{String(seconds % 60).padStart(2, '0')}</span>
        </div>
        <div className="board-holder puzzle-board">
          {run ? (
            <Board
              fen={run.fen}
              orientation={solver}
              interactive={run.status === 'solving' && kind === 'solve' && !run.checking && sideOf(run.fen) === solver}
              movableColor={solver}
              lastMove={run.last}
              marks={marks}
              arrows={arrows}
              onMove={onMove}
              onTap={kind === 'threat' && run.status === 'solving' ? tap : undefined}
            />
          ) : (
            <div className="dk-card empty-puzzle">
              {mode !== 'rated' ? (
                <>
                  <b>{store.mining ? 'Building puzzles from your games…' : `No “${modeInfo.label}” puzzles yet.`}</b>
                  <p className="small muted">
                    {countOf(mode) === 0
                      ? 'Review some of your games first. Everything here is built from the deep analysis of your own games.'
                      : 'Pick another theme.'}
                  </p>
                  <Link className="btn primary" to="/">Go to games</Link>
                </>
              ) : (
                <b>Loading puzzles…</b>
              )}
            </div>
          )}
        </div>
        {run?.puzzle.context && <div className="puzzle-context small muted">{run.puzzle.context}</div>}
        {banner && (
          <div className={`puzzle-banner ${banner.cls}`} data-testid="puzzle-banner" data-status={run!.status}>
            <b>{banner.text}</b>
          </div>
        )}
        {run && !counts && run.status !== 'solving' && <div className="small muted" data-testid="practice-note">Practice puzzle: your rating stays the same.</div>}
        {hintText && <div className="hint-card small" data-testid="hint-text">💡 {hintText}</div>}
        <div className="dk-controls">
          {kind === 'solve' && (
            <>
              <button className="btn" onClick={hint} disabled={!run || run.status !== 'solving' || run.hint >= 3 || !!run.checking} data-testid="hint">Hint</button>
              <button className="btn" onClick={showSolution} disabled={!run || run.status !== 'solving' || !!run.checking} data-testid="solution">Solution</button>
            </>
          )}
          {kind === 'threat' && run?.status === 'solving' && (
            <>
              <button className="btn primary" onClick={() => submitThreat(run.picked)} disabled={!run.picked.length} data-testid="threat-check">Check my answer</button>
              <button className="btn" onClick={() => submitThreat([])} data-testid="threat-none">Nothing is in danger</button>
            </>
          )}
          {kind === 'judge' && run?.status === 'solving' && (
            <>
              <button className="btn bad-btn" onClick={() => judge('blunder')} data-testid="judge-blunder">It is a blunder</button>
              <button className="btn good-btn" onClick={() => judge('safe')} data-testid="judge-safe">It is safe</button>
            </>
          )}
          <span className="grow" />
          <button className="btn primary" onClick={() => load()} data-testid="next-puzzle">{run && run.status !== 'solving' ? 'Next puzzle' : 'Skip'}</button>
        </div>
      </section>

      <aside className="dk-side">
        <div className="dk-card stats-card">
          <div className="small muted">Your puzzle rating</div>
          <b className="big-rating" data-testid="puzzle-rating">{pr.rating}</b>
          <div className="stat-row">
            <span>Solved <b>{pr.solved}</b></span>
            <span>Failed <b>{pr.failed}</b></span>
            <span>Streak <b>{pr.streak}</b></span>
            <span>Best <b>{pr.bestStreak}</b></span>
          </div>
          <div className="small muted" data-testid="rating-note">Your rating moves with Rated puzzles, Checkmate, Tactics and Punish. The other modes are practice.</div>
          {mode === 'rated' && pr.rating > 400 && (
            <button className="linklike small" onClick={() => usePuzzles.getState().easier()} data-testid="easier">Too hard? Give me easier puzzles</button>
          )}
        </div>

        {run?.note && <NoteCard note={run.note} />}
        {over && run && (
          <div className="dk-card explain-card" data-testid="puzzle-explain">
            <b>Why</b>
            {run.puzzle.explain?.map((t, i) => <p key={i} className="small">{t}</p>)}
            {live?.id === run.puzzle.id && live.busy && <p className="small muted">The engine is working out why…</p>}
            {live?.id === run.puzzle.id && live.text && <p className="small">{live.text}</p>}
            {kind === 'solve' && !run.puzzle.explain?.length && !(live?.id === run.puzzle.id && live.text) && !(live?.busy) && sol && <p className="small muted">Solution: {sol || pvSan(run.puzzle.fen, run.puzzle.solution, 6).join(' ')}</p>}
            {kind === 'solve' && live?.id === run.puzzle.id && live.steps.length > 0 && (
              <>
                <button className="btn" onClick={() => setShowSteps((v) => !v)} data-testid="show-steps">{showSteps ? 'Hide the step-by-step' : 'Break it down step by step'}</button>
                {showSteps && <Steps steps={live.steps} />}
              </>
            )}
            {run.puzzle.lesson && <div className="remember small">💡 {run.puzzle.lesson}</div>}
            {run.puzzle.themes.length > 0 && <div className="small muted">Themes: {run.puzzle.themes.filter((t) => !HIDDEN_THEMES.has(t) || run.puzzle.source !== 'game').map((t) => THEME_NAMES[t] ?? t).join(', ')}</div>}
          </div>
        )}

        {run && kind === 'solve' && (over || run.tried) && (
          <CoachBox
            resetKey={`${run.puzzle.id}:${over ? 'done' : run.wrong}`}
            facts={puzzleFacts({ fen: run.puzzle.fen, themes: run.puzzle.themes.map((t) => THEME_NAMES[t] ?? t), solution: run.puzzle.solution, explain: [...(run.puzzle.explain ?? []), ...(live?.id === run.puzzle.id && live.text ? [live.text] : [])], steps: live?.id === run.puzzle.id ? live.steps : undefined, tried: run.tried ?? undefined })}
          />
        )}
        {run?.puzzle.from && (
          <div className="dk-card small">
            {run.puzzle.game && (
              <>
                <b>From your game vs {run.puzzle.game.opponent}</b>
                <div className="muted">Move {run.puzzle.game.moveNo} you played {run.puzzle.game.played}, which gave up about {Math.round(run.puzzle.game.loss * 100)}% of your winning chances.</div>
                {over && <div>The best move was <b>{run.puzzle.game.best}</b>.</div>}
              </>
            )}
            <Link to={`/review/${run.puzzle.from.gameId}`}>Open the game review</Link>
          </div>
        )}

        <div className="mode-list" role="tablist" aria-label="Training mode">
          {MODES.map((m) => (
            <button key={m.key} role="tab" className={`mode-btn${mode === m.key ? ' on' : ''}`} aria-pressed={mode === m.key} onClick={() => choose(m.key)} data-testid={`mode-${m.key}`}>
              <span className="mode-name">{m.label} <span className={`mode-tag${m.counts ? ' on' : ''}`} data-testid={`tag-${m.key}`}>{m.counts ? 'rated' : 'practice'}</span></span>
              <span className="mode-count">{m.key !== 'rated' && store.mining && !countOf(m.key) ? '…' : countOf(m.key).toLocaleString()}</span>
              <span className="mode-blurb small muted">{m.blurb}</span>
            </button>
          ))}
        </div>

        {themeOptions.length > 1 && (
          <div className="dk-card stack-s">
            <label className="lbl" htmlFor="theme">Theme</label>
            <select id="theme" value={theme ?? ''} onChange={(e) => choose(mode, e.target.value || null)}>
              <option value="">Any theme</option>
              {themeOptions.map((t) => <option key={t} value={t}>{THEME_NAMES[t] ?? t}</option>)}
            </select>
            {mode === 'rated' && (
              <div className="small muted">
                {store.rated.length.toLocaleString()} puzzles ({store.lichessCount ? `${store.lichessCount.toLocaleString()} from Lichess` : 'beginner set only'}).
              </div>
            )}
          </div>
        )}

        {weak.length > 0 && (
          <div className="dk-card stack-s" data-testid="weak-spots">
            <b>What you keep getting wrong</b>
            <div className="small muted">From {store.weak.badMoves} weak moves in {store.weak.games} reviewed game{store.weak.games === 1 ? '' : 's'}.</div>
            {weak.map(({ tag, count }) => {
              const w = WEAK[tag];
              return (
                <div className="weak-row" key={tag}>
                  <span className="grow small"><b>{w.label}</b> <span className="muted">×{count}</span></span>
                  <button className="btn" onClick={() => choose(w.practice.mode, w.practice.theme && store.game.some((x) => x.group === w.practice.mode && x.themes.includes(w.practice.theme!)) ? w.practice.theme : null)}>Practise</button>
                </div>
              );
            })}
          </div>
        )}

        {mode === 'rated' && (
          <div className="dk-card stack-s">
            <b>{store.lichessCount ? 'Refresh the Lichess puzzle bank' : 'Get thousands of rated puzzles'}</b>
            <p className="small muted">
              Downloads the free Lichess puzzle database (about 270 MB) once and keeps a balanced sample of about 40,000 puzzles from 400 to 3200 rating on this computer.
              {store.lichessImportedAt ? ` Last imported ${new Date(store.lichessImportedAt).toLocaleDateString()}.` : ''}
            </p>
            {imp.busy ? (
              <>
                <div className="progress"><i style={{ width: `${Math.round(imp.fraction * 100)}%` }} /></div>
                <div className="small muted">{imp.phase}{imp.count ? ` · ${imp.count.toLocaleString()} kept` : ''}</div>
                <button className="btn" onClick={() => window.desktop?.puzzles.cancel()}>Cancel</button>
              </>
            ) : (
              <button className="btn" onClick={() => void startImport()} data-testid="import-lichess">Download Lichess puzzles</button>
            )}
            {imp.error && <div className="err small">{imp.error}</div>}
          </div>
        )}
      </aside>
    </div>
  );
}
