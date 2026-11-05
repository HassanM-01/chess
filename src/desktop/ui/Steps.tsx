import type { Step } from '@/review/words';

/** A numbered, plain-words breakdown (see review/words.ts). */
export function Steps({ steps }: { steps: Step[] }): JSX.Element | null {
  if (!steps.length) return null;
  return (
    <div className="steps" data-testid="steps">
      {steps.map((s) => (
        <div className="step" key={s.title}>
          <b className="small">{s.title}</b>
          {s.lines.filter(Boolean).map((l, i) => (
            <p key={i} className="small">{l}</p>
          ))}
        </div>
      ))}
    </div>
  );
}

/** A note about a move the person tried: why it works, or why it does not. */
export interface TryNote {
  tone: 'good' | 'bad';
  title: string;
  lines: string[];
  lesson?: string;
}

export function NoteCard({ note }: { note: TryNote }): JSX.Element {
  return (
    <div className={`dk-card note-card ${note.tone}`} data-testid="try-note">
      <b>{note.title}</b>
      {note.lines.filter(Boolean).map((l, i) => (
        <p key={i} className="small">{l}</p>
      ))}
      {note.lesson && <div className="remember small">💡 {note.lesson}</div>}
    </div>
  );
}
