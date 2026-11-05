// Your games: import a PGN, pull from chess.com, and start reviews.
import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useEngineStatus } from '../lib/desktopEngine';
import { useLibrary } from '../state/library';
import { useReviews } from '../state/reviews';
import { useSettings } from '../state/settings';

const RESULT = { w: 'Win', l: 'Loss', d: 'Draw' } as const;

export function LibraryPage(): JSX.Element {
  const games = useLibrary((s) => s.games);
  const index = useReviews((s) => s.index);
  const job = useReviews((s) => s.job);
  const queue = useReviews((s) => s.queue);
  const username = useSettings((s) => s.chesscomUsername);
  const [name, setName] = useState(username);
  const [months, setMonths] = useState(2);
  const [busy, setBusy] = useState('');
  const [msg, setMsg] = useState('');
  const [paste, setPaste] = useState('');
  const engine = useEngineStatus();

  const unreviewed = useMemo(() => games.filter((g) => !index[g.id]?.complete), [games, index]);

  const pull = async (): Promise<void> => {
    const u = name.trim();
    if (!u) return setMsg('Type your chess.com username first.');
    setMsg('');
    setBusy('Contacting chess.com…');
    try {
      useSettings.getState().set({ chesscomUsername: u });
      const r = await useLibrary.getState().pullChesscom(u, months, setBusy);
      setMsg(r.added ? `Added ${r.added} game${r.added === 1 ? '' : 's'} from the last ${r.months} month${r.months === 1 ? '' : 's'}.` : 'No new games found.');
    } catch (e) {
      setMsg(e instanceof Error ? e.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '') : String(e));
    } finally {
      setBusy('');
    }
  };

  const doImport = (text: string): void => {
    const r = useLibrary.getState().importPgn(text, name.trim() || username);
    setMsg(r.added ? `Added ${r.added} game${r.added === 1 ? '' : 's'}${r.errors ? `, ${r.errors} unreadable` : ''}.` : r.errors ? "Couldn't read that PGN." : 'Those games were already in your library.');
    if (r.added) setPaste('');
  };

  const openFile = async (): Promise<void> => {
    const files = await window.desktop!.files.openText({ title: 'Open PGN files', extensions: ['pgn', 'txt'], multi: true });
    if (files.length) doImport(files.map((f) => f.text).join('\n\n'));
  };

  return (
    <div className="dk-page" data-testid="library-page">
      <h1>Games</h1>
      {engine.status === 'failed' && (
        <div className="dk-card bad">
          <b>The engine could not start.</b> {engine.error} <Link to="/settings">Open settings</Link>
        </div>
      )}
      <div className="dk-grid2">
        <div className="dk-card stack-s">
          <h3>Get games from chess.com</h3>
          <div className="row">
            <input type="text" value={name} placeholder="chess.com username" onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && void pull()} data-testid="username" style={{ maxWidth: 240 }} />
            <select value={months} onChange={(e) => setMonths(+e.target.value)} style={{ width: 150 }} aria-label="Months to download">
              {[1, 2, 3, 6, 12].map((m) => <option key={m} value={m}>last {m} month{m > 1 ? 's' : ''}</option>)}
            </select>
            <button className="btn primary" onClick={() => void pull()} disabled={!!busy} data-testid="pull">{busy ? 'Working…' : 'Download games'}</button>
          </div>
          {busy && <div className="small muted">{busy}</div>}
        </div>
        <div className="dk-card stack-s">
          <h3>Import a PGN</h3>
          <textarea value={paste} onChange={(e) => setPaste(e.target.value)} placeholder="Paste one or more games here…" rows={3} data-testid="pgn-paste" />
          <div className="row">
            <button className="btn primary" onClick={() => doImport(paste)} disabled={!paste.trim()} data-testid="pgn-import">Import</button>
            <button className="btn" onClick={() => void openFile()}>Open .pgn file…</button>
          </div>
        </div>
      </div>
      {msg && <div className="small" role="status" data-testid="library-msg">{msg}</div>}

      <div className="spread">
        <h2>Your games ({games.length})</h2>
        {unreviewed.length > 0 && (
          <button
            className="btn"
            disabled={engine.status === 'failed'}
            onClick={() => unreviewed.forEach((g) => useReviews.getState().enqueue(g.id))}
            data-testid="review-all"
          >
            Review all {unreviewed.length} unreviewed
          </button>
        )}
      </div>
      {job && (
        <div className="dk-card small">
          Reviewing a game: position {Math.min(job.index + 1, job.total)} of {job.total}, depth {job.depth || '…'}
          {queue.length > 1 ? ` · ${queue.length - 1} more queued` : ''}{' '}
          <button className="linklike" onClick={() => useReviews.getState().cancel()}>Stop</button>
        </div>
      )}
      {games.length === 0 ? (
        <div className="dk-card muted">No games yet. Download yours from chess.com or import a PGN above.</div>
      ) : (
        <div className="dk-card game-table" data-testid="game-list">
          {games.map((g) => {
            const r = index[g.id];
            const active = job?.gameId === g.id;
            return (
              <Link key={g.id} to={`/review/${g.id}`} className="game-row" data-testid="game-row">
                <span className={`res ${g.outcome ?? 'd'}`} title={g.outcome ? RESULT[g.outcome] : g.result ?? ''}>{g.outcome ? g.outcome.toUpperCase() : (g.result ?? '?').replace('1/2-1/2', '½')}</span>
                <span className="who-col">
                  <b>{g.white} <span className="muted">({g.whiteRating ?? '?'})</span> vs {g.black} <span className="muted">({g.blackRating ?? '?'})</span></b>
                  <span className="small muted">{[g.playedAt ? new Date(g.playedAt).toLocaleDateString() : '', g.timeClass, g.opening].filter(Boolean).join(' · ')}</span>
                </span>
                <span className="acc-col">
                  {active ? (
                    <span className="pill">Analyzing {Math.round(((job?.index ?? 0) / (job?.total ?? 1)) * 100)}%</span>
                  ) : r?.complete ? (
                    <span className="small"><b>{r.accuracyW.toFixed(0)}</b> / <b>{r.accuracyB.toFixed(0)}</b> <span className="muted">accuracy · depth {r.depth}</span></span>
                  ) : queue.includes(g.id) ? (
                    <span className="pill">Queued</span>
                  ) : (
                    <span className="pill">Not reviewed</span>
                  )}
                </span>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}
