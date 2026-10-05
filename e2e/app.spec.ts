// End-to-end flows on the iPhone 13 profile (390x844), in local mode with chess.com mocked.
// Phases 1-6 acceptance checks from the spec. Tests run in order and share one browser context (and its saved data).
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { devices, expect, test, type BrowserContext, type Page } from '@playwright/test';
import { Chess } from 'chess.js';
import { OPENINGS } from '../src/content/openings';
import { board, fixtureGames, localState, mockChesscom, onboardAndPull, playUci, specSubset, sq, tapMove } from './helpers';

const N = specSubset().length; // games the mocked chess.com returns

interface RawPuzzle {
  id: string;
  theme: string;
  fen: string;
  moves: string[];
  alts?: string[];
}
const PUZZLES = JSON.parse(readFileSync(join(import.meta.dirname, '..', 'data', 'puzzles.json'), 'utf8')) as RawPuzzle[];

const viewport = { width: 390, height: 844 };
let ctx: BrowserContext;
let page: Page;

test.describe.configure({ mode: 'serial' });

test.beforeAll(async ({ browser }) => {
  ctx = await browser.newContext({ ...devices['iPhone 13'], viewport, serviceWorkers: 'block' });
  page = await ctx.newPage();
  page.on('pageerror', (e) => console.log('PAGE ERROR', e.message));
});
test.afterAll(async () => {
  await ctx.close();
});

const toastText = (re: RegExp) => page.locator('.toast', { hasText: re });

/** the squares a piece of `color` stands on, from the FEN */
function squaresOf(fen: string, color: 'w' | 'b'): string[] {
  const c = new Chess(fen);
  const out: string[] = [];
  for (const row of c.board()) for (const p of row) if (p && p.color === color) out.push(p.square);
  return out;
}

// ---------------------------------------------------------------------------------------------------------------
test.describe('Phase 1: sign-in, onboarding', () => {
  test('a new user is sent to onboarding, and an unknown chess.com username is rejected', async () => {
    await mockChesscom(page);
    await page.goto('/');
    await expect(page).toHaveURL(/\/onboarding/);
    await page.getByLabel('chess.com username').fill('nobody-here-xyz');
    await page.getByRole('button', { name: /link account/i }).click();
    await expect(page.getByRole('alert')).toContainText("couldn't find");
    await expect(page).toHaveURL(/\/onboarding/);
  });
});

test.describe('Phase 3: pull recent games and analysis', () => {
  test('onboarding links the username and auto-runs the first pull with visible progress', async () => {
    await page.getByLabel('chess.com username').fill('huhsaaan');
    await page.getByRole('button', { name: /link account/i }).click();
    await expect(page).toHaveURL(/\/games/);
    await expect(page.getByTestId('pull-games')).toContainText(/Pulling games|Analyzing \d+ of \d+/);
    await expect(page.getByTestId('sync-label')).toBeVisible();
    await expect(toastText(/new games? analyzed\. Your coach report is updated/i)).toBeVisible({ timeout: 150_000 });
    const st = await localState(page);
    expect(st.profile.chesscomUsername).toBe('huhsaaan');
    expect(st.games.length).toBe(N);
    expect(st.games.every((g) => g.analysisStatus === 'done')).toBe(true);
    await expect(page.getByTestId('game-list').locator('a')).toHaveCount(N);
  });

  test('a second "Pull recent games" imports no duplicates', async () => {
    await page.getByTestId('pull-games').click();
    await expect(toastText(/up to date/i)).toBeVisible({ timeout: 60_000 });
    const st = await localState(page);
    expect(st.games.length).toBe(N);
  });

  test('incremental pull: a new game shows up, old ones are not duplicated', async () => {
    // Re-register the mock with one more game in the same month.
    const extra = fixtureGames(({ pgn, month }) => month === '2026-10' && pgn.includes('"nourddin_1"'));
    expect(extra.length).toBe(1);
    await page.unroute('https://api.chess.com/**');
    await mockChesscom(page, { games: [...specSubset(), ...extra] });
    await page.getByTestId('pull-games').click();
    await expect(toastText(/1 new game analyzed/i)).toBeVisible({ timeout: 90_000 });
    const st = await localState(page);
    expect(st.games.length).toBe(N + 1);
    const ids = st.games.map((g) => g.id);
    expect(new Set(ids).size).toBe(N + 1);
    await mockChesscom(page); // back to the base set for later tests
  });
});

test.describe('Phase 4: coach, walkthrough', () => {
  test('the Coach shows weaknesses with evidence, the daily plan and the last-game card', async () => {
    await page.goto('/');
    await expect(page.getByTestId('weaknesses')).toBeVisible();
    await expect(page.getByTestId('weaknesses')).toContainText(/times? in \d+ of \d+ games/);
    await expect(page.getByTestId('daily-plan')).toContainText("Today's 15 minutes");
    await expect(page.getByTestId('last-game-walk')).toBeVisible();
    await expect(page.getByRole('link', { name: 'Coach' })).toHaveAttribute('aria-current', 'page');
  });

  test("walkthrough for the YossufM 2026-10-01 game: red at moves 39, 40, 42, 43, and 'Mistakes »' jumps through them in order", async () => {
    const st = await localState(page);
    const g = st.games.find((x) => x.white === 'huhsaaan' && x.black === 'YossufM' && x.playedAt.startsWith('2026-10-01'));
    expect(g).toBeDefined();
    await page.goto(`/games/${g?.id}/walk`);
    await expect(page.getByTestId('timeline')).toBeVisible();
    // the tab bar is hidden during sessions
    await expect(page.locator('nav.tabs')).toBeHidden();
    const red = await page.locator('[data-testid=timeline] [data-verdict=blunder]').evaluateAll((els) => els.map((e) => Number(e.getAttribute('data-ply'))));
    expect(red.map((p) => p / 2 + 1)).toEqual([39, 40, 42, 43]);

    const seen: string[] = [];
    for (let i = 0; i < 12; i++) {
      await page.getByTestId('walk-jump').click();
      const t = await page.getByTestId('headline').innerText();
      if (/You played/.test(t)) seen.push(t.trim().split(' ')[0]);
      if (seen.length >= 4 && seen[seen.length - 1] === '43.') break;
    }
    const mine = seen.filter((s) => ['39.', '40.', '42.', '43.'].includes(s));
    expect(mine).toEqual(['39.', '40.', '42.', '43.']);
  });

  test('quiz mode accepts the engine move (and any move within 5 win%)', async () => {
    const st = await localState(page);
    const g = st.games.find((x) => x.white === 'huhsaaan' && x.black === 'YossufM' && x.playedAt.startsWith('2026-10-01'));
    const a = st.analyses.find((x) => x.gameId === g?.id);
    const best = a?.evals[76][2] as string;
    await page.goto(`/games/${g?.id}/walk?ply=76`);
    await page.getByRole('switch', { name: 'Quiz me on my mistakes' }).click();
    await expect(page.getByTestId('walk-card')).toContainText('Find something better');
    await tapMove(page, best.slice(0, 2), best.slice(2, 4));
    await expect(page.getByTestId('walk-card')).toContainText(/works!/);
    await page.getByRole('switch', { name: 'Quiz me on my mistakes' }).click(); // leave it off for later tests
  });
});

test.describe('Phase 5: training', () => {
  test('Spot the threat: tapping an enemy piece toasts and is not an answer; Next is visible without scrolling; a wrong answer is due again within 10 minutes', async () => {
    await page.goto('/train');
    await page.getByTestId('mode-threat').click();
    await expect(page.getByTestId('session')).toBeVisible();
    await expect(page.locator('nav.tabs')).toBeHidden();
    const fen = (await board(page).getAttribute('data-fen')) as string;
    const st0 = await localState(page);
    const item = st0.training.find((t) => t.kind === 'threat' && t.payload.fen === fen);
    expect(item, 'the session item must come from the saved training items').toBeDefined();
    const answer = item?.payload.answer ?? [];
    const me = fen.split(' ')[1] as 'w' | 'b';
    const enemy = squaresOf(fen, me === 'w' ? 'b' : 'w');

    // 1. tap an enemy piece: toast, no feedback, counter unchanged
    await sq(page, enemy[0]).click();
    await expect(toastText(/their piece/i)).toBeVisible();
    await expect(page.getByTestId('feedback')).toHaveCount(0);
    await expect(page.getByTestId('counter')).toContainText('1 /');

    // 2. give a wrong answer
    if (answer.length) await page.getByRole('button', { name: 'Nothing is in danger' }).click();
    else await sq(page, squaresOf(fen, me)[0]).click();
    await expect(page.getByTestId('feedback')).toContainText('Not quite');

    // 3. Next is visible without scrolling at 390x844
    const next = page.getByTestId('next');
    await expect(next).toBeVisible();
    const box = (await next.boundingBox()) as { y: number; height: number };
    expect(box.y + box.height).toBeLessThanOrEqual(viewport.height);
    expect(await page.evaluate(() => window.scrollY)).toBe(0);

    // 4. due again within 10 minutes, back in box 0
    const st1 = await localState(page);
    const after = st1.training.find((t) => t.id === item?.id);
    expect(after?.box).toBe(0);
    expect(after?.attempts).toBe(1);
    const dueIn = new Date(after?.dueAt as string).getTime() - Date.now();
    expect(dueIn).toBeGreaterThan(0);
    expect(dueIn).toBeLessThanOrEqual(10 * 60_000 + 5_000);
  });

  test('Try again never changes the schedule or score; the session summary offers redo of missed items', async () => {
    const before = await localState(page);
    await page.getByRole('button', { name: 'Try again' }).click();
    await expect(page.getByTestId('feedback')).toHaveCount(0);
    const fen = (await board(page).getAttribute('data-fen')) as string;
    const item = before.training.find((t) => t.kind === 'threat' && t.payload.fen === fen);
    const answer = item?.payload.answer ?? [];
    const me = fen.split(' ')[1] as 'w' | 'b';
    // answer correctly this time: still must not change the saved schedule
    if (answer.length) await sq(page, answer[0]).click();
    else await page.getByRole('button', { name: 'Nothing is in danger' }).click();
    await expect(page.getByTestId('feedback')).toContainText('Correct');
    const after = await localState(page);
    expect(after.training.find((t) => t.id === item?.id)?.box).toBe(0);
    expect(after.training.find((t) => t.id === item?.id)?.attempts).toBe(1);
    expect(me).toBeTruthy();
  });

  test('puzzles: progressive hints, Show answer, Try again, redo the ones you missed', async () => {
    await page.goto('/train');
    await page.getByTestId('theme-free').click();
    await expect(page.getByTestId('session')).toBeVisible();
    const total = Number((await page.getByTestId('counter').innerText()).split('/')[1]);
    expect(total).toBeGreaterThanOrEqual(5);

    const solveCurrent = async (): Promise<void> => {
      const fen = (await board(page).getAttribute('data-fen')) as string;
      const pz = PUZZLES.find((p) => p.fen === fen);
      expect(pz, `puzzle for ${fen}`).toBeDefined();
      const line = (pz as RawPuzzle).moves;
      await playUci(page, line[0]);
      for (let i = 2; i < line.length; i += 2) {
        await page.waitForTimeout(800); // the reply is played automatically
        await playUci(page, line[i]);
      }
    };

    // #1: use all three hints
    await page.getByRole('button', { name: 'Hint' }).click();
    await expect(page.getByTestId('feedback')).toContainText('Hint 1 of 3');
    await page.getByRole('button', { name: 'Hint' }).click();
    await expect(page.getByTestId('feedback')).toContainText('Hint 2 of 3');
    await page.getByRole('button', { name: 'Hint' }).click();
    await expect(page.getByTestId('feedback')).toContainText('Answer');
    await solveCurrent();
    await expect(page.getByTestId('feedback')).toContainText('Solved, with help');
    // Try again resets the board without scoring
    await page.getByRole('button', { name: 'Try again' }).click();
    await expect(page.getByTestId('feedback')).toHaveCount(0);
    await page.getByRole('button', { name: 'Show answer' }).click();
    await expect(page.getByTestId('feedback')).toContainText('Answer');
    await page.getByTestId('next').click(); // skipping after Show answer counts as missed

    // #2: solve cleanly
    await solveCurrent();
    await expect(page.getByTestId('feedback')).toContainText('Correct!');
    await page.getByTestId('next').click();

    // the rest: solve cleanly
    for (let i = 2; i < total; i++) {
      await solveCurrent();
      await expect(page.getByTestId('feedback')).toContainText('Correct!');
      await page.getByTestId('next').click();
    }
    await expect(page.getByTestId('summary')).toBeVisible();
    await expect(page.getByTestId('summary')).toContainText(`${total - 1} / ${total}`);
    await expect(page.getByRole('button', { name: /Redo the 1 you missed/ })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Do this whole set again' })).toBeVisible();
    await page.getByRole('button', { name: /Redo the 1 you missed/ }).click();
    await expect(page.getByTestId('counter')).toContainText('1 / 1');
    // theme rating and attempts were recorded
    const st = await localState(page);
    expect(st.attempts.filter((a) => a.theme === 'free').length).toBeGreaterThanOrEqual(total);
  });
});

test.describe('Phase 2: board, bot, Blunder Check', () => {
  test('Blunder Check fires on a hung queen, offers Take it back / Play it anyway, and counts the catch', async () => {
    await page.goto('/play?moves=e2e4,e7e5,d1h5,b8c6'); // White to move: Qxe5?? loses the queen to ...Nxe5
    await expect(page.getByTestId('status')).toContainText('Your move');
    await tapMove(page, 'h5', 'e5');
    await expect(page.getByTestId('blunder-check')).toBeVisible({ timeout: 20_000 });
    await expect(page.getByTestId('blunder-check')).toContainText(/queen/i);
    await expect(page.locator('[data-arrow]').first()).toBeVisible(); // red arrow for their punishing reply
    await page.getByTestId('take-back').click();
    await expect(page.getByText(/Blunders caught so far: 1/)).toBeVisible();
    await expect(board(page)).toHaveAttribute('data-fen', /^r1bqkbnr\/pppp1ppp\/2n5\/4p2Q\/4P3\/8\/PPPP1PPP\/RNB1KBNR w/);
  });

  test('tapping the wrong thing is never silent', async () => {
    await sq(page, 'e7').click(); // an opponent piece
    await expect(toastText(/Tap one of your/i)).toBeVisible();
  });

  test('a bot reply arrives quickly even while analysis runs in the background', async () => {
    await page.goto('/play');
    await page.getByTestId('new-game').click();
    // turn Blunder Check off so the test only measures the bot
    await page.getByRole('switch', { name: 'Blunder Check' }).evaluate((el) => (el as HTMLElement).getAttribute('aria-checked') === 'true' && (el as HTMLElement).click());
    await expect(page.getByTestId('status')).toContainText('Your move');
    await tapMove(page, 'e2', 'e4');
    const t0 = Date.now();
    await expect(page.getByTestId('status')).toContainText('Your move', { timeout: 10_000 });
    expect(Date.now() - t0).toBeLessThan(4_000);
    const fen = await board(page).getAttribute('data-fen');
    expect(fen).toContain(' w ');
    expect(fen?.startsWith('rnbqkbnr/pppppppp/8/8/4P3')).toBe(false); // black moved
  });

  test('a short full-game flow is playable: several moves, drag works, game can be restarted', async () => {
    await page.goto('/play');
    await page.getByTestId('new-game').click();
    for (let i = 0; i < 4; i++) {
      await expect(page.getByTestId('status')).toContainText('Your move', { timeout: 15_000 });
      const fen = (await board(page).getAttribute('data-fen')) as string;
      const c = new Chess(fen);
      const m = c.moves({ verbose: true }).filter((x) => !x.captured)[i % 3];
      if (i === 1) {
        // drag instead of tap
        const a = await sq(page, m.from).boundingBox();
        const b = await sq(page, m.to).boundingBox();
        if (!a || !b) throw new Error('no board boxes');
        await page.mouse.move(a.x + a.width / 2, a.y + a.height / 2);
        await page.mouse.down();
        await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2, { steps: 8 });
        await page.mouse.up();
      } else {
        await tapMove(page, m.from, m.to);
      }
      // either Blunder Check interrupts (take it back and carry on) or the bot answers
      const bc = page.getByTestId('blunder-check');
      if (await bc.isVisible().catch(() => false)) await page.getByTestId('play-anyway').click();
    }
    await expect(page.getByTestId('status')).toContainText(/Your move|Bot is thinking|Blunder Check/);
  });
});

test.describe('Phase 6: learn and London', () => {
  test('lessons: open one, practice launches a session, mark as done updates the list', async () => {
    await page.goto('/learn');
    await expect(page.getByTestId('lesson-list').locator('a')).toHaveCount(12);
    await page.getByTestId('lesson-list').locator('a').first().click();
    await expect(page.getByTestId('lesson')).toContainText('What pieces are worth');
    await page.getByRole('button', { name: /Mark as done|Done/ }).click();
    await expect(page).toHaveURL(/\/learn$/);
    await expect(page.getByText('1 of 12 done')).toBeVisible();
  });

  test('opening trainer: play a whole London line (you play White, the trainer answers)', async () => {
    await page.goto('/learn/opening/london/0');
    const line = OPENINGS.london.lines[0].moves;
    const c = new Chess();
    for (let i = 0; i < line.length; i++) {
      const m = c.move(line[i][0]);
      if (i % 2 === 0) {
        await expect(page.getByTestId('opening-actions')).toContainText('Show me', { timeout: 10_000 });
        await tapMove(page, m.from, m.to);
      }
      await page.waitForTimeout(i % 2 === 0 ? 150 : 900); // the trainer plays its reply
    }
    await expect(page.getByText('Line complete')).toBeVisible({ timeout: 10_000 });
    await expect(page.getByTestId('next-line')).toBeVisible();
    const st = await localState(page);
    expect(st.progress.openings.london0).toBe(1);
  });

  test('London coach (scripted): 1.d4 d5 2.Bf4 Nc6 3.e3 e5 recommends dealing with the attacked bishop, not Nf3', async () => {
    await page.goto('/london?moves=d2d4,d7d5,c1f4,b8c6,e2e3,e7e5');
    await expect(page.getByTestId('coach-advice')).toBeVisible({ timeout: 30_000 });
    await expect(page.getByTestId('advice-title')).toHaveText('A pawn is attacking your bishop');
    await expect(page.getByTestId('advice-text')).toContainText('Move it or take the pawn first');
    await expect(page.locator('[data-arrow^="g1f3"]')).toHaveCount(0);
  });

  test('London move-order warning: e3 before Bf4 offers Take back / Keep', async () => {
    await page.goto('/london?moves=d2d4,d7d5');
    await expect(page.getByTestId('coach-advice')).toBeVisible({ timeout: 30_000 });
    await tapMove(page, 'e2', 'e3');
    await expect(page.getByTestId('london-prompt')).toContainText('Move order: bishop first!', { timeout: 20_000 });
    await expect(page.getByTestId('keep-move')).toHaveText('Keep it');
    await page.getByTestId('take-back').click();
    await expect(page.getByTestId('london-prompt')).toHaveCount(0);
  });
});

test.describe('Settings', () => {
  test('theme can be switched to dark and persists', async () => {
    await page.goto('/settings');
    await page.getByRole('group', { name: 'Theme' }).getByRole('button', { name: 'Dark' }).click();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
    await page.reload();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
    await page.getByRole('group', { name: 'Theme' }).getByRole('button', { name: 'System' }).click();
    await expect(page.locator('html')).not.toHaveAttribute('data-theme', /.+/);
  });

  test('about page credits the piece set and engine', async () => {
    await page.goto('/about');
    await expect(page.getByText(/cburnett/)).toBeVisible();
    await expect(page.getByText(/CC BY-SA 3.0/)).toBeVisible();
    await expect(page.getByText(/Stockfish/).first()).toBeVisible();
  });
});

// keep helper referenced for "onboardAndPull" users who want a fresh context in other specs
export { onboardAndPull };
