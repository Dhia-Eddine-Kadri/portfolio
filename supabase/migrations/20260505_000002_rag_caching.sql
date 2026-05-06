-- RAG caching tables: exact answer cache, semantic question cache, retrieval cache, feedback

-- ─── ai_answer_cache ──────────────────────────────────────────────────────────
-- Stores full answers for exact question+document version combos.

create table if not exists public.ai_answer_cache (
  id                    uuid primary key default gen_random_uuid(),
  user_id               uuid not null references auth.users(id) on delete cascade,
  course_id             text not null,
  question_hash         text not null,
  normalized_question   text not null,
  document_version_hash text not null,
  answer_json           jsonb not null,
  created_at            timestamptz not null default now(),
  last_used_at          timestamptz not null default now(),
  usage_count           integer not null default 1
);

alter table public.ai_answer_cache enable row level security;

drop policy if exists "users see own answer cache" on public.ai_answer_cache;
drop policy if exists "users insert own answer cache" on public.ai_answer_cache;
drop policy if exists "users update own answer cache" on public.ai_answer_cache;
drop policy if exists "users delete own answer cache" on public.ai_answer_cache;

create policy "users see own answer cache"
  on public.ai_answer_cache for select using (auth.uid() = user_id);
create policy "users insert own answer cache"
  on public.ai_answer_cache for insert with check (auth.uid() = user_id);
create policy "users update own answer cache"
  on public.ai_answer_cache for update using (auth.uid() = user_id);
create policy "users delete own answer cache"
  on public.ai_answer_cache for delete using (auth.uid() = user_id);

-- Unique index so we can upsert on cache hit
create unique index if not exists ai_answer_cache_lookup_idx
  on public.ai_answer_cache (user_id, course_id, question_hash, document_version_hash);

create index if not exists ai_answer_cache_user_course_idx
  on public.ai_answer_cache (user_id, course_id);

-- ─── ai_question_cache ────────────────────────────────────────────────────────
-- Stores question embeddings so we can find near-duplicate questions semantically.

create table if not exists public.ai_question_cache (
  id                    uuid primary key default gen_random_uuid(),
  user_id               uuid not null references auth.users(id) on delete cascade,
  course_id             text not null,
  question              text not null,
  question_embedding    vector(1536),
  answer_cache_id       uuid references public.ai_answer_cache(id) on delete cascade,
  document_version_hash text not null,
  created_at            timestamptz not null default now()
);

alter table public.ai_question_cache enable row level security;

drop policy if exists "users see own question cache" on public.ai_question_cache;
drop policy if exists "users insert own question cache" on public.ai_question_cache;
drop policy if exists "users delete own question cache" on public.ai_question_cache;

create policy "users see own question cache"
  on public.ai_question_cache for select using (auth.uid() = user_id);
create policy "users insert own question cache"
  on public.ai_question_cache for insert with check (auth.uid() = user_id);
create policy "users delete own question cache"
  on public.ai_question_cache for delete using (auth.uid() = user_id);

create index if not exists ai_question_cache_user_course_idx
  on public.ai_question_cache (user_id, course_id);

-- HNSW index for semantic similarity search on questions
create index if not exists ai_question_cache_embedding_idx
  on public.ai_question_cache
  using hnsw (question_embedding vector_cosine_ops);

-- ─── retrieval_cache ──────────────────────────────────────────────────────────
-- Caches which chunk IDs were retrieved for a question, so we skip vector search on repeats.

create table if not exists public.retrieval_cache (
  id                    uuid primary key default gen_random_uuid(),
  user_id               uuid not null references auth.users(id) on delete cascade,
  course_id             text not null,
  question_hash         text not null,
  top_chunk_ids         uuid[] not null,
  document_version_hash text not null,
  created_at            timestamptz not null default now()
);

alter table public.retrieval_cache enable row level security;

drop policy if exists "users see own retrieval cache" on public.retrieval_cache;
drop policy if exists "users insert own retrieval cache" on public.retrieval_cache;
drop policy if exists "users delete own retrieval cache" on public.retrieval_cache;

create policy "users see own retrieval cache"
  on public.retrieval_cache for select using (auth.uid() = user_id);
create policy "users insert own retrieval cache"
  on public.retrieval_cache for insert with check (auth.uid() = user_id);
create policy "users delete own retrieval cache"
  on public.retrieval_cache for delete using (auth.uid() = user_id);

create unique index if not exists retrieval_cache_lookup_idx
  on public.retrieval_cache (user_id, course_id, question_hash, document_version_hash);

-- ─── ai_feedback ──────────────────────────────────────────────────────────────

create table if not exists public.ai_feedback (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null references auth.users(id) on delete cascade,
  course_id       text not null,
  question        text not null,
  answer_cache_id uuid references public.ai_answer_cache(id) on delete set null,
  rating          text not null,
  feedback_text   text,
  reason          text,
  created_at      timestamptz not null default now()
);

-- rating values: helpful | not_helpful | wrong_answer | not_in_lecture | missing_citation | wrong_formula | too_vague | wrong_language

alter table public.ai_feedback enable row level security;

drop policy if exists "users insert own feedback" on public.ai_feedback;
drop policy if exists "users see own feedback" on public.ai_feedback;

create policy "users insert own feedback"
  on public.ai_feedback for insert with check (auth.uid() = user_id);
create policy "users see own feedback"
  on public.ai_feedback for select using (auth.uid() = user_id);

create index if not exists ai_feedback_user_course_idx
  on public.ai_feedback (user_id, course_id);

-- ─── semantic question similarity function ────────────────────────────────────
-- Finds cached questions that are semantically similar to a new question.

create or replace function public.match_cached_questions(
  p_user_id               uuid,
  p_course_id             text,
  p_embedding             vector(1536),
  p_document_version_hash text,
  p_threshold             float default 0.92,
  p_limit                 int default 3
)
returns table (
  id              uuid,
  answer_cache_id uuid,
  similarity      float
)
language sql stable as $$
  select
    qc.id,
    qc.answer_cache_id,
    1 - (qc.question_embedding <=> p_embedding) as similarity
  from public.ai_question_cache qc
  where qc.user_id = p_user_id
    and qc.course_id = p_course_id
    and qc.document_version_hash = p_document_version_hash
    and qc.answer_cache_id is not null
    and 1 - (qc.question_embedding <=> p_embedding) > p_threshold
  order by qc.question_embedding <=> p_embedding
  limit p_limit;
$$;
