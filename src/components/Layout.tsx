import { useEffect } from 'react';
import { NavLink, Outlet, matchPath, useLocation } from 'react-router-dom';
import { useAuth } from '@/state/auth';
import { engineLabel, useEngineStatus } from '@/state/engine';
import { useProfile } from '@/state/queries';
import { useSyncState } from '@/state/sync';

const ICONS: Record<string, string> = {
  london:
    '<circle cx="12" cy="6" r="2.6" fill="currentColor"/><circle cx="6.5" cy="15.5" r="2.6" fill="currentColor"/><circle cx="17.5" cy="15.5" r="2.6" fill="currentColor"/><path d="M12 8.6 7.8 13.4M12 8.6l4.2 4.8M9.1 15.5h5.8" stroke="currentColor" stroke-width="1.6"/>',
  coach: '<path d="M4 19V9m6 10V5m6 14v-7m4 7H2" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>',
  train:
    '<circle cx="12" cy="12" r="8" fill="none" stroke="currentColor" stroke-width="2"/><circle cx="12" cy="12" r="4" fill="none" stroke="currentColor" stroke-width="2"/><circle cx="12" cy="12" r="1.2" fill="currentColor"/>',
  learn:
    '<path d="M3 6.5 12 3l9 3.5-9 3.5z M7 8.5V14c0 1.5 2.5 3 5 3s5-1.5 5-3V8.5" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/>',
  play: '<path d="M9 20h6m-7-3h8l-1-5 2-3-3-1-2-3-2 1-2 4 2 2z" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/>',
  games:
    '<rect x="4" y="3" width="16" height="18" rx="2" fill="none" stroke="currentColor" stroke-width="2"/><path d="M8 8h8M8 12h8M8 16h5" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>',
};

const TABS: [string, string, string][] = [
  ['/', 'coach', 'Coach'],
  ['/london', 'london', 'London'],
  ['/train', 'train', 'Train'],
  ['/learn', 'learn', 'Learn'],
  ['/play', 'play', 'Play'],
  ['/games', 'games', 'Games'],
];

/** Routes where the tab bar is hidden so sticky action bars never sit under it (spec 7, UX rule 2). */
const SESSION_PATTERNS = ['/learn/mate/pattern/:id', '/learn/mate/practice/:kind', '/coach/chat', '/train/session', '/games/:id', '/games/:id/walk', '/learn/lesson/:id', '/learn/opening/:set', '/learn/opening/:set/:line'];

export function isSessionPath(pathname: string): boolean {
  return SESSION_PATTERNS.some((p) => matchPath({ path: p, end: true }, pathname));
}

export function Layout(): JSX.Element {
  const { pathname } = useLocation();
  const session = isSessionPath(pathname);
  const { mode } = useAuth();
  const { data: profile } = useProfile();
  const engine = useEngineStatus();
  const sync = useSyncState();

  useEffect(() => {
    document.body.classList.toggle('in-session', session);
    return () => document.body.classList.remove('in-session');
  }, [session]);

  // Scroll to the top on every route change.
  useEffect(() => {
    window.scrollTo(0, 0);
  }, [pathname]);

  return (
    <div className="app" data-session={session ? '1' : '0'}>
      {!session && (
        <header className="top">
          <div className="brand">
            <span className="mark" aria-hidden="true">
              <svg viewBox="0 0 24 24">
                <path d="M7 20h10M9 20c0-4 1-6 1-8-1-.4-2-1.4-2-3 0-2 1.6-3.5 4-3.5s4 1.5 4 3.5c0 1.6-1 2.6-2 3 0 2 1 4 1 8" fill="none" stroke="#fff" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </span>
            Blunder Check
          </div>
          <NavLink to="/settings" className="who" aria-label="Settings">
            {profile?.chesscomUsername ?? (mode === 'local' ? 'local mode' : 'account')}
          </NavLink>
        </header>
      )}
      {!session && sync.phase === 'analyzing' && (
        <NavLink to="/games" className="banner" aria-live="polite">
          <span>{sync.label}</span>
          <span className="small muted">{sync.game}</span>
        </NavLink>
      )}
      <main id="main" data-engine={engine}>
        <Outlet />
      </main>
      <nav className="tabs" aria-label="Main">
        <div className="inner">
          {TABS.map(([to, icon, label]) => (
            <NavLink key={to} to={to} end={to === '/'} className="tab" aria-label={label}>
              <svg viewBox="0 0 24 24" aria-hidden="true" dangerouslySetInnerHTML={{ __html: ICONS[icon] }} />
              {label}
            </NavLink>
          ))}
        </div>
      </nav>
    </div>
  );
}

export { engineLabel };
