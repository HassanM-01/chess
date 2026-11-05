import { useEffect, useState } from 'react';
import { HashRouter, NavLink, Route, Routes } from 'react-router-dom';
import { PieceSprite } from '@/components/PieceSprite';
import { getEngine, useEngineStatus } from './lib/desktopEngine';
import { AnalysisPage } from './pages/AnalysisPage';
import { LibraryPage } from './pages/LibraryPage';
import { PuzzlesPage } from './pages/PuzzlesPage';
import { ReviewPage } from './pages/ReviewPage';
import { SettingsPage } from './pages/SettingsPage';
import { useLibrary } from './state/library';
import { useReviews } from './state/reviews';
import { getSystem, useSettings } from './state/settings';

function Sidebar(): JSX.Element {
  const engine = useEngineStatus();
  const settings = useSettings();
  const job = useReviews((s) => s.job);
  const [threads, setThreads] = useState<number | null>(null);
  useEffect(() => {
    void getSystem().then((s) => setThreads(settings.threads ?? s.recommended.threads));
  }, [settings.threads]);
  const dot = engine.status === 'ready' ? 'ok' : engine.status === 'failed' ? 'bad' : 'wait';
  return (
    <nav className="dk-nav" aria-label="Main">
      <div className="dk-brand">
        <span className="mark" aria-hidden="true">♞</span> Blunder Check
      </div>
      <NavLink to="/" end className="dk-link">Games</NavLink>
      <NavLink to="/puzzles" className="dk-link">Puzzles</NavLink>
      <NavLink to="/analysis" className="dk-link">Analysis</NavLink>
      <NavLink to="/settings" className="dk-link">Settings</NavLink>
      <div className="grow" />
      <div className="dk-engine-chip" data-testid="engine-chip">
        <span className={`dot ${dot}`} />
        <div>
          <b>{engine.name || 'Stockfish'}</b>
          <div className="small muted">
            {engine.status === 'failed' ? 'not running' : job ? `searching · depth ${job.depth || '…'}` : engine.status === 'ready' ? 'idle' : 'starting…'}
            {threads ? ` · ${threads} threads` : ''}
          </div>
        </div>
      </div>
    </nav>
  );
}

export function DesktopApp(): JSX.Element {
  const [ready, setReady] = useState(false);
  useEffect(() => {
    void (async () => {
      await Promise.all([useSettings.getState().load(), useLibrary.getState().load(), useReviews.getState().load()]);
      setReady(true);
      // Warm the engine up now so the first review does not wait for the hash table to be allocated.
      void getEngine().boot().catch(() => undefined);
    })();
  }, []);
  const board = useSettings((s) => s.boardTheme);
  useEffect(() => {
    document.documentElement.setAttribute('data-board', board);
  }, [board]);

  if (!window.desktop) {
    return (
      <div className="dk-page">
        <h1>Blunder Check Desktop</h1>
        <p>This screen only works inside the desktop app. Start it with <code>npm run desktop</code>.</p>
      </div>
    );
  }
  if (!ready) return <div className="dk-splash"><div className="spinner" /></div>;
  return (
    <HashRouter>
      <PieceSprite />
      <div className="dk-shell">
        <Sidebar />
        <main className="dk-main">
          <Routes>
            <Route path="/" element={<LibraryPage />} />
            <Route path="/review/:id" element={<ReviewPage />} />
            <Route path="/puzzles" element={<PuzzlesPage />} />
            <Route path="/analysis" element={<AnalysisPage />} />
            <Route path="/settings" element={<SettingsPage />} />
            <Route path="*" element={<LibraryPage />} />
          </Routes>
        </main>
      </div>
    </HashRouter>
  );
}
