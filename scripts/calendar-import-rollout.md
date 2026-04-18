## Calendar Import Rollout

Run these steps in order before re-syncing calendar data:

1. Run `scripts/migrate-calendar-sync-hardening.sql` in Supabase SQL editor.
2. Run `scripts/migrate-contact-profile-enrichment.sql` in Supabase SQL editor.
3. Run `scripts/migrate-identity-verification.sql` in Supabase SQL editor (adds the verification columns the sync pipeline now writes to).
4. Replace `YOUR_USER_ID` in `scripts/wipe-calendar-import-data.sql`, then run it in Supabase SQL editor.
5. **Reconnect Google Calendar from the app** — the sync pipeline now uses the Google People API to pull attendee display names from the user's saved Google Contacts / "Other contacts", which requires two new OAuth scopes (`contacts.readonly` and `contacts.other.readonly`). Existing tokens won't have them, so users must reauthorize. The Today page shows a "Reconnect for contact names" banner when the token is missing these scopes; the sync still runs without them but falls back to heuristic name parsing (more results land in the `needs_verification` queue).
6. **Update the Google Cloud OAuth consent screen** to declare the two new scopes (scope justification: "We use the user's Google Contacts to display the correct person's name for calendar attendees in the user's own CRM view").

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

