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
  // the plain-English explanation: what happens, why the best move is better, and a habit to remember
  await expect(page.getByTestId('explanation')).toContainText(/checkmate/i);
  await expect(page.getByTestId('explanation')).toContainText(/is better/i);
  await page.getByTestId('break-down').click();
  await expect(page.getByTestId('steps')).toContainText('What was played');
  await expect(page.getByTestId('steps')).toContainText(/They take the pawn on f7 with the bishop|You move the knight/);
  await expect(page.getByTestId('coach-off')).toBeVisible(); // no API key saved: the coach offers to be turned on
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
  const current = async (): Promise<{ fen: string; moves: string[] }> => {
    const fen = (await page.getByTestId('board').getAttribute('data-fen'))!;
    const found = puzzles.find((x) => x.fen === fen)!;
    expect(found, 'bundled puzzle for ' + fen).toBeTruthy();
    return found;
  };
  let p = await current();
  // about one puzzle in nine needs several moves; this test solves a one-move puzzle, so skip those
  for (let i = 0; i < 30 && p.moves.length > 1; i++) {
    const old = p.fen;
    await page.getByTestId('next-puzzle').click();
    await expect(page.getByTestId('board')).not.toHaveAttribute('data-fen', old);
    p = await current();
  }
  expect(p.moves.length).toBe(1);
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

test('training modes are built from the reviewed game and explain themselves', async () => {
  await page.getByRole('link', { name: 'Puzzles' }).click();
  await expect(page.getByTestId('puzzles-page')).toBeVisible();

  // checkmate: the mate in 2 that came up in the game (Bxf7+ Ke7 Nd5#). Use the hints to read the move, then play it.
  await page.getByTestId('mode-mate').click();
  await expect(page.getByTestId('puzzle-banner')).toHaveAttribute('data-status', 'solving');
  const startFen = (await page.getByTestId('board').getAttribute('data-fen'))!;
  await page.locator('[data-sq="a2"]').click();
  await page.locator('[data-sq="a3"]').click();
  await expect(page.getByTestId('try-note')).toBeVisible({ timeout: 20_000 });
  await expect(page.getByTestId('try-note')).toContainText(/a3/);
  await expect(page.getByTestId('puzzle-banner')).toHaveAttribute('data-status', 'solving');
  await expect(page.getByTestId('board')).toHaveAttribute('data-fen', startFen); // the piece goes back so you can try again
  for (let i = 0; i < 3; i++) await page.getByTestId('hint').click();
  const arrowAt = async (): Promise<string> => ((await page.locator('[data-arrow]').first().getAttribute('data-arrow')) ?? '').split(':')[0];
  const play = async (uci: string): Promise<void> => {
    await page.locator(`[data-sq="${uci.slice(0, 2)}"]`).click();
    await page.locator(`[data-sq="${uci.slice(2, 4)}"]`).click();
  };
  const status = async (): Promise<string> => (await page.getByTestId('puzzle-banner').getAttribute('data-status')) ?? '';
  // keep playing the hinted move until the puzzle is over (a mate in 2 or 3 has several moves)
  for (let i = 0; i < 4 && (await status()) === 'solving'; i++) {
    const move = await arrowAt();
    await play(move);
    await expect.poll(async () => ((await status()) !== 'solving' ? 'over' : await arrowAt()), { timeout: 8000 }).not.toBe(move);
  }
  await expect(page.getByTestId('puzzle-banner')).toHaveAttribute('data-status', /solved|failed/);
  await expect(page.getByTestId('puzzle-explain')).toContainText(/checkmate/i);
  // Stockfish writes a step-by-step breakdown for the finished puzzle
  await page.getByTestId('show-steps').click({ timeout: 20_000 });
  await expect(page.getByTestId('steps')).toContainText('Look at the board');
  await expect(page.getByTestId('coach-off')).toBeVisible();
  await page.screenshot({ path: join(dataDir, 'shot-mate-puzzle.png') });

  // punish: the opponent's blunder 5...Bxd1 offers a winning reply
  await page.getByTestId('mode-punish').click();
  await expect(page.getByTestId('puzzle-banner')).toBeVisible();
  await page.getByTestId('solution').click();
  await expect(page.getByTestId('puzzle-explain')).toContainText(/checkmate|best reply/i);

  // safe or blunder: answer, then the explanation appears either way
  await page.getByTestId('mode-judge').click();
  await expect(page.getByTestId('judge-blunder')).toBeVisible();
  await page.getByTestId('judge-blunder').click();
  await expect(page.getByTestId('puzzle-banner')).toHaveAttribute('data-status', /solved|failed/);
  await expect(page.getByTestId('puzzle-explain')).toBeVisible();
  await page.screenshot({ path: join(dataDir, 'shot-judge.png') });

  // the weak-spot summary shows what the games have in common
  await expect(page.getByRole('tablist', { name: 'Training mode' })).toBeVisible();
});

const move = async (from: string, to: string): Promise<void> => {
  await page.locator(`[data-sq="${from}"]`).click();
  await page.locator(`[data-sq="${to}"]`).click();
};

test('play: Stockfish checks every move, stops a blunder, and the heads-up and live engine run together', async () => {
  await page.getByRole('link', { name: 'Play', exact: true }).click();
  await expect(page.getByTestId('play-setup')).toBeVisible();
  await page.getByTestId('level-0').click(); // the weakest computer, so the test never depends on a strong reply
  await page.screenshot({ path: join(dataDir, 'shot-play-menu.png') });

  await page.getByTestId('tab-middlegame').click();
  await page.getByTestId('start-mg-italian').click();
  await expect(page.getByTestId('play-game')).toBeVisible();
  await expect(page.getByTestId('play-status')).toHaveText('Your move');
  await expect(page.getByTestId('heads-up')).toBeVisible();
  await expect(page.getByTestId('live-engine')).toContainText(/depth/i, { timeout: 30_000 });
  const startFen = (await page.getByTestId('board').getAttribute('data-fen'))!;

  // 1. Nxe5?? loses a knight for a pawn: Blunder Check stops the game before the computer replies
  await move('f3', 'e5');
  await expect(page.getByTestId('blunder-check')).toBeVisible({ timeout: 40_000 });
  await expect(page.getByTestId('blunder-check')).toContainText(/Nxe5 is (a blunder|a mistake)/);
  await page.screenshot({ path: join(dataDir, 'shot-play-blunder.png') });
  await page.getByTestId('show-better').click();
  await page.getByTestId('take-back').click();
  await expect(page.getByTestId('board')).toHaveAttribute('data-fen', startFen); // back where we were, nothing lost

  // 2. a sound developing move is judged and explained, then the computer replies
  await move('d2', 'f1');
  await expect(page.getByTestId('verdict')).toHaveAttribute('data-status', 'done', { timeout: 40_000 });
  await expect(page.getByTestId('verdict-title')).toContainText(/Nf1 is/);
  await expect(page.getByTestId('play-status')).toHaveText('Your move', { timeout: 30_000 });
  await expect.poll(async () => (await page.getByTestId('play-moves').textContent()) ?? '').toMatch(/Nf1/);
  await page.screenshot({ path: join(dataDir, 'shot-play-game.png') });

  // 3. hint in two steps, then resign and send the game to the review
  await page.getByTestId('play-hint').click();
  await expect(page.getByTestId('play-hint-text')).toContainText(/Look at your/, { timeout: 30_000 });
  await page.getByTestId('play-hint').click();
  await expect(page.getByTestId('play-hint-text')).not.toContainText(/^💡 Look at your/);
  await page.getByTestId('play-resign').click();
  await expect(page.getByTestId('game-over')).toContainText('You resigned');
  await page.getByTestId('review-game').click();
  await expect(page.getByTestId('review-page')).toBeVisible();
});

test('play: an opening drill teaches the line and judges a different move', async () => {
  await page.getByRole('link', { name: 'Play', exact: true }).click();
  // the finished game from the last test is still open: leave it for the menu
  if (await page.getByTestId('play-leave').count()) await page.getByTestId('play-leave').click();
  await page.getByTestId('tab-openings').click();
  await expect(page.getByTestId('opening-london')).toBeVisible();
  await page.getByTestId('drill-london:0').click();
  await expect(page.getByTestId('drill-card')).toContainText('London System');

  await move('d2', 'd4'); // the line starts with d4
  await expect(page.getByTestId('drill-card')).toContainText(/They played d5/, { timeout: 15_000 }); // the scripted reply, with the reason
  await expect(page.getByTestId('play-status')).toHaveText('Your move');

  // a move that is not in the line is checked by Stockfish and the board does not change
  const fen = (await page.getByTestId('board').getAttribute('data-fen'))!;
  await move('a2', 'a3');
  await expect(page.getByTestId('try-note')).toContainText(/a3 is not the move in this line/, { timeout: 40_000 });
  await expect(page.getByTestId('try-note')).toContainText(/Bf4/);
  await expect(page.getByTestId('board')).toHaveAttribute('data-fen', fen);
  await page.getByTestId('drill-show-move').click();
  await expect(page.getByTestId('play-hint-text')).toContainText(/The line plays Bf4/);
  await page.screenshot({ path: join(dataDir, 'shot-play-drill.png') });

  await move('c1', 'f4'); // now the right one
  await expect(page.getByTestId('drill-card')).toContainText(/You played Bf4/);
});

test('play: finishing a whole opening line is remembered, and you can play on from it', async () => {
  await page.getByRole('link', { name: 'Play', exact: true }).click();
  await page.getByTestId('play-leave').click();
  await page.getByTestId('tab-openings').click();
  await page.getByTestId('drill-london:0').click();
  const mine: [string, string][] = [['d2', 'd4'], ['c1', 'f4'], ['e2', 'e3'], ['g1', 'f3'], ['c2', 'c3'], ['b1', 'd2'], ['f4', 'g3'], ['f1', 'd3']];
  for (const [from, to] of mine) {
    await expect(page.getByTestId('play-status')).toHaveText('Your move', { timeout: 15_000 });
    await move(from, to);
  }
  await expect(page.getByTestId('drill-done')).toBeVisible();
  await page.getByTestId('drill-play-on').click();
  // from here it is an ordinary game: the computer answers with its own move and Blunder Check is back on duty
  await expect(page.getByTestId('play-status')).toHaveText('Your move', { timeout: 30_000 });
  await expect(page.getByTestId('drill-card')).toHaveCount(0);
  await page.getByTestId('play-leave').click();
  await page.getByTestId('tab-openings').click();
  await expect(page.getByTestId('learned-london:0')).toContainText('Finished 1×');
});

test('play: an endgame states its goal and tips', async () => {
  await page.getByRole('link', { name: 'Play', exact: true }).click();
  if (await page.getByTestId('play-leave').count()) await page.getByTestId('play-leave').click();
  await page.getByTestId('tab-endgame').click();
  await expect(page.getByTestId('scenario-eg-lucena')).toContainText('Lucena');
  await page.getByTestId('start-eg-kqk').click();
  await expect(page.getByTestId('play-title')).toContainText('Goal: win this position');
  await expect(page.getByText('Ideas for this position')).toBeVisible();
  await page.screenshot({ path: join(dataDir, 'shot-play-endgame.png') });
  await page.getByTestId('play-leave').click();
  await expect(page.getByTestId('play-setup')).toBeVisible();
});

test('no script errors or CSP violations happened', () => {
  expect(problems).toEqual([]);
});

test('settings expose the engine and depth controls', async () => {
  await page.getByRole('link', { name: 'Settings' }).click();
  await expect(page.getByTestId('engine-name')).toContainText('Stockfish');
  await expect(page.getByTestId('coach-settings')).toContainText('your own Anthropic API key');
  await expect(page.getByTestId('coach-key-input')).toHaveAttribute('type', 'password');
  await page.getByTestId('preset-maximum').click();
  await expect(page.getByLabel('Target depth')).toHaveValue('40');
  await page.screenshot({ path: join(dataDir, 'shot-settings.png') });
});
