# Ember CRM

## Demo Day Next Steps

- Get Google Calendar OAuth + sync fully working in production and verify token refresh reliability.
- Validate whether real last-90-days calendar events can be ingested cleanly (dedupe, useful reminder extraction, low noise).
- If calendar data is not enough, add email integration and test whether real inbox activity can produce high-signal relationship updates.
- Tighten UI/UX for first-time users: simplify navigation, reduce cognitive load, and verify whether all 7 pages are necessary for demo flow.
- Add a polished "golden path" demo script: connect account -> source reach-out -> log update (voice + text) -> show reminders -> show relationship graph.
- Add fallback states for every external dependency failure (OAuth errors, empty data, API timeouts) so the demo never dead-ends.
- Seed at least one realistic account profile + network so the app always tells a compelling story in under 3 minutes.
- Instrument basic analytics (feature clicks, sync success/failure, time-to-first-value) to learn from demo conversations.

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

