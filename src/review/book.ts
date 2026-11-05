// Opening book: a position is "book" when it appears on a named line of the Lichess opening list.
import { Chess } from '@/chess/compat';
import data from './data/openings.json';

let book: Map<string, string> | null = null;

/** Board + side to move + castling rights (en passant squares differ between engines for no real reason). */
const key = (fen: string): string => fen.split(' ').slice(0, 3).join(' ');

function build(): Map<string, string> {
  const m = new Map<string, string>();
  for (const [, name, line] of data as [string, string, string][]) {
    const c = new Chess();
    for (const san of line.split(' ')) {
      try {
        c.move(san);
      } catch {
        break;
      }
      const k = key(c.fen());
      // Keep the shortest (most general) name: "Sicilian Defense" rather than a deep variation reached by transposition.
      const prev = m.get(k);
      if (prev === undefined || name.length < prev.length) m.set(k, name);
    }
  }
  return m;
}

/** The opening's name when `fen` (the position AFTER a move) is in the book, otherwise undefined. */
export function bookName(fen: string): string | undefined {
  book ??= build();
  return book.get(key(fen));
}

export const isBook = (fen: string): boolean => bookName(fen) !== undefined;
