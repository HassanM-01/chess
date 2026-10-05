import { useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Hero, Segmented, Switch } from '@/components/ui';
import { ChesscomError } from '@/chesscom/client';
import { chesscomClient } from '@/chesscom/instance';
import { LEVELS } from '@/features/play/levels';
import { useAuth } from '@/state/auth';
import { useProfile, useUpdateProfile } from '@/state/queries';
import { toast } from '@/state/toast';
import { timeAgo } from '@/lib/util';
import { usernameSaveError } from '@/features/onboarding/OnboardingPage';

export function SettingsPage(): JSX.Element {
  const nav = useNavigate();
  const { mode, email, signOut, deleteAccount } = useAuth();
  const { data: profile } = useProfile();
  const update = useUpdateProfile();
  const [username, setUsername] = useState('');
  const [display, setDisplay] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  if (!profile) return <div className="muted">Loading…</div>;
  const s = profile.settings;
  const setSetting = (patch: typeof s): void => update.mutate({ settings: patch });
  const theme = s.theme ?? 'system';

  const saveUsername = async (e: FormEvent): Promise<void> => {
    e.preventDefault();
    const name = (username || profile.chesscomUsername || '').trim();
    if (!name || name.toLowerCase() === profile.chesscomUsername) return;
    setBusy(true);
    setError(null);
    try {
      const canonical = await chesscomClient.validateUsername(name);
      await update.mutateAsync({ chesscomUsername: canonical });
      toast('Username saved. Pull your games again to refresh the report.');
      setUsername('');
    } catch (err) {
      if (err instanceof ChesscomError) setError(err.kind === 'notfound' ? `We couldn't find "${name}" on chess.com.` : err.message);
      else setError(usernameSaveError(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="stack">
      <Hero eyebrow="Settings" title="Your account" />
      <div className="card stack">
        <div className="spread">
          <div>
            <div className="small muted">Signed in as</div>
            <b>{mode === 'local' ? 'Local mode (this browser)' : (email ?? 'you')}</b>
          </div>
          <button
            className="btn"
            onClick={() => {
              void signOut().then(() => nav('/login'));
            }}
            disabled={mode === 'local'}
          >
            Sign out
          </button>
        </div>
        <div className="small muted">Last pulled: {profile.lastSyncedAt ? timeAgo(profile.lastSyncedAt) : 'never'}</div>
      </div>

      <form className="card stack" onSubmit={(e) => void saveUsername(e)}>
        <div>
          <label className="lbl" htmlFor="uname">
            chess.com username
          </label>
          <input id="uname" type="text" autoCapitalize="off" autoCorrect="off" spellCheck={false} value={username || profile.chesscomUsername || ''} onChange={(e) => setUsername(e.target.value)} />
        </div>
        {error && (
          <p className="err" role="alert">
            {error}
          </p>
        )}
        <button className="btn" type="submit" disabled={busy}>
          {busy ? 'Checking…' : 'Save username'}
        </button>
        <div>
          <label className="lbl" htmlFor="dname">
            Display name
          </label>
          <input id="dname" type="text" value={display ?? profile.displayName ?? ''} onChange={(e) => setDisplay(e.target.value)} onBlur={() => display != null && display !== profile.displayName && update.mutate({ displayName: display.trim() || null })} />
        </div>
      </form>

      <div className="card stack">
        <h3>Play settings</h3>
        <div>
          <div className="lbl">Default bot level</div>
          <Segmented label="Bot level" value={s.level ?? 1} options={LEVELS.map((l, i) => ({ value: i, label: l.name }))} onChange={(v) => setSetting({ level: v })} />
        </div>
        <div>
          <div className="lbl">Your colour</div>
          <Segmented
            label="Your colour"
            value={s.color ?? 'w'}
            options={[
              { value: 'w', label: 'White' },
              { value: 'b', label: 'Black' },
              { value: 'r', label: 'Random' },
            ]}
            onChange={(v) => setSetting({ color: v })}
          />
        </div>
        <div className="toggle">
          <div>
            <b>Blunder Check</b>
            <div className="small muted">Stops you when a move loses material</div>
          </div>
          <Switch label="Blunder Check" checked={s.blunderCheck !== false} onChange={(v) => setSetting({ blunderCheck: v })} />
        </div>
        <div className="toggle">
          <div>
            <b>London coach arrow</b>
            <div className="small muted">Shows the coach's move in the London simulator</div>
          </div>
          <Switch label="London coach arrow" checked={s.londonGuide !== false} onChange={(v) => setSetting({ londonGuide: v })} />
        </div>
      </div>

      <div className="card stack">
        <h3>Appearance</h3>
        <Segmented
          label="Theme"
          value={theme}
          options={[
            { value: 'system', label: 'System' },
            { value: 'light', label: 'Light' },
            { value: 'dark', label: 'Dark' },
          ]}
          onChange={(v) => setSetting({ theme: v })}
        />
      </div>

      <div className="card stack">
        <h3>Delete account</h3>
        <p className="small muted">Removes your profile, games, analysis and progress for good. This cannot be undone.</p>
        {!confirmDelete ? (
          <button className="btn" onClick={() => setConfirmDelete(true)}>
            Delete my account…
          </button>
        ) : (
          <div className="row">
            <button
              className="btn primary"
              style={{ background: 'var(--bad)', borderColor: 'var(--bad)' }}
              onClick={() => {
                void deleteAccount()
                  .then(() => nav('/login'))
                  .catch((e: Error) => toast(e.message));
              }}
            >
              Yes, delete everything
            </button>
            <button className="btn ghost" onClick={() => setConfirmDelete(false)}>
              Cancel
            </button>
          </div>
        )}
      </div>
      <p className="small muted">
        <Link to="/about">About and credits</Link>
      </p>
    </div>
  );
}
