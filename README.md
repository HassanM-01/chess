# Blunder Check

A multi-user chess improvement app for beginners (roughly 100 to 1000 rated). Each user links a chess.com username.
The app pulls their games, analyzes every move with Stockfish **in the browser**, finds the habits that cost them games,
and builds training from their own mistakes. It keeps adapting as they play more.

The full technical spec is in [`SPEC.md`](SPEC.md). The original single-file prototype that this app ports lives in
[`reference/`](reference/).

## What's in the box

| Area | Where |
|---|---|
| Chess rules + tactics helpers (ported from the prototype) | `src/chess/` |
| Stockfish 18 WASM service with a two-level priority queue | `src/engine/` |
| Game analysis, mistake classifier, walkthrough model | `src/analysis/` |
| chess.com client, PGN parser, "Pull recent games" | `src/chesscom/` |
| Skill profile, Leitner schedule, puzzle selection, training items | `src/skill/` |
| Data layer: `Repo` interface, Supabase + in-memory implementations | `src/db/` |
| Screens | `src/features/*` |
| Vercel functions: chess.com proxy, "Ask Coach why", delete account | `api/` |
| Database schema + Row Level Security | `supabase/migrations/` |
| Seed scripts | `scripts/` |

### Local mode

If `VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY` are not set the app runs in **local mode**: one local user, everything
saved in the browser's `localStorage`, the 275 bundled puzzles. All screens work, so you can try the whole app (and run the
whole test suite) without a backend. Sharing and account deletion need Supabase.

## Quick start

```bash
npm install          # also copies the Stockfish files into public/engine (git-ignored)
cp .env.example .env.local   # fill in the Supabase values to leave local mode
npm run dev          # http://localhost:5173
```

Node 22+ is required (`stockfish@18.0.8` is pinned on purpose: the spec's results were produced with Stockfish 18).

## Scripts

| Command | What it does |
|---|---|
| `npm run dev` / `build` / `preview` | Vite dev server / production build (with PWA) / preview on :4173 |
| `npm run typecheck` | `tsc --noEmit` (strict) |
| `npm test` | Vitest: unit tests that run the real Stockfish in Node |
| `npm run e2e` | Playwright on the iPhone 13 profile (390x844) + the PWA spec |
| `npm run seed:puzzles` | Upload the 275 bundled puzzles (needs the service role key in `.env.local`) |
| `npm run seed:lichess -- --file lichess_db_puzzle.csv.zst` | Import Lichess puzzles (or `--download`) |

## Set up the backend

1. **Create a Supabase project.** Copy the project URL, the anon key and the service role key.
2. **Run the migrations** in `supabase/migrations/` in order (`0001_init.sql`, `0002_rls.sql`, `0003_triggers.sql`):
   `supabase link --project-ref <ref> && supabase db push`, or paste each file into the SQL editor.
3. **Auth settings:** enable *Email* sign-in with OTP codes, set the *Site URL* to your Vercel domain and add
   `http://localhost:5173` plus the Vercel domain (and `https://*-<team>.vercel.app` for previews) to the redirect URLs.
   Edit the "Magic Link" email template to include `{{ .Token }}` so users get a 6-digit code.
4. **Seed puzzles:** put the keys in `.env.local`, then `npm run seed:puzzles` (and optionally `npm run seed:lichess`).
5. **Check it:** `npx vitest run tests/rls.test.ts tests/repo.contract.test.ts` runs the RLS and data-layer contract
   tests against your real project (they skip themselves when the keys are missing).

### Environment variables

| Variable | Where | Notes |
|---|---|---|
| `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY` | browser + Vercel | safe to expose; RLS protects the data |
| `VITE_COACH_ENABLED=1` | browser + Vercel | shows the "Ask Coach why" button (needs `ANTHROPIC_API_KEY` too) |
| `VITE_GOOGLE_AUTH=1` | browser + Vercel | shows "Continue with Google" (enable the provider in Supabase first) |
| `SUPABASE_SERVICE_ROLE_KEY` | Vercel functions + local scripts only | **never** prefix with `VITE_` |
| `SUPABASE_URL` | Vercel functions | same value as `VITE_SUPABASE_URL` |
| `ANTHROPIC_API_KEY` | Vercel functions | optional; without it `/api/explain` returns 404 and the button stays hidden |
| `CHESSCOM_CONTACT_EMAIL` | Vercel functions | goes into the proxy's `User-Agent` |

## Deploy: GitHub + Vercel (CI/CD)

1. Push this repo to GitHub. `.github/workflows/ci.yml` runs typecheck, unit tests, build and the Playwright suites on every
   push and pull request.
2. In Vercel: **Add New, Project**, pick the repo. The framework preset is Vite; `vercel.json` sets everything else.
   Add the environment variables above (Production and Preview).
3. Every push to `main` deploys to production and every pull request gets a preview URL. To make CI a merge gate, enable
   branch protection on `main` and require the **CI / Typecheck, unit tests, build, e2e** check.
4. Optional repository secrets for the `database` CI job: `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`
   (use a **separate test project**: the tests create and delete throwaway users).
5. On iPhone: open the site in Safari, Share, **Add to Home Screen**.

## Architecture notes

- **All engine work runs in the browser** (single Web Worker, `stockfish-18-lite-single`, asm.js fallback). Interactive
  requests (bot moves, Blunder Check, hints, London coach) always jump ahead of background analysis and even interrupt a
  running background search, so taps never feel frozen.
- **Analysis is reproducible:** the hash table is cleared (`ucinewgame`) at the start of every analyzed game.
- **Supabase is the only backend**, with RLS on every table. Analysis results are written once and are available on every device.
- **Resumable:** a game left `running` by a closed tab is reset to `pending` and analyzed on the next load.
- The data layer is one `Repo` interface. `supabaseRepo` is the real thing; `memoryRepo` powers local mode and the tests,
  and both pass the same contract test (`tests/repo.contract.test.ts`).

## Deviations from the spec (all deliberate)

- `stockfish` is pinned to **18.0.8** (npm's latest is 19) so results match the prototype and the spec's acceptance numbers.
  The engine files are copied into `public/engine/` by `scripts/copy-engine.mjs` rather than committed.
- `puzzles` has two extra nullable columns, `last_move` and `alts`, because the puzzle runner needs the opponent's last move
  and alternative mates.
- Phase 3 acceptance for the YossufM game: the **walkthrough** marks plies 76, 78, 82, 84 red (win-chance drop of 20+ points),
  while the stricter **mistakes list** severity ("blunder" = drop of 30+) calls 76 and 84 blunders and 78 and 82 mistakes.
  All four are in the mistakes list.
- The skill profile excludes bot/London practice games (as in the prototype); weaknesses are ranked first, habit flags
  (not castling, early queen) follow.

## Credits

Chess pieces: cburnett set (CC BY-SA 3.0). Engine: Stockfish.js 18 by Chess.com (GPLv3). Chess rules: chess.js.
Puzzles: generated with Stockfish, plus the optional Lichess puzzle database (CC0). See the in-app About page.
