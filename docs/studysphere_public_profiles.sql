-- StudySphere Public Profiles View
-- Run this in the Supabase SQL Editor after the profile RLS setup.
--
-- Purpose:
-- - Keep the base profiles table private.
-- - Expose only a minimal cross-user identity surface for chat/social features.

begin;

drop view if exists public.public_profiles;

create view public.public_profiles as
select
  id,
  full_name,
  chat_username,
  programme,
  last_seen
from public.profiles;

grant select on public.public_profiles to authenticated;

commit;

-- Verification:
select
  table_schema,
  table_name
from information_schema.views
where table_schema = 'public'
  and table_name = 'public_profiles';
