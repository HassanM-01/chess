import type { MoveClass } from '@/review/types';

export interface ClassMeta {
  label: string;
  color: string;
  glyph: string;
  /** how the class reads in a sentence: "Nf3 is a blunder" */
  phrase: string;
}

export const CLASS_META: Record<MoveClass, ClassMeta> = {
  brilliant: { label: 'Brilliant', color: '#1baca6', glyph: '!!', phrase: 'a brilliant move' },
  great: { label: 'Great', color: '#5c8bb0', glyph: '!', phrase: 'a great move' },
  best: { label: 'Best', color: '#81b64c', glyph: '★', phrase: 'the best move' },
  excellent: { label: 'Excellent', color: '#81b64c', glyph: '✓', phrase: 'an excellent move' },
  good: { label: 'Good', color: '#95b776', glyph: '✓', phrase: 'a good move' },
  book: { label: 'Book', color: '#a88865', glyph: '≡', phrase: 'a book move' },
  inaccuracy: { label: 'Inaccuracy', color: '#f7c631', glyph: '?!', phrase: 'an inaccuracy' },
  mistake: { label: 'Mistake', color: '#ffa459', glyph: '?', phrase: 'a mistake' },
  miss: { label: 'Miss', color: '#ff7769', glyph: '✕', phrase: 'a miss' },
  blunder: { label: 'Blunder', color: '#fa412d', glyph: '??', phrase: 'a blunder' },
  forced: { label: 'Forced', color: '#97af8b', glyph: '→', phrase: 'forced' },
};

export function ClassIcon({ cls, size = 22 }: { cls: MoveClass; size?: number }): JSX.Element {
  const m = CLASS_META[cls];
  return (
    <span
      className="cls-icon"
      title={m.label}
      style={{ background: m.color, width: size, height: size, fontSize: m.glyph.length > 1 ? size * 0.5 : size * 0.62 }}
    >
      {m.glyph}
    </span>
  );
}

/** Evaluation as a chess player writes it: +1.43, -0.30, M3. */
export function formatEval(cp: number, mate: number | null): string {
  if (mate != null) return mate > 0 ? `M${mate}` : `-M${-mate}`;
  if (Math.abs(cp) >= 9000) return cp > 0 ? 'M' : '-M';
  const v = cp / 100;
  return (v > 0 ? '+' : '') + v.toFixed(2);
}
