-- Fix: account/document deletion fails with
--   ERROR: column "invalid_reason" of relation "valid_task_candidates" does not exist (42703)
--
-- 20260608_000003_weekly_mission_schema.sql dropped and recreated
-- valid_task_candidates, renaming invalid_reason → invalidation_reason — but
-- the BEFORE DELETE trigger function on public.documents from
-- 20260608_000001_daily_study_mission.sql still wrote the old column. Any
-- delete that touches documents rows (deleting a file, deleting an account —
-- GoTrue's user delete cascades into documents) aborted with the error above.
-- Same body as before, only the column name updated.

create or replace function public.invalidate_daily_mission_candidates_for_document()
returns trigger language plpgsql as $$
begin
  update public.valid_task_candidates
    set is_valid = false,
        invalidation_reason = case
          when old.processing_status = 'failed' then 'processing_failed'
          else 'deleted_file'
        end,
        updated_at = now()
    where source_file_id = old.id;

  update public.daily_study_tasks
    set status = 'unavailable',
        updated_at = now()
    where source_file_id = old.id
      and status in ('todo','in_progress','skipped','moved');

  return old;
end;
$$;
