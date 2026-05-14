-- Migration 010: Add optional document_ids array filter to match_chunks_hybrid
-- Allows quiz/flashcard generation to be scoped to specific files.
-- Run once in the Supabase SQL editor.

DROP FUNCTION IF EXISTS match_chunks_hybrid(uuid, text, vector, text, integer, double precision, uuid);

CREATE OR REPLACE FUNCTION match_chunks_hybrid(
  p_user_id        uuid,
  p_course_id      text,
  p_embedding      vector(1536),
  p_query          text,
  p_match_count    integer          DEFAULT 10,
  p_threshold      double precision DEFAULT 0.1,
  p_document_id    uuid             DEFAULT NULL,  -- kept for backwards compat
  p_document_ids   uuid[]           DEFAULT NULL   -- optional: restrict to these documents
)
RETURNS TABLE (
  id            uuid,
  document_id   uuid,
  chunk_text    text,
  page_start    integer,
  page_end      integer,
  source_type   text,
  section_title text,
  is_official   boolean,
  similarity    double precision
)
LANGUAGE plpgsql STABLE AS $$
BEGIN
  RETURN QUERY
  WITH
  semantic AS (
    SELECT
      dc.id,
      dc.document_id,
      dc.chunk_text,
      dc.page_start,
      dc.page_end,
      dc.source_type,
      dc.section_title,
      COALESCE(dc.is_official, false) AS is_official,
      1 - (dc.embedding <=> p_embedding) AS similarity,
      ROW_NUMBER() OVER (ORDER BY dc.embedding <=> p_embedding) AS rank
    FROM document_chunks dc
    WHERE dc.user_id   = p_user_id
      AND dc.course_id = p_course_id
      AND (p_document_id  IS NULL OR dc.document_id = p_document_id)
      AND (p_document_ids IS NULL OR dc.document_id = ANY(p_document_ids))
      AND 1 - (dc.embedding <=> p_embedding) >= p_threshold
    ORDER BY dc.embedding <=> p_embedding
    LIMIT 20
  ),
  keyword AS (
    SELECT
      dc.id,
      ROW_NUMBER() OVER (
        ORDER BY ts_rank_cd(dc.fts, websearch_to_tsquery('simple', p_query)) DESC
      ) AS rank
    FROM document_chunks dc
    WHERE dc.user_id   = p_user_id
      AND dc.course_id = p_course_id
      AND (p_document_id  IS NULL OR dc.document_id = p_document_id)
      AND (p_document_ids IS NULL OR dc.document_id = ANY(p_document_ids))
      AND p_query <> ''
      AND dc.fts @@ websearch_to_tsquery('simple', p_query)
    LIMIT 20
  )
  SELECT
    s.id,
    s.document_id,
    s.chunk_text,
    s.page_start,
    s.page_end,
    s.source_type,
    s.section_title,
    s.is_official,
    s.similarity
  FROM semantic s
  FULL OUTER JOIN keyword k ON k.id = s.id
  ORDER BY
    COALESCE(1.0 / (60 + s.rank), 0.0) +
    COALESCE(1.0 / (60 + k.rank), 0.0) DESC
  LIMIT p_match_count;
END;
$$;
