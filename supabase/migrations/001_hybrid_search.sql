-- Migration 001: Hybrid Search
-- Run this once in the Supabase SQL editor.
--
-- What it does:
--   1. Adds a generated `fts` tsvector column to document_chunks
--      (auto-populated on INSERT/UPDATE; backfilled for all existing rows)
--   2. Creates a GIN index on `fts` for fast full-text search
--   3. Creates the `match_chunks_hybrid` RPC that combines vector similarity
--      (HNSW index) with keyword search (GIN index) using Reciprocal Rank Fusion

-- ─── 1. FTS column (STORED generated — auto-maintained by Postgres) ───────────

ALTER TABLE document_chunks
  ADD COLUMN IF NOT EXISTS fts tsvector
    GENERATED ALWAYS AS (to_tsvector('simple', coalesce(chunk_text, ''))) STORED;

-- ─── 2. GIN index on fts ──────────────────────────────────────────────────────

CREATE INDEX IF NOT EXISTS idx_document_chunks_fts
  ON document_chunks USING GIN (fts);

-- ─── 3. Hybrid search RPC ─────────────────────────────────────────────────────
-- Returns up to p_match_count chunks ordered by Reciprocal Rank Fusion (RRF).
--
-- Semantic leg  : top 20 chunks by cosine similarity (uses HNSW index)
-- Keyword leg   : top 20 chunks by ts_rank_cd         (uses GIN index)
-- RRF merge     : score = 1/(60+rank_semantic) + 1/(60+rank_keyword)
-- similarity    : cosine similarity is returned for downstream source-boost logic

-- Drop old version first (return type changed — can't use CREATE OR REPLACE)
DROP FUNCTION IF EXISTS match_chunks_hybrid(uuid, text, vector, text, integer, double precision);

CREATE OR REPLACE FUNCTION match_chunks_hybrid(
  p_user_id    uuid,
  p_course_id  text,
  p_embedding  vector(1536),
  p_query      text,
  p_match_count int  DEFAULT 10,
  p_threshold   float DEFAULT 0.1
)
RETURNS TABLE (
  id             uuid,
  document_id    uuid,
  chunk_text     text,
  page_start     int,
  page_end       int,
  source_type    text,
  section_title  text,
  is_official    boolean,
  similarity     float
)
LANGUAGE plpgsql STABLE
AS $$
BEGIN
  RETURN QUERY
  WITH semantic AS (
    SELECT
      dc.id,
      (1 - (dc.embedding <=> p_embedding))::float                     AS vec_sim,
      ROW_NUMBER() OVER (ORDER BY dc.embedding <=> p_embedding)       AS rank_ix
    FROM document_chunks dc
    WHERE dc.user_id   = p_user_id
      AND dc.course_id = p_course_id
      AND (1 - (dc.embedding <=> p_embedding)) >= p_threshold
    ORDER BY dc.embedding <=> p_embedding
    LIMIT 20
  ),
  keyword AS (
    SELECT
      dc.id,
      ROW_NUMBER() OVER (
        ORDER BY ts_rank_cd(dc.fts, websearch_to_tsquery('simple', p_query)) DESC
      ) AS rank_ix
    FROM document_chunks dc
    WHERE length(p_query) > 0
      AND dc.user_id   = p_user_id
      AND dc.course_id = p_course_id
      AND dc.fts @@ websearch_to_tsquery('simple', p_query)
    LIMIT 20
  ),
  -- Merge both legs with RRF; rows missing from one leg get a 0 contribution
  candidates AS (
    SELECT
      COALESCE(s.id, k.id)                                             AS chunk_id,
      COALESCE(1.0 / (60.0 + s.rank_ix), 0.0)
        + COALESCE(1.0 / (60.0 + k.rank_ix), 0.0)                     AS rrf_score,
      s.vec_sim
    FROM semantic s
    FULL OUTER JOIN keyword k ON k.id = s.id
  )
  SELECT
    dc.id,
    dc.document_id,
    dc.chunk_text,
    dc.page_start,
    dc.page_end,
    dc.source_type,
    dc.section_title,
    COALESCE(dc.is_official, false)                                     AS is_official,
    -- For FTS-only results vec_sim is NULL: compute cosine similarity on-the-fly
    -- (at most 20 extra dot products — negligible cost)
    COALESCE(c.vec_sim, (1 - (dc.embedding <=> p_embedding))::float)   AS similarity
  FROM candidates c
  JOIN document_chunks dc ON dc.id = c.chunk_id
  ORDER BY c.rrf_score DESC
  LIMIT p_match_count;
END;
$$;

-- Allow authenticated users to call the function via PostgREST RPC
GRANT EXECUTE ON FUNCTION match_chunks_hybrid TO authenticated, service_role;
