-- Migration 004: Harden Supabase Storage bucket RLS policies
-- Run in Supabase SQL editor (postgres role).
--
-- Goals:
--   1. Ensure course-uploads and course-documents buckets are PRIVATE
--      (not publicly readable — files served only via signed URLs or auth)
--   2. RLS policies: users can only read/write their own prefix (user_id/)
--   3. Set storage views to SECURITY INVOKER so RLS is evaluated as the
--      calling user, not as the storage definer (prevents privilege escalation)

-- ─── 1. Mark buckets as private (not public) ─────────────────────────────────

UPDATE storage.buckets
SET public = false
WHERE name IN ('course-uploads', 'course-documents');

-- ─── 2. Drop any overly-broad existing policies ───────────────────────────────

DROP POLICY IF EXISTS "Allow all uploads"         ON storage.objects;
DROP POLICY IF EXISTS "Allow all reads"           ON storage.objects;
DROP POLICY IF EXISTS "Public read course-uploads" ON storage.objects;
DROP POLICY IF EXISTS "Public read course-documents" ON storage.objects;

-- ─── 3. course-uploads: users own their prefix ───────────────────────────────
-- Storage path convention: <user_id>/<course_key>/<optional_folder>/<file>

CREATE POLICY "course-uploads: owner insert"
  ON storage.objects FOR INSERT
  TO authenticated
  WITH CHECK (
    bucket_id = 'course-uploads'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );

CREATE POLICY "course-uploads: owner select"
  ON storage.objects FOR SELECT
  TO authenticated
  USING (
    bucket_id = 'course-uploads'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );

CREATE POLICY "course-uploads: owner update"
  ON storage.objects FOR UPDATE
  TO authenticated
  USING (
    bucket_id = 'course-uploads'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );

CREATE POLICY "course-uploads: owner delete"
  ON storage.objects FOR DELETE
  TO authenticated
  USING (
    bucket_id = 'course-uploads'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );

-- ─── 4. course-documents: backend service_role only ──────────────────────────
-- PDFs for RAG processing are written by the backend (service_role key).
-- Authenticated users should not be able to read or write this bucket directly.

CREATE POLICY "course-documents: service_role only"
  ON storage.objects FOR ALL
  TO service_role
  USING (bucket_id = 'course-documents')
  WITH CHECK (bucket_id = 'course-documents');

-- Deny authenticated (browser) access to course-documents
-- (no policy = no access for authenticated role by default when RLS is enabled)

-- ─── 5. Security invoker on storage views ────────────────────────────────────
-- ALTER VIEW and ALTER TABLE on storage.* require the supabase_storage_admin
-- owner role — the postgres role cannot run those directly.
-- Set Security Invoker via the Supabase Dashboard instead:
--   Dashboard → Storage → Policies → (top-right) "Enable Security Invoker"
-- RLS on storage.objects is already enabled by Supabase by default.
