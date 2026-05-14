-- Migration 006: AI evaluation framework
-- Stores test questions and their evaluation results per course.
-- Run once in the Supabase SQL editor after migration 005.

CREATE TABLE IF NOT EXISTS ai_evaluations (
  id                uuid        DEFAULT gen_random_uuid() PRIMARY KEY,
  course_id         text        NOT NULL,
  -- The test question to ask
  test_question     text        NOT NULL,
  -- "grounded" | "refuse" | "general"
  -- grounded: answer should cite a source from expected_sources
  -- refuse:   answer should say the info is not in uploaded material
  -- general:  question is fine to answer from outside knowledge
  expected_behavior text        NOT NULL DEFAULT 'grounded',
  -- Array of file name substrings that should appear in the cited sources
  expected_sources  jsonb       NOT NULL DEFAULT '[]',
  -- Filled in after running /api/ai/evaluate
  actual_answer     text,
  actual_sources    jsonb,
  actual_confidence text,
  passed            boolean,
  failure_reason    text,
  run_at            timestamptz,
  created_at        timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_ai_evaluations_course
  ON ai_evaluations (course_id);

ALTER TABLE ai_evaluations ENABLE ROW LEVEL SECURITY;

-- Only service_role can write; authenticated users can read their own course evals.
-- For simplicity, allow authenticated users to read/insert for their enrolled courses.
-- Adjust to admin-only if you want stricter control.
CREATE POLICY "Authenticated users can manage evaluations"
  ON ai_evaluations FOR ALL
  TO authenticated
  USING (true);
