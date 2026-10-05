import { Suspense, lazy, useEffect } from 'react';
import { BrowserRouter, Navigate, Outlet, Route, Routes } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Layout } from '@/components/Layout';
import { PieceSprite } from '@/components/PieceSprite';
import { Spinner } from '@/components/ui';
import { AuthProvider, useAuth } from '@/state/auth';
import { useProfile } from '@/state/queries';
import { SyncProvider } from '@/state/sync';
import { ToastHost } from '@/state/toast';

const LoginPage = lazy(() => import('@/features/auth/LoginPage').then((m) => ({ default: m.LoginPage })));
const OnboardingPage = lazy(() => import('@/features/onboarding/OnboardingPage').then((m) => ({ default: m.OnboardingPage })));
const CoachPage = lazy(() => import('@/features/coach/CoachPage').then((m) => ({ default: m.CoachPage })));
const GamesPage = lazy(() => import('@/features/games/GamesPage').then((m) => ({ default: m.GamesPage })));
const ReviewPage = lazy(() => import('@/features/review/ReviewPage').then((m) => ({ default: m.ReviewPage })));
const WalkthroughPage = lazy(() => import('@/features/review/WalkthroughPage').then((m) => ({ default: m.WalkthroughPage })));
const TrainPage = lazy(() => import('@/features/train/TrainPage').then((m) => ({ default: m.TrainPage })));
const SessionPage = lazy(() => import('@/features/train/SessionPage').then((m) => ({ default: m.SessionPage })));
const LearnPage = lazy(() => import('@/features/learn/LearnPage').then((m) => ({ default: m.LearnPage })));
const LessonPage = lazy(() => import('@/features/learn/LessonPage').then((m) => ({ default: m.LessonPage })));
const OpeningPage = lazy(() => import('@/features/learn/OpeningPage').then((m) => ({ default: m.OpeningPage })));
const ChatPage = lazy(() => import('@/coach/ChatPage').then((m) => ({ default: m.ChatPage })));
const LondonPage = lazy(() => import('@/features/london/LondonPage').then((m) => ({ default: m.LondonPage })));
const PlayPage = lazy(() => import('@/features/play/PlayPage').then((m) => ({ default: m.PlayPage })));
const SettingsPage = lazy(() => import('@/features/settings/SettingsPage').then((m) => ({ default: m.SettingsPage })));
const AboutPage = lazy(() => import('@/features/about/AboutPage').then((m) => ({ default: m.AboutPage })));
const SharePage = lazy(() => import('@/features/share/SharePage').then((m) => ({ default: m.SharePage })));

const queryClient = new QueryClient({
  defaultOptions: { queries: { staleTime: 15_000, refetchOnWindowFocus: false, retry: 1 } },
});

function RequireAuth(): JSX.Element {
  const { status, repo } = useAuth();
  if (status === 'loading' || (status === 'signedIn' && !repo)) return <Spinner label="Loading…" />;
  if (status === 'signedOut') return <Navigate to="/login" replace />;
  return (
    <SyncProvider>
      <ThemeApplier />
      <Outlet />
    </SyncProvider>
  );
}

function RequireProfile(): JSX.Element {
  const { data, isLoading, isError, refetch } = useProfile();
  if (isLoading) return <Spinner label="Loading your profile…" />;
  if (isError || !data)
    return (
      <div className="app stack" style={{ paddingTop: 40 }}>
        <p>We could not load your profile.</p>
        <button className="btn primary" onClick={() => void refetch()}>
          Try again
        </button>
      </div>
    );
  if (!data.chesscomUsername) return <Navigate to="/onboarding" replace />;
  return <Outlet />;
}

/** Applies the saved light/dark/system choice to <html data-theme>. */
function ThemeApplier(): null {
  const { data } = useProfile();
  const theme = data?.settings.theme ?? 'system';
  useEffect(() => {
    const root = document.documentElement;
    if (theme === 'system') root.removeAttribute('data-theme');
    else root.setAttribute('data-theme', theme);
    try {
      localStorage.setItem('bc-theme', theme);
    } catch {
      /* ignore */
    }
  }, [theme]);
  return null;
}

export function App(): JSX.Element {
  return (
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <AuthProvider>
          <PieceSprite />
          <Suspense fallback={<Spinner />}>
            <Routes>
              <Route path="/login" element={<LoginPage />} />
              <Route path="/share/:gameId" element={<SharePage />} />
              <Route path="/about" element={<div className="app"><AboutPage /></div>} />
              <Route element={<RequireAuth />}>
                <Route path="/onboarding" element={<OnboardingPage />} />
                <Route element={<RequireProfile />}>
                  <Route element={<Layout />}>
                    <Route index element={<CoachPage />} />
                    <Route path="games" element={<GamesPage />} />
                    <Route path="games/:id" element={<ReviewPage />} />
                    <Route path="games/:id/walk" element={<WalkthroughPage />} />
                    <Route path="train" element={<TrainPage />} />
                    <Route path="train/session" element={<SessionPage />} />
                    <Route path="learn" element={<LearnPage />} />
                    <Route path="learn/lesson/:id" element={<LessonPage />} />
                    <Route path="learn/opening/:set" element={<OpeningPage />} />
                    <Route path="learn/opening/:set/:line" element={<OpeningPage />} />
                    <Route path="london" element={<LondonPage />} />
                    <Route path="coach/chat" element={<ChatPage />} />
                    <Route path="play" element={<PlayPage />} />
                    <Route path="settings" element={<SettingsPage />} />
                  </Route>
                </Route>
              </Route>
              <Route path="*" element={<Navigate to="/" replace />} />
            </Routes>
          </Suspense>
          <ToastHost />
        </AuthProvider>
      </BrowserRouter>
    </QueryClientProvider>
  );
}
