import { Navigate, useNavigate, useParams } from 'react-router-dom';
import { SessTop } from '@/components/ui';
import { LESSONS } from '@/content/lessons';
import { dailyFor, useProgress, useProgressUpdater } from '@/state/queries';
import { localDateKey } from '@/lib/util';
import { useStartSession } from '@/features/train/useStartSession';

export function LessonPage(): JSX.Element {
  const { id } = useParams();
  const nav = useNavigate();
  const { data: progress } = useProgress();
  const updateProgress = useProgressUpdater();
  const { startPuzzles } = useStartSession();
  const lesson = LESSONS.find((l) => l.id === id);
  if (!lesson) return <Navigate to="/learn" replace />;
  const done = !!progress?.lessons[lesson.id];
  const pr = lesson.practice;

  const markDone = (): Promise<unknown> =>
    done
      ? Promise.resolve()
      : updateProgress((p) => {
          const d = dailyFor(p, localDateKey());
          return { lessons: { ...p.lessons, [lesson.id]: true }, daily: { ...d, lesson: (d.lesson ?? 0) + 1 } };
        });

  const startPractice = (): void => {
    if (pr.kind === 'puzzles') {
      void startPuzzles({ theme: pr.theme, n: pr.n, title: lesson.title, onDone: () => void markDone(), returnTo: '/learn' });
    } else if (pr.kind === 'opening') {
      void markDone();
      nav(`/learn/opening/${pr.set}/${pr.line < 0 ? 0 : pr.line}${pr.line < 0 ? '?cycle=1' : ''}`);
    } else {
      void markDone();
      nav(pr.fen ? `/play?fen=${encodeURIComponent(pr.fen)}` : '/play?check=1');
    }
  };

  return (
    <div className="stack" data-testid="lesson">
      <SessTop title={lesson.title} sub={`${lesson.mins} min lesson`} to="/learn" />
      <div className="card stack">
        {lesson.cards.map((t, i) => (
          <p key={i}>{t}</p>
        ))}
      </div>
      <button className="btn primary block" onClick={startPractice} data-testid="lesson-practice">
        {pr.label}
      </button>
      <button
        className="btn ghost block"
        onClick={() => {
          void markDone().then(() => nav('/learn'));
        }}
      >
        {done ? 'Done' : 'Mark as done'}
      </button>
    </div>
  );
}
