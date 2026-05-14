-- Migration 009: per-course chat history
-- Stores Q&A pairs so history survives page refresh and syncs across devices.

create table if not exists chat_history (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users(id) on delete cascade,
  course_id   text not null,
  question    text not null,
  answer      text not null,
  created_at  timestamptz not null default now()
);

create index if not exists chat_history_user_course_idx
  on chat_history (user_id, course_id, created_at desc);

-- RLS: users can only read/write their own history
alter table chat_history enable row level security;

create policy "chat_history_select" on chat_history
  for select using (auth.uid() = user_id);

create policy "chat_history_insert" on chat_history
  for insert with check (auth.uid() = user_id);

create policy "chat_history_delete" on chat_history
  for delete using (auth.uid() = user_id);
