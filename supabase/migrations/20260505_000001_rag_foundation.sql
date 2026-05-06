-- RAG foundation: pgvector + document pipeline tables

-- Enable pgvector extension (must be done in Supabase dashboard if not already enabled)
create extension if not exists vector with schema extensions;

-- ─── documents ────────────────────────────────────────────────────────────────

create table if not exists public.documents (
  id                  uuid primary key default gen_random_uuid(),
  user_id             uuid not null references auth.users(id) on delete cascade,
  course_id           text not null,
  semester_id         text,
  professor_name      text,
  file_name           text not null,
  file_type           text not null,
  source_type         text not null default 'lecture',
  storage_path        text not null,
  page_count          integer,
  processing_status   text not null default 'uploaded',
  document_hash       text,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

-- source_type: lecture | exercise | solution | notes | exam | summary | other
-- processing_status: uploaded | extracting_text | chunking | embedding | ready | failed

alter table public.documents enable row level security;

drop policy if exists "users see own documents" on public.documents;
drop policy if exists "users insert own documents" on public.documents;
drop policy if exists "users update own documents" on public.documents;
drop policy if exists "users delete own documents" on public.documents;

create policy "users see own documents"
  on public.documents for select
  using (auth.uid() = user_id);

create policy "users insert own documents"
  on public.documents for insert
  with check (auth.uid() = user_id);

create policy "users update own documents"
  on public.documents for update
  using (auth.uid() = user_id);

create policy "users delete own documents"
  on public.documents for delete
  using (auth.uid() = user_id);

create index if not exists documents_user_course_idx
  on public.documents (user_id, course_id);

-- ─── document_pages ───────────────────────────────────────────────────────────

create table if not exists public.document_pages (
  id            uuid primary key default gen_random_uuid(),
  document_id   uuid not null references public.documents(id) on delete cascade,
  user_id       uuid not null references auth.users(id) on delete cascade,
  course_id     text not null,
  page_number   integer not null,
  raw_text      text,
  cleaned_text  text,
  created_at    timestamptz not null default now()
);

alter table public.document_pages enable row level security;

drop policy if exists "users see own pages" on public.document_pages;
drop policy if exists "users insert own pages" on public.document_pages;

create policy "users see own pages"
  on public.document_pages for select
  using (auth.uid() = user_id);

create policy "users insert own pages"
  on public.document_pages for insert
  with check (auth.uid() = user_id);

create index if not exists document_pages_doc_idx
  on public.document_pages (document_id, page_number);

-- ─── document_chunks ──────────────────────────────────────────────────────────

create table if not exists public.document_chunks (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references auth.users(id) on delete cascade,
  course_id     text not null,
  document_id   uuid not null references public.documents(id) on delete cascade,
  chunk_text    text not null,
  chunk_index   integer not null,
  page_start    integer,
  page_end      integer,
  source_type   text not null default 'lecture',
  embedding     vector(1536),
  created_at    timestamptz not null default now()
);

-- 1536 dimensions = text-embedding-3-small output size

alter table public.document_chunks enable row level security;

drop policy if exists "users see own chunks" on public.document_chunks;
drop policy if exists "users insert own chunks" on public.document_chunks;
drop policy if exists "users delete own chunks" on public.document_chunks;

create policy "users see own chunks"
  on public.document_chunks for select
  using (auth.uid() = user_id);

create policy "users insert own chunks"
  on public.document_chunks for insert
  with check (auth.uid() = user_id);

create policy "users delete own chunks"
  on public.document_chunks for delete
  using (auth.uid() = user_id);

-- HNSW index for fast approximate nearest-neighbour search
create index if not exists document_chunks_embedding_idx
  on public.document_chunks
  using hnsw (embedding vector_cosine_ops);

create index if not exists document_chunks_user_course_idx
  on public.document_chunks (user_id, course_id);

-- ─── auto-update updated_at on documents ──────────────────────────────────────

create or replace function public.set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists documents_updated_at on public.documents;
create trigger documents_updated_at
  before update on public.documents
  for each row execute procedure public.set_updated_at();

-- ─── similarity search function ───────────────────────────────────────────────
-- Called by the backend to retrieve top-k chunks for a user+course+question.

create or replace function public.match_chunks(
  p_user_id       uuid,
  p_course_id     text,
  p_embedding     vector(1536),
  p_match_count   int default 10,
  p_threshold     float default 0.3
)
returns table (
  id            uuid,
  document_id   uuid,
  chunk_text    text,
  chunk_index   integer,
  page_start    integer,
  page_end      integer,
  source_type   text,
  similarity    float
)
language sql stable as $$
  select
    dc.id,
    dc.document_id,
    dc.chunk_text,
    dc.chunk_index,
    dc.page_start,
    dc.page_end,
    dc.source_type,
    1 - (dc.embedding <=> p_embedding) as similarity
  from public.document_chunks dc
  where dc.user_id = p_user_id
    and dc.course_id = p_course_id
    and 1 - (dc.embedding <=> p_embedding) > p_threshold
  order by dc.embedding <=> p_embedding
  limit p_match_count;
$$;
