-- Grant the requested owner account access to the promoter dashboard.
-- The API still verifies profiles.status = 'affiliate' on every request.
update public.profiles
   set status = 'affiliate'
 where id in (
   select id
     from auth.users
    where lower(email) = 'medalimarima@gmail.com'
 );
