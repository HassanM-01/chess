// Caro-Kann tab end to end (iPhone 13 profile, local mode). Own browser context, so it can run on its own:
//   npx playwright test e2e/caro.spec.ts
import { devices, expect, test, type BrowserContext, type Page } from '@playwright/test';
import { Chess } from 'chess.js';
import { OPENINGS } from '../src/content/openings';
import { localState, mockChesscom, tapMove } from './helpers';

let ctx: BrowserContext;
let page: Page;

test.describe.configure({ mode: 'serial' });

test.beforeAll(async ({ browser }) => {
  ctx = await browser.newContext({ ...devices['iPhone 13'], viewport: { width: 390, height: 844 }, serviceWorkers: 'block' });
  page = await ctx.newPage();
  page.on('pageerror', (e) => console.log('PAGE ERROR', e.message));
  await mockChesscom(page, { games: [] });
  await page.goto('/');
  await page.getByLabel('chess.com username').fill('huhsaaan');
  await page.getByRole('button', { name: /link account/i }).click();
  await expect(page).toHaveURL(/\/games/);
});
test.afterAll(async () => {
  await ctx.close();
});

const coachReady = (): Promise<void> => expect(page.getByTestId('coach-advice')).toBeVisible({ timeout: 30_000 });

test.describe('Caro-Kann tab', () => {
  test('the tab opens the simulator: White opens with 1.e4, the coach says ...c6, and following it is scored', async () => {
    await page.goto('/games');
    await page.getByRole('link', { name: 'Caro-Kann', exact: true }).click();
    await expect(page).toHaveURL(/\/caro$/);
    await expect(page.getByTestId('caro')).toBeVisible();
    // the bot (White) plays first; the board is from Black's side
    await coachReady();
    await expect(page.getByTestId('board')).toHaveAttribute('data-fen', /^rnbqkbnr\/pppppppp\/8\/8\/4P3\/8\/PPPP1PPP\/RNBQKBNR b /);
    await expect(page.getByTestId('advice-title')).toHaveText('Setup: c6');
    await expect(page.locator('[data-arrow^="c7c6"]')).toBeAttached();
    await tapMove(page, 'c7', 'c6');
    await expect(page.getByText('Right on plan.')).toBeVisible();
    await expect(page.getByTestId('caro-chips')).toContainText('✓ …c6');
    // White answers (2.d4 or 2.Nf3 or 2.Nc3 ...) and the coach carries on
    await expect(page.getByTestId('status')).toHaveText('Your move', { timeout: 30_000 });
    await expect(page.getByTestId('advice-title')).toHaveText(/Setup: d5|Recapture|danger/i);
  });

  test('...e6 before ...Bf5 in the Advance gets "Move order: bishop first!" with Take back / Keep', async () => {
    await page.goto('/caro?moves=e2e4,c7c6,d2d4,d7d5,e4e5');
    await coachReady();
    await expect(page.getByTestId('advice-title')).toHaveText('Setup: Bf5');
    await tapMove(page, 'e7', 'e6');
    await expect(page.getByTestId('caro-prompt')).toContainText('Move order: bishop first!', { timeout: 20_000 });
    await expect(page.getByTestId('keep-move')).toHaveText('Keep it');
    await page.getByTestId('take-back').click();
    await expect(page.getByTestId('caro-prompt')).toHaveCount(0);
    await coachReady();
    await tapMove(page, 'c8', 'f5');
    await expect(page.getByText('Right on plan.')).toBeVisible();
  });

  test('g4 against the bishop is answered with "A pawn is attacking your bishop"', async () => {
    await page.goto('/caro?moves=e2e4,c7c6,d2d4,d7d5,e4e5,c8f5,g2g4');
    await coachReady();
    await expect(page.getByTestId('advice-title')).toHaveText('A pawn is attacking your bishop');
    await expect(page.getByTestId('advice-text')).toContainText('Move it or take the pawn first');
    await expect(page.locator('[data-arrow^="e7e6"]')).toHaveCount(0);
  });

  test('Blunder Check fires when you hang the bishop, and Take it back restores the move', async () => {
    await page.goto('/caro?moves=e2e4,c7c6,d2d4,d7d5,e4e5,c8f5,b1c3');
    await coachReady();
    await tapMove(page, 'f5', 'c2');
    await expect(page.getByTestId('caro-prompt')).toContainText('Blunder Check: are you sure?', { timeout: 20_000 });
    await page.getByTestId('take-back').click();
    await expect(page.getByTestId('caro-prompt')).toHaveCount(0);
    await expect(page.getByTestId('board')).toHaveAttribute('data-fen', /^rn1qkbnr\/pp2pppp\/2p5\/3pPb2\/3P4\/2N5\/PPP2PPP\/R1BQKBNR b /);
  });

  test('a whole game: follow the coach for several moves and the setup chips fill in', async () => {
    await page.goto('/caro?moves=e2e4');
    for (let n = 0; n < 5; n++) {
      await coachReady();
      const arrow = await page.locator('[data-arrow$=":good"]').first().getAttribute('data-arrow');
      const uci = (arrow as string).split(':')[0];
      await tapMove(page, uci.slice(0, 2), uci.slice(2, 4), uci[4]);
      await expect(page.getByTestId('status')).toHaveText('Your move', { timeout: 40_000 });
    }
    const chips = await page.locator('[data-testid=caro-chips] .lchip.done').count();
    expect(chips).toBeGreaterThanOrEqual(3);
    await page.getByTestId('new-game').click();
    await expect(page.getByTestId('caro-chips').locator('.lchip.done')).toHaveCount(0);
  });

  test('winning a game is recorded, and the finished game can be walked through', async () => {
    // 1.f3 e5 2.g4 Qh4#: the coach spots the mate and the game ends in a win for Black
    await page.goto('/caro?moves=f2f3,e7e5,g2g4');
    await coachReady();
    await expect(page.getByTestId('advice-title')).toHaveText('You have a checkmate!');
    await tapMove(page, 'd8', 'h4');
    await expect(page.getByTestId('caro-over')).toContainText('Checkmate. You win with the Caro-Kann!');
    const st = await localState(page);
    expect((st.progress.play as { caro?: { games: number; wins: number } }).caro).toEqual({ games: 1, wins: 1 });
    await page.getByRole('button', { name: 'Walk through this game' }).click();
    await expect(page).toHaveURL(/\/games\/.+\/walk/);
    const saved = (await localState(page)).games.find((g) => g.black === 'huhsaaan');
    expect(saved?.userColor).toBe('b');
  });

  test('Learn lists the Caro-Kann lines, and the trainer plays a whole line as Black', async () => {
    await page.goto('/learn');
    await expect(page.getByText('Caro-Kann Defence')).toBeVisible();
    await expect(page.getByText('Advance Variation (3.e5)')).toBeVisible();
    await page.goto('/learn/opening/caro/0');
    const line = OPENINGS.caro.lines[0].moves;
    const c = new Chess();
    for (let i = 0; i < line.length; i++) {
      const m = c.move(line[i][0]);
      if (i % 2 === 1) {
        await expect(page.getByTestId('opening-actions')).toContainText('Show me', { timeout: 10_000 });
        await tapMove(page, m.from, m.to);
      }
      await page.waitForTimeout(i % 2 === 1 ? 150 : 900); // the trainer plays its reply
    }
    await expect(page.getByText('Line complete')).toBeVisible({ timeout: 10_000 });
    expect((await localState(page)).progress.openings.caro0).toBe(1);
  });
});
