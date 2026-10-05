import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, type Locator, type Page } from '@playwright/test';

const PGN = readFileSync(join(import.meta.dirname, '..', 'reference', 'data', 'huhsaaan-games.pgn'), 'utf8');

const header = (pgn: string, key: string): string => pgn.match(new RegExp(`\\[${key} "([^"]*)"\\]`))?.[1] ?? '';

export interface FakeGame {
  url: string;
  pgn: string;
  end_time: number;
  time_class: string;
  rules: string;
  white: { username: string };
  black: { username: string };
}

/** Real games from the fixture PGN, shaped like chess.com API month entries. */
export function fixtureGames(filter: (g: { pgn: string; month: string }) => boolean): { month: string; game: FakeGame }[] {
  return PGN.replace(/\r/g, '')
    .split(/\n(?=\s*\[Event )/)
    .map((p) => p.trim())
    .filter(Boolean)
    .map((pgn) => {
      const date = header(pgn, 'Date').replace(/\./g, '-');
      return {
        month: date.slice(0, 7),
        pgn,
        game: {
          url: header(pgn, 'Link'),
          pgn,
          end_time: Math.floor(new Date(`${date}T12:00:00Z`).getTime() / 1000),
          time_class: 'rapid',
          rules: 'chess',
          white: { username: header(pgn, 'White') },
          black: { username: header(pgn, 'Black') },
        },
      };
    })
    .filter(filter);
}

/** The five games the spec uses for its acceptance checks, plus two quick extras. */
export const SPEC_OPPONENTS = ['Nahomxo', '19293a', 'whole_cooked_chicken', 'mert19890', 'YossufM', 'ElioCameron', 'joecur032376'];

export function specSubset(): { month: string; game: FakeGame }[] {
  return fixtureGames(({ pgn, month }) => month === '2026-10' && SPEC_OPPONENTS.some((o) => pgn.includes(`"${o}"`)));
}

export interface MockOptions {
  games?: { month: string; game: FakeGame }[];
  /** usernames chess.com knows about */
  known?: string[];
  /** extra games returned only from the second month fetch onwards (to test incremental pulls) */
  later?: { month: string; game: FakeGame }[];
}

/** Mocks api.chess.com (with CORS headers) so tests are fast, offline and deterministic. */
export async function mockChesscom(page: Page, opts: MockOptions = {}): Promise<{ hits: string[]; addLater: (g: { month: string; game: FakeGame }[]) => void }> {
  let games = opts.games ?? specSubset();
  const known = (opts.known ?? ['huhsaaan']).map((u) => u.toLowerCase());
  const hits: string[] = [];
  const cors = { 'access-control-allow-origin': '*', 'content-type': 'application/json' };
  await page.route('https://api.chess.com/**', async (route) => {
    const path = new URL(route.request().url()).pathname;
    hits.push(path);
    const m = path.match(/^\/pub\/player\/([^/]+)(.*)$/);
    if (!m || !known.includes(m[1].toLowerCase())) {
      await route.fulfill({ status: 404, headers: cors, body: JSON.stringify({ code: 0, message: 'User not found' }) });
      return;
    }
    const rest = m[2];
    if (rest === '') {
      await route.fulfill({ status: 200, headers: cors, body: JSON.stringify({ username: m[1] }) });
    } else if (rest === '/games/archives') {
      const months = [...new Set(games.map((g) => g.month))].sort();
      await route.fulfill({ status: 200, headers: cors, body: JSON.stringify({ archives: months.map((x) => `https://api.chess.com/pub/player/${m[1]}/games/${x.replace('-', '/')}`) }) });
    } else {
      const mm = rest.match(/^\/games\/(\d{4})\/(\d{2})$/);
      const key = mm ? `${mm[1]}-${mm[2]}` : '';
      await route.fulfill({ status: 200, headers: cors, body: JSON.stringify({ games: games.filter((g) => g.month === key).map((g) => g.game) }) });
    }
  });
  return {
    hits,
    addLater: (g) => {
      games = [...games, ...g];
    },
  };
}

export const board = (page: Page): Locator => page.getByTestId('board');
export const sq = (page: Page, s: string): Locator => page.locator(`[data-testid=board] [data-sq=${s}]`).first();

/** Click from-square then to-square (tap to move). */
export async function tapMove(page: Page, from: string, to: string, promotion?: string): Promise<void> {
  await sq(page, from).click();
  await sq(page, to).click();
  if (promotion) {
    const names: Record<string, string> = { q: 'queen', r: 'rook', b: 'bishop', n: 'knight' };
    await page.getByRole('dialog', { name: /promotion/i }).getByRole('button', { name: names[promotion] }).click();
  }
}

/** Play a UCI move (with the promotion piece when it has one). */
export const playUci = (page: Page, u: string): Promise<void> => tapMove(page, u.slice(0, 2), u.slice(2, 4), u[4]);

export async function localState(page: Page): Promise<LocalState> {
  // the memory repo debounces writes by 250 ms
  await page.waitForTimeout(400);
  return page.evaluate(() => JSON.parse(localStorage.getItem('bc-local-v1:local-user') ?? '{}') as LocalState);
}

export interface LocalState {
  games: { id: string; white: string; black: string; playedAt: string; analysisStatus: string; movesUci: string[]; userColor: string }[];
  analyses: { gameId: string; evals: [number, number | null, string | null][] }[];
  mistakes: { gameId: string; ply: number; category: string; severity: string }[];
  training: { id: string; kind: string; box: number; dueAt: string; attempts: number; payload: { pool: string; fen: string; answer?: string[]; verdict?: string } }[];
  attempts: { correct: boolean; usedHint: boolean; theme: string | null }[];
  profile: { chesscomUsername: string | null; lastSyncedAt: string | null };
  progress: { daily: Record<string, unknown>; lessons: Record<string, boolean>; openings: Record<string, number>; play: Record<string, unknown> };
}

/** Onboard as huhsaaan and wait for the first pull + analysis to finish. */
export async function onboardAndPull(page: Page): Promise<void> {
  await mockChesscom(page);
  await page.goto('/');
  await expect(page).toHaveURL(/\/onboarding/);
  await page.getByLabel('chess.com username').fill('huhsaaan');
  await page.getByRole('button', { name: /link account/i }).click();
  await expect(page).toHaveURL(/\/games/);
  await expect(page.locator('.toast', { hasText: /new games? analyzed/i })).toBeVisible({ timeout: 150_000 });
}
