-- Backfill documents.chunk_count and documents.indexed_at for legacy docs
-- that were indexed by the JS pipeline before the Python service existed.
-- No re-embedding, no OpenAI cost — pure metadata fill from chunks that
-- already exist in document_chunks.
--
-- Safe to re-run: only updates rows where chunk_count IS NULL or
-- indexed_at IS NULL. Docs indexed by the Python pipeline already have
-- both populated and are left alone.

update public.documents d
set
  chunk_count = sub.cnt,
  indexed_at  = coalesce(d.indexed_at, d.created_at),
  updated_at  = now()
from (
  select document_id, count(*)::int as cnt
  from public.document_chunks
  group by document_id
) sub
where d.id = sub.document_id
  and d.processing_status = 'ready'
  and (d.chunk_count is null or d.indexed_at is null);

-- Report the result so we can see the impact in the SQL editor.
select count(*) as docs_with_chunk_count,
       sum(chunk_count) as total_chunks_tracked
from public.documents
where chunk_count is not null;
