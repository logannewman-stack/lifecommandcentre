-- Life Command Center: one table holds every document (plan, days, tasks, leads, sessions...).
-- Paste this whole file into Supabase > SQL Editor > New query, then click Run.
-- It is safe to run again later: every statement creates or replaces.

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

-- updated_at always reflects the server clock, whatever the client sends.
create or replace function public.docs_touch()
returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end $$;

drop trigger if exists docs_touch on public.docs;
create trigger docs_touch before insert or update on public.docs
  for each row execute function public.docs_touch();

-- Deep merge of two JSON objects: objects merge key by key, everything else
-- (arrays, numbers, strings, null) is replaced by the value in b.
create or replace function public.jsonb_deep_merge(a jsonb, b jsonb)
returns jsonb language plpgsql immutable as $$
declare
  result jsonb;
  k text;
  v jsonb;
begin
  if a is null then return b; end if;
  if b is null then return a; end if;
  if jsonb_typeof(a) <> 'object' or jsonb_typeof(b) <> 'object' then return b; end if;
  result := a;
  for k, v in select * from jsonb_each(b) loop
    if jsonb_typeof(v) = 'object' and jsonb_typeof(result -> k) = 'object' then
      result := jsonb_set(result, array[k], public.jsonb_deep_merge(result -> k, v), true);
    else
      result := jsonb_set(result, array[k], v, true);
    end if;
  end loop;
  return result;
end $$;

-- Apply a patch to one document on the server (creating it if needed), so two
-- devices editing different fields of the same document never overwrite each other.
create or replace function public.patch_doc(p_collection text, p_id text, p_patch jsonb)
returns public.docs language plpgsql security invoker as $$
declare
  r public.docs;
begin
  insert into public.docs (owner, collection, id, data, updated_at)
  values (auth.uid(), p_collection, p_id, coalesce(p_patch, '{}'::jsonb), now())
  on conflict (owner, collection, id) do update
    set data = public.jsonb_deep_merge(public.docs.data, excluded.data),
        updated_at = now()
  returning * into r;
  return r;
end $$;

revoke all on function public.patch_doc(text, text, jsonb) from public;
grant execute on function public.patch_doc(text, text, jsonb) to authenticated, service_role;

-- Keys for phone reminders (Web Push). Only the "reminders" Edge Function touches this
-- table, through the service role; there are no policies on purpose.
create table if not exists public.push_vapid (
  id         int         primary key default 1 check (id = 1),
  keys       jsonb       not null,
  last_run   timestamptz,
  created_at timestamptz not null default now()
);
alter table public.push_vapid enable row level security;

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
