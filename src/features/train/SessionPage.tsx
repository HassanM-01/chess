// Shared puzzle/drill session runner (spec 7: /train/session). Ported from prototype runPuzzleSession.
// Handles puzzles, own-mistake drills, punish drills, "spot the threat" and "safe or blunder".
import { useCallback, useEffect, useReducer, useRef } from 'react';
import { Navigate, useNavigate } from 'react-router-dom';
import { Chess, uciMove } from '@/chess/compat';
import { sanOf, sideToMove } from '@/chess/helpers';
import { colorName, type Color, type Square, type Uci } from '@/chess/types';
import { Board, arrowOf, arrowsOf, type Arrow, type MarkKind } from '@/components/Board';
import { ProgressBar, SessTop } from '@/components/ui';
import { THEMES } from '@/content/themes';
import { opponentLabel } from '@/features/train/labels';
import { fromStored } from '@/engine/types';
import { wpFor } from '@/engine/winprob';
import { engine, evalPos } from '@/state/engine';
import { toast } from '@/state/toast';
import { pieceHint, positionHint } from './hints';
import { useSessionStore } from './sessionStore';
import type { SessionItem } from './types';
import { useRecordAnswer } from './useRecord';

type Tone = '' | 'good' | 'bad' | 'warn';
interface Fb {
  tone: Tone;
  eyebrow?: string;
  title?: string;
  text?: string;
  note?: string;
}

interface ItemState {
  fen: string;
  step: number;
  tries: number;
  /** no wrong tries, no peeking at the answer */
  firstTry: boolean;
  hintLevel: number;
  solved: boolean;
  busy: boolean;
  revealed: boolean;
  alsoGood: boolean;
  fb: Fb | null;
  arrows: Arrow[];
  marks: Record<Square, MarkKind>;
  lastMove: Uci | null;
  interactive: boolean;
  startedAt: number;
  pulse: number;
}

const PAUSE_MS = 550;

function lineOf(it: SessionItem): Uci[] {
  if (it.kind === 'puz') return it.puzzle.moves;
  if (it.kind === 'drill') return [it.payload.best];
  return [];
}
function startFen(it: SessionItem): string {
  return it.kind === 'puz' ? it.puzzle.fen : it.payload.fen;
}
function meOf(it: SessionItem): Color {
  return it.kind === 'puz' ? sideToMove(it.puzzle.fen) : it.payload.me;
}
function lastMoveOf(it: SessionItem): Uci | null {
  return it.kind === 'puz' ? (it.puzzle.lastMove ?? null) : it.payload.lastMove;
}

function initialState(it: SessionItem): ItemState {
  const quiz = it.kind === 'threat' || it.kind === 'judge';
  return {
    fen: startFen(it),
    step: 0,
    tries: 0,
    firstTry: true,
    hintLevel: 0,
    solved: false,
    busy: false,
    revealed: false,
    alsoGood: false,
    fb: null,
    arrows: it.kind === 'judge' ? arrowsOf(arrowOf(it.payload.move, 'info')) : [],
    marks: {},
    lastMove: lastMoveOf(it),
    interactive: !quiz,
    startedAt: Date.now(),
    pulse: 0,
  };
}

export function SessionPage(): JSX.Element {
  const items = useSessionStore((s) => s.items);
  const run = useSessionStore((s) => s.run);
  if (!items.length) return <Navigate to="/train" replace />;
  return <Runner key={run} />;
}

function Runner(): JSX.Element {
  const nav = useNavigate();
  const items = useSessionStore((s) => s.items);
  const options = useSessionStore((s) => s.options);
  const cursor = useSessionStore((s) => s.cursor);
  const setCursor = useSessionStore((s) => s.setCursor);
  const startSession = useSessionStore((s) => s.start);
  const { recordPuzzle, recordGenerated, recordItem, markTrainerDone } = useRecordAnswer();

  const [, force] = useReducer((x: number) => x + 1, 0);
  const st = useRef<ItemState>(initialState(items[Math.min(cursor.idx, items.length - 1)]));
  const seq = useRef(0); // stale-async guard (spec 8.8)
  const retrying = useRef(false);
  const doneCalled = useRef(false);

  const idx = Math.min(cursor.idx, items.length - 1);
  const it = items[idx];
  const me = meOf(it);

  const patch = useCallback((p: Partial<ItemState>): void => {
    st.current = { ...st.current, ...p };
    force();
  }, []);

  // Load the current item whenever the index changes.
  useEffect(() => {
    seq.current++;
    st.current = initialState(items[idx]);
    force();
  }, [idx, items]);

  useEffect(() => {
    void engine.boot().catch(() => undefined);
  }, []);

  // ---- recording -------------------------------------------------------------------------
  const finalize = useCallback(
    (ok: boolean): void => {
      if (retrying.current) return; // "Try again" never changes the schedule or score
      const s = st.current;
      const outcome = { firstTry: s.firstTry, usedHint: s.hintLevel > 0, ms: Date.now() - s.startedAt };
      const cur = useSessionStore.getState().cursor;
      setCursor(ok ? { score: cur.score + 1 } : { missed: [...cur.missed, it] });
      const rec =
        it.kind === 'puz'
          ? it.item
            ? recordGenerated(it.item, it.puzzle, outcome)
            : recordPuzzle(it.puzzle, outcome)
          : recordItem(it.item, outcome, it.kind === 'drill' ? 'drills' : 'puzzles');
      void rec.catch((e) => console.warn('could not save answer', e));
    },
    [it, recordPuzzle, recordGenerated, recordItem, setCursor],
  );

  // ---- move-finding items (puzzles + drills) -----------------------------------------------
  const finishMove = useCallback(
    (alsoGood: boolean): void => {
      const s = st.current;
      const ok = s.firstTry && s.hintLevel === 0;
      patch({ solved: true, interactive: false, arrows: [], marks: {} });
      finalize(ok);
      let expl = '';
      if (it.kind === 'puz') expl = it.puzzle.explanation ?? '';
      else if (it.kind === 'drill') {
        const p = it.payload;
        if (p.pool === 'punish') expl = (alsoGood ? `Your move works too. The engine's top choice was ${p.bestSan}. ` : '') + p.doneText;
        else expl = `${alsoGood ? `The engine's top choice was ${p.bestSan}, but your move works too.` : `${p.bestSan} is the move.`} ${p.variant ? `The tempting ${p.san} fails here` : `In the game you played ${p.san}`}: ${p.text}`;
      }
      patch({ fb: { tone: ok ? 'good' : 'warn', title: ok ? (alsoGood ? 'Also good!' : 'Correct!') : 'Solved, with help', text: expl } });
    },
    [it, patch, finalize],
  );

  const onMove = useCallback(
    async (u: Uci): Promise<void> => {
      const s = st.current;
      if (s.solved || s.busy) return;
      const line = lineOf(it);
      const exp = line[s.step];
      const c = new Chess(s.fen);
      if (!uciMove(c, u)) return;
      let ok = u === exp || (u.length === 4 && exp.startsWith(u) && exp[4] === 'q');
      if (!ok && it.kind === 'puz' && s.step === 0 && it.puzzle.alts?.includes(u)) ok = true;
      if (!ok && it.kind === 'puz' && s.step === 2 && it.puzzle.themes[0] === 'mate2' && c.isCheckmate()) ok = true;
      let alsoGood = false;
      const mySeq = seq.current;
      if (!ok && it.kind === 'drill' && u !== it.payload.uci) {
        // Accept any move within 7 win% of the engine's best (quick depth-11 check).
        patch({ busy: true, fen: c.fen(), lastMove: u, interactive: false, fb: { tone: '', text: 'Checking your move…' } });
        try {
          const r = await evalPos(c.fen(), 11);
          if (seq.current !== mySeq) return;
          if (wpFor(fromStored(it.payload.evBest), me) - wpFor(r, me) < 7) {
            ok = true;
            alsoGood = true;
          }
        } catch {
          /* engine unavailable: fall through to "try again" */
        }
        if (seq.current !== mySeq) return;
        patch({ busy: false });
      }
      if (!ok) {
        const tries = s.tries + 1;
        let why = 'Not this one. Look again: what is attacked, and what is undefended?';
        if (it.kind === 'drill' && u === it.payload.uci) {
          why = it.payload.pool === 'punish' ? "That's what you played in the game. Look for something that wins material." : `${it.payload.variant ? "That's the tempting move, and it fails." : "That's the move you played in the game."} ${it.payload.text}`;
        }
        patch({ tries, firstTry: false, fen: s.fen, lastMove: lastMoveOf(it), interactive: true, arrows: [], busy: false, fb: { tone: 'bad', title: 'Try again', text: why } });
        if (tries >= 2 && !st.current.revealed) patch({ arrows: arrowsOf(arrowOf(exp, 'good')) });
        return;
      }
      const fen = c.fen();
      const step = s.step + 1;
      patch({ fen, step, lastMove: u, interactive: false, arrows: [], marks: {} });
      if (step < line.length && !alsoGood) {
        patch({ fb: { tone: 'good', text: 'Good. Keep going.' } });
        await new Promise((r) => setTimeout(r, PAUSE_MS));
        if (seq.current !== mySeq) return;
        const rep = line[step];
        const c2 = new Chess(fen);
        uciMove(c2, rep);
        patch({ fen: c2.fen(), step: step + 1, lastMove: rep, interactive: true, fb: null });
        return;
      }
      finishMove(alsoGood);
    },
    [it, me, patch, finishMove],
  );

  const reveal = useCallback(
    (give: boolean): void => {
      const s = st.current;
      const u = lineOf(it)[s.step];
      if (!u) return;
      const san = sanOf(s.fen, u);
      const base: Partial<ItemState> = { arrows: arrowsOf(arrowOf(u, 'good')), marks: {} };
      if (!give) {
        patch(base);
        return;
      }
      let why = '';
      if (it.kind === 'puz') why = it.puzzle.explanation ?? '';
      else if (it.kind === 'drill') why = it.payload.pool === 'punish' ? it.payload.doneText : `${it.payload.variant ? `The tempting ${it.payload.san} fails` : `In the game you played ${it.payload.san}`}. ${it.payload.text}`;
      patch({
        ...base,
        revealed: true,
        firstTry: false,
        hintLevel: 3,
        fb: { tone: 'warn', eyebrow: 'Answer', title: san, text: why, note: `Play ${san} on the board (follow the green arrow) to finish this one, or tap Next to skip.` },
      });
    },
    [it, patch],
  );

  const hint = useCallback((): void => {
    const s = st.current;
    const u = lineOf(it)[s.step];
    if (!u) return;
    const level = s.hintLevel + 1;
    if (level >= 3) {
      reveal(true);
      return;
    }
    const theme = it.kind === 'puz' ? (it.puzzle.themes[0] ?? null) : null;
    if (level === 1) {
      patch({ hintLevel: 1, firstTry: false, fb: { tone: '', eyebrow: 'Hint 1 of 3', text: positionHint(s.fen, u, theme) } });
    } else {
      const h = pieceHint(s.fen, u);
      patch({ hintLevel: 2, firstTry: false, marks: h ? { [h.from]: 'good' } : {}, fb: { tone: '', eyebrow: 'Hint 2 of 3', text: h?.text ?? 'Look at the piece highlighted in green.' } });
    }
  }, [it, patch, reveal]);

  // ---- quiz items --------------------------------------------------------------------------
  const finishQuiz = useCallback(
    (ok: boolean, text: string): void => {
      patch({ solved: true, firstTry: ok, fb: { tone: ok ? 'good' : 'bad', title: ok ? 'Correct!' : 'Not quite', text } });
      finalize(ok);
    },
    [patch, finalize],
  );

  const answerThreat = useCallback(
    (sq: Square | null): void => {
      const s = st.current;
      if (it.kind !== 'threat' || s.solved) return;
      const p = it.payload;
      if (sq && !p.answer.includes(sq)) {
        const piece = new Chess(p.fen).get(sq as never);
        if (!piece || piece.color !== me) {
          toast(piece ? "That's their piece. Tap one of YOUR pieces that could be taken." : 'Tap one of your pieces, or "Nothing is in danger".');
          return; // not an answer: no score change
        }
      }
      const ok = p.answer.length ? !!sq && p.answer.includes(sq) : sq === null;
      const marks: Record<Square, MarkKind> = {};
      p.answer.forEach((a) => (marks[a] = 'bad'));
      if (sq && !ok) marks[sq] = 'sel';
      patch({ marks, arrows: p.attackers.map((a) => arrowOf(a, 'warn')).filter((a): a is Arrow => !!a) });
      finishQuiz(ok, p.explain);
    },
    [it, me, patch, finishQuiz],
  );

  const answerJudge = useCallback(
    (choice: 'safe' | 'blunder'): void => {
      const s = st.current;
      if (it.kind !== 'judge' || s.solved) return;
      const p = it.payload;
      patch({ arrows: p.verdict === 'blunder' ? arrowsOf(arrowOf(p.move, 'bad'), arrowOf(p.reply, 'warn')) : arrowsOf(arrowOf(p.move, 'good')) });
      finishQuiz(choice === p.verdict, p.explain);
    },
    [it, patch, finishQuiz],
  );

  // ---- navigation within the session ----------------------------------------------------------
  const finishSession = useCallback((): void => {
    setCursor({ finished: true });
    if (doneCalled.current) return;
    doneCalled.current = true;
    const cur = useSessionStore.getState().cursor;
    options.onDone?.(cur.score, items.length);
    if (options.dailyKey === 'trainer') void markTrainerDone().catch(() => undefined);
  }, [setCursor, options, items.length, markTrainerDone]);

  const goNext = useCallback((): void => {
    const s = st.current;
    if (!s.solved) {
      // Skipped without solving (e.g. after Show answer): counts as missed.
      finalize(false);
    }
    retrying.current = false;
    if (idx >= items.length - 1) finishSession();
    else setCursor({ idx: idx + 1 });
  }, [idx, items.length, finalize, finishSession, setCursor]);

  const retry = useCallback((): void => {
    retrying.current = true;
    seq.current++;
    st.current = initialState(it);
    force();
  }, [it]);

  // ---- board callbacks --------------------------------------------------------------------------
  const onBadTap = (sq: Square): void => {
    const p = new Chess(st.current.fen).get(sq as never);
    toast(p ? "That's their piece. Tap one of yours, then tap where it should go." : 'Tap one of your pieces first, then tap where it should go.');
  };
  const onIdleTap = (): void => {
    const s = st.current;
    if (s.busy) toast('Checking your move…');
    else if (s.solved) {
      toast('Tap Next to continue.');
      patch({ pulse: s.pulse + 1 });
    } else if (it.kind === 'judge') toast('Tap Safe or Blunder below.');
  };

  // ---- render --------------------------------------------------------------------------------------
  if (cursor.finished) return <Summary />;

  const s = st.current;
  const quiz = it.kind === 'threat' || it.kind === 'judge';
  const last = idx === items.length - 1;
  const opp = opponentLabel(it);
  let prompt = '';
  let sub = '';
  if (it.kind === 'puz') {
    prompt = `${colorName(me)} to move.`;
    sub = options.hideTheme ? 'Find the best move.' : (THEMES[it.puzzle.themes[0]]?.prompt ?? 'Find the best move.');
    if (it.item) sub = `Made for you. ${sub}`;
  } else if (it.kind === 'drill') {
    prompt = `${colorName(me)} to move.`;
    sub = it.payload.pool === 'punish' ? it.payload.sub : it.payload.variant
          ? `Same pattern as a mistake you made against ${opp}, new look. ${it.payload.san} is the tempting move. Find something better.`
          : `From your game vs ${opp}. You played ${it.payload.san} here. Find something better.`;
  } else if (it.kind === 'threat') {
    prompt = `They just played ${it.payload.lastSan}. What's in danger?`;
    sub = `From your game vs ${opp}. Tap your piece that could be lost. If nothing is in danger, tap the button.`;
  } else {
    prompt = `You're about to play ${it.payload.san}.`;
    sub = `From your game vs ${opp}. Blunder Check: is this move safe?`;
  }

  return (
    <div className="stack" data-testid="session" data-kind={it.kind}>
      <SessTop title={options.title} onBack={() => nav(options.returnTo ?? '/train', { replace: true })} />
      <div className="session-meta">
        <ProgressBar value={idx / items.length} />
        <span className="pill" data-testid="counter">{`${idx + 1} / ${items.length}`}</span>
      </div>
      <Board
        fen={s.fen}
        orientation={me}
        interactive={s.interactive && !quiz && !s.solved}
        movableColor={me}
        lastMove={s.lastMove}
        arrows={s.arrows}
        marks={s.marks}
        onMove={(u) => void onMove(u)}
        onTap={it.kind === 'threat' && !s.solved ? (sq) => answerThreat(sq) : undefined}
        onBadTap={onBadTap}
        onIdleTap={onIdleTap}
      />
      <div className="stack-s">
        <div className="prompt" data-testid="prompt">{prompt}</div>
        <div className="small muted">{sub}</div>
      </div>
      {s.fb && (
        <div className={`feedback ${s.fb.tone}`} data-testid="feedback" aria-live="polite">
          {s.fb.eyebrow && <div className="eyebrow">{s.fb.eyebrow}</div>}
          {s.fb.title && <h3>{s.fb.title}</h3>}
          {s.fb.text && <p className="small">{s.fb.text}</p>}
          {s.fb.note && <p className="small muted">{s.fb.note}</p>}
        </div>
      )}
      <div className={`row actions${s.pulse ? ' pulse' : ''}`} key={`bar-${s.pulse}`} data-testid="actions">
        {s.solved ? (
          <>
            {it.kind === 'drill' && it.payload.pool === 'own' && (
              <button className="btn" onClick={() => nav(`/games/${it.item.gameId}?ply=${(it.payload as { srcPly?: number }).srcPly ?? it.item.ply ?? 0}`)}>
                See game
              </button>
            )}
            <button className="btn" onClick={retry}>
              Try again
            </button>
            <button className="btn primary" style={{ flex: 1 }} onClick={goNext} data-testid="next">
              {last ? 'Finish' : 'Next'}
            </button>
          </>
        ) : it.kind === 'threat' ? (
          <button className="btn" onClick={() => answerThreat(null)}>
            Nothing is in danger
          </button>
        ) : it.kind === 'judge' ? (
          <>
            <button className="btn" style={{ flex: 1 }} onClick={() => answerJudge('safe')}>
              Safe
            </button>
            <button className="btn" style={{ flex: 1 }} onClick={() => answerJudge('blunder')}>
              Blunder
            </button>
          </>
        ) : (
          <>
            <button className="btn ghost" onClick={hint} disabled={s.busy}>
              Hint
            </button>
            <button className="btn ghost" onClick={() => reveal(true)} disabled={s.busy}>
              Show answer
            </button>
            {s.revealed && (
              <button className="btn primary" style={{ flex: 1 }} onClick={goNext} data-testid="next">
                {last ? 'Finish' : 'Next'}
              </button>
            )}
          </>
        )}
      </div>
    </div>
  );

  function Summary(): JSX.Element {
    const { score, missed } = cursor;
    const total = items.length;
    return (
      <div className="stack" data-testid="summary">
        <SessTop title={options.title} onBack={() => nav(options.returnTo ?? '/train', { replace: true })} />
        <div className="card stack-s" style={{ textAlign: 'center' }}>
          <div className="eyebrow">Session done</div>
          <h1>{`${score} / ${total}`}</h1>
          <p className="muted">
            {score === total ? 'Perfect. Every one on the first try.' : score >= total * 0.7 ? 'Solid. The ones you missed will come back for review.' : 'These are hard at first. Repetition is how the patterns stick.'}
          </p>
        </div>
        {missed.length > 0 && (
          <button className="btn primary block" onClick={() => startSession(missed.slice(), { ...options, title: `${options.title}: the ones you missed`, dailyKey: undefined, onDone: undefined })}>
            {`Redo the ${missed.length} you missed`}
          </button>
        )}
        <button className="btn block" onClick={() => startSession(items.slice(), { ...options, onDone: undefined, dailyKey: undefined })}>
          Do this whole set again
        </button>
        <button className={missed.length ? 'btn ghost block' : 'btn primary block'} onClick={() => nav(options.returnTo ?? '/train', { replace: true })}>
          Done
        </button>
      </div>
    );
  }
}

