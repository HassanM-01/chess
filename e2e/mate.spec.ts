// Checkmate school end to end (iPhone 13 profile, local mode). Own browser context, so it can run on its own:
//   npx playwright test e2e/mate.spec.ts
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { devices, expect, test, type BrowserContext, type Page } from '@playwright/test';
import { Chess } from 'chess.js';
import { boxSquares, gradeMove } from '../src/mate/technique';
import { board, mockChesscom, playUci, tapMove } from './helpers';

interface RawPuzzle {
  id: string;
  theme: string;
  fen: string;
  moves: string[];
}
const PUZZLES = JSON.parse(readFileSync(join(import.meta.dirname, '..', 'data', 'puzzles.json'), 'utf8')) as RawPuzzle[];

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

/** the move a student following the box rule would play: shrink the cage, never stalemate, never hang a piece */
function greedy(fen: string, seen: Set<string>): string {
  const c = new Chess(fen);
  let best = '';
  let bestKey = [Infinity, Infinity, Infinity];
  for (const m of c.moves({ verbose: true })) {
    const u = m.from + m.to + (m.promotion ?? '');
    const t = new Chess(fen);
    t.move(m);
    const g = gradeMove(fen, t.fen());
    if (g.verdict === 'mate') return u;
    if (g.verdict === 'stalemate' || g.verdict === 'lost-win') continue;
    const bk = t.board().flat().find((p) => p && p.type === 'k' && p.color === 'b')!.square;
    const wk = t.board().flat().find((p) => p && p.type === 'k' && p.color === 'w')!.square;
    const gap = Math.max(Math.abs(bk.charCodeAt(0) - wk.charCodeAt(0)), Math.abs(+bk[1] - +wk[1]));
    const key = [seen.has(t.fen().split(' ').slice(0, 2).join(' ')) ? 1 : 0, g.boxAfter, gap];
    if (key[0] < bestKey[0] || (key[0] === bestKey[0] && (key[1] < bestKey[1] || (key[1] === bestKey[1] && key[2] < bestKey[2])))) {
      best = u;
      bestKey = key;
    }
  }
  return best;
}

test.describe('Checkmate school', () => {
  test('Learn links to the school, which lists techniques and patterns', async () => {
    await page.goto('/learn');
    await page.getByTestId('mate-school-link').click();
    await expect(page).toHaveURL(/\/learn\/mate$/);
    await expect(page.getByTestId('mate-school')).toBeVisible();
    for (const k of ['kq', 'kr', 'rr']) await expect(page.getByTestId(`technique-${k}`)).toBeVisible();
    for (const id of ['back-rank', 'ladder', 'smothered', 'scholars']) await expect(page.getByTestId(`pattern-${id}`)).toBeVisible();
  });

  test('a pattern can be watched step by step and ends by explaining why it is mate', async () => {
    await page.goto('/learn/mate/pattern/back-rank');
    await expect(page.getByTestId('mate-caption')).toContainText('White to move');
    await page.getByTestId('mate-next').click();
    await expect(page.getByTestId('mate-caption')).toContainText('Ra8#');
    await expect(page.getByTestId('mate-why')).toContainText('That is checkmate');
    await expect(page.getByTestId('mate-why')).toContainText('f8');
    await expect(page.locator('[data-arrow]').first()).toBeAttached(); // a horizontal SVG line has zero height, so it is never "visible"
  });

  test('a pattern can be played: a wrong move gets a hint, the right one ends with the explanation', async () => {
    await page.goto('/learn/mate/pattern/back-rank');
    await page.getByRole('button', { name: 'Play it yourself' }).click();
    await expect(page.getByTestId('pattern-play')).toBeVisible();
    await tapMove(page, 'e1', 'e2');
    await expect(page.getByTestId('pattern-play')).toContainText('not the move here');
    await tapMove(page, 'a1', 'a8');
    await expect(page.getByTestId('mate-why')).toContainText('That is checkmate');
  });

  test('the K+Q trainer: hints work, and a whole mate can be played by shrinking the cage', async () => {
    test.setTimeout(240_000);
    await page.goto('/learn/mate/practice/kq');
    await expect(page.getByTestId('practice')).toBeVisible();
    await expect(page.getByTestId('plan')).toContainText(/box|cage|king/i);

    // hints: first highlights, second says what the move does to the cage
    await page.getByTestId('hint-btn').click();
    await expect(page.getByTestId('hint')).toContainText(/moving your|Try moving|checkmate/i);
    await page.getByTestId('hint-btn').click();
    await expect(page.getByTestId('hint')).toContainText(/the arrow/);

    const seen = new Set<string>();
    let moves = 0;
    while (!(await page.getByTestId('won').isVisible()) && moves < 40) {
      await expect(page.getByTestId('status')).toHaveText('Your move', { timeout: 20_000 });
      const fen = (await board(page).getAttribute('data-fen')) as string;
      const u = greedy(fen, seen);
      expect(u, fen).toBeTruthy();
      const c = new Chess(fen);
      c.move({ from: u.slice(0, 2), to: u.slice(2, 4), promotion: u[4] });
      seen.add(c.fen().split(' ').slice(0, 2).join(' '));
      await playUci(page, u);
      moves++;
      await page.getByTestId('grade').or(page.getByTestId('won')).first().waitFor();
    }
    await expect(page.getByTestId('won')).toBeVisible();
    await expect(page.getByTestId('mate-why')).toContainText('checkmate');
    // the win is counted for the school page
    await page.goto('/learn/mate');
    await expect(page.getByTestId('technique-kq')).toContainText('✓ 1');
  });

  test('a move that gives away the win is flagged and Undo takes it back', async () => {
    // re-roll the start until the queen has a move that loses her (almost always the first one)
    let fen = '';
    let bad = '';
    for (let tries = 0; tries < 10 && !bad; tries++) {
      await page.goto('/learn/mate/practice/kq');
      await expect(page.getByTestId('practice')).toBeVisible();
      fen = (await board(page).getAttribute('data-fen')) as string;
      for (const m of new Chess(fen).moves({ verbose: true })) {
        const t = new Chess(fen);
        t.move(m);
        const g = gradeMove(fen, t.fen());
        if (g.verdict === 'lost-win' || g.verdict === 'stalemate') {
          bad = m.from + m.to + (m.promotion ?? '');
          break;
        }
      }
    }
    expect(bad, `a losing move in ${fen}`).toBeTruthy();
    await playUci(page, bad);
    await expect(page.getByTestId('grade')).toHaveAttribute('data-verdict', /lost-win|stalemate/);
    await expect(page.getByTestId('status')).toHaveText('Undo that move');
    await page.getByTestId('undo-btn').click();
    await expect(page.getByTestId('status')).toHaveText('Your move');
    expect(await board(page).getAttribute('data-fen')).toBe(fen);
    expect(boxSquares(fen).length).toBeGreaterThan(0);
  });

  test('a mate puzzle offers "See how the mate works" once solved, and replays the solution with a reason', async () => {
    await page.goto('/train');
    await page.getByTestId('theme-mate2').click();
    await expect(page.getByTestId('session')).toBeVisible();
    const fen = (await board(page).getAttribute('data-fen')) as string;
    const pz = PUZZLES.find((p) => p.fen === fen);
    expect(pz, `puzzle for ${fen}`).toBeDefined();
    await playUci(page, pz!.moves[0]);
    for (let i = 2; i < pz!.moves.length; i += 2) {
      await page.waitForTimeout(800);
      await playUci(page, pz!.moves[i]);
    }
    await expect(page.getByTestId('feedback')).toContainText('Correct');
    await page.getByTestId('mate-why-open').click();
    await expect(page.getByTestId('mate-why-card')).toBeVisible();
    for (let i = 0; i < 6 && !(await page.getByTestId('mate-why').isVisible()); i++) await page.getByTestId('mate-next').click();
    await expect(page.getByTestId('mate-why')).toContainText('checkmate');
  });

  test('the K+Q lesson sends you to the trainer', async () => {
    await page.goto('/learn/lesson/kq');
    await page.getByTestId('lesson-practice').click();
    await expect(page).toHaveURL(/\/learn\/mate\/practice\/kq/);
    await expect(page.getByTestId('practice')).toBeVisible();
  });
});
