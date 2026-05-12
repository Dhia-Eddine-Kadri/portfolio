-- Minallo Chat Reports Setup
-- Run this in the Supabase SQL Editor.
--
-- Purpose:
-- - Store abuse/moderation reports for chat content.
-- - Keep report submission and review behind trusted backend functions.

begin;

create table if not exists public.chat_reports (
  id uuid primary key default gen_random_uuid(),
  reporter_id uuid not null references auth.users(id) on delete cascade,
  reported_user_id uuid references auth.users(id) on delete set null,
  message_id uuid,
  room_id text,
  reason text not null,
  details text,
  status text not null default 'open',
  reviewed_by uuid references auth.users(id) on delete set null,
  resolution_note text,
  created_at timestamptz not null default now(),
  reviewed_at timestamptz
);

alter table public.chat_reports enable row level security;

create index if not exists idx_chat_reports_reporter_id
  on public.chat_reports(reporter_id);

create index if not exists idx_chat_reports_status_created_at
  on public.chat_reports(status, created_at desc);

create index if not exists idx_chat_reports_message_id
  on public.chat_reports(message_id);

commit;

-- Verification:
select
  tablename,
  rowsecurity
from pg_tables
where schemaname = 'public'
  and tablename = 'chat_reports';

select
  schemaname,
  tablename,
  indexname
from pg_indexes
where schemaname = 'public'
  and tablename = 'chat_reports'
order by indexname;
