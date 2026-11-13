// Playing the computer with Stockfish at your shoulder. Every move you make is judged by the full-strength engine
// (the computer you are playing may be much weaker), you can be stopped before a bad move, and a "heads-up" panel
// points out loose pieces, threats and chances. The same screen runs opening drills, middlegame and endgame practice.
import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Chess, uciMove } from '@/chess/compat';
import { gameFens, moveInfo, moveToUci } from '@/chess/helpers';
import { pieceName } from '@/chess/tactics';
import { colorName, type Color, type Uci } from '@/chess/types';
import { parseGame } from '@/chesscom/parsePgn';
import { Board, arrowOf, arrowsOf, type Arrow, type MarkKind } from '@/components/Board';
import { bookName } from '@/review/book';
import { epWhite } from '@/review/expected';
import { explainBestMove } from '@/review/explain';
import { analysePos, judgeMove } from '@/review/judge';
import { PLAY_LEVELS, countMoves, countsText, endOf, goalResult, headsUp, shouldWarn } from '@/review/playCoach';
import { drillById } from '@/review/scenarios';
import type { MoveClass, PosAnalysis } from '@/review/types';
import { moveInWords } from '@/review/words';
import { getEngine } from '../lib/desktopEngine';
import { gameIdOf, useLibrary } from '../state/library';
import { boardOf, usePlay, type Session } from '../state/play';
import { useReviews } from '../state/reviews';
import { useSettings } from '../state/settings';
import { EvalBar } from '../ui/charts';
import { CLASS_META, ClassIcon, formatEval } from '../ui/classInfo';
import { LiveEngine, type LiveSnapshot } from '../ui/LiveEngine';
import { MoveVerdict } from '../ui/MoveVerdict';
import { NoteCard, type TryNote } from '../ui/Steps';

/** Same depth and time for the position before your move (fetched when it becomes your turn) and after it, so the cache is hit. */
const JUDGE = { depth: 18, movetimeMs: 1200 } as const;
const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));
const strip = (san: string): string => san.replace(/[+#!?]/g, '');

type Gate = 'idle' | 'checking' | 'blunder';

function sanToUci(fen: string, san: string): Uci | null {
  try {
    const c = new Chess(fen);
    return moveToUci(c.move(san));
  } catch {
    return null;
  }
}

function sansOf(s: Pick<Session, 'startFen' | 'moves'>): string[] {
  const c = new Chess(s.startFen);
  const out: string[] = [];
  for (const u of s.moves) {
    const m = uciMove(c, u);
    if (!m) break;
    out.push(m.san);
  }
  return out;
}

export function PlayGame(): JSX.Element | null {
  const nav = useNavigate();
  const s = usePlay((st) => st.session);
  const prefs = usePlay((st) => st.prefs);
  const username = useSettings((st) => st.chesscomUsername);

  const [gate, setGate] = useState<Gate>('idle');
  const [flip, setFlip] = useState(false);
  const [snap, setSnap] = useState<LiveSnapshot | null>(null);
  const [before, setBefore] = useState<{ fen: string; pos: PosAnalysis } | null>(null);
  const [hint, setHint] = useState<{ fen: string; level: 0 | 1 | 2; uci: Uci | null; first: string; text: string }>({ fen: '', level: 0, uci: null, first: '', text: '' });
  const [showBetter, setShowBetter] = useState(false);
  const [drillNote, setDrillNote] = useState<{ note: TryNote; uci: Uci } | null>(null);
  const [drillBusy, setDrillBusy] = useState<string | null>(null);
  const [engineProblem, setEngineProblem] = useState('');
  const seq = useRef(0);
  const sessionId = s?.id ?? 0;

  const chess = useMemo(() => (s ? boardOf(s) : null), [s?.startFen, s?.moves]); // eslint-disable-line react-hooks/exhaustive-deps
  const fen = chess?.fen() ?? '';
  const fens = useMemo(() => (s ? gameFens(s.startFen, s.moves) : []), [s?.startFen, s?.moves]); // eslint-disable-line react-hooks/exhaustive-deps
  const sans = useMemo(() => (s ? sansOf(s) : []), [s?.startFen, s?.moves]); // eslint-disable-line react-hooks/exhaustive-deps
  const drill = s?.drillId ? drillById(s.drillId) ?? null : null;
  const drillActive = !!s && !!drill && !s.over && s.moves.length < drill.moves.length;
  const myTurn = !!s && !!chess && !s.over && chess.turn() === s.me;

  // ---- the game ends
  useEffect(() => {
    if (!s || !chess || s.over) return;
    const end = endOf(chess, s.me);
    if (!end) return;
    usePlay.getState().patch({ over: true, end });
    if (s.scenarioId) usePlay.getState().recordResult(s.scenarioId, goalResult(s.goal, end.outcome).met);
  }, [chess, s]);

  // ---- finishing an opening line is remembered, so the menu can show which ones you know
  const finishedDrill = useRef('');
  useEffect(() => {
    if (!s || !drill || s.over || s.moves.length < drill.moves.length) return;
    const key = `${s.id}:${drill.id}`;
    if (finishedDrill.current === key) return;
    finishedDrill.current = key;
    usePlay.getState().recordResult(drill.id, true);
  }, [s, drill]);

  // ---- a new position: forget hints and notes, and start Stockfish on the position before your next move
  useEffect(() => {
    setSnap(null);
    setShowBetter(false);
    setHint({ fen, level: 0, uci: null, first: '', text: '' });
    setBefore(null);
    if (!s || s.over || !chess || chess.turn() !== s.me || drillActive || prefs.coach === 'off') return;
    let live = true;
    analysePos(getEngine(), fen, 3, JUDGE)
      .then((pos) => live && setBefore({ fen, pos }))
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, [fen, sessionId, drillActive, prefs.coach]); // eslint-disable-line react-hooks/exhaustive-deps

  // ---- the computer's turn (or the scripted reply in an opening drill)
  useEffect(() => {
    if (!s || !chess || s.over || gate !== 'idle' || chess.isGameOver() || chess.turn() === s.me) return;
    const my = ++seq.current;
    void (async () => {
      const cur0 = usePlay.getState().session;
      if (!cur0) return;
      let u: Uci | null = null;
      if (drillActive && drill) {
        await sleep(650);
        u = sanToUci(fen, drill.moves[cur0.moves.length].san);
      } else {
        await sleep(350);
        const lv = PLAY_LEVELS[cur0.level] ?? PLAY_LEVELS[1];
        if (Math.random() < lv.rand) {
          const ms = chess.moves({ verbose: true });
          const m = ms[Math.floor(Math.random() * ms.length)];
          u = m ? moveToUci(m) : null;
        } else {
          try {
            u = (await getEngine().run(fen, { depth: lv.depth, skill: lv.skill, movetimeMs: lv.movetimeMs, priority: 'interactive', interruptible: false })).best;
            setEngineProblem('');
          } catch (e) {
            if (seq.current === my) setEngineProblem(e instanceof Error ? e.message : 'The engine is not available.');
            return;
          }
        }
      }
      if (seq.current !== my || !u) return;
      const cur = usePlay.getState().session;
      if (!cur || cur.id !== cur0.id || boardOf(cur).fen() !== fen) return;
      usePlay.getState().patch({ moves: [...cur.moves, u] });
    })();
    return () => {
      seq.current++;
    };
  }, [fen, sessionId, s?.over, s?.level, gate, drillActive]); // eslint-disable-line react-hooks/exhaustive-deps

  // ---- derived things for the screen
  const heads = useMemo(() => (s && prefs.headsUp && myTurn && !drillActive ? headsUp(fen, s.me) : null), [fen, s?.me, prefs.headsUp, myTurn, drillActive]); // eslint-disable-line react-hooks/exhaustive-deps
  const opening = useMemo(() => {
    if (!s || s.startFen.split(' ')[0] !== fens[0]?.split(' ')[0] || s.kind === 'middlegame' || s.kind === 'endgame') return '';
    for (let i = fens.length - 1; i >= 1; i--) {
      const n = bookName(fens[i]);
      if (n) return n;
    }
    return '';
  }, [fens, s?.kind, s?.startFen]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!s || !chess) return null;
  const level = PLAY_LEVELS[s.level] ?? PLAY_LEVELS[1];
  const opp: Color = s.me === 'w' ? 'b' : 'w';
  const lastUci = s.moves.length ? s.moves[s.moves.length - 1] : null;
  const botNow = !s.over && !myTurn;
  const myVerdicts = Object.values(s.verdicts).filter((v) => v.ply < s.moves.length && s.moves[v.ply] === v.uci).sort((a, b) => b.ply - a.ply);
  const latest = myVerdicts[0];
  const counts = countMoves(myVerdicts.filter((v) => v.judgement).map((v) => v.judgement!.move.cls));
  const want = drillActive && drill ? drill.moves[s.moves.length] : null;
  const drillDone = !!drill && !s.over && s.moves.length >= drill.moves.length;
  const lastScripted = drill && s.moves.length > 0 && s.moves.length <= drill.moves.length ? drill.moves[s.moves.length - 1] : null;
  // in words, what the computer just did (only when it is your turn and the last move was theirs)
  const lastBotWords = !botNow && !s.over && lastUci && !drill && fens[s.moves.length - 1]?.split(' ')[1] !== s.me ? moveInWords(fens[s.moves.length - 1], lastUci, 'They') : '';

  // ---- evaluation bar: live engine if it has an answer, otherwise the quick look made when your turn started
  const top = snap?.lines[0];
  const cp = top ? { cp: top.cpWhite, mate: top.mateWhite } : before?.pos.lines[0] ? { cp: before.pos.lines[0].cp, mate: before.pos.lines[0].mate } : null;
  const evalLabel = cp ? formatEval(cp.cp, cp.mate) : '0.00';
  const evalEp = cp ? epWhite(cp) : 0.5;

  const status = s.over ? 'Game over' : gate === 'checking' ? 'Blunder Check…' : gate === 'blunder' ? 'Wait!' : drillBusy ? 'Checking…' : botNow ? (engineProblem ? 'Engine unavailable' : 'Computer is thinking…') : 'Your move';

  // ---- moves
  const reset = (): void => {
    seq.current++;
    setGate('idle');
    setDrillNote(null);
    setDrillBusy(null);
  };

  const playMove = async (u: Uci, leaveDrill = false): Promise<void> => {
    const st = usePlay.getState().session;
    if (!st) return;
    const c = boardOf(st);
    const f0 = c.fen();
    const probe = new Chess(f0);
    const mv = uciMove(probe, u);
    if (!mv) return;
    const ply = st.moves.length;
    setDrillNote(null);
    usePlay.getState().patch(leaveDrill ? { moves: [...st.moves, u], drillId: null } : { moves: [...st.moves, u] });
    const coachMode = usePlay.getState().prefs.coach;
    if (coachMode === 'off') return;
    usePlay.getState().setVerdict({ ply, san: mv.san, uci: u, status: 'checking', judgement: null });
    const warn = coachMode === 'warn' && !probe.isGameOver();
    if (warn) setGate('checking');
    let j: Awaited<ReturnType<typeof judgeMove>> = null;
    try {
      j = await judgeMove(getEngine(), f0, u, JUDGE);
    } catch {
      j = null;
    }
    const cur = usePlay.getState().session;
    if (!cur || cur.id !== st.id || cur.moves[ply] !== u) return; // taken back or a new game while Stockfish was looking
    usePlay.getState().setVerdict({ ply, san: mv.san, uci: u, status: j ? 'done' : 'unavailable', judgement: j });
    if (warn) setGate(j && shouldWarn(j.move.cls, usePlay.getState().prefs.strict) ? 'blunder' : 'idle');
  };

  const drillMove = async (u: Uci): Promise<void> => {
    const st = usePlay.getState().session;
    if (!st || !drill) return;
    const c = boardOf(st);
    const f0 = c.fen();
    const expected = drill.moves[st.moves.length];
    const mv = uciMove(new Chess(f0), u);
    if (!mv || !expected) return;
    if (strip(mv.san) === strip(expected.san)) {
      setDrillNote(null);
      usePlay.getState().patch({ moves: [...st.moves, u] });
      return;
    }
    setDrillBusy(mv.san);
    let j: Awaited<ReturnType<typeof judgeMove>> = null;
    try {
      j = await judgeMove(getEngine(), f0, u, JUDGE);
    } catch {
      j = null;
    }
    const cur = usePlay.getState().session;
    setDrillBusy(null);
    if (!cur || cur.id !== st.id || cur.moves.length !== st.moves.length) return;
    const lines = [`This line plays ${expected.san} here. ${expected.why}`];
    if (j) lines.push(j.good ? `Your ${mv.san} is not bad: Stockfish calls it ${CLASS_META[j.move.cls].label.toLowerCase()}. It is just not the move we are practising.` : (j.explanation ? [j.explanation.headline, ...j.explanation.what.slice(0, 1)].join(' ') : `${mv.san} is ${CLASS_META[j.move.cls].phrase}.`));
    setDrillNote({ uci: u, note: { tone: j?.good ? 'good' : 'bad', title: `${mv.san} is not the move in this line`, lines } });
  };

  const onMove = (u: Uci): void => {
    if (!myTurn || gate !== 'idle' || drillBusy) return;
    if (drillActive) void drillMove(u);
    else void playMove(u);
  };

  const takeBack = (): void => {
    const st = usePlay.getState().session;
    if (!st || !st.moves.length) return;
    const ply = st.moves.length - 1;
    const { [ply]: _gone, ...rest } = st.verdicts;
    usePlay.getState().patch({ moves: st.moves.slice(0, -1), verdicts: rest, caught: st.caught + 1 });
    reset();
  };

  const undo = (): void => {
    const st = usePlay.getState().session;
    if (!st || !st.moves.length || st.over) return;
    const moves = st.moves.slice(0, -1);
    // the computer replied to your move: take that back too
    if (moves.length && boardOf({ startFen: st.startFen, moves }).turn() !== st.me) moves.pop();
    const verdicts = Object.fromEntries(Object.entries(st.verdicts).filter(([p]) => +p < moves.length));
    usePlay.getState().patch({ moves, verdicts });
    reset();
  };

  const resign = (): void => {
    const st = usePlay.getState().session;
    if (!st || st.over) return;
    reset();
    usePlay.getState().patch({ over: true, end: { result: st.me === 'w' ? '0-1' : '1-0', outcome: 'loss', title: 'You resigned.' } });
    if (st.scenarioId) usePlay.getState().recordResult(st.scenarioId, false);
  };

  const again = (): void => {
    const st = usePlay.getState().session;
    if (!st) return;
    reset();
    setFlip(false);
    usePlay.getState().start({ kind: st.kind, title: st.title, tips: st.tips, goal: st.goal, scenarioId: st.scenarioId, fen: st.startFen, me: st.me, level: st.level, drillId: st.drillId ?? (drill?.id ?? null) });
  };

  /** First press: which piece to look at. Second press (or `full`): the move itself, with the reason. */
  const askHint = async (full = false): Promise<void> => {
    if (!myTurn || gate !== 'idle' || drillBusy) return;
    if (hint.fen === fen && hint.level === 1) {
      setHint({ ...hint, level: 2 });
      return;
    }
    if (hint.fen === fen && hint.level === 2) return;
    const level = full ? 2 : 1;
    if (want) {
      const u = sanToUci(fen, want.san);
      const m = moveInfo(fen, u);
      setHint({ fen, level, uci: u, first: m ? `Look at your ${pieceName(m.piece)} on ${m.from}.` : '', text: `The line plays ${want.san}. ${want.why}` });
      return;
    }
    let pos = before?.fen === fen ? before.pos : null;
    if (!pos) {
      try {
        pos = await analysePos(getEngine(), fen, 3, JUDGE);
      } catch {
        return;
      }
    }
    const cur = usePlay.getState().session;
    if (!cur || boardOf(cur).fen() !== fen) return;
    const u = pos.lines[0]?.pv[0] ?? null;
    const m = moveInfo(fen, u);
    if (!u || !m) return;
    setHint({ fen, level, uci: u, first: `Look at your ${pieceName(m.piece)} on ${m.from}.`, text: explainBestMove(fen, pos) || `${m.san} is Stockfish's choice.` });
  };

  const reviewGame = (): void => {
    const st = usePlay.getState().session;
    if (!st || !st.moves.length) return;
    const c = new Chess(st.startFen);
    for (const u of st.moves) uciMove(c, u);
    const me = username.trim() || 'You';
    const bot = `Stockfish (${level.name})`;
    const result = st.end?.result ?? '*';
    const winner = result === '1-0' ? (st.me === 'w' ? me : bot) : result === '0-1' ? (st.me === 'b' ? me : bot) : '';
    c.setHeader('Event', `Practice: ${st.title}`);
    c.setHeader('White', st.me === 'w' ? me : bot);
    c.setHeader('Black', st.me === 'b' ? me : bot);
    c.setHeader('Result', result);
    c.setHeader('Termination', winner ? `${winner} won by ${c.isCheckmate() ? 'checkmate' : 'resignation'}` : 'Game drawn');
    const game = parseGame(c.pgn(), { username: me, source: 'bot' });
    if (!game) return;
    game.externalId = `play_${st.id}_${Date.now()}`;
    game.playedAt = new Date().toISOString();
    game.userColor = st.me;
    const id = gameIdOf(game);
    useLibrary.getState().add([game]);
    usePlay.getState().patch({ savedGameId: id });
    useReviews.getState().enqueue(id);
    nav(`/review/${id}`);
  };

  // ---- what to draw on the board
  const marks: Record<string, MarkKind> = {};
  const arrows: Arrow[] = [];
  if (heads) {
    for (const d of heads.chances) if (d.square) marks[d.square] = 'good';
    for (const d of heads.dangers) if (d.square) marks[d.square] = 'bad';
  }
  if (hint.fen === fen && hint.level >= 1 && hint.uci) {
    if (hint.level === 1) marks[hint.uci.slice(0, 2)] = 'sel';
    else arrows.push(...arrowsOf(arrowOf(hint.uci, 'good')));
  }
  const prompt = gate === 'blunder' && latest?.judgement ? latest : null;
  if (prompt?.judgement) {
    const ex = prompt.judgement.explanation;
    if (ex?.punish) arrows.push(...arrowsOf(arrowOf(ex.punish, 'bad')));
    if (showBetter) arrows.push(...arrowsOf(arrowOf(prompt.judgement.move.bestUci, 'good')));
  }

  const orientation: Color = flip ? opp : s.me;
  const won = s.end?.outcome === 'win';
  const goal = s.end ? goalResult(s.goal, s.end.outcome) : null;
  const showLive = prefs.showEngine && myTurn && gate === 'idle' && !drillActive;
  const lastCls: MoveClass | null = latest?.judgement?.move.cls ?? null;

  return (
    <div className="dk-review" data-testid="play-game" data-over={s.over ? '1' : '0'}>
      <section className="dk-boardcol">
        <div className="player-bar">
          <b>Stockfish</b>
          <span className="muted small">{level.name}</span>
          <span className="grow" />
          <span className="pill" data-testid="play-status">{status}</span>
        </div>
        <div className="board-row">
          {prefs.showEngine && <EvalBar ep={evalEp} label={evalLabel} orientation={orientation} />}
          <div className="board-holder">
            <Board
              fen={fen}
              orientation={orientation}
              interactive={myTurn && gate === 'idle' && !drillBusy}
              movableColor={s.me}
              lastMove={lastUci}
              marks={marks}
              arrows={arrows}
              onMove={onMove}
            />
          </div>
        </div>
        <div className="player-bar">
          <b>{username.trim() || 'You'}</b>
          <span className="muted small">{colorName(s.me)}</span>
          <span className="grow" />
          {lastCls && <ClassIcon cls={lastCls} size={22} />}
        </div>
        <div className="dk-controls">
          <button className="btn" onClick={() => void askHint()} disabled={!myTurn || gate !== 'idle' || !!drillBusy || (hint.fen === fen && hint.level === 2)} data-testid="play-hint">
            {hint.fen === fen && hint.level === 1 ? 'More help' : 'Hint'}
          </button>
          <button className="btn" onClick={undo} disabled={!s.moves.length || s.over} data-testid="play-undo">Undo</button>
          <button className="btn" onClick={() => setFlip(!flip)}>Flip</button>
          <span className="grow" />
          {!s.over && <button className="btn" onClick={resign} data-testid="play-resign">Resign</button>}
          <button className="btn" onClick={() => usePlay.getState().close()} data-testid="play-leave">Back to menu</button>
        </div>
      </section>

      <aside className="dk-side">
        <div className="dk-card" data-testid="play-title">
          <b className="ex-headline">{s.title}</b>
          <div className="small muted">
            You play {colorName(s.me)} against {level.name}
            {opening ? ` · ${opening}` : ''}
          </div>
          {s.goal !== 'play' && (
            <div className="small">
              <b>Goal:</b> {s.goal === 'win' ? 'win this position' : 'hold the draw (a win is a bonus)'}
            </div>
          )}
          {engineProblem && <div className="err small">{engineProblem}</div>}
        </div>

        {s.over && s.end && (
          <div className={`dk-card note-card ${won || goal?.met ? 'good' : 'bad'}`} data-testid="game-over">
            <b>{s.end.title}</b>
            {s.goal !== 'play' || s.scenarioId ? <p className="small" data-testid="goal-result">{goal?.text}</p> : null}
            <p className="small">{countsText(counts)}{s.caught ? ` You took back ${s.caught} bad move${s.caught === 1 ? '' : 's'}: good catch.` : ''}</p>
            <div className="row">
              {s.moves.length >= 2 && <button className="btn primary" onClick={reviewGame} data-testid="review-game">Review this game</button>}
              <button className="btn" onClick={again} data-testid="play-again">Play again</button>
            </div>
          </div>
        )}

        {gate === 'checking' && !s.over && (
          <div className="dk-card" data-testid="blunder-checking">
            <div className="row">
              <div className="spinner tiny" aria-hidden="true" />
              <span className="small"><b>Blunder Check:</b> Stockfish is looking at your move before the computer replies…</span>
            </div>
          </div>
        )}

        {prompt?.judgement && !s.over && (
          <div className="dk-card note-card bad" data-testid="blunder-check">
            <b>Blunder Check: are you sure?</b>
            <p className="small">
              <b>{prompt.san}</b> is {CLASS_META[prompt.judgement.move.cls].phrase}. {prompt.judgement.explanation?.headline}
            </p>
            {prompt.judgement.explanation?.what.slice(0, 2).map((t, i) => <p key={i} className="small">{t}</p>)}
            {showBetter && prompt.judgement.explanation?.better && (
              <div className="ex-better">
                <b className="small">Why {prompt.judgement.move.bestSan} is better</b>
                <p className="small">{prompt.judgement.explanation.better}</p>
              </div>
            )}
            <div className="row">
              <button className="btn primary" onClick={takeBack} data-testid="take-back">Take it back</button>
              <button className="btn" onClick={() => setGate('idle')} data-testid="play-anyway">Keep it</button>
              {!showBetter && <button className="btn" onClick={() => setShowBetter(true)} data-testid="show-better">Show me a better move</button>}
            </div>
          </div>
        )}

        {drill && (
          <div className="dk-card" data-testid="drill-card">
            <b>Opening practice: {drill.opening}</b>
            <div className="progress"><i style={{ width: `${Math.round((Math.min(s.moves.length, drill.moves.length) / drill.moves.length) * 100)}%` }} /></div>
            <div className="small muted">Move {Math.min(s.moves.length + 1, drill.moves.length)} of {drill.moves.length}</div>
            {lastScripted && (
              <p className="small">
                <b>{lastScripted.by === s.me ? 'You played' : 'They played'} {drill.moves[s.moves.length - 1].san}.</b> {lastScripted.why}
              </p>
            )}
            {drillActive && myTurn && !drillNote && <p className="small">Find the next move of the line. Not sure? Press Hint.</p>}
            {drillBusy && <p className="small muted">Stockfish is checking {drillBusy}…</p>}
            {drillDone && (
              <>
                <div className="remember small" data-testid="drill-done">You finished the line. That is the plan you wanted to learn.</div>
                <div className="row">
                  <button className="btn primary" onClick={() => usePlay.getState().patch({ drillId: null })} data-testid="drill-play-on">Play on against the computer</button>
                  <button className="btn" onClick={again}>Do it again</button>
                </div>
              </>
            )}
          </div>
        )}
        {drillNote && (
          <>
            <NoteCard note={drillNote.note} />
            <div className="row">
              <button className="btn" onClick={() => void askHint(true)} disabled={hint.fen === fen && hint.level === 2} data-testid="drill-show-move">Show me the move</button>
              <button className="btn" onClick={() => { const u = drillNote.uci; setDrillNote(null); void playMove(u, true); }} data-testid="drill-anyway">Play mine anyway and keep going freely</button>
            </div>
          </>
        )}

        {hint.fen === fen && hint.level >= 1 && myTurn && (
          <div className="hint-card small" data-testid="play-hint-text">💡 {hint.level === 1 ? hint.first : hint.text}</div>
        )}

        {lastBotWords && (
          <div className="dk-card small" data-testid="bot-moved">
            <b>The computer just moved.</b> {lastBotWords}
          </div>
        )}

        {heads && (
          <div className="dk-card" data-testid="heads-up">
            <b>Look around</b>
            {heads.dangers.length === 0 && heads.chances.length === 0 && <p className="small muted">Nothing is hanging on either side. Think about improving your position.</p>}
            {heads.dangers.map((d, i) => <p key={`d${i}`} className="small heads danger">⚠️ {d.text}</p>)}
            {heads.chances.map((d, i) => <p key={`c${i}`} className="small heads chance">✅ {d.text}</p>)}
          </div>
        )}

        {latest && !prompt && gate !== 'checking' && <MoveVerdict verdict={latest} fenBefore={fens[latest.ply] ?? s.startFen} me={s.me} />}

        {prefs.showEngine && (
          <div className="dk-card">
            <b>Stockfish thinking</b>
            <LiveEngine fen={fen} enabled={showLive} lines={3} onSnapshot={setSnap} pausedText={drillActive ? 'Hidden while you practise the line.' : s.over ? 'The game is over.' : 'Stockfish waits while the computer moves.'} />
          </div>
        )}

        {s.tips.length > 0 && (
          <details className="dk-card small" open={!s.moves.length}>
            <summary><b>Ideas for this position</b></summary>
            <ul className="tips">
              {s.tips.map((t, i) => <li key={i}>{t}</li>)}
            </ul>
          </details>
        )}

        <div className="dk-card small" data-testid="play-moves">
          <b>Moves</b> <span className="muted">{countsText(counts)}</span>
          <div className="dk-movelist plain">
            {sans.length ? sans.map((san, i) => {
              const parts = (fens[i] ?? '').split(' ');
              const v = parts[1] === s.me ? s.verdicts[i] : undefined;
              const num = parts[1] === 'w' ? `${parts[5]}. ` : i === 0 ? `${parts[5]}... ` : '';
              return (
                <span key={i} className="pm">{num}{san}{v?.judgement ? <ClassIcon cls={v.judgement.move.cls} size={14} /> : null} </span>
              );
            }) : <span className="muted">Make your first move.</span>}
          </div>
        </div>

        <div className="dk-card stack-s" data-testid="play-quick-settings">
          <b>Blunder Check</b>
          <select value={prefs.coach} onChange={(e) => usePlay.getState().setPrefs({ coach: e.target.value as 'warn' | 'watch' | 'off' })} aria-label="Blunder Check mode" data-testid="coach-mode">
            <option value="warn">Stop me before a bad move</option>
            <option value="watch">Tell me after each move</option>
            <option value="off">Off (no hints from Stockfish)</option>
          </select>
          <label className="row small"><input type="checkbox" checked={prefs.strict} onChange={(e) => usePlay.getState().setPrefs({ strict: e.target.checked })} /> Stop me on small slips (inaccuracies) too</label>
          <label className="row small"><input type="checkbox" checked={prefs.headsUp} onChange={(e) => usePlay.getState().setPrefs({ headsUp: e.target.checked })} /> Point out what I might be missing</label>
          <label className="row small"><input type="checkbox" checked={prefs.showEngine} onChange={(e) => usePlay.getState().setPrefs({ showEngine: e.target.checked })} /> Show Stockfish thinking and the evaluation bar</label>
        </div>
      </aside>
    </div>
  );
}
