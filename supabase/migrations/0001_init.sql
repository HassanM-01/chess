-- Blunder Check: schema (spec section 4).
-- Deviations from the spec text, all additive:
--   * puzzles.last_move / puzzles.alts: the puzzle runner needs the opponent's last move (highlight)
--     and alternative accepted first moves (mate-in-1 puzzles with several mates).

create extension if not exists pgcrypto;

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
  source text not null,
  last_move text,                       -- the opponent move that led to this position (highlight)
  alts text[]                           -- alternative accepted first moves
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
create index on public.skill_snapshots (user_id, created_at desc);

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
