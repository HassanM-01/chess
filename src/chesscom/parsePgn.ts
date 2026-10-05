// PGN -> NewGame. Used for chess.com sync and for manual PGN paste/upload (spec 5).
import type { Outcome, Termination } from '@/analysis/types';
import { loadPgnSafe } from '@/chess/compat';
import { moveToUci } from '@/chess/helpers';
import { START_FEN, type Color } from '@/chess/types';
import type { GameSource, NewGame } from '@/db/types';

export function hashStr(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0).toString(36);
}

/** Last path segment of a chess.com game URL. */
export function externalIdFromUrl(url: string | undefined | null): string | null {
  if (!url) return null;
  const seg = url.split('?')[0].split('/').filter(Boolean).pop();
  return seg || null;
}

export function terminationFromHeader(raw: string | undefined, result: string | undefined): Termination {
  const t = (raw ?? '').toLowerCase();
  if (result === '1/2-1/2' && !t.includes('abandon')) return 'draw';
  if (t.includes('checkmate')) return 'checkmate';
  if (t.includes('resign')) return 'resignation';
  if (t.includes('time')) return 'time';
  if (t.includes('abandon')) return 'abandoned';
  if (/repetition|stalemate|agreement|insufficient|50/.test(t)) return 'draw';
  return 'other';
}

export function openingFromHeaders(h: Record<string, string>): string | null {
  if (h.ECOUrl) {
    const slug = h.ECOUrl.split('/').pop();
    if (slug) return decodeURIComponent(slug).replace(/-/g, ' ').replace(/\.{3}/g, '...').slice(0, 70);
  }
  return h.Opening ?? null;
}

export function timeClassFromControl(tc: string | undefined): string | null {
  if (!tc) return null;
  if (tc.includes('/')) return 'daily';
  const base = parseInt(tc, 10);
  if (Number.isNaN(base)) return null;
  const inc = parseInt(tc.split('+')[1] ?? '0', 10) || 0;
  const est = base + 40 * inc;
  if (est < 180) return 'bullet';
  if (est < 600) return 'blitz';
  return 'rapid';
}

export function outcomeFor(result: string | undefined, userColor: Color | null): Outcome | null {
  if (!userColor) return null;
  if (result === '1/2-1/2') return 'd';
  if (result === '1-0') return userColor === 'w' ? 'w' : 'l';
  if (result === '0-1') return userColor === 'b' ? 'w' : 'l';
  return null;
}

export function userColorFor(white: string | undefined, black: string | undefined, username: string | null | undefined): Color | null {
  const u = (username ?? '').trim().toLowerCase();
  if (!u) return null;
  if ((white ?? '').toLowerCase() === u) return 'w';
  if ((black ?? '').toLowerCase() === u) return 'b';
  return null;
}

function playedAtFromHeaders(h: Record<string, string>): string | null {
  const date = (h.UTCDate || h.Date || '').replace(/\./g, '-');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;
  const time = /^\d{2}:\d{2}:\d{2}$/.test(h.UTCTime ?? '') ? h.UTCTime : h.EndTime && /^\d{2}:\d{2}:\d{2}$/.test(h.EndTime) ? h.EndTime : '00:00:00';
  const d = new Date(`${date}T${time}Z`);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

export interface ParseOptions {
  username: string | null | undefined;
  source: GameSource;
  /** chess.com API value, when known (end_time in unix seconds) */
  endTime?: number;
  timeClass?: string | null;
  /** chess.com API game url (fallback for the Link header) */
  url?: string;
}

export const MIN_PLIES = 6;

/** Parse ONE PGN game. Returns null when unreadable or empty. */
export function parseGame(pgn: string, o: ParseOptions): NewGame | null {
  const loaded = loadPgnSafe(pgn.trim());
  if (!loaded) return null;
  const { headers: h, history } = loaded;
  const startFen = h.FEN || START_FEN; // odds games start from a custom FEN (SetUp/FEN headers)
  const white = h.White ?? 'White';
  const black = h.Black ?? 'Black';
  const result = h.Result ?? '*';
  const userColor = userColorFor(white, black, o.username);
  const movesUci = history.map(moveToUci);
  const movesSan = history.map((m) => m.san);
  const link = h.Link || o.url;
  const externalId =
    externalIdFromUrl(link) ?? `pgn_${hashStr(`${h.Date ?? ''}|${white}|${black}|${movesUci.join('')}`)}`;
  return {
    source: o.source,
    externalId,
    pgn: pgn.trim(),
    startFen,
    movesUci,
    movesSan,
    white,
    black,
    whiteRating: h.WhiteElo ? +h.WhiteElo || null : null,
    blackRating: h.BlackElo ? +h.BlackElo || null : null,
    userColor,
    result,
    outcome: outcomeFor(result, userColor),
    termination: terminationFromHeader(h.Termination, result),
    timeClass: o.timeClass ?? timeClassFromControl(h.TimeControl),
    opening: openingFromHeaders(h),
    eco: h.ECO ?? null,
    playedAt: o.endTime ? new Date(o.endTime * 1000).toISOString() : playedAtFromHeaders(h),
  };
}

/** Split a blob of text into PGN game chunks. */
export function splitPgns(text: string): string[] {
  const t = text.replace(/\r/g, '').trim();
  if (!t) return [];
  if (!/\[Event /.test(t)) return [t];
  return t.split(/\n(?=\s*\[Event )/).map((c) => c.trim()).filter(Boolean);
}

/** Manual PGN paste/upload. Games with fewer than 2 plies count as errors. */
export function parsePgnText(text: string, username: string | null | undefined): { games: NewGame[]; errors: number } {
  const games: NewGame[] = [];
  let errors = 0;
  for (const chunk of splitPgns(text)) {
    const g = parseGame(chunk, { username, source: 'pgn' });
    if (!g || g.movesUci.length < 2) {
      errors++;
      continue;
    }
    games.push(g);
  }
  return { games, errors };
}
