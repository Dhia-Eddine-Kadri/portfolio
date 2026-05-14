-- Migration 011: Per-item study sets with progress tracking.
-- Allows bookmarks, confidence, seen count, wrong answers, and review history
-- to persist across sessions.  quiz_runs / flashcard_decks remain for bulk storage.

-- ── study_sets ────────────────────────────────────────────────────────────────
-- One row per generated set (quiz or flashcard).
create table if not exists study_sets (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references auth.users(id) on delete cascade,
  course_id     text not null,
  tool          text not null check (tool in ('quiz', 'flashcards')),
  name          text not null,
  topic         text,
  difficulty    text,
  document_ids  uuid[],          -- source documents used for this set
  item_count    int not null default 0,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create index if not exists study_sets_user_course_idx
  on study_sets (user_id, course_id, tool, created_at desc);

alter table study_sets enable row level security;

drop policy if exists "study_sets owner" on study_sets;
create policy "study_sets owner" on study_sets
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- ── study_items ───────────────────────────────────────────────────────────────
-- One row per question / flashcard.
create table if not exists study_items (
  id          uuid primary key default gen_random_uuid(),
  set_id      uuid not null references study_sets(id) on delete cascade,
  user_id     uuid not null references auth.users(id) on delete cascade,
  position    int not null,        -- order within the set
  item_data   jsonb not null,      -- full item JSON (question/options/answer or front/back/…)
  source      text,                -- file name + page reference
  difficulty  text,
  created_at  timestamptz not null default now()
);

create index if not exists study_items_set_idx on study_items (set_id, position);

alter table study_items enable row level security;

drop policy if exists "study_items owner" on study_items;
create policy "study_items owner" on study_items
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- ── study_item_progress ───────────────────────────────────────────────────────
-- One row per (user, item) pair — upserted on every interaction.
create table if not exists study_item_progress (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null references auth.users(id) on delete cascade,
  item_id         uuid not null references study_items(id) on delete cascade,
  seen_count      int not null default 0,
  correct_count   int not null default 0,
  wrong_count     int not null default 0,
  confidence      text check (confidence in ('known', 'review', null)),
  bookmarked      boolean not null default false,
  last_seen_at    timestamptz,
  updated_at      timestamptz not null default now(),
  unique (user_id, item_id)
);

create index if not exists study_item_progress_user_idx
  on study_item_progress (user_id, item_id);

alter table study_item_progress enable row level security;

drop policy if exists "study_item_progress owner" on study_item_progress;
create policy "study_item_progress owner" on study_item_progress
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
