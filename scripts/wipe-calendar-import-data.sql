-- Wipe Google Calendar imported CRM data for one user.
-- 1) Replace YOUR_USER_ID with your auth user UUID in every params CTE.
-- 2) Run in Supabase SQL editor.
-- 3) Re-run Calendar Sync.
--
-- This script now includes TWO levels:
-- - Core wipe: reminders/interactions/recent updates from calendar sync
-- - Contact wipe: deletes contacts tagged 'google-calendar' (imported people)
--
-- If you want to keep imported contacts, comment out the "Contact wipe" section.

begin;

with params as (
  select 'cce1bfc5-a262-4634-94e0-a523b0ed1d34'::uuid as uid
)
delete from public.reminders r
using params p
where r.user_id = p.uid
  and r.source = 'google_calendar';

with params as (
  select 'cce1bfc5-a262-4634-94e0-a523b0ed1d34'::uuid as uid
)
delete from public.interactions i
using params p
where i.user_id = p.uid
  and (
    i.notes like 'Synced from Google Calendar%'
    or i.external_event_id is not null
  );

with params as (
  select 'cce1bfc5-a262-4634-94e0-a523b0ed1d34'::uuid as uid
)
delete from public.recent_updates u
using params p
where u.user_id = p.uid
  and exists (
    select 1
    from unnest(u.actions) as a
    where a like 'Google Calendar sync:%'
  );

-- Contact wipe (imported people)
-- Removes contacts created/imported by calendar sync.
-- This is intentionally aggressive for "start fresh" behavior.
with params as (
  select 'cce1bfc5-a262-4634-94e0-a523b0ed1d34'::uuid as uid
)
delete from public.contacts c
using params p
where c.user_id = p.uid
  and c.tags @> array['google-calendar']::text[];

-- Optional: fully disconnect Google Calendar before a clean reconnect.
-- Uncomment if you want to force OAuth reconnect.
-- with params as (
--   select 'cce1bfc5-a262-4634-94e0-a523b0ed1d34'::uuid as uid
-- )
-- delete from public.google_calendar_tokens t
-- using params p
-- where t.user_id = p.uid;
--
-- with params as (
--   select 'YOUR_USER_ID'::uuid as uid
-- )
-- delete from public.google_oauth_states s
-- using params p
-- where s.user_id = p.uid;

commit;
