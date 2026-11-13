// The Play menu: a free game against the computer, or practice for openings, middlegames and endgames.
import { useState } from 'react';
import { PLAY_LEVELS, type CoachMode } from '@/review/playCoach';
import { ENDGAMES, MIDDLEGAMES, OPENING_CHOICES, type Scenario } from '@/review/scenarios';
import { colorName } from '@/chess/types';
import { usePlay } from '../state/play';

type Tab = 'free' | 'openings' | 'middlegame' | 'endgame';

const TABS: { key: Tab; label: string; blurb: string }[] = [
  { key: 'free', label: 'Play a game', blurb: 'A full game from the start.' },
  { key: 'openings', label: 'Openings', blurb: 'Learn the first moves, with the reason for each.' },
  { key: 'middlegame', label: 'Middlegames', blurb: 'Both sides are developed. Find a plan.' },
  { key: 'endgame', label: 'Endgames', blurb: 'Few pieces left. Technique decides.' },
];

const COACH: { key: CoachMode; label: string; blurb: string }[] = [
  { key: 'warn', label: 'Stop me before a bad move', blurb: 'Stockfish checks every move you make. If it is a mistake or a blunder, you get to take it back before the computer replies.' },
  { key: 'watch', label: 'Tell me after each move', blurb: 'The game keeps going. Stockfish labels each move and explains it as you play.' },
  { key: 'off', label: 'Off', blurb: 'A plain game with no help from Stockfish.' },
];

function Seg<T extends string | number>({ value, options, onChange, testid }: { value: T; options: { value: T; label: string }[]; onChange: (v: T) => void; testid: string }): JSX.Element {
  return (
    <div className="seg" role="group" data-testid={testid}>
      {options.map((o) => (
        <button key={String(o.value)} className={value === o.value ? 'on' : ''} aria-pressed={value === o.value} onClick={() => onChange(o.value)} data-testid={`${testid}-${o.value}`}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function PlaySetup(): JSX.Element {
  const prefs = usePlay((s) => s.prefs);
  const progress = usePlay((s) => s.progress);
  const [tab, setTab] = useState<Tab>('free');
  const level = PLAY_LEVELS[prefs.level] ?? PLAY_LEVELS[1];

  const startFree = (): void => {
    usePlay.getState().start({ kind: 'free', title: 'Game against the computer', me: prefs.color, level: prefs.level });
  };

  const startScenario = (sc: Scenario): void => {
    usePlay.getState().start({ kind: sc.kind, title: sc.title, tips: sc.tips, goal: sc.goal, scenarioId: sc.id, fen: sc.fen, me: sc.side, level: prefs.level });
  };

  const scenarioCard = (sc: Scenario): JSX.Element => {
    const p = progress[sc.id];
    return (
      <div className="dk-card scenario-card" key={sc.id} data-testid={`scenario-${sc.id}`}>
        <div className="grow stack-s">
          <b>{sc.title}</b>
          <span className="small muted">{sc.blurb}</span>
          <div className="row small">
            <span className="pill">You play {colorName(sc.side)}</span>
            <span className={`pill ${sc.goal === 'win' ? 'good' : ''}`}>{sc.goal === 'win' ? 'Goal: win' : sc.goal === 'draw' ? 'Goal: hold the draw' : 'Play it well'}</span>
            {p && <span className="muted">Played {p.plays}×{sc.goal !== 'play' ? ` · goal met ${p.met}×` : ''}</span>}
          </div>
        </div>
        <button className="btn primary" onClick={() => startScenario(sc)} data-testid={`start-${sc.id}`}>Start</button>
      </div>
    );
  };

  return (
    <div className="dk-page" data-testid="play-setup">
      <h1>Play</h1>
      <p className="muted">
        Play the computer while Stockfish, at full strength, watches every move you make. It tells you if a move is good, stops you before a blunder, and points out what you might be missing.
      </p>

      <div className="dk-card stack" data-testid="play-options">
        <div className="stack-s">
          <b>How strong is the computer?</b>
          <Seg value={prefs.level} options={PLAY_LEVELS.map((l, i) => ({ value: i, label: l.name }))} onChange={(v) => usePlay.getState().setPrefs({ level: v })} testid="level" />
          <span className="small muted">{level.blurb}</span>
        </div>
        <div className="stack-s">
          <b>Blunder Check</b>
          <Seg value={prefs.coach} options={COACH.map((c) => ({ value: c.key, label: c.label }))} onChange={(v) => usePlay.getState().setPrefs({ coach: v })} testid="coach" />
          <span className="small muted">{COACH.find((c) => c.key === prefs.coach)?.blurb}</span>
        </div>
      </div>

      <div className="pl-tabs" role="tablist">
        {TABS.map((t) => (
          <button key={t.key} role="tab" aria-selected={tab === t.key} className={`pl-tab${tab === t.key ? ' on' : ''}`} onClick={() => setTab(t.key)} data-testid={`tab-${t.key}`}>
            {t.label}
          </button>
        ))}
      </div>
      <p className="small muted">{TABS.find((t) => t.key === tab)?.blurb}</p>

      {tab === 'free' && (
        <div className="dk-card stack">
          <div className="stack-s">
            <b>Your colour</b>
            <Seg value={prefs.color} options={[{ value: 'w', label: 'White' }, { value: 'b', label: 'Black' }, { value: 'r', label: 'Random' }]} onChange={(v) => usePlay.getState().setPrefs({ color: v })} testid="color" />
          </div>
          <div className="row">
            <button className="btn primary" onClick={startFree} data-testid="start-free">Start a game</button>
          </div>
        </div>
      )}

      {tab === 'openings' && (
        <div className="stack">
          {OPENING_CHOICES.map((o) => (
            <div className="dk-card stack-s" key={o.key} data-testid={`opening-${o.key}`}>
              <div className="row">
                <b className="grow">{o.title}</b>
                <span className="pill">You play {colorName(o.side)}</span>
              </div>
              <span className="small muted">{o.blurb}</span>
              <div className="stack-s">
                {o.lines.map((d) => (
                  <div className="drill-row" key={d.id}>
                    <span className="grow small">
                      {d.line} <span className="muted">· {d.moves.length} moves</span>
                      {progress[d.id]?.met ? <span className="pill good" data-testid={`learned-${d.id}`}>Finished {progress[d.id].met}×</span> : null}
                    </span>
                    <button
                      className="btn"
                      onClick={() => usePlay.getState().start({ kind: 'opening', title: `${o.title}: ${d.line}`, me: d.side, level: prefs.level, drillId: d.id, tips: [] })}
                      data-testid={`drill-${d.id}`}
                    >
                      Learn this line
                    </button>
                  </div>
                ))}
              </div>
              <div className="row">
                <button
                  className="btn"
                  onClick={() =>
                    usePlay.getState().start({
                      kind: 'opening',
                      title: `${o.title}: play it`,
                      me: o.side,
                      level: prefs.level,
                      tips: [`Aim for this setup: ${o.lines[0].moves.filter((m) => m.by === o.side).slice(0, 7).map((m) => m.san).join(', ')}.`, o.blurb],
                    })
                  }
                  data-testid={`play-opening-${o.key}`}
                >
                  Play it against the computer
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {tab === 'middlegame' && <div className="stack">{MIDDLEGAMES.map(scenarioCard)}</div>}
      {tab === 'endgame' && <div className="stack">{ENDGAMES.map(scenarioCard)}</div>}
    </div>
  );
}
