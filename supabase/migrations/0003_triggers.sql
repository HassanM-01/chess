-- On auth.users insert, create the profile + progress rows for the new user (spec section 4, "Trigger").
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, display_name)
  values (new.id, coalesce(new.raw_user_meta_data ->> 'full_name', split_part(new.email, '@', 1)))
  on conflict (id) do nothing;
  insert into public.progress (user_id) values (new.id) on conflict (user_id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- Atomically bump today's "Ask Coach why" counter; used only by /api/explain with the service role.
create or replace function public.bump_coach_usage(p_user uuid)
returns int
language sql
security definer
set search_path = public
as $$
  insert into public.coach_usage as c (user_id, day, count)
  values (p_user, current_date, 1)
  on conflict (user_id, day) do update set count = c.count + 1
  returning c.count;
$$;
revoke all on function public.bump_coach_usage(uuid) from public, anon, authenticated;
grant execute on function public.bump_coach_usage(uuid) to service_role;

-- Users are created before profiles can be linked to a username; keep the lowercase invariant in the database too.
create or replace function public.lowercase_chesscom_username()
returns trigger language plpgsql as $$
begin
  if new.chesscom_username is not null then
    new.chesscom_username := lower(btrim(new.chesscom_username));
  end if;
  return new;
end;
$$;
drop trigger if exists profiles_lowercase_username on public.profiles;
create trigger profiles_lowercase_username
  before insert or update on public.profiles
  for each row execute function public.lowercase_chesscom_username();
