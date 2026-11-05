// The game review screen: board + eval bar on the left, summary / move list / live engine on the right.
import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { Chess } from '@/chess/compat';
import { gameFens, moveNumberLabel } from '@/chess/helpers';
import type { Color } from '@/chess/types';
import { Board, arrowOf, arrowsOf } from '@/components/Board';
import { reviewMoves, summarizeReview } from '@/review/classify';
import { epWhite } from '@/review/expected';
import { retryVerdict } from '@/review/retry';
import { MOVE_CLASSES, type MoveClass, type MoveReview } from '@/review/types';
import { CLASS_META, ClassIcon, formatEval } from '../ui/classInfo';
import { EvalBar, EvalGraph } from '../ui/charts';
import { LiveEngine } from '../ui/LiveEngine';
import { useEngineStatus } from '../lib/desktopEngine';
import { useLibrary } from '../state/library';
import { useReviews } from '../state/reviews';
import { useSettings } from '../state/settings';

const BAD: MoveClass[] = ['inaccuracy', 'mistake', 'miss', 'blunder'];
const SHOW_BEST: MoveClass[] = ['inaccuracy', 'mistake', 'miss', 'blunder'];
const KEY_MOMENTS: MoveClass[] = ['brilliant', 'great', 'miss', 'mistake', 'blunder'];

function describe(m: MoveReview): { title: string; body: string } {
  const lossPct = Math.round(m.loss * 100);
  const title = `${m.san} is ${CLASS_META[m.cls].phrase}`;
  switch (m.cls) {
    case 'book':
      return { title: `${m.san} is a book move`, body: m.bookName ? `Opening: ${m.bookName}.` : 'A standard opening move.' };
    case 'forced':
      return { title: `${m.san} is forced`, body: 'It was the only legal move.' };
    case 'brilliant':
    case 'great':
      return { title, body: m.note ?? '' };
    case 'best':
      return { title, body: 'The engine agrees: nothing is better.' };
    case 'excellent':
    case 'good':
      return { title, body: m.bestSan && m.bestSan !== m.san ? `${m.bestSan} was slightly stronger.` : '' };
    default:
      return {
        title,
        body: `${m.bestSan ? `${m.bestSan} was best. ` : ''}This gave up about ${lossPct}% of your winning chances.${m.note ? ` ${m.note}.` : ''}`,
      };
  }
}

export function ReviewPage(): JSX.Element {
  const { id = '' } = useParams();
  const nav = useNavigate();
  const game = useLibrary((s) => s.games.find((g) => g.id === id));
  const review = useReviews((s) => s.reviews[id]);
  const job = useReviews((s) => s.job);
  const queued = useReviews((s) => s.queue.includes(id));
  const reviewErr = useReviews((s) => s.error);
  const settings = useSettings();
  const engineState = useEngineStatus();
  const [ply, setPly] = useState(0);
  const [flip, setFlip] = useState(false);
  const [tab, setTab] = useState<'summary' | 'moves'>('summary');
  const [live, setLive] = useState(false);
  const [showBest, setShowBest] = useState(true);
  const [retry, setRetry] = useState<{ ply: number; verdict: 'best' | 'good' | 'wrong' | null } | null>(null);

  useEffect(() => {
    void useReviews.getState().open(id);
  }, [id]);

  const positions = review?.positions ?? [];
  const moves = useMemo(() => (game ? reviewMoves(game.startFen, game.movesUci, positions) : []), [game, positions]);
  const summary = useMemo(() => (positions.length > 1 ? summarizeReview(moves, positions) : null), [moves, positions]);
  const fens = useMemo(() => (game ? gameFens(game.startFen, game.movesUci) : []), [game]);

  const last = game ? game.movesUci.length : 0;
  const go = (p: number): void => {
    setRetry(null);
    setPly(Math.max(0, Math.min(last, p)));
  };
  const orientation: Color = (flip ? (game?.userColor === 'b' ? 'w' : 'b') : (game?.userColor ?? 'w')) as Color;

  useEffect(() => {
    const h = (e: KeyboardEvent): void => {
      if ((e.target as HTMLElement)?.tagName === 'INPUT' || (e.target as HTMLElement)?.tagName === 'TEXTAREA') return;
      if (e.key === 'ArrowLeft') go(ply - 1);
      else if (e.key === 'ArrowRight') go(ply + 1);
      else if (e.key === 'Home') go(0);
      else if (e.key === 'End') go(last);
      else if (e.key.toLowerCase() === 'f') setFlip((f) => !f);
    };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  });

  if (!game) {
    return (
      <div className="dk-page">
        <p>This game is not in your library.</p>
        <Link to="/">Back to games</Link>
      </div>
    );
  }

  const m = ply > 0 ? moves[ply - 1] : undefined;
  const analyzedUpTo = positions.length - 1; // last position with an analysis
  const thisJob = job?.gameId === id ? job : null;
  const complete = !!review?.complete;
  const ep = positions[ply]?.lines[0] ? epWhite(positions[ply].lines[0]) : 0.5;
  const evalLine = positions[ply]?.lines[0];
  const evalLabel = evalLine ? formatEval(evalLine.cp, evalLine.mate) : '0.00';

  const arrows = arrowsOf();
  const badges: { square: string; color: string; glyph: string }[] = [];
  if (m) {
    badges.push({ square: m.uci.slice(2, 4), color: CLASS_META[m.cls].color, glyph: CLASS_META[m.cls].glyph });
    if (showBest && m.bestUci && m.bestUci !== m.uci && SHOW_BEST.includes(m.cls)) arrows.push(...arrowsOf(arrowOf(m.bestUci, 'good')));
  }
  const retryMove = retry ? moves[retry.ply] : undefined;
  // While retrying, the board shows the position BEFORE the mistake and the player tries again.
  const boardFen = retry ? fens[retry.ply] : fens[ply];
  const lastMove = retry ? (retry.ply > 0 ? game.movesUci[retry.ply - 1] : null) : ply > 0 ? game.movesUci[ply - 1] : null;

  const nextMistake = (dir: 1 | -1): void => {
    const from = ply - 1;
    const list = moves.filter((x) => KEY_MOMENTS.includes(x.cls) && (dir === 1 ? x.ply > from : x.ply < from));
    const t = dir === 1 ? list[0] : list[list.length - 1];
    if (t) go(t.ply + 1);
  };

  const name = (c: Color): string => (c === 'w' ? game.white : game.black) ?? (c === 'w' ? 'White' : 'Black');
  const rating = (c: Color): number | null => (c === 'w' ? game.whiteRating : game.blackRating);
  const acc = (c: Color): string | null => (summary && complete ? summary[c === 'w' ? 'white' : 'black'].accuracy.toFixed(1) : null);
  const bar = (c: Color): JSX.Element => (
    <div className="player-bar">
      <span className={`swatch ${c}`} />
      <b>{name(c)}</b>
      {rating(c) ? <span className="muted">({rating(c)})</span> : null}
      {acc(c) && <span className="pill acc" title="Accuracy">{acc(c)}%</span>}
    </div>
  );
  const top: Color = orientation === 'w' ? 'b' : 'w';

  const startReview = (force: boolean): void => useReviews.getState().enqueue(id, { force });
  const pct = thisJob ? Math.round((thisJob.index / thisJob.total) * 100) : complete ? 100 : Math.round((positions.length / (last + 1)) * 100);
  const eta = thisJob && thisJob.index > 0 ? Math.round(((Date.now() - thisJob.startedAt) / thisJob.index) * (thisJob.total - thisJob.index) / 1000) : null;

  const onRetryMove = (uci: string): void => {
    if (!retry) return;
    const v = retryVerdict(positions[retry.ply], moves[retry.ply].color, uci);
    setRetry({ ply: retry.ply, verdict: v });
  };

  return (
    <div className="dk-review" data-testid="review-page">
      <section className="dk-boardcol">
        {bar(top)}
        <div className="board-row">
          <EvalBar ep={ep} label={evalLabel} orientation={orientation} />
          <div className="board-holder">
            <Board
              fen={boardFen}
              orientation={orientation}
              lastMove={lastMove}
              arrows={retry ? [] : arrows}
              badges={retry ? [] : badges}
              interactive={!!retry && retry.verdict !== 'best' && retry.verdict !== 'good'}
              movableColor={retryMove?.color ?? null}
              onMove={onRetryMove}
            />
          </div>
        </div>
        {bar(orientation)}
        <div className="dk-controls">
          <button className="btn" onClick={() => go(0)} aria-label="Start">«</button>
          <button className="btn" onClick={() => go(ply - 1)} aria-label="Previous move">‹</button>
          <button className="btn" onClick={() => go(ply + 1)} aria-label="Next move">›</button>
          <button className="btn" onClick={() => go(last)} aria-label="End">»</button>
          <span className="grow" />
          <button className="btn" onClick={() => nextMistake(-1)} title="Previous key moment">⇤ key</button>
          <button className="btn" onClick={() => nextMistake(1)} title="Next key moment">key ⇥</button>
          <button className="btn" onClick={() => setFlip((f) => !f)} title="Flip board (F)">⇅</button>
        </div>
      </section>

      <aside className="dk-side">
        <header className="dk-side-head">
          <button className="btn ghost" onClick={() => nav('/')}>← Games</button>
          <div className="grow">
            <b>{game.white} vs {game.black}</b>
            <div className="small muted">
              {[game.playedAt ? new Date(game.playedAt).toLocaleDateString() : '', game.timeClass, game.result].filter(Boolean).join(' · ')}
            </div>
          </div>
          {game.source === 'chesscom' && game.externalId && !game.externalId.startsWith('pgn_') && (
            <button className="btn ghost" onClick={() => window.desktop?.openExternal(`https://www.chess.com/game/live/${game.externalId}`)}>chess.com ↗</button>
          )}
        </header>

        {/* analysis status */}
        {!complete && (
          <div className="dk-card status" data-testid="review-status">
            {thisJob ? (
              <>
                <div className="spread">
                  <b>Analyzing position {Math.min(thisJob.index + 1, thisJob.total)} of {thisJob.total}</b>
                  <button className="btn" onClick={() => useReviews.getState().cancel()}>Stop</button>
                </div>
                <div className="progress"><i style={{ width: `${pct}%` }} /></div>
                <div className="small muted">
                  depth {thisJob.depth || '…'} · {settings.preset === 'custom' ? 'custom' : settings.preset} settings
                  {eta != null && eta > 0 ? ` · about ${eta > 90 ? `${Math.round(eta / 60)} min` : `${eta} s`} left` : ''}
                </div>
              </>
            ) : queued ? (
              <b>Waiting for the engine…</b>
            ) : (
              <>
                <div>
                  {positions.length > 1 ? `Partly analyzed (${positions.length - 1} of ${last} moves).` : 'This game has not been reviewed yet.'} Uses the{' '}
                  <b>{settings.preset === 'custom' ? 'custom' : settings.preset}</b> setting (depth {settings.depth}, up to {Math.round(settings.movetimeMs / 1000)} s per move).
                </div>
                <button className="btn primary block" onClick={() => startReview(false)} disabled={engineState.status === 'failed'} data-testid="start-review">
                  {positions.length > 1 ? 'Continue the review' : 'Start the review'}
                </button>
              </>
            )}
            {reviewErr && <div className="err small">{reviewErr}</div>}
          </div>
        )}

        {summary && <EvalGraph graph={summary.graph} moves={moves} current={ply} onSelect={go} />}

        <div className="seg dk-tabs" role="tablist">
          <button role="tab" aria-pressed={tab === 'summary'} onClick={() => setTab('summary')}>Summary</button>
          <button role="tab" aria-pressed={tab === 'moves'} onClick={() => setTab('moves')}>Moves</button>
        </div>

        {tab === 'summary' ? (
          <Summary
            moves={moves}
            summary={summary}
            game={game}
            complete={complete}
            onJump={(p) => {
              go(p + 1);
              setTab('moves');
            }}
            onRedo={() => startReview(true)}
            review={review}
          />
        ) : (
          <div className="dk-moves-pane">
            {m ? (
              <div className={`dk-card move-card ${m.cls}`} data-testid="move-card">
                <div className="row">
                  <ClassIcon cls={m.cls} size={30} />
                  <div>
                    <b data-testid="move-title">{describe(m).title}</b>
                    <div className="small muted">
                      {moveNumberLabel(game.startFen, m.ply)} · eval {formatEval(m.evalCp, m.evalMate)}
                    </div>
                  </div>
                </div>
                {describe(m).body && <p className="small">{describe(m).body}</p>}
                {m.bestLineSan.length > 0 && m.bestUci !== m.uci && <p className="small muted">Best line: {m.bestLineSan.join(' ')}</p>}
                <div className="row">
                  {m.bestUci && m.bestUci !== m.uci && BAD.includes(m.cls) && (
                    <button className="btn" onClick={() => setRetry({ ply: m.ply, verdict: null })} data-testid="retry">Retry</button>
                  )}
                  <label className="small row"><input type="checkbox" checked={showBest} onChange={(e) => setShowBest(e.target.checked)} /> best-move arrow</label>
                </div>
              </div>
            ) : (
              <div className="dk-card small muted">Step through the game with the arrow keys. Click a move to jump to it.</div>
            )}
            {retry && retryMove && (
              <div className={`dk-card retry ${retry.verdict === 'wrong' ? 'bad' : retry.verdict ? 'good' : ''}`} data-testid="retry-card">
                <b>
                  {retry.verdict === null && `Find a better move for ${retryMove.color === 'w' ? 'White' : 'Black'}.`}
                  {retry.verdict === 'best' && `Yes! ${retryMove.bestSan} is the best move.`}
                  {retry.verdict === 'good' && 'That works too: the engine rates it nearly as high as the best move.'}
                  {retry.verdict === 'wrong' && 'That is not it. Try again, or look at the solution.'}
                </b>
                <div className="row">
                  {retry.verdict === 'wrong' && <button className="btn" onClick={() => setRetry({ ply: retry.ply, verdict: null })}>Try again</button>}
                  <button className="btn" onClick={() => setRetry(null)}>{retry.verdict === 'best' || retry.verdict === 'good' ? 'Continue' : 'Show solution'}</button>
                </div>
              </div>
            )}
            <MoveList game={game} moves={moves} analyzedUpTo={analyzedUpTo} ply={ply} onSelect={go} />
            <div className="dk-card">
              <label className="row small">
                <input type="checkbox" checked={live} onChange={(e) => setLive(e.target.checked)} data-testid="live-toggle" /> Live engine on this position
              </label>
              {live ? (
                <LiveEngine fen={fens[ply]} enabled lines={3} />
              ) : (
                <StoredLines fen={fens[ply]} pos={positions[ply]} />
              )}
            </div>
          </div>
        )}
      </aside>
    </div>
  );
}

function StoredLines({ fen, pos }: { fen: string; pos: { lines: { cp: number; mate: number | null; pv: string[]; depth: number }[] } | undefined }): JSX.Element {
  if (!pos || !pos.lines.length || !pos.lines[0].pv.length) return <div className="small muted">No engine lines for this position.</div>;
  return (
    <div className="live">
      <div className="live-head small muted"><span>Saved review lines</span><span>depth {pos.lines[0].depth}</span></div>
      {pos.lines.map((l, i) => {
        const c = new Chess(fen);
        const sans: string[] = [];
        for (const u of l.pv.slice(0, 9)) {
          try {
            sans.push(c.move({ from: u.slice(0, 2), to: u.slice(2, 4), promotion: u[4] }).san);
          } catch {
            break;
          }
        }
        return (
          <div className="live-line" key={i}>
            <b className={`live-eval ${l.cp < 0 ? 'neg' : 'pos'}`}>{formatEval(l.cp, l.mate)}</b>
            <span className="live-pv">{sans.join(' ')}</span>
          </div>
        );
      })}
    </div>
  );
}

function MoveList({ game, moves, analyzedUpTo, ply, onSelect }: { game: { startFen: string; movesSan: string[] }; moves: MoveReview[]; analyzedUpTo: number; ply: number; onSelect: (p: number) => void }): JSX.Element {
  const rows: JSX.Element[] = [];
  const startBlack = game.startFen.split(' ')[1] === 'b';
  for (let i = 0; i < game.movesSan.length; i++) {
    const white = startBlack ? i % 2 === 1 : i % 2 === 0;
    const mv = moves[i];
    if (white || i === 0) rows.push(<span key={`n${i}`} className="mn">{moveNumberLabel(game.startFen, i)}</span>);
    if (startBlack && i === 0) rows.push(<span key="gap" />);
    rows.push(
      <button key={i} className={`mv${ply === i + 1 ? ' cur' : ''}`} onClick={() => onSelect(i + 1)} disabled={i + 1 > analyzedUpTo + 1 && !mv} data-ply={i + 1}>
        {mv && <ClassIcon cls={mv.cls} size={16} />}
        {game.movesSan[i]}
      </button>,
    );
  }
  return <div className="dk-movelist" data-testid="movelist">{rows}</div>;
}

function Summary({
  moves,
  summary,
  game,
  complete,
  onJump,
  onRedo,
  review,
}: {
  moves: MoveReview[];
  summary: ReturnType<typeof summarizeReview> | null;
  game: { white: string | null; black: string | null; opening: string | null };
  complete: boolean;
  onJump: (ply: number) => void;
  onRedo: () => void;
  review: { engine: string; threads: number; hashMb: number; settings: { depth: number; movetimeMs: number; multipv: number } } | undefined;
}): JSX.Element {
  if (!summary) return <div className="dk-card small muted">Start the review to see accuracy, move ratings and key moments.</div>;
  const opening = moves.find((x) => x.bookName && x.cls === 'book');
  const lastBook = [...moves].reverse().find((x) => x.cls === 'book' && x.bookName);
  const key = moves.filter((x) => KEY_MOMENTS.includes(x.cls));
  return (
    <div className="dk-summary" data-testid="summary">
      <div className="acc-row">
        {(['w', 'b'] as const).map((c) => {
          const s = summary[c === 'w' ? 'white' : 'black'];
          return (
            <div key={c} className={`acc-card ${c}`}>
              <div className="small muted">{(c === 'w' ? game.white : game.black) ?? (c === 'w' ? 'White' : 'Black')}</div>
              <b className="acc-num" data-testid={`accuracy-${c}`}>{s.accuracy.toFixed(1)}</b>
              <div className="small muted">Accuracy{complete ? '' : ' so far'}</div>
            </div>
          );
        })}
      </div>
      <table className="cls-table">
        <tbody>
          {MOVE_CLASSES.map((c) => (
            <tr key={c} className={summary.white.counts[c] + summary.black.counts[c] === 0 ? 'zero' : ''}>
              <td className="num" data-testid={`count-w-${c}`} style={{ color: summary.white.counts[c] ? CLASS_META[c].color : undefined }}>{summary.white.counts[c]}</td>
              <td className="lbl"><ClassIcon cls={c} size={18} /> {CLASS_META[c].label}</td>
              <td className="num" data-testid={`count-b-${c}`} style={{ color: summary.black.counts[c] ? CLASS_META[c].color : undefined }}>{summary.black.counts[c]}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {(lastBook || opening || game.opening) && <div className="small muted">Opening: {lastBook?.bookName ?? game.opening}</div>}
      {key.length > 0 && (
        <div className="dk-card">
          <b>Key moments</b>
          <div className="key-list">
            {key.map((x) => (
              <button key={x.ply} className="key-item" onClick={() => onJump(x.ply)}>
                <ClassIcon cls={x.cls} size={20} />
                <span className="mvno">{x.color === 'w' ? `${Math.floor(x.ply / 2) + 1}.` : `${Math.floor(x.ply / 2) + 1}…`}</span>
                <b>{x.san}</b>
                <span className="muted small">{CLASS_META[x.cls].label}{BAD.includes(x.cls) && x.bestSan ? ` · best ${x.bestSan}` : ''}</span>
              </button>
            ))}
          </div>
        </div>
      )}
      {review && (
        <div className="small muted dk-engine-note">
          {review.engine} · {review.threads} threads · {review.hashMb} MB hash · depth ≤{review.settings.depth}, {review.settings.multipv} lines
          {complete && (
            <>
              {' · '}
              <button className="linklike" onClick={onRedo}>Re-run with current settings</button>
            </>
          )}
        </div>
      )}
    </div>
  );
}
