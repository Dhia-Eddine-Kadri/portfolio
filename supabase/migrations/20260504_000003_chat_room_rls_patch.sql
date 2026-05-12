-- Minallo Chat Room RLS Patch
-- Run this in Supabase SQL Editor after Minallo_rls_hardening.sql.
--
-- Why:
-- The first hardening pass protected UUID-backed custom rooms, but the app also
-- has public app rooms such as "general" and local course room IDs like "telc".
-- This patch lets authenticated users read public app rooms while keeping
-- custom_* rooms and dm_* rooms protected.

begin;

drop policy if exists "Room members can read messages" on public.messages;
drop policy if exists "Room members can send messages" on public.messages;
drop policy if exists "Users can update their own messages" on public.messages;

create policy "Room members can read messages"
on public.messages
for select
to authenticated
using (
  room_id = 'general'
  or (
    room_id !~ '^custom_'
    and room_id !~ '^dm_'
    and room_id !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
  )
  or exists (
    select 1
    from public.room_members rm
    where rm.room_id::text = case
        when messages.room_id like 'custom_%' then substring(messages.room_id from 8)
        else messages.room_id
      end
      and rm.user_id = auth.uid()
  )
  or (
    room_id ~ '^dm_[0-9a-f-]{36}_[0-9a-f-]{36}$'
    and auth.uid()::text in (
      substring(room_id from 4 for 36),
      substring(room_id from 41 for 36)
    )
    and exists (
      select 1
      from public.friendships f
      where f.status = 'accepted'
        and (
          (f.user_id = auth.uid() and f.friend_id::text in (substring(room_id from 4 for 36), substring(room_id from 41 for 36)))
          or
          (f.friend_id = auth.uid() and f.user_id::text in (substring(room_id from 4 for 36), substring(room_id from 41 for 36)))
        )
    )
  )
);

create policy "Room members can send messages"
on public.messages
for insert
to authenticated
with check (
  user_id = auth.uid()
  and (
    room_id = 'general'
    or (
      room_id !~ '^custom_'
      and room_id !~ '^dm_'
      and room_id !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
    )
    or exists (
      select 1
      from public.room_members rm
      where rm.room_id::text = case
          when messages.room_id like 'custom_%' then substring(messages.room_id from 8)
          else messages.room_id
        end
        and rm.user_id = auth.uid()
    )
  )
);

create policy "Users can update their own messages"
on public.messages
for update
to authenticated
using (user_id = auth.uid())
with check (
  user_id = auth.uid()
  and (
    room_id = 'general'
    or (
      room_id !~ '^custom_'
      and room_id !~ '^dm_'
      and room_id !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
    )
    or exists (
      select 1
      from public.room_members rm
      where rm.room_id::text = case
          when messages.room_id like 'custom_%' then substring(messages.room_id from 8)
          else messages.room_id
        end
        and rm.user_id = auth.uid()
    )
  )
);

commit;

select policyname, cmd, qual, with_check
from pg_policies
where schemaname = 'public'
  and tablename = 'messages'
order by policyname;
