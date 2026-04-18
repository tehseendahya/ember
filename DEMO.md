# Ember demo checklist

Use this before a live demo or investor walkthrough.

## Environment and keys


| Variable                                                          | Role                                                                      | If missing                                                                                              |
| ----------------------------------------------------------------- | ------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`       | Auth + CRM data                                                           | App will not load signed-in experience.                                                                 |
| `OPENAI_API_KEY`                                                  | Update capture (`/api/update`), reach-out, search ranking, briefings prep | Reach-out shows an error hint on Today; network/world search may degrade (see API responses / notices). |
| `EXA_API_KEY`                                                     | Search the World (`/api/search/world`)                                    | World search fails or returns errors; Discover “Search the World” is weak.                              |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_REDIRECT_URI` | Calendar OAuth                                                            | Connect Google Calendar in Settings is unavailable; meeting cards on Today stay empty.                  |


Details for Google setup: [GOOGLE_CALENDAR_SETUP.md](GOOGLE_CALENDAR_SETUP.md). Copy env template from [.env.example](.env.example).

## Data

- Run [supabase/seed.sql](supabase/seed.sql) against your project after setting `target_user_id` to your `auth.users.id`. This fills contacts, interactions, second-degree edges, profile context, and **mutual_connections** so the People graph matches your CRM rows.
- Stay logged in for the session; magic-link sign-in is slow on stage.

## Product flows to rehearse (about 3 minutes)

1. **Today** — Confirm greeting, action items, optional Google meeting row with **Research in Discover** (prefills Discover from the primary attendee).
2. **Cmd+K** — Open command palette; use **Graph** to open `/people?view=graph`; try **World** with a typed query (requires `EXA_API_KEY` + `OPENAI_API_KEY` for best results).
3. **Quick capture** — Floating `+` or `/` in the palette; natural-language update (needs `OPENAI_API_KEY`).
4. **Discover** — Deep link: `/discover?q=ML+engineer&mode=network` or `mode=world`.
5. **People** — List vs **Graph** (Warm Reach Radar); open one contact with second-degree intros.

## Degraded behavior (what to say in the room)

- **No calendar**: “We’re showing CRM-only; calendar is optional OAuth.”
- **No Exa**: Stay on **My Network** in Discover or fall back to keyword behavior where implemented.
- **No OpenAI**: Rely on seeded data and manual notes; skip capture and reach-out refresh or narrate them as “wired, needs key.”

