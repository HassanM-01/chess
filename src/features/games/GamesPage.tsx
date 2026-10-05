import { useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { opponentName } from '@/analysis/queue';
import { parsePgnText } from '@/chesscom/parsePgn';
import { Hero, Pill, ProgressBar } from '@/components/ui';
import type { GameRow } from '@/db/types';
import { timeAgo } from '@/lib/util';
import { useRepo } from '@/state/auth';
import { engineLabel, useEngineStatus } from '@/state/engine';
import { invalidateAll, useGames, useMistakes, useProfile } from '@/state/queries';
import { useSyncController, useSyncState } from '@/state/sync';
import { toast } from '@/state/toast';

const RESULT_LABEL = { w: 'Win', l: 'Loss', d: 'Draw' } as const;

function statusPill(g: GameRow, blunders: number | undefined): JSX.Element {
  switch (g.analysisStatus) {
    case 'done':
      return <Pill tone={blunders ? 'bad' : 'good'}>{blunders ? `${blunders} blunder${blunders === 1 ? '' : 's'}` : 'Clean'}</Pill>;
    case 'running':
      return <Pill>Analyzing…</Pill>;
    case 'error':
      return <Pill tone="warn">Analysis failed</Pill>;
    case 'skipped':
      return <Pill>Too short</Pill>;
    default:
      return <Pill>Not analyzed</Pill>;
  }
}

export function GamesPage(): JSX.Element {
  const repo = useRepo();
  const qc = useQueryClient();
  const sync = useSyncState();
  const controller = useSyncController();
  const engine = useEngineStatus();
  const { data: profile } = useProfile();
  const { data: games = [], isLoading } = useGames();
  const { data: mistakes = [] } = useMistakes();
  const [paste, setPaste] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);

  const blunders = useMemo(() => {
    const m = new Map<string, number>();
    for (const x of mistakes) if (x.severity === 'blunder') m.set(x.gameId, (m.get(x.gameId) ?? 0) + 1);
    return m;
  }, [mistakes]);

  const sorted = useMemo(() => games.slice().sort((a, b) => (b.playedAt ?? b.createdAt).localeCompare(a.playedAt ?? a.createdAt)), [games]);
  const shown = sorted.filter((g) => g.analysisStatus !== 'skipped');
  const pending = games.filter((g) => g.analysisStatus === 'pending' || g.analysisStatus === 'error').length;
  const busy = sync.phase === 'pulling' || sync.phase === 'analyzing';

  const doImport = async (text: string): Promise<void> => {
    const { games: parsed, errors } = parsePgnText(text, profile?.chesscomUsername);
    if (!parsed.length) {
      toast(errors ? "Couldn't read that. Make sure you pasted the full PGN." : 'Paste a game first.');
      return;
    }
    const inserted = await repo.insertGames(parsed);
    const dupes = parsed.length - inserted.length;
    toast(`${inserted.length} game${inserted.length === 1 ? '' : 's'} added${dupes ? `, ${dupes} already here` : ''}${errors ? `, ${errors} unreadable` : ''}`);
    if (inserted.length && !inserted.some((g) => g.userColor)) toast(`None of these have ${profile?.chesscomUsername ?? 'your username'} as a player. Check your username.`);
    setPaste('');
    await invalidateAll(qc, repo.userId);
    if (inserted.length) void controller.analyzePending(false);
  };

  return (
    <div className="stack">
      <Hero eyebrow="Games" title="Pull your chess.com games." />

      <div className="card stack">
        <button className="btn primary block big-btn" disabled={busy} onClick={() => void controller.pull()} data-testid="pull-games">
          {sync.phase === 'pulling' ? 'Pulling games…' : sync.phase === 'analyzing' ? sync.label : 'Pull recent games'}
        </button>
        {busy && (
          <div className="stack-s">
            <ProgressBar value={sync.phase === 'analyzing' ? sync.fraction : 0.05} />
            <div className="small muted" data-testid="sync-label">
              {sync.phase === 'analyzing' ? `${sync.label} ${sync.game}` : sync.label}
            </div>
          </div>
        )}
        {sync.phase === 'error' && sync.error && (
          <p className="err" role="alert">
            {sync.error}
          </p>
        )}
        <div className="small muted">
          {profile?.chesscomUsername ? (
            <>
              Account <b>{profile.chesscomUsername}</b> · last pulled {profile.lastSyncedAt ? timeAgo(profile.lastSyncedAt) : 'never'}.{' '}
              <Link to="/settings">Change</Link>
            </>
          ) : null}
        </div>
      </div>

      <div className="card stack-s">
        <div className="spread">
          <h3>Analysis</h3>
          <span className="small muted">{engineLabel(engine)}</span>
        </div>
        {!busy && pending > 0 ? (
          <button className="btn primary" onClick={() => void controller.analyzePending(false)}>
            Analyze {pending} game{pending === 1 ? '' : 's'}
          </button>
        ) : !busy ? (
          <p className="small muted">{games.length ? 'All games analyzed.' : 'No games yet.'}</p>
        ) : null}
        <p className="small muted">
          The engine runs on your phone, roughly 10 to 30 seconds per game. Keep this screen open while it works. Results are saved to your account
          {repo.mode === 'local' ? ' (local mode: saved in this browser)' : ''}.
        </p>
      </div>

      <details className="card">
        <summary>Paste or upload a PGN</summary>
        <div className="stack" style={{ marginTop: 10 }}>
          <div>
            <label className="lbl" htmlFor="pgn-input">
              Paste one or more games (PGN)
            </label>
            <textarea id="pgn-input" value={paste} onChange={(e) => setPaste(e.target.value)} placeholder={'[Event "Live Chess"]\n[White "you"] ...\n\n1. e4 e5 2. Nf3 ...'} />
          </div>
          <div className="row">
            <button className="btn primary" onClick={() => void doImport(paste)}>
              Import
            </button>
            <button className="btn" onClick={() => fileRef.current?.click()}>
              Upload .pgn file
            </button>
            <input
              ref={fileRef}
              type="file"
              accept=".pgn,.txt,text/plain"
              hidden
              multiple
              onChange={(e) => {
                const files = Array.from(e.target.files ?? []);
                void Promise.all(files.map((f) => f.text())).then((texts) => doImport(texts.join('\n\n')));
                e.target.value = '';
              }}
            />
          </div>
          <p className="small muted">On chess.com you can also copy a single game's PGN from its share menu, or download a whole month from Games, then Archive.</p>
        </div>
      </details>

      {isLoading ? (
        <p className="muted">Loading games…</p>
      ) : shown.length ? (
        <div className="stack-s">
          <h2>Your games ({shown.length})</h2>
          <div className="card list" data-testid="game-list">
            {shown.map((g) => (
              <Link key={g.id} to={`/games/${g.id}`} className="li" style={{ textDecoration: 'none', color: 'inherit' }}>
                <span className={`res ${g.outcome ?? 'd'}`} aria-label={g.outcome ? RESULT_LABEL[g.outcome] : 'Unknown result'}>
                  {g.outcome ? g.outcome.toUpperCase() : '?'}
                </span>
                <span style={{ minWidth: 0 }}>
                  <b>vs {opponentName(g)}</b>
                  <div className="small muted ellipsis">
                    {[g.playedAt ? new Date(g.playedAt).toLocaleDateString() : '', g.opening ?? (g.source === 'bot' || g.source === 'london' ? 'Bot game' : '')].filter(Boolean).join(' · ')}
                  </div>
                </span>
                {statusPill(g, blunders.get(g.id))}
              </Link>
            ))}
          </div>
        </div>
      ) : (
        <p className="muted">No games yet. Tap “Pull recent games” to bring in your chess.com games.</p>
      )}
    </div>
  );
}
