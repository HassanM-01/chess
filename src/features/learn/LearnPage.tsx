import { Link } from 'react-router-dom';
import { Hero, Pill } from '@/components/ui';
import { LESSONS } from '@/content/lessons';
import { OPENINGS, type OpeningKey } from '@/content/openings';
import { colorName } from '@/chess/types';
import { useProgress } from '@/state/queries';
import { nextLesson } from '@/features/coach/CoachPage';

export function LearnPage(): JSX.Element {
  const { data: progress } = useProgress();
  const nl = nextLesson(progress);
  const doneCount = LESSONS.filter((l) => progress?.lessons[l.id]).length;

  return (
    <div className="stack">
      <Hero eyebrow="Learn" title="A path from zero, in the order that wins games." />
      <Link to="/learn/mate" className="card stack-s" style={{ textDecoration: 'none', color: 'inherit' }} data-testid="mate-school-link">
        <div className="spread">
          <h3>Checkmate school</h3>
          <Pill tone="acc">New</Pill>
        </div>
        <p className="small muted">Stop chasing the king. Learn the plan for K+Q, K+R and two rooks, and the classic patterns, with every escape square explained.</p>
      </Link>
      <div className="stack-s">
        <div className="spread">
          <h2>Lessons</h2>
          <span className="small muted">{`${doneCount} of ${LESSONS.length} done`}</span>
        </div>
        <div className="card list" data-testid="lesson-list">
          {LESSONS.map((l, i) => {
            const done = !!progress?.lessons[l.id];
            const next = nl?.id === l.id;
            return (
              <Link key={l.id} to={`/learn/lesson/${l.id}`} className={`lesson${done ? ' done' : next ? ' next' : ''}`} style={{ textDecoration: 'none', color: 'inherit' }}>
                <span className="num">{done ? '✓' : i + 1}</span>
                <span>
                  <b>{l.title}</b>
                  <div className="small muted">{`${l.mins} min · ${l.practice.label}`}</div>
                </span>
                <span className="muted" aria-hidden="true">
                  ›
                </span>
              </Link>
            );
          })}
        </div>
      </div>

      <div className="stack-s">
        <h2>Your openings</h2>
        <p className="small muted">One plan as White, one answer to each first move as Black. You play your moves, the trainer plays theirs and explains every move.</p>
        {(Object.keys(OPENINGS) as OpeningKey[]).map((k) => {
          const set = OPENINGS[k];
          return (
            <div className="card stack-s" key={k}>
              <div className="spread">
                <h3>{set.title}</h3>
                <Pill tone="acc">{`You play ${colorName(set.side)}`}</Pill>
              </div>
              <p className="small muted">{set.blurb}</p>
              <div className="list">
                {set.lines.map((ln, i) => {
                  const d = progress?.openings[`${k}${i}`] ?? 0;
                  return (
                    <Link key={ln.name} to={`/learn/opening/${k}/${i}`} className="li" style={{ textDecoration: 'none', color: 'inherit' }}>
                      <Pill tone={d ? 'good' : ''}>{d ? `✓ ${d}` : 'New'}</Pill>
                      <span>{ln.name}</span>
                      <span className="muted" aria-hidden="true">
                        ›
                      </span>
                    </Link>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
