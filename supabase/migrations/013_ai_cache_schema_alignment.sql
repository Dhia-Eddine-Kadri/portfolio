-- Migration 013: Align AI/RAG cache schema with current ai-ask.js.
-- Safe to run after older cache migrations; all changes are additive/idempotent.

alter table if exists ai_answer_cache
  add column if not exists mode text not null default 'strict';

alter table if exists ai_question_cache
  add column if not exists mode text not null default 'strict';

alter table if exists retrieval_cache
  add column if not exists chunk_entries jsonb;

do $$
begin
  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'retrieval_cache'
      and column_name = 'top_chunk_ids'
  ) then
    execute $sql$
      update retrieval_cache
      set chunk_entries = (
        select coalesce(jsonb_agg(jsonb_build_object('id', chunk_id::text, 'similarity', 0.5) order by ord), '[]'::jsonb)
        from unnest(top_chunk_ids) with ordinality as t(chunk_id, ord)
      )
      where chunk_entries is null
    $sql$;
  end if;
end $$;

update retrieval_cache set chunk_entries = '[]'::jsonb where chunk_entries is null;

alter table if exists retrieval_cache
  alter column chunk_entries set not null;

create index if not exists idx_ai_answer_cache_lookup_mode
  on ai_answer_cache (user_id, course_id, question_hash, document_version_hash, mode);

create index if not exists idx_ai_question_cache_lookup_mode
  on ai_question_cache (user_id, course_id, document_version_hash, mode);

create or replace function match_cached_questions(
  p_user_id               uuid,
  p_course_id             text,
  p_embedding             vector(1536),
  p_document_version_hash text,
  p_mode                  text             default 'strict',
  p_threshold             double precision default 0.92,
  p_limit                 integer          default 1
)
returns table (
  id              uuid,
  question        text,
  answer_cache_id uuid,
  similarity      double precision
)
language sql stable as $$
  select
    qc.id,
    qc.question,
    qc.answer_cache_id,
    1 - (qc.question_embedding <=> p_embedding) as similarity
  from ai_question_cache qc
  where qc.user_id = p_user_id
    and qc.course_id = p_course_id
    and qc.document_version_hash = p_document_version_hash
    and qc.mode = p_mode
    and qc.answer_cache_id is not null
    and 1 - (qc.question_embedding <=> p_embedding) >= p_threshold
  order by qc.question_embedding <=> p_embedding
  limit p_limit;
$$;
