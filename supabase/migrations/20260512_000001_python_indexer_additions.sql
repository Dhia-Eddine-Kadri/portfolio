-- Phase 2 additions for the Python AI/RAG service.
-- ALL CHANGES ARE ADDITIVE. No existing column types or data are touched.
-- No new tables, no new RLS policies, no FK changes.
-- Safe to run on production. Idempotent (uses IF NOT EXISTS).
--
-- After this migration:
--   - documents.indexed_at:       set by the indexer when chunking + embedding finishes.
--   - documents.chunk_count:      number of chunks the indexer produced for this doc.
--   - document_chunks.chunk_type: definition | theorem | example | exercise | formula | explanation | general
--   - document_chunks.token_count: token count of the chunk (used for cost reporting + reranker batching).
--
-- The existing JS indexer keeps working — it just won't populate these new columns,
-- which is fine because they all allow NULL or default to safe values.

alter table public.documents
  add column if not exists indexed_at  timestamptz,
  add column if not exists chunk_count integer;

alter table public.document_chunks
  add column if not exists chunk_type  text not null default 'general',
  add column if not exists token_count integer;

-- Helpful for "show me only definitions / exercises" filters down the road.
create index if not exists document_chunks_chunk_type_idx
  on public.document_chunks (document_id, chunk_type);
