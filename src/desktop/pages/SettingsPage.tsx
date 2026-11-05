import { useEffect, useState } from 'react';
import { PRESETS, type PresetKey } from '@/review/presets';
import type { SystemInfo } from '../api';
import { applyEngineSettings, getEngine, useEngineStatus } from '../lib/desktopEngine';
import { askCoachTest } from '../lib/coachTest';
import { removeCoachKey, saveCoachKey, useCoachKey } from '../lib/coach';
import { getSystem, useSettings } from '../state/settings';

const HASH_CHOICES = [256, 512, 1024, 2048, 4096, 8192, 12288, 16384];

export function SettingsPage(): JSX.Element {
  const s = useSettings();
  const engine = useEngineStatus();
  const [sys, setSys] = useState<SystemInfo | null>(null);
  const [path, setPath] = useState<{ path: string; found: boolean } | null>(null);
  const [note, setNote] = useState('');
  const hasKey = useCoachKey();
  const [keyText, setKeyText] = useState('');
  const [coachNote, setCoachNote] = useState<{ ok: boolean; text: string } | null>(null);
  const [coachBusy, setCoachBusy] = useState(false);

  useEffect(() => {
    void getSystem().then(setSys);
    void window.desktop!.engine.info().then(setPath);
  }, [engine.status]);

  if (!sys) return <div className="dk-page">Loading…</div>;
  const threads = s.threads ?? sys.recommended.threads;
  const hash = s.hashMb ?? sys.recommended.hashMb;

  const choosePreset = (k: PresetKey): void => s.set({ preset: k, depth: PRESETS[k].depth, movetimeMs: PRESETS[k].movetimeMs, multipv: PRESETS[k].multipv });
  const custom = (patch: Partial<typeof s>): void => s.set({ ...patch, preset: 'custom' });

  return (
    <div className="dk-page narrow" data-testid="settings-page">
      <h1>Settings</h1>

      <div className="dk-card stack">
        <h3>Engine</h3>
        <div className="small">
          <b data-testid="engine-name">{engine.name || 'Stockfish'}</b>{' '}
          <span className={`pill ${engine.status === 'ready' ? 'good' : engine.status === 'failed' ? 'bad' : ''}`}>
            {engine.status === 'ready' ? 'running' : engine.status === 'loading' ? 'starting' : engine.status === 'failed' ? 'not working' : 'idle'}
          </span>
          <div className="muted ellipsis">{path?.found ? path.path : 'Stockfish was not found.'}</div>
          {engine.error && <div className="err">{engine.error}</div>}
        </div>
        <div className="row">
          <button
            className="btn"
            onClick={async () => {
              const p = await window.desktop!.engine.pick();
              if (p) {
                setNote('Engine changed. It will start on the next analysis.');
                getEngine().requestRestart();
                setPath({ path: p, found: true });
              }
            }}
          >
            Choose a different Stockfish…
          </button>
          <button className="btn" onClick={() => { applyEngineSettings(); setNote('Engine restarted.'); }}>Restart engine</button>
        </div>
        {note && <div className="small muted">{note}</div>}

        <div>
          <label className="lbl" htmlFor="threads">Threads: {threads} of {sys.logicalCores}</label>
          <input id="threads" type="range" min={1} max={sys.logicalCores} value={threads} onChange={(e) => s.set({ threads: +e.target.value })} data-testid="threads" />
          <div className="small muted">{sys.cpuModel}. Using every thread is fastest but makes the rest of the computer sluggish; the default leaves two free.</div>
        </div>
        <div>
          <label className="lbl" htmlFor="hash">Hash memory</label>
          <select id="hash" value={hash} onChange={(e) => s.set({ hashMb: +e.target.value })} data-testid="hash">
            {[...new Set([...HASH_CHOICES.filter((h) => h <= sys.totalMemMb * 0.75), hash])].sort((a, b) => a - b).map((h) => (
              <option key={h} value={h}>{h >= 1024 ? `${h / 1024} GB` : `${h} MB`}</option>
            ))}
          </select>
          <div className="small muted">{(sys.totalMemMb / 1024).toFixed(0)} GB installed. More hash helps long, deep searches.</div>
        </div>
      </div>

      <div className="dk-card stack">
        <h3>How deep to analyze</h3>
        <div className="preset-grid">
          {(Object.keys(PRESETS) as PresetKey[]).map((k) => (
            <button key={k} className={`preset${s.preset === k ? ' on' : ''}`} onClick={() => choosePreset(k)} data-testid={`preset-${k}`}>
              <b>{PRESETS[k].label}</b>
              <span className="small muted">{PRESETS[k].blurb}</span>
            </button>
          ))}
        </div>
        <div className="grid3">
          <div>
            <label className="lbl" htmlFor="depth">Target depth</label>
            <input id="depth" type="number" min={8} max={80} value={s.depth} onChange={(e) => custom({ depth: Math.max(8, Math.min(80, +e.target.value || 8)) })} />
          </div>
          <div>
            <label className="lbl" htmlFor="time">Max seconds per move</label>
            <input id="time" type="number" min={1} max={600} value={Math.round(s.movetimeMs / 1000)} onChange={(e) => custom({ movetimeMs: Math.max(1, Math.min(600, +e.target.value || 1)) * 1000 })} />
          </div>
          <div>
            <label className="lbl" htmlFor="mpv">Lines (MultiPV)</label>
            <input id="mpv" type="number" min={1} max={5} value={s.multipv} onChange={(e) => custom({ multipv: Math.max(1, Math.min(5, +e.target.value || 1)) })} />
          </div>
        </div>
        <p className="small muted">
          Each position is searched until it reaches the target depth or the time limit, whichever comes first. Two or more lines are needed to spot Great moves and to build puzzles.
          Changing this only affects reviews you start afterwards.
        </p>
      </div>

      <div className="dk-card stack-s" data-testid="coach-settings">
        <h3>AI coach (optional)</h3>
        <p className="small muted">
          The coach explains a move or puzzle in simple words and answers follow-up questions. It only talks about what Stockfish has already confirmed, so it cannot make up moves.
          It uses <b>your own Anthropic API key</b> (made at console.anthropic.com; this is separate from a Claude.ai subscription and is billed by Anthropic per question, usually a small fraction of a cent to a few cents).
        </p>
        <p className="small muted">
          When you press "Ask the coach", the position, the moves and the engine's analysis of that one move or puzzle are sent to Anthropic. Your username and your other games are not sent.
          The key is stored encrypted on this computer and is never shown again.
        </p>
        <button className="linklike small" onClick={() => window.desktop?.openExternal('https://console.anthropic.com/settings/keys')}>Open the Anthropic page where keys are made</button>
        {hasKey ? (
          <div className="row">
            <span className="pill good" data-testid="coach-key-saved">A key is saved</span>
            <button className="btn" onClick={() => { void removeCoachKey(); setCoachNote(null); }}>Remove the key</button>
          </div>
        ) : (
          <div className="row">
            <input className="grow" type="password" autoComplete="off" spellCheck={false} placeholder="sk-ant-..." value={keyText} onChange={(e) => setKeyText(e.target.value)} data-testid="coach-key-input" />
            <button
              className="btn primary"
              disabled={!keyText.trim() || coachBusy}
              data-testid="coach-key-save"
              onClick={async () => {
                setCoachBusy(true);
                setCoachNote(null);
                try {
                  await saveCoachKey(keyText);
                  setKeyText('');
                  setCoachNote(await askCoachTest());
                } catch (e) {
                  setCoachNote({ ok: false, text: (e instanceof Error ? e.message : String(e)).replace(/^Error invoking remote method '[^']+': (Error: )?/, '') });
                } finally {
                  setCoachBusy(false);
                }
              }}
            >
              {coachBusy ? 'Testing…' : 'Save and test'}
            </button>
          </div>
        )}
        {coachNote && <div className={coachNote.ok ? 'small' : 'err small'}>{coachNote.text}</div>}
      </div>

      <div className="dk-card stack-s">
        <h3>chess.com</h3>
        <label className="lbl" htmlFor="cc">Username</label>
        <input id="cc" type="text" value={s.chesscomUsername} onChange={(e) => s.set({ chesscomUsername: e.target.value })} placeholder="your chess.com username" />
      </div>

      <div className="dk-card stack-s">
        <h3>Board</h3>
        <div className="seg" role="group" aria-label="Board colors">
          {(['green', 'brown', 'blue'] as const).map((b) => (
            <button key={b} aria-pressed={s.boardTheme === b} onClick={() => s.set({ boardTheme: b })}>{b[0].toUpperCase() + b.slice(1)}</button>
          ))}
        </div>
      </div>

      <div className="dk-card small muted">
        Blunder Check Desktop {sys.appVersion}. Engine: Stockfish (GPLv3, stockfishchess.org). Opening names: Lichess opening database (CC0). Puzzles: Lichess puzzle database (CC0).
        Pieces: cburnett (CC BY-SA 3.0). Move ratings follow chess.com's published expected-points thresholds; accuracy uses Lichess' formula, so numbers will differ from chess.com's own.
      </div>
    </div>
  );
}
