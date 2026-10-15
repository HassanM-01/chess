// Caro-Kann simulator: play Black against a bot that uses real anti-Caro-Kann setups, with a live coach.
// Same flow as the London simulator, from the other side of the board.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { categorize } from '@/analysis/categorize';
import { Chess, uciMove } from '@/chess/compat';
import { moveToUci, sanOf } from '@/chess/helpers';
import { parseFen } from '@/chess/tactics';
import type { Uci } from '@/chess/types';
import { Board, arrowOf, arrowsOf, type Arrow } from '@/components/Board';
import { Hero, Pill, Segmented, Switch } from '@/components/ui';
import type { PosEval } from '@/engine/types';
import { wpFor } from '@/engine/winprob';
import { saveBotGame } from '@/features/play/saveBotGame';
import { useRepo } from '@/state/auth';
import { engine, evalPos } from '@/state/engine';
import { dailyFor, useProfile, useProgressUpdater, useUpdateProfile } from '@/state/queries';
import { useSyncController } from '@/state/sync';
import { toast } from '@/state/toast';
import { localDateKey, sleep } from '@/lib/util';
import { caroAdvice } from './advice';
import type { Advice } from '@/features/london/advice';
import { caroBoard, newCaroGame, useCaroStore, type CaroGame } from './caroStore';
import { CARO_LEVELS, CARO_STEPS, panovShape } from './steps';

type Gate = 'idle' | 'blunder' | 'order' | 'checking';
type Tone = '' | 'good' | 'bad' | 'warn';

export function CaroPage(): JSX.Element {
  const nav = useNavigate();
  const [params, setParams] = useSearchParams();
  const repo = useRepo();
  const controller = useSyncController();
  const { data: profile } = useProfile();
  const update = useUpdateProfile();
  const updateProgress = useProgressUpdater();
  const settings = profile?.settings ?? {};
  const username = profile?.chesscomUsername ?? 'You';
  const guide = settings.caroGuide !== false;

  const game = useCaroStore((s) => s.game);
  const setGame = useCaroStore((s) => s.set);
  const patchGame = useCaroStore((s) => s.patch);

  const [gate, setGate] = useState<Gate>('idle');
  const [status, setStatus] = useState('');
  const [fb, setFb] = useState<{ tone: Tone; title: string; text: string } | null>(null);
  const [prompt, setPrompt] = useState<{ kind: 'blunder' | 'order'; text: string; arrow: Arrow | null } | null>(null);
  const [arrows, setArrows] = useState<Arrow[]>([]);
  const [flip, setFlip] = useState(false);
  const [showWhy, setShowWhy] = useState(false);
  const [ready, setReady] = useState(false); // coach finished looking at the position
  const turnSeq = useRef(0);
  const moveSeq = useRef(0);

  const freshGame = useCallback(
    (level?: number, moves?: Uci[]) => {
      turnSeq.current++;
      moveSeq.current++;
      setGame(newCaroGame(level ?? settings.caroLevel ?? 0, { moves }));
      setGate('idle');
      setFb(null);
      setPrompt(null);
      setArrows([]);
      setFlip(false);
      setShowWhy(false);
    },
    [settings.caroLevel, setGame],
  );

  useEffect(() => {
    const mv = params.get('moves');
    if (mv) {
      // Resume from a move list (?moves=e2e4,c7c6,...): also used by the e2e tests.
      const list = mv.split(',').filter(Boolean);
      const c = new Chess();
      if (list.every((u) => !!uciMove(c, u))) freshGame(undefined, list);
      else freshGame();
      setParams({}, { replace: true });
    } else if (!useCaroStore.getState().game) freshGame();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const chess = useMemo(() => (game ? caroBoard(game) : null), [game]);
  const fen = chess?.fen() ?? '';
  const board = useMemo(() => (fen ? parseFen(fen) : {}), [fen]);
  const lastUci: Uci | null = game && game.moves.length ? game.moves[game.moves.length - 1] : null;

  // ---- game end
  useEffect(() => {
    if (!game || !chess || game.over || !chess.isGameOver()) return;
    let res = '1/2-1/2';
    let title = 'Draw.';
    if (chess.isCheckmate()) {
      const won = chess.turn() === 'w';
      res = won ? '0-1' : '1-0';
      title = won ? 'Checkmate. You win with the Caro-Kann!' : 'Checkmated.';
    }
    patchGame({ over: true, result: res, title });
    setStatus('Game over');
    setArrows([]);
    void updateProgress((p) => {
      const l = (p.play as { caro?: { games?: number; wins?: number } }).caro ?? {};
      return { play: { ...p.play, caro: { games: (l.games ?? 0) + 1, wins: (l.wins ?? 0) + (res === '0-1' ? 1 : 0) } }, daily: { ...dailyFor(p, localDateKey()), played: true } };
    });
  }, [game, chess, patchGame, updateProgress]);

  // ---- White's move: the next plan move (of the next two) if it is within 18 win% of the engine's best, otherwise the engine at the chosen level.
  const botMove = useCallback(
    async (g: CaroGame, c: Chess): Promise<{ uci: Uci; book: string | null } | null> => {
      const f = c.fen();
      const lv = CARO_LEVELS[g.level];
      const whiteMoves = Math.floor(g.moves.length / 2);
      if (whiteMoves < 10) {
        const legal = c.moves({ verbose: true });
        let base: PosEval | null = null;
        for (const s of g.plan.moves.filter((x) => !g.used.includes(x)).slice(0, 2)) {
          const m = legal.find((x) => x.san.replace(/[+#]/g, '') === s);
          if (!m) continue;
          try {
            base = base ?? (await engine.run(f, { depth: 8, priority: 'interactive' }));
            const c2 = new Chess(f);
            c2.move(m.san);
            const e = await evalPos(c2.fen(), 8);
            if (wpFor(e, 'w') >= wpFor(base, 'w') - 18) return { uci: moveToUci(m), book: s };
          } catch {
            break;
          }
        }
      }
      if (Math.random() < lv.rand) {
        const ms = c.moves({ verbose: true });
        const m = ms[Math.floor(Math.random() * ms.length)];
        return m ? { uci: moveToUci(m), book: null } : null;
      }
      try {
        const r = await engine.run(f, { depth: lv.depth, skill: lv.skill, priority: 'interactive' });
        return r.best ? { uci: r.best, book: null } : null;
      } catch {
        setStatus('Engine unavailable');
        return null;
      }
    },
    [],
  );

  // ---- turn loop
  useEffect(() => {
    if (!game || !chess || game.over || gate !== 'idle' || chess.isGameOver()) return;
    const my = ++turnSeq.current;
    if (chess.turn() === 'b') {
      setStatus('Coach is looking…');
      setReady(false);
      const hist = chess.history({ verbose: true });
      const lastMove = hist.length ? hist[hist.length - 1] : null;
      void (async () => {
        let a: Advice | null = null;
        try {
          a = await caroAdvice(fen, evalPos, { lastMove });
        } catch {
          a = null;
        }
        if (turnSeq.current !== my) return;
        patchGame({ adv: a, advFen: fen });
        setStatus('Your move');
        setShowWhy(false);
        setReady(true);
      })();
    } else {
      setStatus('White is thinking…');
      setArrows([]);
      void (async () => {
        await sleep(400);
        if (turnSeq.current !== my) return;
        const cur = useCaroStore.getState().game;
        if (!cur) return;
        const r = await botMove(cur, caroBoard(cur));
        if (turnSeq.current !== my || !r) return;
        const latest = useCaroStore.getState().game;
        if (!latest || caroBoard(latest).fen() !== fen) return;
        patchGame({ moves: [...latest.moves, r.uci], used: r.book ? [...latest.used, r.book] : latest.used });
      })();
    }
    return () => {
      turnSeq.current++;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fen, game?.id, game?.over, gate]);

  const advice = game && game.advFen === fen ? game.adv : null;
  // Show the coach arrow whenever advice is ready and the guide is on.
  useEffect(() => {
    if (!game || game.over || gate !== 'idle' || chess?.turn() !== 'b') return;
    setArrows(guide && advice?.uci ? arrowsOf(arrowOf(advice.uci, 'good')) : []);
  }, [advice, guide, gate, game, chess]);

  const say = (tone: Tone, title: string, text: string): void => setFb({ tone, title, text });

  const onMove = useCallback(
    async (u: Uci): Promise<void> => {
      if (!game || !chess || game.over || chess.turn() !== 'b' || gate !== 'idle' || !ready) return;
      const f0 = fen;
      const a = advice;
      const c = new Chess(f0);
      const m = uciMove(c, u);
      if (!m) return;
      const f1 = c.fen();
      const my = ++moveSeq.current;
      turnSeq.current++;
      setArrows([]);
      setFb(null);
      const followed = !!a?.uci && a.uci.slice(0, 4) === u.slice(0, 4);
      patchGame({ moves: [...game.moves, u], score: { caro: game.score.caro + (followed ? 1 : 0), total: game.score.total + 1 } });
      if (followed) {
        say('good', `✓ ${m.san}`, a?.kind === 'setup' ? 'Right on plan.' : 'Exactly what the coach wanted.');
        return;
      }
      setGate('checking');
      setStatus('Checking your move…');
      let e0: PosEval | null = null;
      let e1: PosEval | null = null;
      try {
        e0 = await evalPos(f0, 10);
        e1 = await evalPos(f1, 10);
      } catch {
        /* engine unavailable: skip the check */
      }
      if (moveSeq.current !== my) return;
      const drop = e0 && e1 ? wpFor(e0, 'b') - wpFor(e1, 'b') : 0;
      const b0 = parseFen(f0);
      // Blunder Check: pause when the move drops win% by 15 or more.
      if (drop >= 15 && e0 && e1 && wpFor(e0, 'b') > 8) {
        const cat = categorize(f0, f1, u, e0, e1, 'b');
        setArrows(arrowsOf(arrowOf(e1.best, 'bad')));
        setStatus('Wait!');
        setPrompt({ kind: 'blunder', text: cat ? cat.text : `${m.san} gives away a lot.`, arrow: arrowOf(e1.best, 'bad') });
        setGate('blunder');
        return;
      }
      // Move-order warning: ...e6 while the c8 bishop is still home and ...Bf5 is legal.
      const bf5Legal = new Chess(f0).moves({ verbose: true }).some((x) => x.from === 'c8' && x.to === 'f5');
      if (u.startsWith('e7e6') && b0.c8 && b0.c8.type === 'b' && b0.c8.color === 'b' && bf5Legal && !panovShape(b0)) {
        setStatus('Move order');
        setPrompt({
          kind: 'order',
          text: '...e6 before ...Bf5 locks your light-squared bishop behind your own pawns, and that bishop is the reason you chose the Caro-Kann. Play ...Bf5 first, then ...e6.',
          arrow: null,
        });
        setGate('order');
        return;
      }
      if (a && a.kind === 'setup') say('', `${m.san}: playable`, `Not a mistake. The Caro-Kann move was ${sanOf(f0, a.uci)}: ${CARO_STEPS.find((s) => s.san === a.step)?.why ?? ''}`);
      else if (a && (a.kind === 'answer' || a.kind === 'danger' || a.kind === 'tactic' || a.kind === 'recapture'))
        say(drop >= 7 ? 'warn' : '', `${m.san}: ${drop >= 7 ? 'not the best' : 'OK'}`, `The coach wanted ${sanOf(f0, a.uci)}. ${a.title}.`);
      else say('', m.san, drop >= 7 ? `A bit loose. ${a ? sanOf(f0, a.uci) + ' was stronger.' : ''}` : 'Fine move.');
      setGate('idle');
    },
    [game, chess, gate, fen, advice, ready, patchGame],
  );

  const takeBack = (): void => {
    const cur = useCaroStore.getState().game;
    if (!cur) return;
    moveSeq.current++;
    patchGame({ moves: cur.moves.slice(0, -1), score: { ...cur.score, total: Math.max(0, cur.score.total - 1) } });
    setPrompt(null);
    setFb(null);
    setArrows([]);
    setGate('idle');
  };
  const keepMove = (): void => {
    setPrompt(null);
    setArrows([]);
    setGate('idle');
  };

  const undo = (): void => {
    const cur = useCaroStore.getState().game;
    if (!cur || cur.moves.length < 3) {
      toast('Nothing to undo yet.');
      return;
    }
    const moves = cur.moves.slice(0, -1);
    if (caroBoard({ ...cur, moves }).turn() !== 'b') moves.pop();
    turnSeq.current++;
    moveSeq.current++;
    patchGame({ moves, over: false, result: null, title: null, adv: null, advFen: null });
    setFb(null);
    setPrompt(null);
    setArrows([]);
    setGate('idle');
  };

  const saving = useRef(false);
  const review = async (): Promise<void> => {
    if (!game?.result || saving.current) return;
    saving.current = true;
    let row;
    try {
      row = await saveBotGame(repo, {
        source: 'bot',
        event: 'Caro-Kann practice',
        username,
        botName: `Caro-Kann bot (${CARO_LEVELS[game.level].name})`,
        userColor: 'b',
        fen0: new Chess().fen(),
        moves: game.moves,
        result: game.result,
        opening: `Caro-Kann vs ${game.plan.name}`,
      });
    } catch {
      saving.current = false;
      toast('Could not save the game. Try again.');
      return;
    }
    void controller.analyzePending(true);
    nav(`/games/${row.id}/walk`);
  };

  useEffect(() => {
    if (prompt || game?.over) document.querySelector('[data-testid=caro-prompt],[data-testid=caro-over]')?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }, [prompt, game?.over]);

  if (!game || !chess) return <div className="muted">Loading…</div>;

  const myTurn = chess.turn() === 'b' && !game.over && gate === 'idle' && ready;
  const showAdvice = !!advice && myTurn;
  const adviceTone: Tone = advice ? ({ danger: 'bad', tactic: 'good', careful: 'warn', answer: 'warn', recapture: 'warn', setup: '', plan: '' } as Record<string, Tone>)[advice.kind] ?? '' : '';
  const chips = CARO_STEPS.map((st) => ({ san: st.san, done: st.done(board) }));
  const reveal = guide || showWhy;

  return (
    <div className="stack" data-testid="caro">
      <Hero eyebrow="Caro-Kann Defence" title="Play the Caro-Kann. Your coach guides every move." />
      <Segmented
        label="Opponent level"
        value={game.level}
        options={CARO_LEVELS.map((l, i) => ({ value: i, label: l.name }))}
        onChange={(i) => {
          update.mutate({ settings: { caroLevel: i } });
          if (game.moves.length <= 2 || game.over) freshGame(i);
          else patchGame({ level: i });
        }}
      />
      <div className="toggle">
        <div>
          <b>Show the coach's move</b>
          <div className="small muted">Green arrow on the board. Turn off to test yourself.</div>
        </div>
        <Switch label="Show coach arrow" checked={guide} onChange={(v) => update.mutate({ settings: { caroGuide: v } })} />
      </div>
      <div className="lchips" data-testid="caro-chips">
        <span className="small muted" style={{ width: '100%' }}>
          Your setup
        </span>
        {chips.map((c) => (
          <span key={c.san} className={`lchip${c.done ? ' done' : ''}`}>
            {(c.done ? '✓ ' : '') + '…' + c.san}
          </span>
        ))}
      </div>
      <div className="spread">
        <Pill tone="acc">{`You: Black · ${CARO_LEVELS[game.level].name}`}</Pill>
        <span className="small muted" data-testid="status">
          {status}
        </span>
      </div>

      <Board
        fen={fen}
        orientation={flip ? 'w' : 'b'}
        interactive={myTurn}
        movableColor="b"
        lastMove={lastUci}
        arrows={arrows}
        onMove={(u) => void onMove(u)}
        onBadTap={(sq) => {
          const p = chess.get(sq as never);
          toast(p ? "That's White's piece. Tap one of your black pieces." : 'Tap one of your black pieces first, then where it should go.');
        }}
        onIdleTap={() => {
          if (!game.over && chess.turn() === 'w') toast('White is thinking…');
          else if (gate === 'blunder' || gate === 'order') toast('Choose Take it back or keep your move below.');
          else if (!game.over && !myTurn) toast('The coach is looking at the position…');
        }}
      />

      {showAdvice && advice && (
        <div className={`feedback ${adviceTone} stack-s`} data-testid="coach-advice" data-kind={advice.kind}>
          <div className="eyebrow">Coach</div>
          <h3 data-testid="advice-title">
            {reveal ? advice.title : advice.kind === 'setup' ? "Your move. What's next in the setup?" : advice.kind === 'plan' ? 'Your move. Setup is done, find a plan.' : 'Your move. Something important is happening.'}
          </h3>
          {reveal ? <p className="small" data-testid="advice-text">{advice.text}</p> : <p className="small muted">Tap “Why?” if you get stuck.</p>}
        </div>
      )}

      {prompt ? (
        <div className={`feedback ${prompt.kind === 'blunder' ? 'bad' : 'warn'} stack-s`} data-testid="caro-prompt">
          <h3>{prompt.kind === 'blunder' ? 'Blunder Check: are you sure?' : 'Move order: bishop first!'}</h3>
          <p className="small">{prompt.text}</p>
          <div className="row">
            <button className="btn primary" onClick={takeBack} data-testid="take-back">
              Take it back
            </button>
            <button className="btn" onClick={keepMove} data-testid="keep-move">
              {prompt.kind === 'blunder' ? 'Play it anyway' : 'Keep it'}
            </button>
          </div>
        </div>
      ) : game.over ? (
        <div className={`feedback ${game.result === '0-1' ? 'good' : 'warn'} stack-s`} data-testid="caro-over">
          <h3>{game.title}</h3>
          <p className="small">{`White played the "${game.plan.name}" setup. You matched the coach on ${game.score.caro} of ${game.score.total} moves.`}</p>
          <div className="row">
            <button className="btn primary" onClick={() => void review()}>
              Walk through this game
            </button>
            <button className="btn" onClick={() => freshGame()}>
              Play again
            </button>
          </div>
        </div>
      ) : fb ? (
        <div className={`feedback ${fb.tone}`}>
          <h3>{fb.title}</h3>
          <p className="small">{fb.text}</p>
        </div>
      ) : null}

      <div className="ctrl">
        <button
          className="btn"
          onClick={() => {
            if (!advice || !myTurn) return;
            setShowWhy(true);
            setArrows(arrowsOf(arrowOf(advice.uci, 'good')));
          }}
          data-testid="why"
        >
          Why?
        </button>
        <button className="btn" onClick={undo}>
          Undo
        </button>
        <button className="btn" onClick={() => setFlip((f) => !f)}>
          Flip
        </button>
        <button className="btn" onClick={() => freshGame()} data-testid="new-game">
          New
        </button>
      </div>
    </div>
  );
}
