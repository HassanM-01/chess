-- The coach's latest plan is stored with the user's progress so it follows them across devices.
alter table public.progress add column if not exists coach jsonb not null default '{}';
