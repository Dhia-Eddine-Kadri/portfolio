-- Minallo Admin Security Setup
-- Run this in the Supabase SQL Editor before relying on /api/admin-users.
--
-- This moves admin authorization from a frontend/email convention to a
-- service-role backend check against public.admins.

begin;

create table if not exists public.admins (
  user_id uuid primary key references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);

alter table public.admins enable row level security;

-- No client policies on admins. The backend checks this table with the
-- Supabase service role key; normal frontend clients should not read it.

create table if not exists public.security_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete set null,
  event_type text not null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

alter table public.security_events enable row level security;

-- No client policies on security_events. Security logs are written by trusted
-- backend functions with the service role key.

commit;

-- Bootstrap your first admin. Replace the email below if needed, then run it
-- after the tables are created.
--
-- insert into public.admins (user_id)
-- select id
-- from auth.users
-- where email = 'dalimovich2004@gmail.com'
-- on conflict (user_id) do nothing;

-- Verification:
select user_id, created_at
from public.admins
order by created_at desc;

select tablename, rowsecurity
from pg_tables
where schemaname = 'public'
  and tablename in ('admins', 'security_events')
order by tablename;
