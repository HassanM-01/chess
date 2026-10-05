// Auth + repo provider. With Supabase credentials: email OTP / magic link (+ optional Google).
// Without them the app runs in "local mode": one local user, data kept in this browser (also what the e2e tests use).
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import type { Session } from '@supabase/supabase-js';
import { loadBundledPuzzles } from '@/data/bundledPuzzles';
import { createMemoryRepo } from '@/db/memoryRepo';
import type { Repo } from '@/db/repo';
import { createSupabaseRepo } from '@/db/supabaseRepo';
import { getSupabase, isSupabaseConfigured } from '@/lib/supabase';

export type AuthStatus = 'loading' | 'signedOut' | 'signedIn';

interface AuthContextValue {
  status: AuthStatus;
  mode: 'supabase' | 'local';
  userId: string | null;
  email: string | null;
  repo: Repo | null;
  sendCode(email: string): Promise<void>;
  verifyCode(email: string, code: string): Promise<void>;
  signInWithGoogle(): Promise<void>;
  signOut(): Promise<void>;
  deleteAccount(): Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export const googleEnabled = import.meta.env.VITE_GOOGLE_AUTH === '1';

export function AuthProvider({ children }: { children: ReactNode }): JSX.Element {
  const qc = useQueryClient();
  const mode: 'supabase' | 'local' = isSupabaseConfigured ? 'supabase' : 'local';
  const [status, setStatus] = useState<AuthStatus>('loading');
  const [session, setSession] = useState<Session | null>(null);
  const [localRepo, setLocalRepo] = useState<Repo | null>(null);

  // ---- local mode
  useEffect(() => {
    if (mode !== 'local') return;
    let alive = true;
    void loadBundledPuzzles().then((puzzles) => {
      if (!alive) return;
      const storage = typeof localStorage !== 'undefined' ? localStorage : null;
      setLocalRepo(createMemoryRepo({ userId: 'local-user', storage, puzzles }));
      setStatus('signedIn');
    });
    return () => {
      alive = false;
    };
  }, [mode]);

  // ---- supabase mode
  useEffect(() => {
    if (mode !== 'supabase') return;
    const sb = getSupabase();
    let alive = true;
    void sb.auth.getSession().then(({ data }) => {
      if (!alive) return;
      setSession(data.session);
      setStatus(data.session ? 'signedIn' : 'signedOut');
    });
    const { data: sub } = sb.auth.onAuthStateChange((_evt, s) => {
      setSession((prev) => {
        if (prev?.user.id !== s?.user.id) qc.clear(); // never show another user's cached data
        return s;
      });
      setStatus(s ? 'signedIn' : 'signedOut');
    });
    return () => {
      alive = false;
      sub.subscription.unsubscribe();
    };
  }, [mode, qc]);

  const supaRepo = useMemo<Repo | null>(() => (mode === 'supabase' && session ? createSupabaseRepo(getSupabase(), session.user.id) : null), [mode, session?.user.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const sendCode = useCallback(async (email: string) => {
    const { error } = await getSupabase().auth.signInWithOtp({ email, options: { emailRedirectTo: window.location.origin, shouldCreateUser: true } });
    if (error) throw new Error(error.message);
  }, []);
  const verifyCode = useCallback(async (email: string, code: string) => {
    const { error } = await getSupabase().auth.verifyOtp({ email, token: code.trim(), type: 'email' });
    if (error) throw new Error(error.message);
  }, []);
  const signInWithGoogle = useCallback(async () => {
    const { error } = await getSupabase().auth.signInWithOAuth({ provider: 'google', options: { redirectTo: window.location.origin } });
    if (error) throw new Error(error.message);
  }, []);
  const signOut = useCallback(async () => {
    if (mode === 'supabase') await getSupabase().auth.signOut();
    qc.clear();
  }, [mode, qc]);
  const deleteAccount = useCallback(async () => {
    if (mode === 'local') {
      try {
        localStorage.removeItem('bc-local-v1:local-user');
      } catch {
        /* ignore */
      }
      window.location.assign('/');
      return;
    }
    const sb = getSupabase();
    const { data } = await sb.auth.getSession();
    const res = await fetch('/api/delete-account', { method: 'POST', headers: { Authorization: `Bearer ${data.session?.access_token ?? ''}` } });
    if (!res.ok) throw new Error('Could not delete the account. Try again later.');
    await sb.auth.signOut();
    qc.clear();
  }, [mode, qc]);

  const value: AuthContextValue = {
    status,
    mode,
    userId: mode === 'local' ? 'local-user' : (session?.user.id ?? null),
    email: session?.user.email ?? null,
    repo: mode === 'local' ? localRepo : supaRepo,
    sendCode,
    verifyCode,
    signInWithGoogle,
    signOut,
    deleteAccount,
  };
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const v = useContext(AuthContext);
  if (!v) throw new Error('useAuth must be used inside <AuthProvider>');
  return v;
}

/** The signed-in user's repo (use only under the auth guard). */
export function useRepo(): Repo {
  const { repo } = useAuth();
  if (!repo) throw new Error('No repo: user is not signed in');
  return repo;
}
