-- Migration 005: Exact answer cache + semantic question cache
-- Run this once in the Supabase SQL editor after migrations 001-004.

-- ─── 1. ai_answer_cache ───────────────────────────────────────────────────────
-- Stores the full JSON answer for an exact (hash-matched) question.
-- Cache key: user_id + course_id + question_hash + document_version_hash
-- Invalidated automatically when document_version_hash changes (new uploads).

CREATE TABLE IF NOT EXISTS ai_answer_cache (
  id                    uuid        DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id               uuid        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  course_id             text        NOT NULL,
  question_hash         text        NOT NULL,
  normalized_question   text        NOT NULL,
  document_version_hash text        NOT NULL,
  mode                  text        NOT NULL DEFAULT 'strict',
  answer_json           jsonb       NOT NULL,
  created_at            timestamptz DEFAULT now(),
  last_used_at          timestamptz DEFAULT now(),
  usage_count           integer     DEFAULT 1
);

CREATE INDEX IF NOT EXISTS idx_ai_answer_cache_lookup
  ON ai_answer_cache (user_id, course_id, question_hash, document_version_hash);

-- Auto-increment usage_count via trigger instead of relying on client sending it
CREATE OR REPLACE FUNCTION increment_answer_cache_usage()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.usage_count := COALESCE(OLD.usage_count, 0) + 1;
  NEW.last_used_at := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_answer_cache_usage ON ai_answer_cache;
CREATE TRIGGER trg_answer_cache_usage
  BEFORE UPDATE ON ai_answer_cache
  FOR EACH ROW
  EXECUTE FUNCTION increment_answer_cache_usage();

ALTER TABLE ai_answer_cache ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can access own answer cache"
  ON ai_answer_cache FOR ALL
  USING (auth.uid() = user_id);

-- ─── 2. ai_question_cache ─────────────────────────────────────────────────────
-- Stores the embedding of each answered question.
-- Used for semantic cache lookup: find a previously answered question with
-- cosine similarity > 0.92 and the same document_version_hash, then reuse
-- that answer instead of calling the AI again.

CREATE TABLE IF NOT EXISTS ai_question_cache (
  id                    uuid        DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id               uuid        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  course_id             text        NOT NULL,
  question              text        NOT NULL,
  question_embedding    vector(1536) NOT NULL,
  answer_cache_id       uuid        REFERENCES ai_answer_cache(id) ON DELETE CASCADE,
  document_version_hash text        NOT NULL,
  mode                  text        NOT NULL DEFAULT 'strict',
  created_at            timestamptz DEFAULT now()
);

-- HNSW index for fast cosine similarity search on question embeddings
CREATE INDEX IF NOT EXISTS idx_ai_question_cache_embedding
  ON ai_question_cache
  USING hnsw (question_embedding vector_cosine_ops)
  WITH (m = 16, ef_construction = 64);

CREATE INDEX IF NOT EXISTS idx_ai_question_cache_lookup
  ON ai_question_cache (user_id, course_id, document_version_hash);

ALTER TABLE ai_question_cache ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can access own question cache"
  ON ai_question_cache FOR ALL
  USING (auth.uid() = user_id);

-- ─── 3. match_cached_questions RPC ───────────────────────────────────────────
-- Called by ai-ask.js semantic cache lookup.
-- Returns the most similar previously-answered question for the same user/course/docVersion.

DROP FUNCTION IF EXISTS match_cached_questions(uuid, text, vector, text, double precision, integer);
DROP FUNCTION IF EXISTS match_cached_questions(uuid, text, vector, text, text, double precision, integer);

CREATE OR REPLACE FUNCTION match_cached_questions(
  p_user_id               uuid,
  p_course_id             text,
  p_embedding             vector(1536),
  p_document_version_hash text,
  p_mode                  text             DEFAULT 'strict',
  p_threshold             double precision DEFAULT 0.92,
  p_limit                 integer          DEFAULT 1
)
RETURNS TABLE (
  id                uuid,
  question          text,
  answer_cache_id   uuid,
  similarity        double precision
)
LANGUAGE sql STABLE AS $$
  SELECT
    qc.id,
    qc.question,
    qc.answer_cache_id,
    1 - (qc.question_embedding <=> p_embedding) AS similarity
  FROM ai_question_cache qc
  WHERE qc.user_id               = p_user_id
    AND qc.course_id             = p_course_id
    AND qc.document_version_hash = p_document_version_hash
    AND qc.mode                  = p_mode
    AND qc.answer_cache_id IS NOT NULL
    AND 1 - (qc.question_embedding <=> p_embedding) >= p_threshold
  ORDER BY qc.question_embedding <=> p_embedding
  LIMIT p_limit;
$$;
