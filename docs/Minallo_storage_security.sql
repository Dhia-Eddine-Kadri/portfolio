-- Minallo Storage Security Setup
-- Run this in the Supabase SQL Editor.
--
-- This hardens the main course upload bucket. Objects must live under:
--   <auth.uid()>/<course_key>/<file_name>
--
-- Chat attachments use:
--   <room_id>/<auth.uid()>/<file_name>
-- and the frontend stores that private storage path, not a public URL.

begin;

insert into storage.buckets (
  id,
  name,
  public,
  file_size_limit,
  allowed_mime_types
)
values (
  'course-uploads',
  'course-uploads',
  false,
  26214400,
  array[
    'application/pdf',
    'text/plain',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'image/png',
    'image/jpeg'
  ]::text[]
)
on conflict (id) do update
set
  public = false,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

insert into storage.buckets (
  id,
  name,
  public,
  file_size_limit,
  allowed_mime_types
)
values (
  'chat-attachments',
  'chat-attachments',
  false,
  26214400,
  array[
    'application/pdf',
    'text/plain',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'image/png',
    'image/jpeg'
  ]::text[]
)
on conflict (id) do update
set
  public = false,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "Users can read their own course uploads" on storage.objects;
drop policy if exists "Users can upload their own course files" on storage.objects;
drop policy if exists "Users can update their own course uploads" on storage.objects;
drop policy if exists "Users can delete their own course uploads" on storage.objects;
drop policy if exists "Room members can read chat attachments" on storage.objects;
drop policy if exists "Room members can upload chat attachments" on storage.objects;
drop policy if exists "Users can delete their own chat attachments" on storage.objects;

create policy "Users can read their own course uploads"
on storage.objects
for select
to authenticated
using (
  bucket_id = 'course-uploads'
  and (storage.foldername(name))[1] = auth.uid()::text
);

create policy "Users can upload their own course files"
on storage.objects
for insert
to authenticated
with check (
  bucket_id = 'course-uploads'
  and (storage.foldername(name))[1] = auth.uid()::text
  and lower(storage.extension(name)) in ('pdf', 'txt', 'docx', 'png', 'jpg', 'jpeg')
);

create policy "Users can update their own course uploads"
on storage.objects
for update
to authenticated
using (
  bucket_id = 'course-uploads'
  and (storage.foldername(name))[1] = auth.uid()::text
)
with check (
  bucket_id = 'course-uploads'
  and (storage.foldername(name))[1] = auth.uid()::text
  and lower(storage.extension(name)) in ('pdf', 'txt', 'docx', 'png', 'jpg', 'jpeg')
);

create policy "Users can delete their own course uploads"
on storage.objects
for delete
to authenticated
using (
  bucket_id = 'course-uploads'
  and (storage.foldername(name))[1] = auth.uid()::text
);

create policy "Room members can read chat attachments"
on storage.objects
for select
to authenticated
using (
  bucket_id = 'chat-attachments'
  and (
    (storage.foldername(name))[1] = 'general'
    or exists (
      select 1
      from public.room_members rm
      where rm.room_id::text = (storage.foldername(name))[1]
        and rm.user_id = auth.uid()
    )
  )
);

create policy "Room members can upload chat attachments"
on storage.objects
for insert
to authenticated
with check (
  bucket_id = 'chat-attachments'
  and (storage.foldername(name))[2] = auth.uid()::text
  and lower(storage.extension(name)) in ('pdf', 'txt', 'docx', 'png', 'jpg', 'jpeg')
  and (
    (storage.foldername(name))[1] = 'general'
    or exists (
      select 1
      from public.room_members rm
      where rm.room_id::text = (storage.foldername(name))[1]
        and rm.user_id = auth.uid()
    )
  )
);

create policy "Users can delete their own chat attachments"
on storage.objects
for delete
to authenticated
using (
  bucket_id = 'chat-attachments'
  and (storage.foldername(name))[2] = auth.uid()::text
);

commit;

-- Verification:
select
  id,
  name,
  public,
  file_size_limit,
  allowed_mime_types
from storage.buckets
where id in ('course-uploads', 'chat-attachments')
order by id;

select
  schemaname,
  tablename,
  policyname,
  cmd,
  qual,
  with_check
from pg_policies
where schemaname = 'storage'
  and tablename = 'objects'
  and policyname in (
    'Users can read their own course uploads',
    'Users can upload their own course files',
    'Users can update their own course uploads',
    'Users can delete their own course uploads',
    'Room members can read chat attachments',
    'Room members can upload chat attachments',
    'Users can delete their own chat attachments'
  )
order by policyname;
