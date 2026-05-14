-- Migration 003: Extended document metadata
-- Run in Supabase SQL editor after migrations 001 and 002.
--
-- Adds professor_name, lecture_number, exercise_number, language,
-- and is_official_prof_material to the documents table so that
-- retrieval can prioritise official professor material over student notes.

ALTER TABLE documents
  ADD COLUMN IF NOT EXISTS professor_name          text,
  ADD COLUMN IF NOT EXISTS lecture_number          int,
  ADD COLUMN IF NOT EXISTS exercise_number         int,
  ADD COLUMN IF NOT EXISTS language                text    DEFAULT 'en',
  ADD COLUMN IF NOT EXISTS is_official_prof_material boolean DEFAULT false;

-- Index language for potential future per-language FTS config
CREATE INDEX IF NOT EXISTS idx_documents_language
  ON documents (language);

-- Index for efficient professor-material priority queries
CREATE INDEX IF NOT EXISTS idx_documents_official
  ON documents (user_id, course_id, is_official_prof_material);

-- Propagate professor_name and language down to document_chunks so
-- retrieval can filter/boost without joining back to documents.
-- Run once to backfill existing chunks; trigger keeps it current.

ALTER TABLE document_chunks
  ADD COLUMN IF NOT EXISTS professor_name text,
  ADD COLUMN IF NOT EXISTS language       text DEFAULT 'en',
  ADD COLUMN IF NOT EXISTS is_official    boolean DEFAULT false;

-- Trigger: keep chunk metadata in sync when documents row is updated
CREATE OR REPLACE FUNCTION sync_chunk_metadata()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  UPDATE document_chunks
  SET
    professor_name = NEW.professor_name,
    language       = COALESCE(NEW.language, 'en'),
    is_official    = COALESCE(NEW.is_official_prof_material, false)
  WHERE document_id = NEW.id;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_sync_chunk_metadata ON documents;
CREATE TRIGGER trg_sync_chunk_metadata
  AFTER UPDATE OF professor_name, language, is_official_prof_material
  ON documents
  FOR EACH ROW EXECUTE FUNCTION sync_chunk_metadata();

-- Backfill existing chunks from their parent document rows
UPDATE document_chunks dc
SET
  professor_name = d.professor_name,
  language       = COALESCE(d.language, 'en'),
  is_official    = COALESCE(d.is_official_prof_material, false)
FROM documents d
WHERE dc.document_id = d.id;
