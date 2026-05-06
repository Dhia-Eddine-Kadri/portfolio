-- Phase 5: Evaluation framework
-- Run this in Supabase Dashboard → SQL Editor

create table if not exists public.ai_evaluations (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null references auth.users(id) on delete cascade,
  course_id       text not null,
  test_question   text not null,
  expected_behavior text not null,
  expected_sources  text,         -- JSON array of keyword strings
  actual_answer   text,
  actual_sources  text,           -- JSON array of source objects
  confidence      text,
  passed          boolean,
  notes           text,
  created_at      timestamptz default now()
);

-- RLS
alter table public.ai_evaluations enable row level security;

drop policy if exists "users see own evaluations" on public.ai_evaluations;
create policy "users see own evaluations"
  on public.ai_evaluations for all
  using (auth.uid() = user_id);

-- Index for fast per-user/course lookup
create index if not exists ai_evaluations_user_course_idx
  on public.ai_evaluations(user_id, course_id);
