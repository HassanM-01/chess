// London System simulator (ported from prototype London): play White against a bot that uses real anti-London setups,
// with a live coach.
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
import { londonAdvice, type Advice } from './advice';
import { londonBoard, newLondonGame, useLondonStore, type LondonGame } from './londonStore';
import { LONDON_LEVELS, LONDON_STEPS } from './steps';

type Gate = 'idle' | 'blunder' | 'order' | 'checking';
type Tone = '' | 'good' | 'bad' | 'warn';

export function LondonPage(): JSX.Element {
  const nav = useNavigate();
  const [params, setParams] = useSearchParams();
  const repo = useRepo();
  const controller = useSyncController();
  const { data: profile } = useProfile();
  const update = useUpdateProfile();
  const updateProgress = useProgressUpdater();
  const settings = profile?.settings ?? {};
  const username = profile?.chesscomUsername ?? 'You';
  const guide = settings.londonGuide !== false;

  const game = useLondonStore((s) => s.game);
  const setGame = useLondonStore((s) => s.set);
  const patchGame = useLondonStore((s) => s.patch);

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
      setGame(newLondonGame(level ?? settings.londonLevel ?? 0, { moves }));
      setGate('idle');
      setFb(null);
      setPrompt(null);
      setArrows([]);
      setFlip(false);
      setShowWhy(false);
    },
    [settings.londonLevel, setGame],
  );

  useEffect(() => {
    const mv = params.get('moves');
    if (mv) {
      // Resume from a move list (?moves=d2d4,d7d5,...): also used by the e2e tests.
      const list = mv.split(',').filter(Boolean);
      const c = new Chess();
      if (list.every((u) => !!uciMove(c, u))) freshGame(undefined, list);
      else freshGame();
      setParams({}, { replace: true });
    } else if (!useLondonStore.getState().game) freshGame();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const chess = useMemo(() => (game ? londonBoard(game) : null), [game]);
  const fen = chess?.fen() ?? '';
  const board = useMemo(() => (fen ? parseFen(fen) : {}), [fen]);
  const lastUci: Uci | null = game && game.moves.length ? game.moves[game.moves.length - 1] : null;

  // ---- game end
  useEffect(() => {
    if (!game || !chess || game.over || !chess.isGameOver()) return;
    let res = '1/2-1/2';
    let title = 'Draw.';
    if (chess.isCheckmate()) {
      const won = chess.turn() === 'b';
      res = won ? '1-0' : '0-1';
      title = won ? 'Checkmate. You win with the London!' : 'Checkmated.';
    }
    patchGame({ over: true, result: res, title });
    setStatus('Game over');
    setArrows([]);
    void updateProgress((p) => {
      const l = p.play.london ?? {};
      return { play: { ...p.play, london: { games: (l.games ?? 0) + 1, wins: (l.wins ?? 0) + (res === '1-0' ? 1 : 0) } }, daily: { ...dailyFor(p, localDateKey()), played: true } };
    });
  }, [game, chess, patchGame, updateProgress]);

  // ---- Black's move: a plan move if it is within 18 win% of the engine's best, otherwise the engine at the chosen level.
  const botMove = useCallback(
    async (g: LondonGame, c: Chess): Promise<{ uci: Uci; book: string | null } | null> => {
      const f = c.fen();
      const lv = LONDON_LEVELS[g.level];
      const blackMoves = Math.floor(g.moves.length / 2);
      if (blackMoves < 10) {
        const legal = c.moves({ verbose: true });
        let base: PosEval | null = null;
        for (const s of g.plan.moves) {
          if (g.used.includes(s)) continue;
          const m = legal.find((x) => x.san.replace(/[+#]/g, '') === s);
          if (!m) continue;
          try {
            base = base ?? (await engine.run(f, { depth: 8, priority: 'interactive' }));
            const c2 = new Chess(f);
            c2.move(m.san);
            const e = await evalPos(c2.fen(), 8);
            if (wpFor(e, 'b') >= wpFor(base, 'b') - 18) return { uci: moveToUci(m), book: s };
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
    if (chess.turn() === 'w') {
      setStatus('Coach is looking…');
      setReady(false);
      const hist = chess.history({ verbose: true });
      const lastMove = hist.length ? hist[hist.length - 1] : null;
      void (async () => {
        let a: Advice | null = null;
        try {
          a = await londonAdvice(fen, evalPos, { lastMove });
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
      setStatus('Black is thinking…');
      setArrows([]);
      void (async () => {
        await sleep(400);
        if (turnSeq.current !== my) return;
        const cur = useLondonStore.getState().game;
        if (!cur) return;
        const r = await botMove(cur, londonBoard(cur));
        if (turnSeq.current !== my || !r) return;
        const latest = useLondonStore.getState().game;
        if (!latest || londonBoard(latest).fen() !== fen) return;
        patchGame({ moves: [...latest.moves, r.uci], used: r.book ? [...latest.used, r.book] : latest.used });
      })();
    }
    return () => {
      turnSeq.current++;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fen, game?.over, gate]);

  const advice = game && game.advFen === fen ? game.adv : null;
  // Show the coach arrow whenever advice is ready and the guide is on.
  useEffect(() => {
    if (!game || game.over || gate !== 'idle' || chess?.turn() !== 'w') return;
    setArrows(guide && advice?.uci ? arrowsOf(arrowOf(advice.uci, 'good')) : []);
  }, [advice, guide, gate, game, chess]);

  const say = (tone: Tone, title: string, text: string): void => setFb({ tone, title, text });

  const onMove = useCallback(
    async (u: Uci): Promise<void> => {
      if (!game || !chess || game.over || chess.turn() !== 'w' || gate !== 'idle' || !ready) return;
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
      patchGame({ moves: [...game.moves, u], score: { london: game.score.london + (followed ? 1 : 0), total: game.score.total + 1 } });
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
      const drop = e0 && e1 ? wpFor(e0, 'w') - wpFor(e1, 'w') : 0;
      const b0 = parseFen(f0);
      // Blunder Check: pause when the move drops win% by 15 or more.
      if (drop >= 15 && e0 && e1 && wpFor(e0, 'w') > 8) {
        const cat = categorize(f0, f1, u, e0, e1, 'w');
        setArrows(arrowsOf(arrowOf(e1.best, 'bad')));
        setStatus('Wait!');
        setPrompt({ kind: 'blunder', text: cat ? cat.text : `${m.san} gives away a lot.`, arrow: arrowOf(e1.best, 'bad') });
        setGate('blunder');
        return;
      }
      // Move-order warning: e3 while the c1 bishop is still home and Bf4 is legal.
      const bf4Legal = new Chess(f0).moves({ verbose: true }).some((x) => x.from === 'c1' && x.to === 'f4');
      if (u.startsWith('e2e3') && b0.c1 && b0.c1.type === 'b' && bf4Legal) {
        setStatus('Move order');
        setPrompt({
          kind: 'order',
          text: "e3 before Bf4 locks your dark-squared bishop behind your pawns. That's the mistake from your 1. d4 d5 2. e3 games. In the London, play Bf4 first, then e3.",
          arrow: null,
        });
        setGate('order');
        return;
      }
      if (u.startsWith('b1c3')) say('', `${m.san}: playable`, 'In the London the knight usually goes to d2 instead, so your c-pawn can go to c3 and finish the pawn triangle.');
      else if (a && a.kind === 'setup') say('', `${m.san}: playable`, `Not a mistake. The London move was ${sanOf(f0, a.uci)}: ${LONDON_STEPS.find((s) => s.san === a.step)?.why ?? ''}`);
      else if (a && (a.kind === 'answer' || a.kind === 'danger' || a.kind === 'tactic' || a.kind === 'recapture'))
        say(drop >= 7 ? 'warn' : '', `${m.san}: ${drop >= 7 ? 'not the best' : 'OK'}`, `The coach wanted ${sanOf(f0, a.uci)}. ${a.title}.`);
      else say('', m.san, drop >= 7 ? `A bit loose. ${a ? sanOf(f0, a.uci) + ' was stronger.' : ''}` : 'Fine move.');
      setGate('idle');
    },
    [game, chess, gate, fen, advice, ready, patchGame],
  );

  const takeBack = (): void => {
    const cur = useLondonStore.getState().game;
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
    const cur = useLondonStore.getState().game;
    if (!cur || cur.moves.length < 2) return;
    const moves = cur.moves.slice(0, -1);
    if (londonBoard({ ...cur, moves }).turn() !== 'w') moves.pop();
    turnSeq.current++;
    moveSeq.current++;
    patchGame({ moves, over: false, result: null, title: null, adv: null, advFen: null });
    setFb(null);
    setPrompt(null);
    setArrows([]);
    setGate('idle');
  };

  const review = async (): Promise<void> => {
    if (!game?.result) return;
    const row = await saveBotGame(repo, {
      source: 'london',
      username,
      botName: `London bot (${LONDON_LEVELS[game.level].name})`,
      userColor: 'w',
      fen0: new Chess().fen(),
      moves: game.moves,
      result: game.result,
      opening: `London System vs ${game.plan.name}`,
    });
    void controller.analyzePending(true);
    nav(`/games/${row.id}/walk`);
  };

  if (!game || !chess) return <div className="muted">Loading…</div>;

  const myTurn = chess.turn() === 'w' && !game.over && gate === 'idle' && ready;
  const showAdvice = !!advice && myTurn;
  const adviceTone: Tone = advice ? ({ danger: 'bad', tactic: 'good', careful: 'warn', answer: 'warn', recapture: 'warn', setup: '', plan: '' } as Record<string, Tone>)[advice.kind] ?? '' : '';
  const chips = LONDON_STEPS.map((st) => ({ san: st.san, done: st.done(board) }));
  const reveal = guide || showWhy;

  return (
    <div className="stack" data-testid="london">
      <Hero eyebrow="London System" title="Play the London. Your coach guides every move." />
      <Segmented
        label="Opponent level"
        value={game.level}
        options={LONDON_LEVELS.map((l, i) => ({ value: i, label: l.name }))}
        onChange={(i) => {
          update.mutate({ settings: { londonLevel: i } });
          if (game.moves.length <= 1 || game.over) freshGame(i);
          else patchGame({ level: i });
        }}
      />
      <div className="toggle">
        <div>
          <b>Show the coach's move</b>
          <div className="small muted">Green arrow on the board. Turn off to test yourself.</div>
        </div>
        <Switch label="Show coach arrow" checked={guide} onChange={(v) => update.mutate({ settings: { londonGuide: v } })} />
      </div>
      <div className="lchips" data-testid="london-chips">
        <span className="small muted" style={{ width: '100%' }}>
          Your setup
        </span>
        {chips.map((c) => (
          <span key={c.san} className={`lchip${c.done ? ' done' : ''}`}>
            {(c.done ? '✓ ' : '') + c.san}
          </span>
        ))}
      </div>
      <div className="spread">
        <Pill tone="acc">{`You: White · ${LONDON_LEVELS[game.level].name}`}</Pill>
        <span className="small muted" data-testid="status">
          {status}
        </span>
      </div>

      <Board
        fen={fen}
        orientation={flip ? 'b' : 'w'}
        interactive={myTurn}
        movableColor="w"
        lastMove={lastUci}
        arrows={arrows}
        onMove={(u) => void onMove(u)}
        onBadTap={(sq) => {
          const p = chess.get(sq as never);
          toast(p ? "That's Black's piece. Tap one of your white pieces." : 'Tap one of your white pieces first, then where it should go.');
        }}
        onIdleTap={() => {
          if (!game.over && chess.turn() === 'b') toast('Black is thinking…');
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
        <div className={`feedback ${prompt.kind === 'blunder' ? 'bad' : 'warn'} stack-s`} data-testid="london-prompt">
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
        <div className={`feedback ${game.result === '1-0' ? 'good' : 'warn'} stack-s`} data-testid="london-over">
          <h3>{game.title}</h3>
          <p className="small">{`Black played the "${game.plan.name}" setup. You matched the coach on ${game.score.london} of ${game.score.total} moves.`}</p>
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
