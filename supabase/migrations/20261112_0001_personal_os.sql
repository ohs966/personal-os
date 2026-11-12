-- Personal OS: its own data, auth lock, Telegram pairing and AI spend log.
-- Nothing here is shared with any other system.

-- ---------- app data ----------
-- Every record of the OS (tasks, goals, plans, businesses, payouts, money, ...) is one row.
-- coll matches the app's collections; data holds the record's fields.
create table if not exists public.os_docs (
  coll       text not null,
  id         text not null,
  user_id    uuid references auth.users (id) on delete cascade,
  data       jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  primary key (coll, id)
);
create index if not exists os_docs_user_idx on public.os_docs (user_id, coll);
alter table public.os_docs enable row level security;
alter table public.os_docs replica identity full;

drop policy if exists "own docs read" on public.os_docs;
create policy "own docs read" on public.os_docs for select to authenticated using (user_id = (select auth.uid()));
drop policy if exists "own docs insert" on public.os_docs;
create policy "own docs insert" on public.os_docs for insert to authenticated with check (user_id = (select auth.uid()));
drop policy if exists "own docs update" on public.os_docs;
create policy "own docs update" on public.os_docs for update to authenticated using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
drop policy if exists "own docs delete" on public.os_docs;
create policy "own docs delete" on public.os_docs for delete to authenticated using (user_id = (select auth.uid()));

create or replace function public.os_touch() returns trigger language plpgsql set search_path = '' as $$
begin new.updated_at := now(); return new; end $$;
drop trigger if exists os_docs_touch on public.os_docs;
create trigger os_docs_touch before update on public.os_docs for each row execute function public.os_touch();

-- Live updates in the app (changes made from Telegram show up instantly).
do $$ begin
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'os_docs') then
    alter publication supabase_realtime add table public.os_docs;
  end if;
end $$;

-- ---------- config (server only) ----------
create table if not exists public.os_config (
  key   text primary key,
  value text not null,
  updated_at timestamptz not null default now()
);
alter table public.os_config enable row level security;  -- no policies: only the service role reads it

-- ---------- single owner ----------
-- The first account to sign up owns this OS and gets every migrated record.
-- Any later sign-up is refused, so nobody else can create an account here.
create or replace function public.os_owner_guard() returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if exists (select 1 from auth.users) then
    raise exception 'This Personal OS already has its owner.';
  end if;
  new.email_confirmed_at := coalesce(new.email_confirmed_at, now());
  return new;
end $$;
drop trigger if exists os_owner_guard on auth.users;
create trigger os_owner_guard before insert on auth.users for each row execute function public.os_owner_guard();

create or replace function public.os_claim_owner() returns trigger language plpgsql security definer set search_path = '' as $$
begin
  update public.os_docs set user_id = new.id where user_id is null;
  insert into public.os_config (key, value) values ('owner_user_id', new.id::text)
    on conflict (key) do update set value = excluded.value, updated_at = now();
  return new;
end $$;
drop trigger if exists os_claim_owner on auth.users;
create trigger os_claim_owner after insert on auth.users for each row execute function public.os_claim_owner();

-- ---------- Telegram ----------
create table if not exists public.telegram_links (
  chat_id    bigint primary key,
  user_id    uuid not null references auth.users (id) on delete cascade,
  username   text,
  first_name text,
  linked_at  timestamptz not null default now()
);
alter table public.telegram_links enable row level security;
drop policy if exists "own links read" on public.telegram_links;
create policy "own links read" on public.telegram_links for select to authenticated using (user_id = (select auth.uid()));
drop policy if exists "own links delete" on public.telegram_links;
create policy "own links delete" on public.telegram_links for delete to authenticated using (user_id = (select auth.uid()));

create table if not exists public.telegram_pairing (
  code       text primary key,
  user_id    uuid not null references auth.users (id) on delete cascade,
  expires_at timestamptz not null
);
alter table public.telegram_pairing enable row level security;  -- no policies: only the RPC and the bot touch it

create table if not exists public.telegram_state (
  chat_id    bigint primary key,
  convo      jsonb not null default '[]'::jsonb,   -- last 12 messages
  pending    jsonb,                                -- plan waiting for Confirm / Cancel
  updated_at timestamptz not null default now()
);
alter table public.telegram_state enable row level security;    -- no policies: server only

-- Makes a 6-digit code valid for 15 minutes and returns it with the bot's @username.
create or replace function public.create_telegram_pairing() returns json language plpgsql security definer set search_path = '' as $$
declare uid uuid := auth.uid(); c text; bot text;
begin
  if uid is null then raise exception 'Sign in first.'; end if;
  delete from public.telegram_pairing where user_id = uid or expires_at < now();
  loop
    c := lpad((floor(random() * 1000000))::int::text, 6, '0');
    exit when not exists (select 1 from public.telegram_pairing where code = c);
  end loop;
  insert into public.telegram_pairing (code, user_id, expires_at) values (c, uid, now() + interval '15 minutes');
  select value into bot from public.os_config where key = 'bot_username';
  return json_build_object('code', c, 'bot', bot, 'expires_at', now() + interval '15 minutes');
end $$;
revoke all on function public.create_telegram_pairing() from public, anon;
grant execute on function public.create_telegram_pairing() to authenticated;

-- ---------- AI spend ----------
create table if not exists public.ai_spend (
  id            bigint generated always as identity primary key,
  user_id       uuid references auth.users (id) on delete cascade,
  at            timestamptz not null default now(),
  source        text not null,              -- 'telegram' or 'app'
  model         text not null,
  input_tokens  integer not null default 0,
  output_tokens integer not null default 0,
  cache_read    integer not null default 0,
  cache_write   integer not null default 0,
  usd           numeric(12, 6) not null default 0
);
create index if not exists ai_spend_user_at_idx on public.ai_spend (user_id, at desc);
alter table public.ai_spend enable row level security;
drop policy if exists "own spend read" on public.ai_spend;
create policy "own spend read" on public.ai_spend for select to authenticated using (user_id = (select auth.uid()));

-- Lock down the trigger helpers.
revoke all on function public.os_owner_guard() from public, anon, authenticated;
revoke all on function public.os_claim_owner() from public, anon, authenticated;
revoke all on function public.os_touch() from public, anon, authenticated;
