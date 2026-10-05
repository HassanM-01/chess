// Game review (spec 7: /games/:id): board, move list, eval bar, mistakes list, share + coach.
import { useMemo, useState } from 'react';
import { Link, Navigate, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { opponentName } from '@/analysis/queue';
import { gameFens, moveNumberLabel } from '@/chess/helpers';
import { Board, arrowOf, arrowsOf } from '@/components/Board';
import { Pill, ProgressBar, SessTop, Spinner } from '@/components/ui';
import { CATS } from '@/content/cats';
import { cap } from '@/lib/util';
import { fromStored } from '@/engine/types';
import { wpWhite } from '@/engine/winprob';
import { useStartSession } from '@/features/train/useStartSession';
import { useAuth, useRepo } from '@/state/auth';
import { invalidateAll, useTrainingItems } from '@/state/queries';
import { useSyncController } from '@/state/sync';
import { toast } from '@/state/toast';
import { toSessionItem } from '@/features/train/types';
import { AskCoach } from './AskCoach';
import { useGameReview } from './useGameReview';

const OUTCOME = { w: 'Win', l: 'Loss', d: 'Draw' } as const;

export function ReviewPage(): JSX.Element {
  const { id } = useParams();
  const [sp] = useSearchParams();
  const nav = useNavigate();
  const repo = useRepo();
  const qc = useQueryClient();
  const { mode } = useAuth();
  const controller = useSyncController();
  const { startItems } = useStartSession();
  const { data: training = [] } = useTrainingItems();
  const { game, analysis, mistakes, progress, failed, analyzeNow } = useGameReview(id);
  const g = game.data;
  const [cur, setCur] = useState(() => Number(sp.get('ply') ?? 0) || 0);
  const [confirmRemove, setConfirmRemove] = useState(false);

  const fens = useMemo(() => (g ? gameFens(g.startFen, g.movesUci) : []), [g]);
  const evals = useMemo(() => analysis.data?.evals.map(fromStored) ?? null, [analysis.data]);

  if (game.isLoading) return <Spinner label="Loading the game…" />;
  if (!g) return <Navigate to="/games" replace />;

  const ply = Math.max(0, Math.min(fens.length - 1, cur));
  const me = g.userColor ?? 'w';
  const mistakeAt = (p: number) => mistakes.find((m) => m.ply === p);
  const m = mistakeAt(ply);
  const prevM = ply > 0 ? mistakeAt(ply - 1) : undefined;
  const arrows = arrowsOf();
  if (m) {
    arrows.push(...arrowsOf(arrowOf(m.playedUci, 'bad'), arrowOf(m.bestUci, 'good')));
  }
  if (prevM?.replyUci) arrows.push(...arrowsOf(arrowOf(prevM.replyUci, 'warn')));
  const wp = evals ? wpWhite(evals[ply]) : 50;
  const evShare = me === 'b' ? 100 - wp : wp;
  const o = g.outcome;
  const back = (): void => void nav('/games');

  const practice = (): void => {
    if (!m) return;
    const item = training.find((t) => t.kind === 'own_mistake' && t.gameId === g.id && t.ply === m.ply);
    if (!item) {
      toast('This position is not in your training set yet.');
      return;
    }
    startItems([toSessionItem(item)], { title: 'Practice this position', returnTo: `/games/${g.id}?ply=${m.ply}` });
    nav('/train/session');
  };

  const setSide = async (c: 'w' | 'b'): Promise<void> => {
    await repo.setGameUserColor(g.id, c);
    await invalidateAll(qc, repo.userId);
    void controller.analyzePending(false);
  };

  const togglePublic = async (v: boolean): Promise<void> => {
    await repo.setGamePublic(g.id, v);
    await invalidateAll(qc, repo.userId);
    toast(v ? 'Sharing is on. Anyone with the link can view this walkthrough.' : 'Sharing is off.');
  };
  const shareUrl = `${window.location.origin}/share/${g.id}`;

  return (
    <div className="stack" data-testid="review">
      <SessTop title={`vs ${opponentName(g)}`} sub={[g.playedAt ? new Date(g.playedAt).toLocaleDateString() : '', g.opening].filter(Boolean).join(' · ')} onBack={back} />
      <div className="row">
        {o && <Pill tone={o === 'w' ? 'good' : o === 'l' ? 'bad' : ''}>{OUTCOME[o]}</Pill>}
        {analysis.data && <Pill>{cap(analysis.data.summary.how_ended)}</Pill>}
        {g.source === 'chesscom' && g.externalId && (
          <a className="small" href={`https://www.chess.com/game/live/${g.externalId}`} target="_blank" rel="noopener noreferrer">
            Open on chess.com
          </a>
        )}
      </div>
      {analysis.data && g.userColor && (
        <Link className="btn primary block" to={`/games/${g.id}/walk`} data-testid="walk-me">
          Walk me through this game, move by move
        </Link>
      )}

      <Board fen={fens[ply]} orientation={me} lastMove={ply > 0 ? g.movesUci[ply - 1] : null} arrows={arrows} />
      {analysis.data && (
        <div className={`evalbar${me === 'b' ? ' flip' : ''}`} title="Evaluation">
          <i style={{ width: `${evShare}%` }} />
        </div>
      )}
      <div className="ctrl">
        <button className="btn" aria-label="Start" onClick={() => setCur(0)}>
          «
        </button>
        <button className="btn" aria-label="Previous move" onClick={() => setCur(ply - 1)}>
          ‹
        </button>
        <button className="btn" aria-label="Next move" onClick={() => setCur(ply + 1)}>
          ›
        </button>
        <button className="btn" aria-label="End" onClick={() => setCur(fens.length - 1)}>
          »
        </button>
      </div>

      {m ? (
        <div className={`feedback ${m.severity === 'blunder' ? 'bad' : 'warn'} stack-s`}>
          <div className="eyebrow">{`${m.severity === 'blunder' ? 'Blunder' : 'Mistake'} · ${CATS[m.category].short}`}</div>
          <h3>{`You played ${m.playedSan}`}</h3>
          <p className="small">{m.explanation + (m.bestSan && m.category !== 'missed_mate' && m.category !== 'missed_free' ? ` Better was ${m.bestSan}.` : '')}</p>
          <p className="small muted">Red arrow: your move. Green: the better move. Tap › to see their reply.</p>
          <div className="row">
            <button className="btn" onClick={practice}>
              Practice it
            </button>
          </div>
          <AskCoach key={m.ply} mistake={{ ...m, replyFen: fens[m.ply + 1] }} color={me} />
        </div>
      ) : prevM ? (
        <div className="feedback warn">
          <p className="small">{prevM.replySan ? `Orange arrow: ${prevM.replySan}, the reply your move allowed.` : 'This is the position after your mistake.'}</p>
        </div>
      ) : null}

      <div className="moves" data-testid="moves">
        {g.movesSan.map((s, i) => {
          const startBlack = g.startFen.split(' ')[1] === 'b';
          const white = startBlack ? i % 2 === 1 : i % 2 === 0;
          const mm = mistakeAt(i);
          return (
            <span key={i} style={{ display: 'contents' }}>
              {(white || i === 0) && <span className="mn">{moveNumberLabel(g.startFen, i)}</span>}
              <button className={`${ply === i + 1 ? 'cur ' : ''}${mm ? (mm.severity === 'blunder' ? 'blun' : 'mist') : ''}`} onClick={() => setCur(i + 1)}>
                {s + (mm ? (mm.severity === 'blunder' ? '??' : '?') : '')}
              </button>
            </span>
          );
        })}
      </div>

      {!g.userColor ? (
        <div className="card stack-s">
          <p>Which side were you?</p>
          <div className="row">
            <button className="btn" onClick={() => void setSide('w')}>
              White
            </button>
            <button className="btn" onClick={() => void setSide('b')}>
              Black
            </button>
          </div>
        </div>
      ) : !analysis.data && !analysis.isLoading ? (
        <div className="card stack-s">
          <p className="small muted">{failed ? 'The engine could not analyze this game.' : 'Run the engine to find your mistakes in this game.'}</p>
          {progress != null && <ProgressBar value={progress} />}
          <button className="btn primary block" disabled={progress != null} onClick={() => void analyzeNow()}>
            {progress != null ? 'Analyzing…' : 'Analyze this game'}
          </button>
        </div>
      ) : analysis.data ? (
        <div className="card">
          <h3 style={{ marginBottom: 4 }}>{mistakes.length ? `Your ${mistakes.length} biggest mistake${mistakes.length === 1 ? '' : 's'}` : 'No big mistakes in this game'}</h3>
          <div className="list">
            {mistakes.map((x) => (
              <button
                key={x.id}
                className="mistake-card"
                onClick={() => {
                  setCur(x.ply);
                  window.scrollTo({ top: 0, behavior: 'smooth' });
                }}
              >
                <Pill tone={x.severity === 'blunder' ? 'bad' : 'warn'}>{`${moveNumberLabel(g.startFen, x.ply)} ${x.playedSan}`}</Pill>
                <span>
                  <div className="chip-cat">{CATS[x.category].short}</div>
                  <div className="small">{x.explanation}</div>
                </span>
              </button>
            ))}
          </div>
        </div>
      ) : null}

      {g.userColor && analysis.data && (
        <div className="card stack-s">
          <div className="toggle">
            <div>
              <b>Share this walkthrough</b>
              <div className="small muted">{mode === 'local' ? 'Sharing needs an account (not available in local mode).' : 'Anyone with the link can view it, read-only.'}</div>
            </div>
            <button className="switch" role="switch" aria-checked={g.isPublic} aria-label="Share this walkthrough" disabled={mode === 'local'} onClick={() => void togglePublic(!g.isPublic)} />
          </div>
          {g.isPublic && (
            <div className="row">
              <input type="text" readOnly value={shareUrl} aria-label="Share link" onFocus={(e) => e.currentTarget.select()} />
              <button
                className="btn"
                onClick={() => {
                  void navigator.clipboard?.writeText(shareUrl).then(() => toast('Link copied.'), () => toast('Select the link and copy it.'));
                }}
              >
                Copy link
              </button>
            </div>
          )}
        </div>
      )}

      {confirmRemove ? (
        <div className="row">
          <button
            className="btn primary"
            style={{ background: 'var(--bad)', borderColor: 'var(--bad)' }}
            onClick={() => {
              void repo.deleteGame(g.id).then(async () => {
                await invalidateAll(qc, repo.userId);
                toast('Game removed');
                nav('/games', { replace: true });
              });
            }}
          >
            Yes, remove it
          </button>
          <button className="btn ghost" onClick={() => setConfirmRemove(false)}>
            Cancel
          </button>
        </div>
      ) : (
        <button className="btn ghost" onClick={() => setConfirmRemove(true)}>
          Remove this game
        </button>
      )}
    </div>
  );
}
