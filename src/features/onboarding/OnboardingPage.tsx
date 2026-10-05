import { useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { ChesscomError } from '@/chesscom/client';
import { chesscomClient } from '@/chesscom/instance';
import { useProfile, useUpdateProfile } from '@/state/queries';
import { useSyncController } from '@/state/sync';

/** Friendly text for the unique-index violation on profiles.chesscom_username. */
export function usernameSaveError(e: unknown): string {
  const msg = e instanceof Error ? e.message : String(e);
  const code = (e as { code?: string }).code;
  if (code === '23505' || /duplicate key|already exists|unique/i.test(msg)) return 'That chess.com username is already linked to another account.';
  return 'Could not save your username. Try again.';
}

export function OnboardingPage(): JSX.Element {
  const nav = useNavigate();
  const { data: profile } = useProfile();
  const update = useUpdateProfile();
  const sync = useSyncController();
  const [name, setName] = useState(profile?.chesscomUsername ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: FormEvent): Promise<void> => {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const canonical = await chesscomClient.validateUsername(name);
      try {
        await update.mutateAsync({ chesscomUsername: canonical });
      } catch (err) {
        setError(usernameSaveError(err));
        return;
      }
      void sync.pull(); // first "Pull recent games" runs right away; progress shows on the Games screen
      nav('/games', { replace: true });
    } catch (err) {
      if (err instanceof ChesscomError && err.kind === 'notfound') setError(`We couldn't find "${name.trim()}" on chess.com. Check the spelling.`);
      else if (err instanceof ChesscomError) setError(err.message);
      else setError('Something went wrong. Try again.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="app">
      <div className="stack" style={{ paddingTop: 40 }}>
        <div className="hero stack-s">
          <div className="eyebrow">Step 1 of 1</div>
          <h1>What's your chess.com username?</h1>
          <p className="muted">We pull your public games from chess.com. We can only read games, never play or change anything on your account.</p>
        </div>
        <form className="card stack" onSubmit={submit}>
          <div>
            <label className="lbl" htmlFor="username">
              chess.com username
            </label>
            <input id="username" type="text" autoComplete="off" autoCapitalize="off" autoCorrect="off" spellCheck={false} value={name} onChange={(e) => setName(e.target.value)} placeholder="huhsaaan" />
          </div>
          {error && (
            <p className="err" role="alert">
              {error}
            </p>
          )}
          <button className="btn primary block" disabled={busy || name.trim().length < 2} type="submit">
            {busy ? 'Checking…' : 'Link account and pull my games'}
          </button>
        </form>
      </div>
    </div>
  );
}
