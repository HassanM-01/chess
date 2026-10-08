# Blunder Check: Technical Spec

A multi-user chess improvement app for beginners (roughly 100 to 1000 rated). Each user links a chess.com username. The app pulls their games, analyzes every move with Stockfish, finds the patterns that cost them games, and builds training from their own mistakes. It keeps adapting as they play more.

This spec is written for Claude Code. Work through the phases in order. Each phase ends with acceptance checks. Do not start a phase until the previous one passes.

---

## 0. Ground rules for Claude Code

1. **A working prototype already exists** in `reference/prototype/`. It is a single-page vanilla JS app. Its chess logic, mistake classifier, puzzle data, lessons, opening lines, London simulator, and walkthrough are tested and correct. **Port this logic. Do not reinvent it.** Section 13 maps every prototype function to its new home.
2. Mobile first. Most users are on a phone in Safari. Test every screen at 390px wide.
3. All engine work runs **in the browser** (Stockfish WASM in a Web Worker). There is no server-side engine. That keeps hosting free.
4. Supabase is the only backend. Row Level Security (RLS) is on for every table. Users can never read or write another user's private data.
5. Use TypeScript in strict mode. No `any` in domain code.
6. Write tests as you go (Vitest for logic, Playwright for flows). Section 12 lists the required ones.
7. When a library's current API differs from what this spec says, follow the library's current docs and leave a one-line comment.
8. Ask me before adding paid services or any dependency over 1 MB that isn't listed here.

---

## 1. Product summary

### Who it's for
Beginners who keep losing to friends and don't know why. They hang pieces, miss threats, miss free captures and miss mates in one. They don't need opening theory. They need habits.

### Core loop
1. User taps **Pull recent games**.
2. The app fetches their chess.com games, analyzes each one, and finds their mistakes.
3. Their **skill profile** updates. That covers which mistake types they make most, in which game phase, and with which pieces, all weighted toward recent games.
4. The **Coach** screen shows their top 3 weaknesses, with evidence and a daily 15-minute plan.
5. **Training** serves exactly what they need:
   - Their own blunders as puzzles, with spaced repetition.
   - Drills built from their own positions.
   - Theme puzzles weighted by weakness and pitched at their level.
6. As they improve, weights shift automatically and the plan changes. "Learning from their mistakes" means this feedback loop.

### Features (all exist in the prototype unless marked NEW)
| Area | Feature |
|---|---|
| Accounts | NEW: sign in (email magic link / OTP, optional Google), link chess.com username, profile |
| Games | **Pull recent games** button (NEW: auto via chess.com API), PGN paste/upload, game list, per-game analysis |
| Coach | Weakness report, phase breakdown, how losses ended, castling habit, daily plan, "your last game" card, NEW: improvement trend |
| Walkthrough | Move-by-move review: graded moves (Best/Good/Inaccuracy/Mistake/Blunder/Missed free piece), red and green arrows, better move with reason, best line, timeline strip, "Mistakes »" jump, quiz mode |
| Train | Game trainer (Spot the threat, Safe or blunder?, Punish mistakes, Fix your mistakes), spaced repetition, daily mix, theme puzzles, progressive 3-step hints, Try again, redo missed |
| Learn | 12 ordered lessons, opening trainer (Italian, London, Black vs e4/d4) |
| London | London System simulator vs a bot that plays real anti-London setups, with a live coach |
| Play | Play vs bot (5 levels) with Blunder Check (stops you before hanging material) |
| Coach chat | Optional: "Ask Coach why" plain-English explanation via a Vercel function calling the Anthropic API |
| Sharing | NEW (phase 7): public read-only walkthrough link for a single game |

---

## 2. Tech stack

| Layer | Choice | Notes |
|---|---|---|
| Frontend | **Vite + React 18 + TypeScript** | SPA. React Router for routes. |
| Server state | **TanStack Query** | Caching and refetching Supabase reads. |
| Local state | **Zustand** | Board and session state only. |
| Styling | **Plain CSS with design tokens** | Port `reference/prototype/app.css` (light and dark tokens). CSS Modules or one global file. No Tailwind needed. |
| Chess rules | **chess.js v1.x** | Note: the prototype uses v0.10. API differences are in Section 13.3. |
| Engine | **stockfish npm package, v18** | Use `stockfish-18-lite-single.js` + `.wasm` (single threaded, ~7 MB, no special headers). Fallback: `stockfish-18-asm.js`. Copy to `/public/engine/`. |
| Board UI | Port the prototype's `BoardView` (tap to move, drag, arrows, marks, promotion picker) to a React component. | Piece SVGs: the cburnett set (CC BY-SA 3.0), already inlined as a sprite in `reference/prototype/built-single-file.html`. Credit it on an About page. |
| Backend | **Supabase** (Postgres, Auth, RLS) | JS client v2. |
| Hosting | **Vercel** | Static SPA + `/api/*` serverless functions (only for the optional coach and a chess.com proxy fallback). |
| PWA | `vite-plugin-pwa` | Installable on the home screen; caches the engine files. |
| Tests | Vitest, Playwright | Playwright with the iPhone 13 device profile. |

---

## 3. Architecture

```
Browser (React SPA)
 ├─ UI screens ─────────── TanStack Query ── Supabase JS ──> Supabase (Auth + Postgres + RLS)
 ├─ chesscom.ts ── fetch ──> https://api.chess.com/pub/...   (CORS allowed: Access-Control-Allow-Origin: *)
 │                  └─ fallback ──> /api/chesscom (Vercel fn, adds User-Agent, handles 429 retry)
 ├─ engine/worker.ts ── Stockfish WASM (Web Worker), priority queue
 ├─ analysis/ ── analyzeGame → classify mistakes → write to DB
 ├─ skill/ ── recompute skill profile → choose training
 └─ /api/explain (optional) ──> Anthropic Messages API (key stays server-side)
```

Analysis results are written to Supabase, so a game is analyzed once and is then available on every device.

---

## 4. Data model (Supabase)

Create `supabase/migrations/0001_init.sql` with the following. Use `uuid` keys with `gen_random_uuid()`.

```sql
-- PROFILES -------------------------------------------------------------
create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text,
  chesscom_username text,               -- lowercase
  settings jsonb not null default '{}', -- bot level, blunder check on, London guide on, etc.
  last_synced_at timestamptz,
  created_at timestamptz not null default now()
);
create unique index profiles_chesscom_username_key on public.profiles (chesscom_username) where chesscom_username is not null;

-- GAMES ----------------------------------------------------------------
create type game_source as enum ('chesscom','pgn','bot','london');
create type analysis_status as enum ('pending','running','done','error','skipped');

create table public.games (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  source game_source not null,
  external_id text,                     -- chess.com game id (from URL)
  pgn text not null,
  start_fen text not null default 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1',
  moves_uci text[] not null,
  moves_san text[] not null,
  white text, black text,
  white_rating int, black_rating int,
  user_color char(1) check (user_color in ('w','b')),
  result text,                          -- '1-0' | '0-1' | '1/2-1/2' | '*'
  outcome char(1) check (outcome in ('w','l','d')),
  termination text,                     -- checkmate | resignation | time | abandoned | draw | other
  time_class text,                      -- bullet | blitz | rapid | daily
  opening text, eco text,
  played_at timestamptz,
  analysis_status analysis_status not null default 'pending',
  is_public boolean not null default false,
  created_at timestamptz not null default now(),
  unique (user_id, external_id)
);
create index on public.games (user_id, played_at desc);
create index on public.games (user_id, analysis_status);

-- ANALYSIS (one row per game) -------------------------------------------
create table public.game_analysis (
  game_id uuid primary key references public.games(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  engine text not null,                 -- e.g. 'sf18-lite-d11'
  depth int not null,
  evals jsonb not null,                 -- array per ply: [cp_white, mate_white|null, best_uci]
  summary jsonb not null,               -- castled_move, early_queen, eval_after_10, how_ended, counts by verdict
  created_at timestamptz not null default now()
);

-- MISTAKES (one row per user mistake) -----------------------------------
create type mistake_category as enum ('hung','ignored','missed_free','fork','missed_mate','allowed_mate','other');
create type game_phase as enum ('opening','middlegame','endgame');

create table public.mistakes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  game_id uuid not null references public.games(id) on delete cascade,
  ply int not null,
  fen text not null,                    -- position BEFORE the user's move
  played_uci text not null, played_san text not null,
  best_uci text, best_san text,
  reply_uci text, reply_san text,       -- opponent's best reply after the mistake
  category mistake_category not null,
  severity text not null check (severity in ('mistake','blunder')),
  phase game_phase not null,
  piece char(1),                        -- p n b r q k (piece lost, if any)
  square text,
  win_drop real not null,               -- win% points lost (0..100)
  explanation text not null,
  played_at timestamptz,                -- copied from game, for recency weighting
  created_at timestamptz not null default now(),
  unique (game_id, ply)
);
create index on public.mistakes (user_id, played_at desc);

-- GLOBAL PUZZLES (read-only for users) ----------------------------------
create table public.puzzles (
  id text primary key,                  -- 'bc_xxx' (bundled) or 'li_XXXXX' (Lichess)
  fen text not null,                    -- position where the SOLVER is to move
  moves text[] not null,                -- solver move, reply, solver move, ...
  themes text[] not null,               -- our theme keys (Section 6.4)
  rating int not null,
  explanation text,
  source text not null
);
create index on public.puzzles using gin (themes);
create index on public.puzzles (rating);

-- TRAINING ITEMS (spaced repetition, per user) --------------------------
create type training_kind as enum ('own_mistake','threat','judge','punish');
create table public.training_items (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  kind training_kind not null,
  mistake_id uuid references public.mistakes(id) on delete cascade,
  game_id uuid references public.games(id) on delete cascade,
  ply int,
  payload jsonb not null,               -- everything needed to render (fen, answer, explanation...)
  box int not null default 0,           -- Leitner box 0..6
  due_at timestamptz not null default now(),
  attempts int not null default 0,
  correct int not null default 0,
  last_result boolean,
  created_at timestamptz not null default now(),
  unique (user_id, kind, game_id, ply)
);
create index on public.training_items (user_id, due_at);

-- ATTEMPTS LOG (every answer, for stats and skill model) ----------------
create table public.attempts (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  puzzle_id text references public.puzzles(id),
  training_item_id uuid references public.training_items(id) on delete set null,
  theme text,
  correct boolean not null,
  used_hint boolean not null default false,
  ms int,
  created_at timestamptz not null default now()
);
create index on public.attempts (user_id, created_at desc);

-- THEME SKILL (per user per theme rating) -------------------------------
create table public.theme_skill (
  user_id uuid not null references auth.users(id) on delete cascade,
  theme text not null,
  rating real not null default 800,
  attempts int not null default 0,
  updated_at timestamptz not null default now(),
  primary key (user_id, theme)
);

-- SKILL PROFILE SNAPSHOTS (for the improvement trend) -------------------
create table public.skill_snapshots (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  profile jsonb not null,               -- output of computeSkillProfile()
  games_analyzed int not null,
  created_at timestamptz not null default now()
);

-- PROGRESS (lessons, openings, daily plan, play stats) -------------------
create table public.progress (
  user_id uuid primary key references auth.users(id) on delete cascade,
  lessons jsonb not null default '{}',
  openings jsonb not null default '{}',
  daily jsonb not null default '{}',
  play jsonb not null default '{}',
  updated_at timestamptz not null default now()
);

-- COACH USAGE (only if /api/explain is enabled) -------------------------
create table public.coach_usage (
  user_id uuid not null references auth.users(id) on delete cascade,
  day date not null default current_date,
  count int not null default 0,
  primary key (user_id, day)
);
```

### RLS (`0002_rls.sql`)
- Enable RLS on every table.
- `profiles`: select/update where `id = auth.uid()`; insert via trigger only (below).
- `games`, `game_analysis`, `mistakes`, `training_items`, `attempts`, `theme_skill`, `skill_snapshots`, `progress`: all CRUD where `user_id = auth.uid()`.
- `games` and `game_analysis`: an extra **select** policy for `anon` and `authenticated` where `games.is_public = true` (phase 7 sharing).
- `puzzles`: select for `authenticated`; no insert/update/delete from clients (seed through the service role).
- `coach_usage`: no client access; only the serverless function, with the service role, touches it.

### Trigger
On `auth.users` insert, create a `profiles` row and a `progress` row for the new user.

---

## 5. chess.com integration ("Pull recent games")

### Endpoints (public, no auth, CORS `*` confirmed)
- Validate username: `GET https://api.chess.com/pub/player/{username}` (returns 404 if missing).
- Archive list: `GET https://api.chess.com/pub/player/{username}/games/archives` returns `{ archives: [url, ...] }`, oldest first.
- Month: `GET https://api.chess.com/pub/player/{username}/games/{YYYY}/{MM}` returns `{ games: [...] }`. Each game has `url`, `pgn`, `end_time` (unix s), `time_class`, `rules`, `white{username,rating,result}`, `black{...}`.

### Pull recent games algorithm (`src/chesscom/sync.ts`)
1. Read `profiles.chesscom_username` and `last_synced_at`.
2. Fetch archives. Pick months to fetch: if never synced, the **last 2 months**; otherwise every month whose start is at or after the month of `last_synced_at`. Fetch months **one at a time** (chess.com rate-limits parallel requests; on 429 wait 2 s and retry up to 3 times).
3. Keep games where `rules === 'chess'`. Skip games with fewer than 6 plies (instant abandons). Mark them `skipped`, don't drop them, so they aren't re-fetched.
4. `external_id` = last path segment of `game.url`.
5. Parse each PGN with chess.js. Handle the `[%clk ...]` comments and the `SetUp`/`FEN` headers (odds games start from a custom FEN). Fill `moves_uci`, `moves_san`, `user_color` (compare usernames lowercase), `outcome`, `termination` (map the `Termination` header: contains "checkmate" means checkmate, "resignation" means resignation, "time" means time, "abandoned" means abandoned, "repetition|stalemate|agreement|insufficient|50" means draw), `opening` (from `ECOUrl` slug), `played_at` from `end_time`.
6. Upsert into `games` with `on conflict (user_id, external_id) do nothing`. Count the new rows.
7. Update `last_synced_at = now()`.
8. Kick off the **analysis queue** (Section 6.1) for every `pending` game, newest first.
9. UI: the button shows "Pulling games…", then "Analyzing 3 of 12…" with a progress bar. When done: a toast saying "12 new games analyzed. Your coach report is updated." The Coach screen refreshes.

If the direct fetch fails with a network or CORS error, retry through `/api/chesscom?path=/pub/player/...`. That's a Vercel function that only allows `/pub/player/` paths, sets a `User-Agent: BlunderCheck/1.0 (contact email)` header, and caches for 60 s.

PGN paste/upload stays as a manual import (source `pgn`), using the same parser.

---

## 6. Analysis and the "learning" model

### 6.1 Engine service (`src/engine/`)
Port `Engine` from the prototype:
- A single Web Worker running `stockfish-18-lite-single.js`, with the asm.js build as fallback (25 s / 60 s timeouts).
- UCI wrapper: `run(fen, { depth, skill, multipv, priority })` returns `{ cpWhite, mateWhite, best, pv, lines }`. **Always convert scores to White's point of view** (UCI reports from the side to move).
- **Two-level priority queue.** Interactive requests (bot moves, Blunder Check, hints, London coach) always run before background analysis. This fixed a real bug in the prototype where taps felt frozen while games analyzed.
- `terminalEval(fen)`: if checkmate or stalemate, return without asking the engine.

### 6.2 Game analysis (`src/analysis/analyzeGame.ts`)
- Evaluate every position at **depth 15** (background priority). Store `[cp, mate, best]` per ply.
- Win probability for White: `wp = 50 + 50 * (2 / (1 + exp(-0.00368208 * clamp(cp, -2000, 2000))) - 1)`; mate means 100 or 0.
- For each **user** move: `drop = wpUser(before) - wpUser(after)`. It's a candidate mistake if `drop >= 17 (it was 18 at depth 11; depth 15 reads the same borderline fork about a point lower)` and `wpUser(before) >= 6`, unless the user is still above 88% after it (and no mate was missed).
- Severity: `blunder` if `drop >= 30`, else `mistake`.
- Classify with the prototype's `categorize()` (Section 13). Categories in priority order:
  1. `missed_mate`: the user had a forced mate before and doesn't after.
  2. `allowed_mate`: opponent has mate in 4 or fewer after.
  3. `hung`: opponent's best reply captures a piece worth 3+ that the user just moved or just stopped defending (not an even trade).
  4. `ignored`: that piece was **already** attacked before the user's move.
  5. `fork`: opponent's best reply attacks two valuable targets.
  6. `missed_free`: the engine's best move captured a loose enemy piece worth 3+ and the user didn't take it.
  7. `other`.
- **Dedupe:** the same category on the same square in one game counts once. (The prototype found one hanging knight reported 4 times in a row without this.)
- **Even swaps aren't hung pieces.** If the user can recapture and the capturing piece is worth at least as much, skip `hung`.
- Phase: opening if ply ≤ 20; endgame if 6 or fewer non-pawn pieces or total material ≤ 26; else middlegame.
- Write `game_analysis`, `mistakes`, and generate `training_items` (6.5), then set `analysis_status = 'done'`.
- **Resumable:** if the tab closes mid-game, that game stays `running` → reset to `pending` on next app load.

### 6.3 Skill profile (`src/skill/computeSkillProfile.ts`)
Pure function. Input: the user's mistakes, game summaries and attempts. Output:

```ts
type SkillProfile = {
  gamesAnalyzed: number;
  record: { w: number; l: number; d: number };
  weaknesses: Array<{ key: Category | 'nocastle' | 'earlyqueen'; score: number; count: number; games: number; topPiece?: Piece }>; // sorted desc, top 4
  phases: Record<GamePhase, number>;
  lossesBy: Record<string, number>;
  castledEarlyRate: number;
  blundersPerGame: number;
  themeWeights: Record<Theme, number>;   // drives puzzle selection
  trend: Array<{ key: string; recent: number; previous: number }>; // last 14 days vs the 14 before
};
```
- Weakness score per category = `Σ (severity weight) × recency weight` ÷ games analyzed in the window.
  - Severity weight: blunder 1.0, mistake 0.6.
  - Recency weight: `0.5 ^ (days_ago / 14)` (14-day half-life), so recent habits dominate and fixed habits fade out.
- Habit flags (as in the prototype): `nocastle` if they castle by move 12 in fewer than half their games (with at least 3 analyzed); `earlyqueen` if they move the queen in their first 5 moves in 40% or more of games.
- Theme weights: map categories to themes (`hung`/`ignored` → `save`, `missed_free` → `free`, `fork` → `fork`, `missed_mate` → `mate1` + `mate2`, `allowed_mate` → `stopmate`, `other` → `winmat`). Base 1 per theme, plus `3 × normalized weakness`, plus 2 if theme accuracy over the last 20 attempts is below 60%.
- After every sync, store a `skill_snapshots` row. The Coach screen shows the trend, like "Hanging pieces: down 40% vs the previous 2 weeks".

### 6.4 Puzzles
- **Theme keys:** `save`, `free`, `fork`, `stopmate`, `mate1`, `mate2`, `winmat` (the prototype's `THEMES` object has names and prompts).
- **Seed 1 (bundled):** `reference/data/puzzles.json`, 275 puzzles generated and verified with Stockfish, beginner level, each with an explanation. Format: `{id, theme, fen, moves[], explain, alts?, lastMove?}`. Load with rating 600.
- **Seed 2 (Lichess, recommended):** the Lichess puzzle database is CC0 (`database.lichess.org/lichess_db_puzzle.csv.zst`). Write `scripts/import-lichess-puzzles.ts`:
  - Keep rows with Rating 400 to 1400 and Popularity ≥ 80.
  - Map Lichess themes: `hangingPiece` → `free`; `fork` → `fork`; `mateIn1` → `mate1`; `mateIn2` → `mate2`; `defensiveMove` → `save`; also `mate`, `backRankMate`. Keep at most 3000 per theme.
  - **Important:** in Lichess rows, the FEN is the position *before the opponent's move*, and `Moves[0]` is that opponent move. Apply `Moves[0]` to get our `fen` and `moves = Moves.slice(1)`; set `lastMove = Moves[0]`.
  - Upsert with the service role key (run locally, not in the browser).
- **Selection (`src/skill/pickPuzzles.ts`):**
  - Weighted random by `themeWeights`.
  - Within a theme, prefer puzzles with rating within ±150 of the user's `theme_skill.rating`.
  - Exclude puzzles attempted in the last 7 days.
  - Mix in 20% "review" puzzles they previously failed.
- **Theme rating update:** Elo with K = 32, where the puzzle rating is the opponent. A hint counts as a loss for rating purposes but still records the solve.

### 6.5 Training items (own positions) and spaced repetition
Generated after each game analysis (port `trainerPools()` from the prototype):
- `own_mistake`: one per mistake. "Find the better move than the one you played." Accept the engine's best, or any move within 7 win% of it (verify with a quick depth-11 eval).
- `threat`: positions right after the opponent moved where one of the user's pieces worth 3+ is hanging. "Tap your piece that's in danger." Also add calm positions (nothing hanging) at about 1 per 4 threats, with the answer "Nothing is in danger".
- `judge`: "You're about to play X. Safe or blunder?" Use the user's real blunders, plus real safe moves (drop ≤ 3, win% between 10 and 90), balanced 50/50.
- `punish`: positions right after the opponent blundered (user's win% jumped ≥ 20) where the best move captures or mates. "Your opponent just made a mistake. Punish it."

Leitner schedule (all kinds): boxes `[0, 1, 3, 7, 14, 30, 60]` days. Correct on the first try with no hint → box + 1. Wrong → box 0, due in 10 minutes. A "Try again" retry never changes the schedule or score.

### 6.6 Daily plan (Coach screen)
Generate from the profile. Each item is a card with a Go button and a done tick:
1. Game trainer: 15 positions from their games (mix: 3 threat, 1 calm, 2 judge, 2 safe-judge, 2 punish, 3 due own mistakes).
2. Puzzle mix: 10 puzzles weighted by `themeWeights`.
3. Next unfinished lesson.
4. Play one game vs the bot with Blunder Check on (or a London simulator game, if they've started the London lessons).
Store completion in `progress.daily`, keyed by local date.

---

## 7. Screens and routes

| Route | Screen | Port from prototype |
|---|---|---|
| `/login` | Email OTP / magic link; optional Google | NEW |
| `/onboarding` | Enter chess.com username (validate via API), then auto-run the first **Pull recent games** | NEW |
| `/` | **Coach**: last game card ("Walk me through it"), stats row, top weaknesses with evidence and "Train this" / "Lesson" buttons, phase bars, trend, daily plan, puzzle accuracy | `viewCoach`, `buildReport` |
| `/games` | **Pull recent games** button (big, top), last sync time, analysis progress, game list with W/L chip and blunder count, PGN paste/upload (collapsed) | `viewGames`, `doImport`, `analyzeAll` |
| `/games/:id` | Game review: board, move list, eval bar, mistakes list, "Ask Coach why" | `openReview` |
| `/games/:id/walk` | **Walkthrough**: timeline strip, headline ("You played X · Blunder · Better: Y"), board with arrows, explanation card, quiz toggle, sticky ‹ / Next › / Mistakes » bar | `openWalkthrough`, `walkSteps`, `verdictOf`, `whyBest` |
| `/train` | Game trainer card (4 modes plus a 15-position session), daily mix, theme grid | `viewTrain`, `startGameTrainer`, `trainerPools` |
| `/train/session` | Shared puzzle/drill session runner | `runPuzzleSession` (incl. `loadQuiz`, hints, `positionHint`, Try again, redo missed) |
| `/learn` | Lessons list and opening sets | `viewLearn`, `openLesson`, `openOpening`, `LESSONS`, `OPENINGS` |
| `/london` | London System simulator | `London`, `londonAdvice`, `LONDON_STEPS`, `LONDON_PLANS` |
| `/play` | Play vs bot with Blunder Check | `Play`, `LEVELS` |
| `/settings` | Username, display name, bot defaults, theme (light/dark/system), sign out, delete account | NEW |
| `/share/:gameId` | Public read-only walkthrough (phase 7) | NEW |

Bottom tab bar: Coach, London, Train, Learn, Play, Games. **Hide the tab bar during sessions** (puzzles, walkthrough, lessons) so the action bar never sits under it.

---

## 8. UX rules (learned from real use on an iPhone, enforce them)

1. **No silent taps.** Every tap on the board gets visible feedback: a selection, a move, or a short toast that explains what to do instead ("That's Black's piece. Tap one of yours." / "Tap Next to continue.").
2. **The primary action is always visible.** Put Next / Try again / Show answer in a sticky bottom action bar (`position: sticky; bottom: 0`, plus the safe-area inset). Explanations scroll above it.
3. **Every puzzle and drill has Try again**, and the session end screen has "Redo the N you missed" and "Do this whole set again".
4. **Hints are progressive and specific**:
   - Hint 1 is a clue about the position, in words ("Their queen on d3 is not protected").
   - Hint 2 highlights the piece to move.
   - Hint 3 shows the answer with the reason.
   - Never just say "play it on the board".
5. **Explanations name squares and pieces** and say *why*, in plain English for a beginner. No engine numbers in the main text.
6. **Blunder Check** (Play and London): if a move drops win% by 15 or more, pause and offer "Take it back" / "Play it anyway", with the reason and a red arrow for the opponent's punishing reply.
7. Engine work for the user's own actions must feel instant. That's the priority queue in 6.1.
8. A guard against stale async: every bot/coach async call carries a sequence token. If the view re-rendered or the game changed, discard the result. (The prototype had a bug where the bot played two plan moves after a re-render.)

---

## 9. London simulator details (port as is)
- User is White. A checklist of 9 setup moves: d4, Bf4, e3, Nf3, c3, Bd3, Nbd2, O-O, h3. Each is done by board state, not move history.
- Bot picks a random Black plan per game (Classical, Queen raid on b2, King's Indian, Knight hunts your bishop, Mirror). It plays the next legal plan move if it's within 18 win% of the engine's best; otherwise it falls back to the engine at the chosen level.
- Coach advice priority:
  1. Mate available.
  2. Own piece hanging.
  3. Free capture.
  4. Standard answers: ...Qb6 vs b2 → Qb3/Qc1/b3; knight attacking f4 → Be5/Bg5/Bg3; ...Bd6 vs f4 → Bg3/Bxd6.
  5. Next safe setup move (e3 never before Bf4). If a setup move is unsafe, skip to the next safe one and explain why.
  6. Middlegame plans after setup.
- **Add (new):** when a **pawn** attacks the f4 bishop (...e5 or ...g5), advice item 4 must trigger: "A pawn is attacking your bishop. Move it or take the pawn first." The real user lost the f4 bishop this way in three straight games.
- **Add (new):** when the opponent has just captured, item 2.5 is "Recapture first." The real user lost a rook to 4...cxd4 5.c3? dxc3 6.Bd3? cxb2 7...bxa1=Q by following the checklist instead of recapturing.
- Move-order warning: e3 while the c1 bishop is still home and Bf4 is legal, with Take back / Keep.

---

## 10. Optional: "Ask Coach why" (`/api/explain`)
- Vercel function. Body: `{ fen, played, best, reply, line, category, summary }`. Verify the Supabase JWT from the `Authorization` header.
- Rate limit: 30 per user per day via `coach_usage` (service role).
- Calls the Anthropic Messages API with `ANTHROPIC_API_KEY`. Use a small, fast model (e.g. `claude-haiku-4-5-20251001`) with max_tokens 200. Prompt: the engine facts are ground truth; reply in 3 to 4 short plain-English sentences: what went wrong, why the better move is better, one habit that would have caught it. No headings, lists, or em dashes.
- Stream the response to the UI. If the key is missing, hide the button.

---

## 11. Environment and deployment

`.env.local` (and Vercel project env):
```
VITE_SUPABASE_URL=
VITE_SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=      # server/scripts only, never VITE_
ANTHROPIC_API_KEY=              # optional
CHESSCOM_CONTACT_EMAIL=         # for the proxy User-Agent
```
Steps:
1. Create a Supabase project. Run migrations with `supabase db push` (or paste them in the SQL editor).
2. In Auth settings: enable email OTP; set the site URL and redirect URLs to the Vercel domain and `http://localhost:5173`.
3. Seed puzzles: `npm run seed:puzzles` (bundled) and optionally `npm run seed:lichess`.
4. `vercel link` then `vercel env add ...` then `vercel --prod`.
5. On iPhone: open the site in Safari, then Share, then Add to Home Screen.

---

## 12. Build phases and acceptance checks

### Phase 1: Scaffold, auth, profile
- Vite + React + TS, router, tokens and CSS ported (light/dark), tab bar, Supabase client, login, onboarding with username validation, settings.
- ✅ A new user can sign up on a phone, link `huhsaaan`, refresh, and stay signed in. A second user can't see the first user's profile (RLS test).

### Phase 2: Board and engine
- React `Board` (tap and drag moves, promotion, arrows, marks, last move, check highlight, flip, coordinates). Engine worker with priority queue. Play screen with 5 bot levels and Blunder Check.
- ✅ A full game vs the bot is playable on an iPhone 13 profile. A bot reply under background load arrives in under 1 s. Blunder Check fires on a hung queen.

### Phase 3: Pull recent games and analysis
- `chesscom/sync.ts`, PGN parsing, analysis queue (resumable), mistake classifier, training item generation. Games list and review screen.
- ✅ For `huhsaaan`, Pull recent games imports the October 2026 games without duplicates on a second press. Unit tests on these known games (from `reference/data/huhsaaan-games.pgn`, plies are 0-based, analysis now runs at depth 15, the prototype used 11) must pass. These are the prototype's actual outputs:
  - Game vs **Nahomxo** (2026-10-01): a mistake at ply 13 (`7...Nh6`) classified `fork` (Nxc7+ hits king and rook).
  - Game vs **19293a** (2026-10-05, user is Black): **zero** mistakes.
  - Game vs **whole_cooked_chicken** (2026-10-05): a blunder at ply 6 (`4.Nf3`) classified `ignored`, whose explanation mentions the bishop on f4.
  - Game vs **mert19890** (2026-10-03): outcome `l`, termination `checkmate`.
  - Game vs **YossufM** (2026-10-01, user is White): blunders at plies 76, 78, 82, 84.
- ✅ Also: import `reference/data/huhsaaan-games.pgn` through PGN upload and confirm 35 games parse.

### Phase 4: Coach, skill profile, walkthrough
- `computeSkillProfile`, Coach screen, trend, daily plan, Walkthrough (with quiz mode), "your last game" card.
- ✅ The walkthrough for the YossufM 2026-10-01 game shows the strip with red at moves 39, 40, 42 and 43. "Mistakes »" jumps through them in order. Quiz mode accepts any move within 5 win%.

### Phase 5: Training
- Session runner (all item kinds), progressive hints, Try again, redo missed, Leitner scheduling, puzzle seeding and selection, theme skill ratings, game trainer modes.
- ✅ Spot the threat: tapping an enemy piece shows a toast and doesn't count as an answer. The Next button is visible without scrolling at 390x844. A wrong answer makes the item due again within 10 minutes.

### Phase 6: Learn and London
- Lessons, opening trainer, London simulator with the two new advice rules (Section 9).
- ✅ Scripted test: 1.d4 d5 2.Bf4 Nc6 3.e3 e5: the coach must recommend dealing with the attacked bishop or taking the pawn, not Nf3.

### Phase 7: Polish and sharing
- PWA install, offline cache for the engine, public share link for a walkthrough, About/credits page, optional `/api/explain`.
- ✅ Lighthouse PWA installable. The share link opens signed out and shows the walkthrough read-only.

---

## 13. Porting map (prototype → new code)

### 13.1 Files in `reference/prototype/`
| File | What's inside |
|---|---|
| `logic.js` | Board helpers: `parseFen`, `attacksFrom`, `attackers`, `hangingInfo`, `hangingPieces`, `material`, `forkTargets`, `phaseOf`, piece values. Port to `src/chess/tactics.ts` almost unchanged. |
| `app.js` | Everything else. Key functions: `Engine` (queue + worker), `wpWhite`, `wpFor`, `evalPos`, `terminalEval`, `BoardView`, `parsePGNs`, `assignColor`, `outcomeOf`, `howEnded`, `analyzeGame`, `findMistakes`, `categorize`, `summarize`, `buildReport`, `allDrillItems`, `gradeDrill`, `trainerPools`, `startGameTrainer`, `pickPuzzles`, `positionHint`, `runPuzzleSession`, `viewCoach`, `viewTrain`, `viewLearn`, `openLesson`, `openOpening`, `Play`, `LEVELS`, `London`, `londonAdvice`, `LONDON_STEPS`, `LONDON_PLANS`, `LONDON_LEVELS`, `openReview`, `walkSteps`, `verdictOf`, `standing`, `whyBest`, `openWalkthrough`, `askCoach`. |
| `content.js` | `OPENINGS` (Italian, London with 5 lines, Black vs e4, Black vs d4), `LESSONS` (12), `THEMES`, `CATS` (category labels and advice). Port to `src/content/*.ts` as typed constants. All lines are verified legal. |
| `app.css` | Design tokens (light/dark), board, cards, pills, timeline, sticky action bar. |
| `gen.js` | The offline puzzle generator (Stockfish self-play). Keep it in `scripts/` for later. |
| `built-single-file.html` | The working prototype. Open it in a browser to see the intended behavior. It contains the piece sprite SVG. |

### 13.2 Data
- `reference/data/puzzles.json`: 275 verified beginner puzzles.
- `reference/data/huhsaaan-games.pgn`: 35 real games for fixtures and tests.

### 13.3 chess.js 0.10 → 1.x differences
| 0.10 (prototype) | 1.x |
|---|---|
| `load_pgn(pgn, {sloppy:true})` returns false on failure | `loadPgn(pgn, { strict: false })` throws on failure |
| `in_check()`, `in_checkmate()`, `in_stalemate()`, `game_over()` | `inCheck()`, `isCheckmate()`, `isStalemate()`, `isGameOver()` |
| `move(...)` returns null if illegal | `move(...)` **throws** if illegal; wrap it in a `tryMove` helper that returns null |
| `header()` | `header()` (unchanged); `getHeaders()` in newer versions |
| `history({verbose:true})` items have `.from .to .piece .captured .promotion .san .color` | same |

Write `src/chess/compat.ts` with `tryMove`, `loadPgnSafe`, and the boolean helpers so ported code stays simple.

---

## 14. Definition of done
- Two real accounts can each sign in on a phone and a laptop. Each sees only their own games and progress, and progress matches across devices.
- Pull recent games imports, analyzes and updates the coach report in one tap, with visible progress.
- Training picks change after new games: a user who starts hanging rooks sees more `save` puzzles and own-mistake drills within one sync.
- All Section 12 checks pass in CI (`npm test` and `npx playwright test`).
