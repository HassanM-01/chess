import { useState, type FormEvent } from 'react';
import { Navigate } from 'react-router-dom';
import { googleEnabled, useAuth } from '@/state/auth';

export function LoginPage(): JSX.Element {
  const { status, mode, sendCode, verifyCode, signInWithGoogle } = useAuth();
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [step, setStep] = useState<'email' | 'code'>('email');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (status === 'signedIn') return <Navigate to="/" replace />;

  const submitEmail = async (e: FormEvent): Promise<void> => {
    e.preventDefault();
    setError(null);
    if (!/^\S+@\S+\.\S+$/.test(email.trim())) {
      setError('Enter a valid email address.');
      return;
    }
    setBusy(true);
    try {
      await sendCode(email.trim());
      setStep('code');
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const submitCode = async (e: FormEvent): Promise<void> => {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      await verifyCode(email.trim(), code);
    } catch (err) {
      setError('That code did not work. Check it and try again, or request a new one.');
      console.warn(err);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="app login">
      <div className="stack" style={{ paddingTop: 40 }}>
        <div className="hero stack-s">
          <div className="eyebrow">Blunder Check</div>
          <h1>Find out why you keep losing.</h1>
          <p className="muted">Link your chess.com account. The app checks every move you made, finds the habits that cost you games, and trains exactly those.</p>
        </div>
        {mode === 'local' && (
          <div className="feedback warn">
            <b>Local mode.</b> Supabase is not configured for this build, so there are no accounts here. Your data stays in this browser.
          </div>
        )}
        {step === 'email' ? (
          <form className="card stack" onSubmit={submitEmail}>
            <div>
              <label className="lbl" htmlFor="email">
                Your email
              </label>
              <input id="email" type="email" inputMode="email" autoComplete="email" autoCapitalize="off" spellCheck={false} value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@example.com" />
            </div>
            {error && (
              <p className="err" role="alert">
                {error}
              </p>
            )}
            <button className="btn primary block" disabled={busy || mode === 'local'} type="submit">
              {busy ? 'Sending…' : 'Email me a sign-in code'}
            </button>
            {googleEnabled && (
              <button className="btn block" type="button" onClick={() => void signInWithGoogle().catch((e: Error) => setError(e.message))}>
                Continue with Google
              </button>
            )}
            <p className="small muted">No password. We email you a 6-digit code (or a link, if you prefer to tap it).</p>
          </form>
        ) : (
          <form className="card stack" onSubmit={submitCode}>
            <p>
              We sent a code to <b>{email}</b>. Enter it below, or tap the link in that email.
            </p>
            <div>
              <label className="lbl" htmlFor="code">
                6-digit code
              </label>
              <input id="code" type="text" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]*" maxLength={8} value={code} onChange={(e) => setCode(e.target.value)} placeholder="123456" />
            </div>
            {error && (
              <p className="err" role="alert">
                {error}
              </p>
            )}
            <button className="btn primary block" disabled={busy || code.trim().length < 6} type="submit">
              {busy ? 'Checking…' : 'Sign in'}
            </button>
            <button className="btn ghost block" type="button" onClick={() => { setStep('email'); setCode(''); setError(null); }}>
              Use a different email
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
