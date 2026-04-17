## Calendar Import Rollout

Run these steps in order before re-syncing calendar data:

1. Run `scripts/migrate-calendar-sync-hardening.sql` in Supabase SQL editor.
2. Run `scripts/migrate-contact-profile-enrichment.sql` in Supabase SQL editor.
3. Replace `YOUR_USER_ID` in `scripts/wipe-calendar-import-data.sql`, then run it in Supabase SQL editor.
4. Reconnect/sync Google Calendar from the app.

## Quick Validation

Check imported contacts now have enrichment fields:

```sql
select
  name,
  email,
  company,
  role,
  school,
  location,
  linkedin,
  profile_source,
  profile_confidence
from public.contacts
where user_id = 'YOUR_USER_ID'::uuid
order by updated_at desc
limit 20;
```

Check imported reminders/interactions dedupe correctly:

```sql
select external_event_id, count(*)
from public.reminders
where user_id = 'YOUR_USER_ID'::uuid
  and source = 'google_calendar'
group by external_event_id
having count(*) > 1;

select external_event_id, count(*)
from public.interactions
where user_id = 'YOUR_USER_ID'::uuid
  and external_event_id is not null
group by external_event_id
having count(*) > 1;
```

## Manual QA Cases

- Sync the same calendar twice and verify no new duplicate reminders/interactions appear.
- Open a contact with a wrong name, correct it, click `Enrich profile`, and verify role/school/location/LinkedIn fill in.
- Check one repeated-invite contact and confirm project/company hints land in notes rather than overwriting manual fields.
