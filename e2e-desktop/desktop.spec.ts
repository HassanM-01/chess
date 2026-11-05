import { _electron as electron, expect, test, type ElectronApplication, type Page } from '@playwright/test';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { mkdirSync } from 'node:fs';
import os from 'node:os';
import { join } from 'node:path';

// Legal's trap + a short, ordinary game; enough to exercise import, review, labels and puzzles.
const PGN = `[Event "Live Chess"]
[Site "Chess.com"]
[Date "2025.09.13"]
[White "hero"]
[Black "villain"]
[Result "1-0"]
[WhiteElo "800"]
[BlackElo "790"]
[TimeControl "600"]
[Termination "hero won by checkmate"]
[Link "https://www.chess.com/game/live/111111111"]

1. e4 e5 2. Nf3 d6 3. Bc4 Bg4 4. Nc3 g6 5. Nxe5 Bxd1 6. Bxf7+ Ke7 7. Nd5# 1-0
`;

let app: ElectronApplication;
let page: Page;
let dataDir: string;
const problems: string[] = [];

test.beforeAll(async () => {
  dataDir = mkdtempSync(join(os.tmpdir(), 'blunder-e2e-'));
  mkdirSync(join(dataDir, 'data'), { recursive: true });
  // Quick analysis so the test is fast; the real default is the Maximum preset.
  writeFileSync(join(dataDir, 'data', 'settings.json'), JSON.stringify({ preset: 'quick', depth: 14, movetimeMs: 1500, multipv: 3, chesscomUsername: 'hero' }));
  // BLUNDER_EXE points the same test at the packaged app (release/win-unpacked/Blunder Check.exe)
  app = await electron.launch({ ...(process.env.BLUNDER_EXE ? { executablePath: process.env.BLUNDER_EXE } : { args: ['.'] }), env: { ...process.env, BLUNDER_USER_DATA: dataDir } });
  page = await app.firstWindow();
  page.on('pageerror', (e) => problems.push(`pageerror: ${e.message}`));
  page.on('console', (m) => {
    if (m.type() === 'error') problems.push(`console: ${m.text()}`);
  });
  await page.setViewportSize({ width: 1500, height: 940 }).catch(() => undefined);
});
test.afterAll(async () => {
  await app?.close();
});

test('imports a PGN, reviews it with native Stockfish and labels the moves', async () => {
  await expect(page.getByTestId('library-page')).toBeVisible();
  await page.getByTestId('pgn-paste').fill(PGN);
  await page.getByTestId('pgn-import').click();
  await expect(page.getByTestId('game-row')).toHaveCount(1);
  await page.screenshot({ path: join(dataDir, 'shot-library.png') });

  await page.getByTestId('game-row').click();
  await expect(page.getByTestId('review-page')).toBeVisible();
  await page.getByTestId('start-review').click();
  // wait for the review to finish: the accuracy cards appear and the status card goes away
  await expect(page.getByTestId('review-status')).toHaveCount(0, { timeout: 180_000 });
  await expect(page.getByTestId('accuracy-w')).toBeVisible();

  const acc = async (c: 'w' | 'b'): Promise<number> => parseFloat((await page.getByTestId(`accuracy-${c}`).textContent()) ?? '0');
  expect(await acc('w')).toBeGreaterThan(await acc('b'));
  await page.screenshot({ path: join(dataDir, 'shot-summary.png') });

  // 5...Bxd1?? walks into mate: it must be a mistake or blunder. 7.Nd5# is checkmate: best.
  await page.getByRole('tab', { name: 'Moves' }).click();
  await page.locator('[data-ply="10"]').click();
  await expect(page.getByTestId('move-title')).toContainText(/Bxd1 is (a blunder|a mistake)/);
  await page.screenshot({ path: join(dataDir, 'shot-blunder.png') });
  // Retry: the board goes back to before the mistake and dxe5 (the best move) must be accepted
  await page.getByTestId('retry').click();
  await page.locator('[data-sq="d6"]').click();
  await page.locator('[data-sq="e5"]').click();
  await expect(page.getByTestId('retry-card')).toContainText('best move');
  await page.getByRole('button', { name: 'Continue' }).click();
  await page.locator('[data-ply="13"]').click();
  await expect(page.getByTestId('move-title')).toContainText('Nd5# is the best move');
  console.log('screenshots in', dataDir);
});

test('puzzles page loads and offers the bundled puzzles', async () => {
  await page.getByRole('link', { name: 'Puzzles' }).click();
  await expect(page.getByTestId('puzzles-page')).toBeVisible();
  await expect(page.getByTestId('puzzle-banner')).toBeVisible();
  await page.screenshot({ path: join(dataDir, 'shot-puzzles.png') });
  // solve one for real, by clicking squares
  const puzzles = JSON.parse(readFileSync('data/puzzles.json', 'utf8')) as { fen: string; moves: string[] }[];
  const fen = (await page.getByTestId('board').getAttribute('data-fen'))!;
  const p = puzzles.find((x) => x.fen === fen)!;
  expect(p, 'bundled puzzle for ' + fen).toBeTruthy();
  await page.getByTestId('hint').click();
  const first = p.moves[0];
  await page.locator(`[data-sq="${first.slice(0, 2)}"]`).click();
  await page.locator(`[data-sq="${first.slice(2, 4)}"]`).click();
  await expect(page.getByTestId('puzzle-banner')).toHaveAttribute('data-status', /solved|failed/);
  // a hint was used, so it is not a clean solve for the rating
  await expect(page.getByTestId('puzzle-banner')).toHaveAttribute('data-status', 'failed');
  await page.getByTestId('next-puzzle').click();
  await page.getByTestId('solution').click();
  await expect(page.getByTestId('puzzle-banner')).toHaveAttribute('data-status', 'revealed');
  await expect(page.getByTestId('puzzle-rating')).not.toHaveText('1000');
});

test('no script errors or CSP violations happened', () => {
  expect(problems).toEqual([]);
});

test('settings expose the engine and depth controls', async () => {
  await page.getByRole('link', { name: 'Settings' }).click();
  await expect(page.getByTestId('engine-name')).toContainText('Stockfish');
  await page.getByTestId('preset-maximum').click();
  await expect(page.getByLabel('Target depth')).toHaveValue('40');
  await page.screenshot({ path: join(dataDir, 'shot-settings.png') });
});
