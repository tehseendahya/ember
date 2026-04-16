# Ember CRM

## Demo Day Next Steps

### For demo

- Search about that person when calendar adds them as contact.
- Decide if email data is needed.
- Tighten UI/UX for first-time users: simplify navigation, reduce cognitive load, and verify whether all 7 pages are necessary for demo flow.
- Fix visualize network tool.
- Implement relationship graph features.

### Later

- Email tracker.
- PostHog when have users.
- Initial onboarding.

## What This App Does

Ember is a personal relationship CRM that helps users stay warm with their network.  
It turns unstructured updates into structured CRM actions, suggests who to reach out to next, tracks follow-up reminders, and visualizes relationship context (including second-degree connections).

Core user outcomes:

- Quickly log interactions from freeform text (or voice typing).
- Get a daily recommendation for who to contact and why.
- Track reminders and stale relationships before they drift.
- Explore direct and extended network context to prepare outreach.

## Technical Architecture (Concise)

### Frontend

- Next.js App Router with React client components.
- Key client surfaces: `Today`, `Update`, `My People`, `Search`, `Settings`, and relationship graph views.
- Voice input uses browser Web Speech API (`webkitSpeechRecognition`) in the update flow.

### Backend/API

- Route handlers under `app/api/*` for CRM actions, search, reach-out recommendations, settings, and integrations.
- LLM-assisted parsing in update/reach-out flows converts plain-language input into structured actions.
- Server-side auth guard pattern via shared auth utilities.

### Data Layer

- Centralized through `lib/data/index.ts`.
- Primary persistence is Supabase (contacts, interactions, reminders, updates, snoozes, second-degree edges, user settings).
- Some non-core experiences (e.g., parts of analytics/search fixtures) are mock-backed.

### Integrations

- Google Calendar OAuth + sync endpoints (`connect`, `callback`, `status`, `sync`).
- OAuth state and tokens persisted in Supabase tables (`google_oauth_states`, `google_calendar_tokens`).

### Storage Schema

- SQL schema and seed files live in `supabase/schema.sql` and `supabase/seed.sql`.
- RLS policies enforce per-user row ownership across CRM tables.

### Runtime + Tooling

- TypeScript across app and server code.
- ESLint for static checks.
- Next.js server rendering plus client interactivity where needed.

