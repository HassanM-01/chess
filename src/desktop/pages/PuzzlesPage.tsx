// Puzzles in the style of chess.com: a rated trainer plus puzzles made from your own mistakes.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { Chess, uciMove } from '@/chess/compat';
import { pvSan } from '@/chess/helpers';
import { Board, arrowOf, arrowsOf, type MarkKind } from '@/components/Board';
import { checkMove, sideOf, type Puzzle } from '@/review/puzzles';
import { usePuzzles } from '../state/puzzles';
import { useLibrary } from '../state/library';

type Status = 'solving' | 'solved' | 'failed' | 'revealed';

interface Run {
  puzzle: Puzzle;
  fen: string;
  step: number;
  status: Status;
  /** had a wrong try or used help: the puzzle counts as failed for the rating */
  tainted: boolean;
  wrong: number;
  hint: 0 | 1 | 2;
  delta: number | null;
  last: string | null;
  startedAt: number;
  finishedAt: number | null;
  feedback: 'idle' | 'right' | 'wrong';
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
  hangingPiece: 'Hanging piece',
  backRankMate: 'Back-rank mate',
  endgame: 'Endgame',
  middlegame: 'Middlegame',
  opening: 'Opening',
  crushing: 'Crushing',
  advantage: 'Advantage',
  yourMistake: 'From your game',
};
const THEMES = ['mateIn1', 'mateIn2', 'mateIn3', 'fork', 'pin', 'skewer', 'sacrifice', 'discoveredAttack', 'hangingPiece', 'backRankMate', 'endgame'];

function fresh(p: Puzzle): Run {
  return { puzzle: p, fen: p.fen, step: 0, status: 'solving', tainted: false, wrong: 0, hint: 0, delta: null, last: p.lastMove ?? null, startedAt: Date.now(), finishedAt: null, feedback: 'idle' };
}

export function PuzzlesPage(): JSX.Element {
  const store = usePuzzles();
  const games = useLibrary((s) => s.games);
  const [mode, setMode] = useState<'rated' | 'mine'>('rated');
  const [theme, setTheme] = useState<string | null>(null);
  const [run, setRun] = useState<Run | null>(null);
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
    (m: 'rated' | 'mine' = mode, th: string | null = theme) => {
      timers.current.forEach(clearTimeout);
      timers.current = [];
      const p = usePuzzles.getState().next(m, th);
      setRun(p ? fresh(p) : null);
    },
    [mode, theme],
  );

  useEffect(() => {
    if (store.loaded && !run) load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [store.loaded, store.mine.length, store.rated.length]);

  const finish = (r: Run, ok: boolean, status: Status): Run => {
    const delta = usePuzzles.getState().finish(r.puzzle, ok);
    return { ...r, status, delta, finishedAt: Date.now() };
  };

  const solver = run ? sideOf(run.puzzle.fen) : 'w';

  const onMove = (uci: string): void => {
    if (!run || run.status !== 'solving') return;
    const res = checkMove(run.puzzle, run.fen, run.step, uci);
    if (res === 'wrong') {
      setRun({ ...run, tainted: true, wrong: run.wrong + 1, feedback: 'wrong' });
      later(() => setRun((r) => (r ? { ...r, feedback: 'idle' } : r)), 900);
      return;
    }
    const c = new Chess(run.fen);
    if (!uciMove(c, uci)) return;
    const accepted = res === 'alt' ? run.puzzle.solution.slice() : run.puzzle.solution;
    // An accepted alternative ends the line when it mates; otherwise the main line is followed from there only if it still applies.
    const mates = c.isCheckmate();
    const done = mates || run.step + 1 >= accepted.length || res === 'alt';
    if (done) {
      setRun(finish({ ...run, fen: c.fen(), last: uci, feedback: 'right' }, !run.tainted, run.tainted ? 'failed' : 'solved'));
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
    if (!run || run.status !== 'solving') return;
    const base = finish({ ...run, tainted: true }, false, 'revealed');
    setRun(base);
    // play the rest of the line out on the board
    let fen = run.fen;
    const remaining = run.puzzle.solution.slice(run.step);
    remaining.forEach((u, i) => {
      later(() => {
        const c = new Chess(fen);
        if (!uciMove(c, u)) return;
        fen = c.fen();
        setRun((r) => (r ? { ...r, fen, last: u } : r));
      }, 500 * (i + 1));
    });
  };

  const hint = (): void => {
    if (!run || run.status !== 'solving') return;
    setRun({ ...run, tainted: true, hint: Math.min(2, run.hint + 1) as 1 | 2 });
  };

  const expected = run && run.status === 'solving' ? run.puzzle.solution[run.step] : null;
  const marks: Record<string, MarkKind> = {};
  if (run && expected && run.hint >= 1) marks[expected.slice(0, 2)] = 'sel';
  const arrows = run && expected && run.hint >= 2 ? arrowsOf(arrowOf(expected, 'good')) : [];
  const seconds = run ? Math.floor(((run.finishedAt ?? Date.now()) - run.startedAt) / 1000) : 0;
  void tick;

  const startImport = async (): Promise<void> => {
    setImp({ busy: true, phase: 'Starting…', fraction: 0, count: 0, error: '' });
    const off = window.desktop!.puzzles.onProgress((p) => setImp((x) => ({ ...x, phase: p.phase, fraction: p.fraction || x.fraction, count: p.count || x.count })));
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

  const p = store.progress;
  const themes = useMemo(() => THEMES.filter((t) => store.rated.some((x) => x.themes.includes(t))), [store.rated]);
  const sol = run?.status === 'revealed' || run?.status === 'failed' ? pvSan(run.puzzle.fen, run.puzzle.solution, 6).join(' ') : '';

  return (
    <div className="dk-puzzles" data-testid="puzzles-page">
      <section className="dk-boardcol">
        <div className="player-bar">
          <b>{run ? `${solver === 'w' ? 'White' : 'Black'} to move` : 'Puzzles'}</b>
          {run && <span className="muted small">{run.puzzle.source === 'game' ? 'From one of your games' : `Puzzle rating ${run.puzzle.rating}`}</span>}
          <span className="grow" />
          <span className="pill">{Math.floor(seconds / 60)}:{String(seconds % 60).padStart(2, '0')}</span>
        </div>
        <div className="board-holder puzzle-board">
          {run ? (
            <Board
              fen={run.fen}
              orientation={solver}
              interactive={run.status === 'solving' && run.fen !== undefined && sideOf(run.fen) === solver}
              movableColor={solver}
              lastMove={run.last}
              marks={marks}
              arrows={arrows}
              onMove={onMove}
            />
          ) : (
            <div className="dk-card empty-puzzle">
              {mode === 'mine' ? (
                <>
                  <b>No puzzles from your games yet.</b>
                  <p className="small muted">Review a few games first. Every blunder, mistake or miss that has one clear answer becomes a puzzle here.</p>
                  <Link className="btn primary" to="/">Go to games</Link>
                </>
              ) : (
                <b>Loading puzzles…</b>
              )}
            </div>
          )}
        </div>
        {run && (
          <div className={`puzzle-banner ${run.feedback === 'wrong' ? 'bad' : run.status === 'solved' ? 'good' : run.status === 'solving' ? '' : 'bad'}`} data-testid="puzzle-banner" data-status={run.status}>
            {run.status === 'solving' && run.feedback === 'wrong' && <b>That is not the move. Try again.</b>}
            {run.status === 'solving' && run.feedback !== 'wrong' && <b>{run.step === 0 ? 'Find the best move.' : 'Good. Keep going.'}</b>}
            {run.status === 'solved' && <b>Puzzle solved!{run.delta ? ` ${run.delta > 0 ? '+' : ''}${run.delta}` : ''}</b>}
            {run.status === 'failed' && <b>Solved, but not cleanly.{run.delta ? ` ${run.delta}` : ''}</b>}
            {run.status === 'revealed' && <b>Solution: {sol}{run.delta ? `  (${run.delta})` : ''}</b>}
          </div>
        )}
        <div className="dk-controls">
          <button className="btn" onClick={hint} disabled={!run || run.status !== 'solving'} data-testid="hint">Hint</button>
          <button className="btn" onClick={showSolution} disabled={!run || run.status !== 'solving'} data-testid="solution">Solution</button>
          <span className="grow" />
          <button className="btn primary" onClick={() => load()} data-testid="next-puzzle">{run && run.status !== 'solving' ? 'Next puzzle' : 'Skip'}</button>
        </div>
      </section>

      <aside className="dk-side">
        <div className="dk-card stats-card">
          <div className="small muted">Your puzzle rating</div>
          <b className="big-rating" data-testid="puzzle-rating">{p.rating}</b>
          <div className="stat-row">
            <span>Solved <b>{p.solved}</b></span>
            <span>Failed <b>{p.failed}</b></span>
            <span>Streak <b>{p.streak}</b></span>
            <span>Best <b>{p.bestStreak}</b></span>
          </div>
        </div>

        <div className="seg dk-tabs">
          <button aria-pressed={mode === 'rated'} onClick={() => { setMode('rated'); load('rated', theme); }}>Rated</button>
          <button aria-pressed={mode === 'mine'} onClick={() => { setMode('mine'); load('mine', null); }}>My mistakes ({store.mine.length})</button>
        </div>

        {mode === 'rated' && (
          <div className="dk-card stack-s">
            <label className="lbl" htmlFor="theme">Theme</label>
            <select id="theme" value={theme ?? ''} onChange={(e) => { const t = e.target.value || null; setTheme(t); load('rated', t); }}>
              <option value="">Any theme</option>
              {themes.map((t) => <option key={t} value={t}>{THEME_NAMES[t] ?? t}</option>)}
            </select>
            <div className="small muted">
              {store.rated.length.toLocaleString()} puzzles ({store.lichessCount ? `${store.lichessCount.toLocaleString()} from Lichess` : 'beginner set only'}).
            </div>
          </div>
        )}

        {run?.puzzle.game && (
          <div className="dk-card small">
            <b>From your game vs {run.puzzle.game.opponent}</b>
            <div className="muted">Move {run.puzzle.game.moveNo} you played {run.puzzle.game.played}, which gave up about {Math.round(run.puzzle.game.loss * 100)}% of your winning chances.</div>
            {run.status !== 'solving' && <div>The best move was <b>{run.puzzle.game.best}</b>.</div>}
            <Link to={`/review/${run.puzzle.game.gameId}`}>Open the game review</Link>
          </div>
        )}
        {run && run.puzzle.themes.length > 0 && run.status !== 'solving' && (
          <div className="small muted">Themes: {run.puzzle.themes.map((t) => THEME_NAMES[t] ?? t).join(', ')}</div>
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
