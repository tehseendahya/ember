-- =============================================================================
-- Wipe Google Calendar–related data (Postgres / Supabase)
--
-- Removes:
--   1. Reminders with source = 'google_calendar'
--   2. Contacts whose tags include 'google-calendar' (calendar-created people).
--      Cascades: interactions, second-degree edges (introducer), contact_snoozes, etc.
--   3. Rows in google_calendar_tokens and google_oauth_states (disconnects Google)
--
-- Usage:
--   • Supabase Dashboard → SQL Editor → paste and run
--   • Or: psql "$DATABASE_URL" -f scripts/wipe-google-calendar-data.sql
--
-- Scope:
--   • Set v_user_id to a single auth.users id to wipe only that user.
--   • Leave v_user_id NULL to wipe ALL users (local dev / full reset).
-- =============================================================================

DO $$
DECLARE
  v_user_id uuid := NULL;  -- e.g. 'a1b2c3d4-e5f6-7890-abcd-ef1234567890'::uuid
BEGIN
  IF v_user_id IS NULL THEN
    RAISE NOTICE 'Wiping Google Calendar data for ALL users.';
    DELETE FROM public.reminders WHERE source = 'google_calendar';
    DELETE FROM public.contacts WHERE 'google-calendar' = ANY(tags);
    DELETE FROM public.google_calendar_tokens;
    DELETE FROM public.google_oauth_states;
  ELSE
    RAISE NOTICE 'Wiping Google Calendar data for user_id=%', v_user_id;
    DELETE FROM public.reminders WHERE user_id = v_user_id AND source = 'google_calendar';
    DELETE FROM public.contacts WHERE user_id = v_user_id AND 'google-calendar' = ANY(tags);
    DELETE FROM public.google_calendar_tokens WHERE user_id = v_user_id;
    DELETE FROM public.google_oauth_states WHERE user_id = v_user_id;
  END IF;
END $$;

-- Optional: remove activity log rows that only exist because of calendar sync.
-- Uncomment and set v_user_id logic if you want this (can be large / noisy).
/*
DELETE FROM public.recent_updates ru
WHERE (
  ru.input ILIKE '%Google Calendar%' OR ru.input ILIKE '%calendar sync%'
  OR EXISTS (
    SELECT 1 FROM unnest(ru.actions) AS a WHERE a ILIKE '%Google Calendar%'
  )
);
*/
