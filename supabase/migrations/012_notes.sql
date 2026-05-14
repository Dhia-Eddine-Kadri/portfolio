-- Migration 012: AI Notes and Summaries generated from PDFs.

-- ── notes ────────────────────────────────────────────────────────────────────
create table if not exists notes (
  id                uuid primary key default gen_random_uuid(),
  user_id           uuid not null references auth.users(id) on delete cascade,
  course_id         text not null,
  document_id       uuid references documents(id) on delete set null,
  folder_id         uuid,
  title             text not null,
  type              text not null default 'notes' check (type in ('notes', 'summary', 'formula_sheet')),
  content_markdown  text not null default '',
  source_page_start int,
  source_page_end   int,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

create index if not exists notes_user_course_idx
  on notes (user_id, course_id, created_at desc);
create index if not exists notes_user_document_idx
  on notes (user_id, document_id, created_at desc);

alter table notes enable row level security;

drop policy if exists "notes owner" on notes;
create policy "notes owner" on notes
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- ── note_sources ──────────────────────────────────────────────────────────────
-- Which chunks were used to generate this note (for traceability).
create table if not exists note_sources (
  id            uuid primary key default gen_random_uuid(),
  note_id       uuid not null references notes(id) on delete cascade,
  document_id   uuid references documents(id) on delete set null,
  chunk_id      uuid,
  page_start    int,
  page_end      int,
  quote_preview text,
  created_at    timestamptz not null default now()
);

create index if not exists note_sources_note_idx on note_sources (note_id);

alter table note_sources enable row level security;

drop policy if exists "note_sources owner" on note_sources;
create policy "note_sources owner" on note_sources
  for select using (
    exists (select 1 from notes n where n.id = note_id and n.user_id = auth.uid())
  );
drop policy if exists "note_sources insert" on note_sources;
create policy "note_sources insert" on note_sources
  for insert with check (
    exists (select 1 from notes n where n.id = note_id and n.user_id = auth.uid())
  );
drop policy if exists "note_sources delete" on note_sources;
create policy "note_sources delete" on note_sources
  for delete using (
    exists (select 1 from notes n where n.id = note_id and n.user_id = auth.uid())
  );
