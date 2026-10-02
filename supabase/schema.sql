-- Life Command Center: one table holds every document (plan, days, tasks, leads, sessions...).
-- Paste this whole file into Supabase > SQL Editor > New query, then click Run.

create table if not exists public.docs (
  owner      uuid        not null default auth.uid() references auth.users (id) on delete cascade,
  collection text        not null,
  id         text        not null,
  data       jsonb       not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  primary key (owner, collection, id)
);

-- Only you can see or change your rows.
alter table public.docs enable row level security;

drop policy if exists "docs: read own"   on public.docs;
drop policy if exists "docs: insert own" on public.docs;
drop policy if exists "docs: update own" on public.docs;
drop policy if exists "docs: delete own" on public.docs;

create policy "docs: read own"   on public.docs for select using (auth.uid() = owner);
create policy "docs: insert own" on public.docs for insert with check (auth.uid() = owner);
create policy "docs: update own" on public.docs for update using (auth.uid() = owner) with check (auth.uid() = owner);
create policy "docs: delete own" on public.docs for delete using (auth.uid() = owner);

-- Live sync between your phone and laptop.
alter table public.docs replica identity full;
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'docs'
  ) then
    alter publication supabase_realtime add table public.docs;
  end if;
end $$;
