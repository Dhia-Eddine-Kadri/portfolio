-- Migration 002: Section titles on chunks + retrieval cache table
-- Run this once in the Supabase SQL editor after migration 001.

-- ─── 1. section_title column on document_chunks ───────────────────────────────
-- Stores the heading that was active when the chunk was created.
-- NULL for chunks that started before any heading was detected.

ALTER TABLE document_chunks
  ADD COLUMN IF NOT EXISTS section_title text;

-- ─── 2. retrieval_cache table ─────────────────────────────────────────────────
-- Caches the set of chunk IDs retrieved for a given question + document state.
-- Allows repeated / semantically similar questions to skip the vector search
-- and go straight to fetching chunks by primary key.

CREATE TABLE IF NOT EXISTS retrieval_cache (
  id                    uuid        DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id               uuid        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  course_id             text        NOT NULL,
  question_hash         text        NOT NULL,
  document_version_hash text        NOT NULL,
  -- Array of { id, similarity } objects so source-boost ranking can be preserved
  chunk_entries         jsonb       NOT NULL,
  created_at            timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_retrieval_cache_lookup
  ON retrieval_cache (user_id, course_id, question_hash, document_version_hash);

-- Auto-expire rows older than 14 days via pg_cron (optional — safe to skip)
-- SELECT cron.schedule('cleanup-retrieval-cache', '0 3 * * *',
--   $$DELETE FROM retrieval_cache WHERE created_at < now() - interval '14 days'$$);

-- ─── RLS ─────────────────────────────────────────────────────────────────────
ALTER TABLE retrieval_cache ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can access own retrieval cache"
  ON retrieval_cache FOR ALL
  USING (auth.uid() = user_id);
