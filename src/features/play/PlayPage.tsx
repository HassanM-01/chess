// Play vs bot with Blunder Check (ported from prototype Play).
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { categorize } from '@/analysis/categorize';
import { Chess, uciMove } from '@/chess/compat';
import { moveInfo, moveToUci } from '@/chess/helpers';
import { VAL, hangingPieces, parseFen, pieceName } from '@/chess/tactics';
import { colorName, otherColor, type Color, type Uci } from '@/chess/types';
import { Board, arrowOf, arrowsOf, type Arrow, type MarkKind } from '@/components/Board';
import { Pill, Segmented, Switch } from '@/components/ui';
import type { PosEval } from '@/engine/types';
import { wpFor } from '@/engine/winprob';
import { useRepo } from '@/state/auth';
import { engine, evalPos } from '@/state/engine';
import { dailyFor, useProfile, useProgressUpdater, useUpdateProfile } from '@/state/queries';
import { useSyncController } from '@/state/sync';
import { toast } from '@/state/toast';
import { localDateKey, sleep } from '@/lib/util';
import { LEVELS } from './levels';
import { boardOf, newPlayGame, usePlayStore } from './playStore';
import { saveBotGame } from './saveBotGame';

type Gate = 'idle' | 'checking' | 'blunder';

interface BlunderPrompt {
  text: string;
  /** the user's move, to take back or keep */
  uci: Uci;
}

export function PlayPage(): JSX.Element {
  const nav = useNavigate();
  const repo = useRepo();
  const controller = useSyncController();
  const [params, setParams] = useSearchParams();
  const { data: profile } = useProfile();
  const update = useUpdateProfile();
  const updateProgress = useProgressUpdater();
  const settings = profile?.settings ?? {};
  const username = profile?.chesscomUsername ?? 'You';

  const game = usePlayStore((s) => s.game);
  const setGame = usePlayStore((s) => s.set);
  const patchGame = usePlayStore((s) => s.patch);

  const [gate, setGate] = useState<Gate>('idle');
  const [status, setStatus] = useState('');
  const [panel, setPanel] = useState<{ tone: '' | 'good' | 'bad' | 'warn'; text: string } | null>(null);
  const [prompt, setPrompt] = useState<BlunderPrompt | null>(null);
  const [arrows, setArrows] = useState<Arrow[]>([]);
  const [marks, setMarks] = useState<Record<string, MarkKind>>({});
  const [flip, setFlip] = useState(false);
  const seq = useRef(0); // stale-async guard for the turn loop (spec 8.8)
  const checkSeq = useRef(0); // stale-async guard for Blunder Check
  const evBefore = useRef<{ fen: string; p: Promise<PosEval | null> } | null>(null);
  const blunderCheck = settings.blunderCheck !== false;

  const freshGame = useCallback(
    (o: { fen?: string; level?: number; color?: Color; moves?: Uci[] } = {}) => {
      const pref = settings.color ?? 'w';
      const me: Color = o.color ?? (pref === 'r' ? (Math.random() < 0.5 ? 'w' : 'b') : pref);
      seq.current++;
      checkSeq.current++;
      setGame(newPlayGame({ fen: o.fen, me, level: o.level ?? settings.level ?? 1, moves: o.moves }));
      setGate('idle');
      setPanel(null);
      setPrompt(null);
      setArrows([]);
      setMarks({});
      setFlip(false);
    },
    [settings.color, settings.level, setGame],
  );

  // Start a game on first visit, or from a lesson link (?fen=... K+Q lesson, ?check=1 Blunder Check lesson).
  useEffect(() => {
    const fen = params.get('fen');
    const check = params.get('check');
    const moves = params.get('moves');
    if (moves) {
      // Resume a game from a move list (?moves=e2e4,e7e5): also used by the e2e tests.
      const list = moves.split(',').filter(Boolean);
      const c = new Chess();
      if (list.every((u) => !!uciMove(c, u))) freshGame({ moves: list, color: 'w' });
      else freshGame();
      setParams({}, { replace: true });
    } else if (fen) {
      freshGame({ fen, level: 4, color: 'w' });
      setParams({}, { replace: true });
    } else if (check) {
      update.mutate({ settings: { blunderCheck: true } });
      freshGame();
      setParams({}, { replace: true });
    } else if (!usePlayStore.getState().game) {
      freshGame();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const chess = useMemo(() => (game ? boardOf(game) : null), [game]);
  const fen = chess?.fen() ?? '';
  const lastMove: Uci | null = game && game.moves.length ? game.moves[game.moves.length - 1] : null;

  // ---- game end
  useEffect(() => {
    if (!game || !chess || game.over || !chess.isGameOver()) return;
    let res: string;
    let title: string;
    let won = false;
    if (chess.isCheckmate()) {
      won = chess.turn() !== game.me;
      res = won === (game.me === 'w') ? '1-0' : '0-1';
      title = won ? 'Checkmate. You win!' : 'Checkmated.';
    } else {
      res = '1/2-1/2';
      title = chess.isStalemate() ? "Stalemate. It's a draw." : 'Draw.';
    }
    patchGame({ over: true, result: res, title });
    setStatus('Game over');
    void updateProgress((p) => ({
      play: { ...p.play, games: (p.play.games ?? 0) + 1, wins: (p.play.wins ?? 0) + (won ? 1 : 0) },
      daily: { ...dailyFor(p, localDateKey()), played: true },
    }));
  }, [game, chess, patchGame, updateProgress]);

  // ---- turn loop: the user's turn prepares Blunder Check, the bot's turn asks the engine
  useEffect(() => {
    if (!game || !chess || game.over || gate !== 'idle' || chess.isGameOver()) return;
    const my = ++seq.current;
    if (chess.turn() === game.me) {
      setStatus('Your move');
      evBefore.current = { fen, p: evalPos(fen, 10).catch(() => null) };
      return () => {
        seq.current++;
      };
    }
    setStatus('Bot is thinking…');
    void (async () => {
      await sleep(350);
      if (seq.current !== my) return;
      const lv = LEVELS[game.level];
      let u: Uci | null = null;
      if (Math.random() < lv.rand) {
        const ms = chess.moves({ verbose: true });
        const m = ms[Math.floor(Math.random() * ms.length)];
        u = m ? moveToUci(m) : null;
      } else {
        try {
          u = (await engine.run(fen, { depth: lv.depth, skill: lv.skill, priority: 'interactive' })).best;
        } catch {
          if (seq.current === my) setStatus('Engine unavailable');
          return;
        }
      }
      if (seq.current !== my || !u) return;
      const cur = usePlayStore.getState().game;
      if (!cur || boardOf(cur).fen() !== fen) return; // the position changed while the bot was thinking
      patchGame({ moves: [...cur.moves, u] });
    })();
    return () => {
      seq.current++;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fen, game?.id, game?.over, game?.level, game?.me, gate]);

  const onMove = useCallback(
    async (u: Uci): Promise<void> => {
      if (!game || !chess || game.over || chess.turn() !== game.me || gate !== 'idle') return;
      const f0 = fen;
      const c = new Chess(f0);
      const m = uciMove(c, u);
      if (!m) return;
      const f1 = c.fen();
      const my = ++checkSeq.current;
      setPanel(null);
      setArrows([]);
      setMarks({});
      patchGame({ moves: [...game.moves, u], started: true });
      if (!blunderCheck || game.custom || c.isGameOver()) return;
      setGate('checking');
      setStatus('Blunder Check…');
      const e0 = evBefore.current && evBefore.current.fen === f0 ? await evBefore.current.p : await evalPos(f0, 10).catch(() => null);
      const e1 = await evalPos(f1, 10).catch(() => null);
      if (checkSeq.current !== my) return;
      if (e0 && e1) {
        const drop = wpFor(e0, game.me) - wpFor(e1, game.me);
        if (drop >= 15 && wpFor(e0, game.me) > 8) {
          const cat = categorize(f0, f1, u, e0, e1, game.me);
          setGate('blunder');
          setStatus('Wait!');
          setPrompt({ uci: u, text: cat ? cat.text : `${m.san} gives away a lot. Look again.` });
          setArrows(arrowsOf(arrowOf(e1.best, 'bad')));
          return;
        }
      }
      setGate('idle');
    },
    [game, chess, gate, fen, blunderCheck, patchGame],
  );

  const takeBack = (): void => {
    if (!game) return;
    const cur = usePlayStore.getState().game;
    if (!cur) return;
    patchGame({ moves: cur.moves.slice(0, -1), caught: cur.caught + 1 });
    void updateProgress((p) => ({ play: { ...p.play, caught: (p.play.caught ?? 0) + 1 } }));
    setPrompt(null);
    setArrows([]);
    setPanel({ tone: 'good', text: 'Good catch. Find a safer move.' });
    setGate('idle');
  };
  const playAnyway = (): void => {
    setPrompt(null);
    setArrows([]);
    setGate('idle');
  };

  const hint = async (): Promise<void> => {
    if (!game || !chess || game.over || chess.turn() !== game.me || gate !== 'idle') return;
    setStatus('Thinking…');
    const hintFen = fen;
    const r = evBefore.current && evBefore.current.fen === fen ? await evBefore.current.p : await evalPos(fen, 10).catch(() => null);
    const cur = usePlayStore.getState().game;
    if (!cur || boardOf(cur).fen() !== hintFen) return; // the position changed while the engine was thinking
    setStatus('Your move');
    if (!r?.best) {
      toast('No hint available right now. Look for checks, captures and threats.');
      return;
    }
    const m = moveInfo(fen, r.best);
    if (!m) return;
    setMarks({ [r.best.slice(0, 2)]: 'good' });
    const threat = hangingPieces(parseFen(fen), game.me).filter((x) => VAL[x.piece.type] >= 3);
    setPanel({ tone: '', text: (threat.length ? `Careful: your ${pieceName(threat[0].piece.type)} on ${threat[0].square} is in danger. ` : '') + `Try moving your ${pieceName(m.piece)}.` });
  };

  const undo = (): void => {
    const cur = usePlayStore.getState().game;
    if (!cur || !cur.moves.length) {
      toast('Nothing to undo yet.');
      return;
    }
    const moves = cur.moves.slice();
    moves.pop();
    // the bot replied after the user's move: take back that reply too
    if (moves.length && boardOf({ ...cur, moves }).turn() !== cur.me) moves.pop();
    seq.current++;
    checkSeq.current++;
    patchGame({ moves, over: false, result: null, title: null });
    setGate('idle');
    setPanel(null);
    setPrompt(null);
    setArrows([]);
    setMarks({});
  };

  const saving = useRef(false);
  const review = async (): Promise<void> => {
    if (!game || !game.result || saving.current) return;
    saving.current = true;
    let row;
    try {
      row = await saveBotGame(repo, { source: 'bot', username, botName: `Bot (${LEVELS[game.level].name})`, userColor: game.me, fen0: game.fen0, moves: game.moves, result: game.result });
    } catch {
      saving.current = false;
      toast('Could not save the game. Try again.');
      return;
    }
    void controller.analyzePending(true);
    nav(`/games/${row.id}/walk`);
  };

  useEffect(() => {
    if (prompt || game?.over) document.querySelector('[data-testid=blunder-check],[data-testid=game-over]')?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }, [prompt, game?.over]);

  if (!game || !chess) return <div className="muted">Loading…</div>;

  const myTurn = chess.turn() === game.me && !game.over && gate === 'idle';
  const level = LEVELS[game.level];
  const orient = flip ? otherColor(game.me) : game.me;
  const won = game.title?.includes('win');
  const newGame = (): void => freshGame(game.custom ? { fen: game.fen0, color: game.me, level: game.level } : {});

  return (
    <div className="stack" data-testid="play">
      <h1 className="play-title">{game.custom ? 'Checkmate the lone king.' : 'Play the bot'}</h1>
      <div className="spread">
        <Pill tone="acc">{`You: ${colorName(game.me)} · ${level.name}`}</Pill>
        <span className="small muted" data-testid="status">
          {status}
        </span>
      </div>

      <Board
        fen={fen}
        orientation={orient}
        interactive={myTurn}
        movableColor={game.me}
        lastMove={lastMove}
        arrows={arrows}
        marks={marks}
        onMove={(u) => void onMove(u)}
        onBadTap={(sq) => {
          const p = chess.get(sq as never);
          toast(p ? `That's ${colorName(p.color)}'s piece. Tap one of your ${colorName(game.me).toLowerCase()} pieces.` : 'Tap one of your pieces first, then where it should go.');
        }}
        onIdleTap={() => {
          if (game.over) toast('The game is over. Tap New to play again.');
          else if (gate === 'blunder') toast('Choose Take it back or Play it anyway below.');
          else if (chess.turn() !== game.me) toast('Wait for the bot to move…');
        }}
      />

      {prompt ? (
        <div className="feedback bad stack-s" data-testid="blunder-check">
          <h3>Blunder Check: are you sure?</h3>
          <p className="small">{prompt.text}</p>
          <div className="row">
            <button className="btn primary" onClick={takeBack} data-testid="take-back">
              Take it back
            </button>
            <button className="btn" onClick={playAnyway} data-testid="play-anyway">
              Play it anyway
            </button>
          </div>
        </div>
      ) : game.over ? (
        <div className={`feedback ${won ? 'good' : 'warn'} stack-s`} data-testid="game-over">
          <h3>{game.title}</h3>
          {game.custom && chess.isStalemate() && <p className="small">Stalemate: the king had no legal move but wasn't in check. Leave it a square next time.</p>}
          <div className="row">
            {!game.custom && (
              <button className="btn primary" onClick={() => void review()}>
                Review this game
              </button>
            )}
            <button className="btn" onClick={newGame}>
              Play again
            </button>
          </div>
        </div>
      ) : panel ? (
        <div className={`feedback ${panel.tone}`}>
          <p className="small">{panel.text}</p>
        </div>
      ) : null}

      <div className="ctrl">
        <button className="btn" onClick={() => void hint()}>
          Hint
        </button>
        <button className="btn" onClick={undo}>
          Undo
        </button>
        <button className="btn" onClick={() => setFlip((f) => !f)}>
          Flip
        </button>
        <button className="btn" onClick={newGame} data-testid="new-game">
          New
        </button>
      </div>
      <div className="card stack" data-testid="play-settings">
      {!game.custom && (
        <div className="stack-s">
          <Segmented
            label="Bot level"
            value={game.level}
            options={LEVELS.map((l, i) => ({ value: i, label: l.name }))}
            onChange={(i) => {
              update.mutate({ settings: { level: i } });
              if (!game.started || game.over) freshGame({ level: i });
              else patchGame({ level: i });
            }}
          />
          <Segmented
            label="Your color"
            value={settings.color ?? 'w'}
            options={[
              { value: 'w', label: 'White' },
              { value: 'b', label: 'Black' },
              { value: 'r', label: 'Random' },
            ]}
            onChange={(c) => {
              update.mutate({ settings: { color: c } });
              if (!game.started || game.over) freshGame({ color: c === 'r' ? (Math.random() < 0.5 ? 'w' : 'b') : c });
            }}
          />
        </div>
      )}
      <div className="toggle">
        <div>
          <b>Blunder Check</b>
          <div className="small muted">Stops you when a move loses material and says why</div>
        </div>
        <Switch label="Blunder Check" checked={blunderCheck} onChange={(v) => update.mutate({ settings: { blunderCheck: v } })} />
      </div>
      </div>
      <p className="small muted">Blunders caught so far: {game.caught}. Each one is a piece you would have lost.</p>
    </div>
  );
}
