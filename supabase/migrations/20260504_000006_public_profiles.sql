-- Minallo public profile surface for cross-user features.

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
