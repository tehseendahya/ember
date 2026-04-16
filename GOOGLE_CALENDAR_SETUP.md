# Google Calendar Integration Setup

This project now supports Google Calendar OAuth and syncs recent calendar events into CRM reminders and the recent updates feed.

## What works now

- OAuth connect flow via `GET /api/integrations/google-calendar/connect`
- OAuth callback/token exchange via `GET /api/integrations/google-calendar/callback`
- Access token persistence in Supabase table `public.google_calendar_tokens`
- Access token refresh using stored refresh token
- Manual sync via `POST /api/integrations/google-calendar/sync`
- Status endpoint via `GET /api/integrations/google-calendar/status`
- Sync behavior:
  - reads up to 50 recent primary-calendar events from the last 14 days
  - creates reminders with `source: "google_calendar"`
  - upserts existing reminders by event id to avoid duplicates
  - writes sync activity into `recentUpdates`

## Required environment variables

Add these to `.env.local`:

- `GOOGLE_CLIENT_ID`
- `GOOGLE_CLIENT_SECRET`
- `GOOGLE_REDIRECT_URI`
- optional `GOOGLE_CALENDAR_SCOPES` (comma-separated)

## Google Cloud Console setup

1. Create/select a Google Cloud project.
2. Enable the Google Calendar API.
3. Configure OAuth consent screen.
4. Create OAuth 2.0 Client ID credentials (Web application).
5. Add authorized redirect URI that matches `GOOGLE_REDIRECT_URI` exactly.
  - local dev example: `http://localhost:3000/api/integrations/google-calendar/callback`

## Runtime flow

1. Open app home page and click **Connect Google**.
2. Complete Google OAuth consent.
3. Callback stores token and triggers initial sync.
4. Use **Sync calendar** for manual refreshes.

## Security notes

- Secrets are read from env vars only (no hardcoded credentials).
- Access/refresh tokens are persisted in Supabase.
- For production, use encrypted secrets/KMS and tighten key management around service-role usage.

## Remaining TODOs for full production integration

1. **Credentials hardening**
  - Provide production OAuth credentials and a stable production callback URL.
  - Restrict OAuth app publishing status and authorized domains.
2. **OAuth redirect URIs**
  - Add separate redirect URIs per environment (dev/staging/prod) and keep env values aligned.
3. **Scopes**
  - Validate final minimum scope set (currently readonly calendar + openid/email).
  - If writing events is required later, add write scopes and consent updates.
4. **Webhook setup**
  - Implement Google Calendar push notifications (`events.watch`) and webhook receiver endpoint.
  - Persist `channelId`, `resourceId`, expiration, and schedule renewals before expiry.
  - Verify webhook signatures/headers and reject invalid channel/resource ids.
5. **Refresh token handling**
  - Handle token revocation/re-consent UX.
  - Add retry/backoff for transient Google API failures.
  - Rotate and encrypt refresh tokens in persistent storage.