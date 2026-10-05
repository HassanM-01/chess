import { Link } from 'react-router-dom';
import { Hero, Pill } from '@/components/ui';
import { useProgress } from '@/state/queries';
import { PATTERNS } from './patterns';
import { TECHNIQUES } from './technique';

/** Checkmate school: learn how to BUILD a mate (technique), and recognise the classic shapes (patterns). */
export function MateSchoolPage(): JSX.Element {
  const { data: progress } = useProgress();
  const done = (progress?.play as { mate?: Record<string, number> } | undefined)?.mate ?? {};
  return (
    <div className="stack" data-testid="mate-school">
      <Hero eyebrow="Checkmate school" title="Stop chasing the king. Learn the plan." />
      <p className="muted">
        Chasing a king with checks almost never works. Mating is a plan: take squares away until he has none, then check. Start with the three endings you must be able to win, then learn the shapes that
        come up in real games.
      </p>

      <div className="stack-s">
        <h2>1. Technique: build the mate</h2>
        <p className="small muted">You play White against the best defence. A plan card tells you what to do now, a yellow cage shows every square the king can still reach, and each move is graded on whether it shrank the cage.</p>
        <div className="card list">
          {TECHNIQUES.map((t) => (
            <Link key={t.kind} to={`/learn/mate/practice/${t.kind}`} className="li" style={{ textDecoration: 'none', color: 'inherit' }} data-testid={`technique-${t.kind}`}>
              <Pill tone={done[t.kind] ? 'good' : ''}>{done[t.kind] ? `✓ ${done[t.kind]}` : 'New'}</Pill>
              <span>
                <b>{t.title}</b>
                <div className="small muted">{t.blurb}</div>
              </span>
              <span className="muted" aria-hidden="true">
                ›
              </span>
            </Link>
          ))}
        </div>
      </div>

      <div className="stack-s">
        <h2>2. Patterns: see why it is mate</h2>
        <p className="small muted">Watch each one step by step, or play it yourself. The last position always shows every square the king cannot use, and why.</p>
        <div className="card list">
          {PATTERNS.map((p) => (
            <Link key={p.id} to={`/learn/mate/pattern/${p.id}`} className="li" style={{ textDecoration: 'none', color: 'inherit' }} data-testid={`pattern-${p.id}`}>
              <Pill tone="acc">{`${Math.ceil(p.moves.length / 2)} move${p.moves.length <= 2 ? '' : 's'}`}</Pill>
              <span>
                <b>{p.title}</b>
                <div className="small muted">{p.blurb}</div>
              </span>
              <span className="muted" aria-hidden="true">
                ›
              </span>
            </Link>
          ))}
        </div>
      </div>
    </div>
  );
}
