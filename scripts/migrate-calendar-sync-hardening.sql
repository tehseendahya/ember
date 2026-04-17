-- Migration for stricter Google Calendar sync dedupe support.
-- Run in Supabase SQL editor before using the refactored sync.

begin;

alter table public.interactions
  add column if not exists external_event_id text;

create unique index if not exists interactions_google_event_unique
  on public.interactions(user_id, contact_id, external_event_id)
  where external_event_id is not null;

commit;
