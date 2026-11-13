// Stockfish's verdict on one move you played: its label, a plain-English reason, and (optionally) a step-by-step breakdown and the AI coach.
import { useEffect, useState } from 'react';
import type { Color } from '@/chess/types';
import { moveFacts } from '@/review/coachFacts';
import { moveSteps } from '@/review/words';
import type { Verdict } from '../state/play';
import { ClassIcon, CLASS_META, formatEval } from './classInfo';
import { CoachBox } from './CoachBox';
import { Steps } from './Steps';

const WEAK = ['inaccuracy', 'mistake', 'miss', 'blunder', 'great', 'brilliant'];

export function MoveVerdict({ verdict, fenBefore, me, coach = true }: { verdict: Verdict; fenBefore: string; me: Color; coach?: boolean }): JSX.Element {
  const [steps, setSteps] = useState(false);
  useEffect(() => setSteps(false), [verdict.ply, verdict.uci]);

  if (verdict.status === 'checking') {
    return (
      <div className="dk-card move-card" data-testid="verdict" data-status="checking">
        <div className="row">
          <div className="spinner tiny" aria-hidden="true" />
          <span className="small">Stockfish is checking {verdict.san}…</span>
        </div>
      </div>
    );
  }
  const j = verdict.judgement;
  if (!j) {
    return (
      <div className="dk-card move-card" data-testid="verdict" data-status="unavailable">
        <span className="small muted">Stockfish could not check {verdict.san} this time.</span>
      </div>
    );
  }
  const m = j.move;
  const ex = j.explanation;
  const input = { fenBefore, move: m, before: j.before, after: j.after, userColor: me } as const;
  return (
    <div className={`dk-card move-card ${m.cls}`} data-testid="verdict" data-status="done" data-class={m.cls}>
      <div className="row">
        <ClassIcon cls={m.cls} size={30} />
        <div>
          <b data-testid="verdict-title">{m.cls === 'forced' ? `${m.san} was the only move` : `${m.san} is ${CLASS_META[m.cls].phrase}`}</b>
          <div className="small muted">eval {formatEval(m.evalCp, m.evalMate)} for White</div>
        </div>
      </div>
      {ex && (
        <div className="explain" data-testid="verdict-explanation">
          <div className="ex-headline">{ex.headline}</div>
          {ex.what.map((t, i) => (
            <p key={i} className="small">{t}</p>
          ))}
          {ex.better && (
            <div className="ex-better">
              <b className="small">Why {m.bestSan} is better</b>
              <p className="small">{ex.better}</p>
            </div>
          )}
          {ex.lesson && <div className="remember small">💡 {ex.lesson}</div>}
        </div>
      )}
      {m.bestLineSan.length > 0 && m.bestUci !== m.uci && <p className="small muted">Engine line: {m.bestLineSan.join(' ')}</p>}
      {WEAK.includes(m.cls) && (
        <div className="row">
          <button className="btn" onClick={() => setSteps((v) => !v)} data-testid="verdict-steps-btn">
            {steps ? 'Hide the step-by-step' : 'Break it down step by step'}
          </button>
        </div>
      )}
      {steps && <Steps steps={moveSteps(input)} />}
      {coach && <CoachBox resetKey={`${verdict.ply}:${verdict.uci}`} facts={moveFacts(input)} />}
    </div>
  );
}
