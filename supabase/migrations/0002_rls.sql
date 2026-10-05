-- Row Level Security (spec section 4). Every table has RLS on. Users can never read or write another user's private data.

alter table public.profiles        enable row level security;
alter table public.games           enable row level security;
alter table public.game_analysis   enable row level security;
alter table public.mistakes        enable row level security;
alter table public.puzzles         enable row level security;
alter table public.training_items  enable row level security;
alter table public.attempts        enable row level security;
alter table public.theme_skill     enable row level security;
alter table public.skill_snapshots enable row level security;
alter table public.progress        enable row level security;
alter table public.coach_usage     enable row level security;

-- PROFILES: select/update own row. No insert policy: rows are created by the trigger (0003) only.
create policy profiles_select_own on public.profiles for select to authenticated using (id = (select auth.uid()));
create policy profiles_update_own on public.profiles for update to authenticated using (id = (select auth.uid())) with check (id = (select auth.uid()));

-- Per-user tables: all CRUD where user_id = auth.uid().
create policy games_all_own on public.games for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
-- game_analysis / mistakes / training_items also verify that the referenced game (and mistake) belongs to the caller:
-- foreign-key checks bypass RLS, so without this a user could attach rows to somebody else's (e.g. shared) game.
create policy game_analysis_all_own on public.game_analysis for all to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid())
    and exists (select 1 from public.games g where g.id = game_id and g.user_id = (select auth.uid())));
create policy mistakes_all_own on public.mistakes for all to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid())
    and exists (select 1 from public.games g where g.id = game_id and g.user_id = (select auth.uid())));
create policy training_items_all_own on public.training_items for all to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid())
    and (game_id is null or exists (select 1 from public.games g where g.id = game_id and g.user_id = (select auth.uid())))
    and (mistake_id is null or exists (select 1 from public.mistakes m where m.id = mistake_id and m.user_id = (select auth.uid()))));
create policy attempts_all_own on public.attempts for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy theme_skill_all_own on public.theme_skill for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy skill_snapshots_all_own on public.skill_snapshots for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy progress_all_own on public.progress for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

-- Public sharing (phase 7): a game owner can flip is_public; anyone (even signed out) can then read that one game
-- and its analysis, read-only.
create policy games_select_public on public.games for select to anon, authenticated using (is_public = true);
create policy game_analysis_select_public on public.game_analysis for select to anon, authenticated
  using (exists (select 1 from public.games g where g.id = game_analysis.game_id and g.is_public = true));

-- PUZZLES: readable by signed-in users, never writable from clients (seed with the service role).
create policy puzzles_select on public.puzzles for select to authenticated using (true);

-- COACH_USAGE: no policies at all => no client access. Only the serverless function (service role) touches it.

-- Belt and braces: make sure the anon role cannot write anything.
revoke insert, update, delete on all tables in schema public from anon;
revoke insert, update, delete on public.puzzles from authenticated;
revoke all on public.coach_usage from anon, authenticated;
