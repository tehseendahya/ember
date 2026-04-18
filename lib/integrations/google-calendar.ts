import "server-only";

import { randomUUID } from "crypto";
import { requireUserId } from "@/lib/auth";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import {
  companyFromWorkEmailDomain,
  resolveEventIdentities,
  type CalendarAttendee,
  type GoogleContactsHint,
  type ResolvedIdentity,
} from "@/lib/integrations/calendar-identity-resolver";
import { lookupContactsByEmail } from "@/lib/integrations/google-people-api";

const GOOGLE_AUTH_BASE = "https://accounts.google.com/o/oauth2/v2/auth";
const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";
const GOOGLE_CALENDAR_EVENTS_URL = "https://www.googleapis.com/calendar/v3/calendars/primary/events";

/** Past-only sync window: [now − N days, now]. */
const SYNC_LOOKBACK_DAYS = 14;
/** Google allows up to 2500; we paginate until exhausted. */
const SYNC_PAGE_SIZE = 250;

const DEFAULT_SCOPES = [
  "openid",
  "https://www.googleapis.com/auth/userinfo.email",
  "https://www.googleapis.com/auth/calendar.readonly",
  // People API scopes: used to resolve attendee emails to the display name the
  // Google Calendar UI shows (e.g. "Alexander Kvamme" for apfk88@gmail.com).
  // Without these, we fall back to parsing the email local-part, which often
  // produces incomplete or wrong names for common personal-email domains.
  "https://www.googleapis.com/auth/contacts.readonly",
  "https://www.googleapis.com/auth/contacts.other.readonly",
];

/** Scope string that indicates we can call the People API for this token. */
const PEOPLE_API_SCOPE_PREFIXES = [
  "https://www.googleapis.com/auth/contacts.readonly",
  "https://www.googleapis.com/auth/contacts.other.readonly",
];

function tokenHasPeopleApiScope(token: StoredGoogleToken): boolean {
  const scope = token.scope ?? "";
  return PEOPLE_API_SCOPE_PREFIXES.some((s) => scope.includes(s));
}
const STATE_TTL_MS = 10 * 60 * 1000;

function gCalSyncVerbose(): boolean {
  const v = process.env.GOOGLE_CALENDAR_SYNC_LOG?.trim().toLowerCase();
  return v === "1" || v === "true" || v === "all";
}

function gCalSyncLog(...args: unknown[]): void {
  if (gCalSyncVerbose()) {
    console.log("[GCal sync]", ...args);
  }
}

/** Kept as an exported helper since api routes use it to seed company from email. */
export function companyFromEmailDomain(email: string | null): string {
  return companyFromWorkEmailDomain(email);
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface GoogleTokenPayload {
  access_token: string;
  expires_in: number;
  refresh_token?: string;
  scope?: string;
  token_type?: string;
}

interface StoredGoogleToken {
  accessToken: string;
  expiresAt: number;
  refreshToken?: string;
  scope?: string;
  tokenType?: string;
  updatedAt: string;
}

interface StoredOAuthState {
  userId: string;
  state: string;
  redirectTo?: string;
  expiresAt: number;
  createdAt: string;
}

export interface GoogleIntegrationStatus {
  enabled: boolean;
  connected: boolean;
  missingConfig: string[];
  lastSyncAt: string | null;
  tokenExpiresAt: string | null;
  /**
   * True when the stored token is missing the People API scopes. The sync
   * still works, but name resolution quality is reduced — the user should
   * reconnect to grant the new scopes.
   */
  needsReauthForContacts: boolean;
}

export interface CalendarSyncResult {
  ok: boolean;
  reason?: string;
  processedEvents: number;
  skippedEvents: number;
  fetchedEvents: number;
  createdContacts: number;
  flaggedForReview: number;
  /** Count of legacy per-attendee reminders removed during this sync. */
  purgedLegacyReminders: number;
}

export interface GoogleCalendarEvent {
  id: string;
  summary?: string;
  description?: string;
  htmlLink?: string;
  organizer?: { email?: string; displayName?: string; self?: boolean };
  attendees?: CalendarAttendee[];
  start?: { date?: string; dateTime?: string };
  end?: { date?: string; dateTime?: string };
  status?: string;
}

// ---------------------------------------------------------------------------
// Env / config
// ---------------------------------------------------------------------------

function getRequiredEnv(name: "GOOGLE_CLIENT_ID" | "GOOGLE_CLIENT_SECRET" | "GOOGLE_REDIRECT_URI"): string | null {
  const value = process.env[name]?.trim();
  return value && value.length > 0 ? value : null;
}

function getScopes(): string[] {
  const raw = process.env.GOOGLE_CALENDAR_SCOPES?.trim();
  if (!raw) return DEFAULT_SCOPES;
  return raw
    .split(",")
    .map((scope) => scope.trim())
    .filter(Boolean);
}

function getMissingConfig(): string[] {
  const missing: string[] = [];
  if (!getRequiredEnv("GOOGLE_CLIENT_ID")) missing.push("GOOGLE_CLIENT_ID");
  if (!getRequiredEnv("GOOGLE_CLIENT_SECRET")) missing.push("GOOGLE_CLIENT_SECRET");
  if (!getRequiredEnv("GOOGLE_REDIRECT_URI")) missing.push("GOOGLE_REDIRECT_URI");
  return missing;
}

// ---------------------------------------------------------------------------
// Token persistence + refresh
// ---------------------------------------------------------------------------

async function readToken(userId: string): Promise<StoredGoogleToken | null> {
  const supabase = await createSupabaseServerClient();
  const { data } = await supabase
    .from("google_calendar_tokens")
    .select("access_token, expires_at, refresh_token, scope, token_type, updated_at")
    .eq("user_id", userId)
    .maybeSingle();
  if (!data) return null;
  return {
    accessToken: data.access_token,
    expiresAt: new Date(data.expires_at).getTime(),
    refreshToken: data.refresh_token ?? undefined,
    scope: data.scope ?? undefined,
    tokenType: data.token_type ?? undefined,
    updatedAt: data.updated_at,
  };
}

async function writeToken(
  userId: string,
  payload: GoogleTokenPayload,
  previous?: StoredGoogleToken | null,
): Promise<StoredGoogleToken> {
  const token: StoredGoogleToken = {
    accessToken: payload.access_token,
    expiresAt: Date.now() + payload.expires_in * 1000,
    refreshToken: payload.refresh_token ?? previous?.refreshToken,
    scope: payload.scope ?? previous?.scope,
    tokenType: payload.token_type ?? previous?.tokenType ?? "Bearer",
    updatedAt: new Date().toISOString(),
  };
  const supabase = await createSupabaseServerClient();
  await supabase.from("google_calendar_tokens").upsert({
    user_id: userId,
    access_token: token.accessToken,
    expires_at: new Date(token.expiresAt).toISOString(),
    refresh_token: token.refreshToken ?? null,
    scope: token.scope ?? null,
    token_type: token.tokenType ?? "Bearer",
    updated_at: token.updatedAt,
  });
  return token;
}

async function writeOAuthState(state: StoredOAuthState): Promise<void> {
  const supabase = await createSupabaseServerClient();
  await supabase.from("google_oauth_states").upsert({
    user_id: state.userId,
    state: state.state,
    redirect_to: state.redirectTo ?? "/",
    expires_at: new Date(state.expiresAt).toISOString(),
    created_at: state.createdAt,
  });
}

async function readOAuthState(userId: string): Promise<StoredOAuthState | null> {
  const supabase = await createSupabaseServerClient();
  const { data } = await supabase
    .from("google_oauth_states")
    .select("state, redirect_to, expires_at, created_at")
    .eq("user_id", userId)
    .maybeSingle();
  if (!data) return null;
  return {
    userId,
    state: data.state,
    redirectTo: data.redirect_to ?? undefined,
    expiresAt: new Date(data.expires_at).getTime(),
    createdAt: data.created_at,
  };
}

async function exchangeCodeForToken(code: string, userId: string): Promise<StoredGoogleToken> {
  const clientId = getRequiredEnv("GOOGLE_CLIENT_ID");
  const clientSecret = getRequiredEnv("GOOGLE_CLIENT_SECRET");
  const redirectUri = getRequiredEnv("GOOGLE_REDIRECT_URI");
  if (!clientId || !clientSecret || !redirectUri) {
    throw new Error("Google OAuth config missing");
  }
  const params = new URLSearchParams({
    code,
    client_id: clientId,
    client_secret: clientSecret,
    redirect_uri: redirectUri,
    grant_type: "authorization_code",
  });
  const res = await fetch(GOOGLE_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: params.toString(),
    cache: "no-store",
  });
  if (!res.ok) {
    const details = await res.text();
    throw new Error(`Google token exchange failed: ${details}`);
  }
  const token = (await res.json()) as GoogleTokenPayload;
  return writeToken(userId, token, await readToken(userId));
}

async function refreshAccessTokenIfNeeded(token: StoredGoogleToken, userId: string): Promise<StoredGoogleToken> {
  const skewMs = 60 * 1000;
  if (token.expiresAt > Date.now() + skewMs) return token;
  if (!token.refreshToken) {
    throw new Error("Google refresh token is missing. Reconnect integration with offline access.");
  }
  const clientId = getRequiredEnv("GOOGLE_CLIENT_ID");
  const clientSecret = getRequiredEnv("GOOGLE_CLIENT_SECRET");
  if (!clientId || !clientSecret) {
    throw new Error("Google OAuth client config missing");
  }
  const params = new URLSearchParams({
    client_id: clientId,
    client_secret: clientSecret,
    refresh_token: token.refreshToken,
    grant_type: "refresh_token",
  });
  const res = await fetch(GOOGLE_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: params.toString(),
    cache: "no-store",
  });
  if (!res.ok) {
    const details = await res.text();
    throw new Error(`Google token refresh failed: ${details}`);
  }
  const refreshed = (await res.json()) as GoogleTokenPayload;
  return writeToken(userId, refreshed, token);
}

async function getUsableAccessToken(userId: string): Promise<StoredGoogleToken> {
  const stored = await readToken(userId);
  if (!stored) {
    throw new Error("Google Calendar is not connected.");
  }
  return refreshAccessTokenIfNeeded(stored, userId);
}

// ---------------------------------------------------------------------------
// Event fetch
// ---------------------------------------------------------------------------

async function fetchPrimaryCalendarEvents(
  accessToken: string,
  timeMinIso: string,
  timeMaxIso: string,
): Promise<{ events: GoogleCalendarEvent[]; pages: number }> {
  const events: GoogleCalendarEvent[] = [];
  let pageToken: string | undefined;
  let pages = 0;
  do {
    pages++;
    const eventsUrl = new URL(GOOGLE_CALENDAR_EVENTS_URL);
    eventsUrl.searchParams.set("singleEvents", "true");
    eventsUrl.searchParams.set("orderBy", "startTime");
    eventsUrl.searchParams.set("timeMin", timeMinIso);
    eventsUrl.searchParams.set("timeMax", timeMaxIso);
    eventsUrl.searchParams.set("maxResults", String(SYNC_PAGE_SIZE));
    if (pageToken) eventsUrl.searchParams.set("pageToken", pageToken);
    const res = await fetch(eventsUrl.toString(), {
      headers: { Authorization: `Bearer ${accessToken}` },
      cache: "no-store",
    });
    if (!res.ok) {
      throw new Error(await res.text());
    }
    const payload = (await res.json()) as { items?: GoogleCalendarEvent[]; nextPageToken?: string };
    const batch = (payload.items ?? []).filter((e) => e.status !== "cancelled");
    events.push(...batch);
    pageToken = payload.nextPageToken;
    gCalSyncLog(`page ${pages}: +${batch.length} events (total so far ${events.length})${pageToken ? ", next page…" : ""}`);
  } while (pageToken);
  return { events, pages };
}

function eventDate(event: GoogleCalendarEvent): string | null {
  const raw = event.start?.date ?? event.start?.dateTime;
  if (!raw) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;
  const parsed = new Date(raw);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed.toISOString().slice(0, 10);
}

function eventIsTimedPeopleMeeting(event: GoogleCalendarEvent): boolean {
  if (!event.start?.dateTime) return false; // skip all-day blocks
  const meaningful = (event.attendees ?? []).filter((a) => !a.self && !a.resource);
  return meaningful.length > 0;
}

// ---------------------------------------------------------------------------
// Public: OAuth + status
// ---------------------------------------------------------------------------

export async function getGoogleIntegrationStatus(): Promise<GoogleIntegrationStatus> {
  const missingConfig = getMissingConfig();
  const userId = await requireUserId();
  const token = await readToken(userId);
  const supabase = await createSupabaseServerClient();
  const { data: updates } = await supabase
    .from("recent_updates")
    .select("timestamp, actions")
    .eq("user_id", userId)
    .order("timestamp", { ascending: false })
    .limit(50);
  const lastSync = (updates ?? []).find((u) => (u.actions ?? []).some((a: string) => a.includes("Google Calendar sync")));
  return {
    enabled: missingConfig.length === 0,
    connected: token !== null,
    missingConfig,
    lastSyncAt: lastSync?.timestamp ?? null,
    tokenExpiresAt: token ? new Date(token.expiresAt).toISOString() : null,
    needsReauthForContacts: token ? !tokenHasPeopleApiScope(token) : false,
  };
}

export async function buildGoogleAuthUrl(redirectTo?: string): Promise<string> {
  const clientId = getRequiredEnv("GOOGLE_CLIENT_ID");
  const redirectUri = getRequiredEnv("GOOGLE_REDIRECT_URI");
  if (!clientId || !redirectUri) {
    throw new Error("Google OAuth config missing");
  }
  const userId = await requireUserId();
  const state = randomUUID();
  await writeOAuthState({
    userId,
    state,
    redirectTo: redirectTo?.trim() ? redirectTo : "/",
    createdAt: new Date().toISOString(),
    expiresAt: Date.now() + STATE_TTL_MS,
  });
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: "code",
    scope: getScopes().join(" "),
    access_type: "offline",
    include_granted_scopes: "true",
    prompt: "consent",
    state,
  });
  return `${GOOGLE_AUTH_BASE}?${params.toString()}`;
}

export async function handleGoogleOAuthCallback(code: string, state: string): Promise<{ redirectTo: string }> {
  const userId = await requireUserId();
  const saved = await readOAuthState(userId);
  if (!saved || saved.state !== state || saved.expiresAt < Date.now()) {
    throw new Error("OAuth state mismatch or expired");
  }
  await exchangeCodeForToken(code, userId);
  return { redirectTo: saved.redirectTo ?? "/" };
}

// ---------------------------------------------------------------------------
// Sync
// ---------------------------------------------------------------------------

function avatarInitials(name: string): string {
  return (
    name
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((p) => p[0]?.toUpperCase() ?? "")
      .join("") || "?"
  );
}

/**
 * Master sync: pulls recent events, resolves each attendee via the identity
 * resolver, and upserts contacts + interactions. Low-confidence identities
 * become `needs_verification` contacts (with candidate LinkedIns stashed for
 * the user to pick from) rather than fabricated profiles. Intentionally does
 * NOT create reminders — meetings are surfaced via pre-meeting briefings on
 * Home, not as action items.
 */
/**
 * Fetch raw Google Calendar events for the current user between the given
 * ISO timestamps. Returns `null` when the integration is not configured or
 * the user hasn't connected. Used by pre-meeting briefings (near-real-time
 * read) — sync-level persistence is handled elsewhere.
 */
export async function fetchCalendarEventsForCurrentUser(
  timeMinIso: string,
  timeMaxIso: string,
): Promise<GoogleCalendarEvent[] | null> {
  if (getMissingConfig().length > 0) return null;
  const userId = await requireUserId();
  let token: StoredGoogleToken;
  try {
    token = await getUsableAccessToken(userId);
  } catch {
    return null;
  }
  try {
    const { events } = await fetchPrimaryCalendarEvents(token.accessToken, timeMinIso, timeMaxIso);
    return events;
  } catch {
    return null;
  }
}

/** Public surface for the briefings service so it can resolve attendee names. */
export async function getCalendarAccessTokenForCurrentUser(): Promise<string | null> {
  if (getMissingConfig().length > 0) return null;
  try {
    const userId = await requireUserId();
    const token = await getUsableAccessToken(userId);
    return token.accessToken;
  } catch {
    return null;
  }
}

export async function syncRecentGoogleCalendarEvents(): Promise<CalendarSyncResult> {
  const missingConfig = getMissingConfig();
  const zeroResult = {
    processedEvents: 0,
    skippedEvents: 0,
    fetchedEvents: 0,
    createdContacts: 0,
    flaggedForReview: 0,
    purgedLegacyReminders: 0,
  };
  if (missingConfig.length > 0) {
    return { ok: false, reason: `Missing config: ${missingConfig.join(", ")}`, ...zeroResult };
  }

  const userId = await requireUserId();
  let token: StoredGoogleToken;
  try {
    token = await getUsableAccessToken(userId);
  } catch (err) {
    return { ok: false, reason: String(err), ...zeroResult };
  }

  const now = new Date();
  const timeMax = now.toISOString();
  const since = new Date(now);
  since.setDate(since.getDate() - SYNC_LOOKBACK_DAYS);
  const timeMin = since.toISOString();

  console.log(
    `[GCal sync] Query: calendars/primary/events · timeMin=${timeMin} · timeMax=${timeMax} (past-only: now − ${SYNC_LOOKBACK_DAYS}d), singleEvents=true, orderBy=startTime.`,
  );

  let events: GoogleCalendarEvent[];
  let pageCount: number;
  try {
    const fetched = await fetchPrimaryCalendarEvents(token.accessToken, timeMin, timeMax);
    events = fetched.events;
    pageCount = fetched.pages;
  } catch (err) {
    return {
      ok: false,
      reason: `Google Calendar read failed: ${err instanceof Error ? err.message : String(err)}`,
      ...zeroResult,
    };
  }

  console.log(
    `[GCal sync] Loaded ${events.length} non-cancelled event(s) in ${pageCount} page(s). Per-event detail: set GOOGLE_CALENDAR_SYNC_LOG=1 in .env.local`,
  );

  // Pre-fetch Google Contacts display names for every non-self attendee email.
  // This is what the Calendar UI uses and gives us the user's authoritative
  // name for the person (e.g. "Alexander Kvamme" rather than "Alex" or
  // "apfk88"). We do this ONCE per sync, not per event, to keep API calls low.
  const contactsHints = new Map<string, GoogleContactsHint>();
  if (tokenHasPeopleApiScope(token)) {
    const uniqueEmails = new Set<string>();
    for (const event of events) {
      for (const a of event.attendees ?? []) {
        if (a.self || a.resource) continue;
        const email = (a.email ?? "").trim().toLowerCase();
        if (email) uniqueEmails.add(email);
      }
    }
    try {
      const matches = await lookupContactsByEmail(token.accessToken, uniqueEmails);
      for (const [email, match] of matches.entries()) {
        contactsHints.set(email, {
          displayName: match.displayName,
          source: match.source,
        });
      }
      console.log(
        `[GCal sync] People API resolved ${contactsHints.size}/${uniqueEmails.size} attendee emails to saved contact names.`,
      );
    } catch (err) {
      // Non-fatal — just proceed without the hints.
      console.warn(
        `[GCal sync] People API lookup failed, continuing without contact name hints:`,
        err instanceof Error ? err.message : err,
      );
    }
  } else {
    console.log(
      "[GCal sync] Token lacks contacts.readonly / contacts.other.readonly scopes — skipping People API lookup. User should reconnect Google to enable name resolution from Google Contacts.",
    );
  }

  const supabase = await createSupabaseServerClient();

  // One-shot cleanup: previous versions of this integration created a reminder
  // for every meeting attendee, which was extremely noisy. Calendar events now
  // drive pre-meeting briefings on Home instead. Delete any lingering rows so
  // the action queue stays clean. This is cheap (indexed on user_id + source).
  const { count: purgedLegacyReminders } = await supabase
    .from("reminders")
    .delete({ count: "exact" })
    .eq("user_id", userId)
    .eq("source", "google_calendar");

  const { data: contacts } = await supabase
    .from("contacts")
    .select("*")
    .eq("user_id", userId);

  const contactsByEmail = new Map<string, { id: string; name: string }>();
  const contactsByName = new Map<string, { id: string; name: string }>();
  for (const c of contacts ?? []) {
    if (c.email) contactsByEmail.set(c.email.toLowerCase(), { id: c.id, name: c.name });
    contactsByName.set(c.name.trim().toLowerCase(), { id: c.id, name: c.name });
  }

  let skippedEvents = 0;
  let createdContacts = 0;
  let flaggedForReview = 0;
  let processedEvents = 0;

  const { enrichContactFromWeb } = await import("@/lib/integrations/enrich-contact-from-web");

  for (const event of events) {
    const date = eventDate(event);
    if (!date || !event.id) {
      skippedEvents++;
      gCalSyncLog("SKIP", {
        id: event.id,
        reason: !event.id ? "missing id" : "missing/invalid date",
      });
      continue;
    }

    if (!eventIsTimedPeopleMeeting(event)) {
      skippedEvents++;
      gCalSyncLog("SKIP", {
        id: event.id,
        summary: (event.summary ?? "").slice(0, 120),
        reason: event.start?.dateTime ? "no human attendees" : "all-day / no start.dateTime",
      });
      continue;
    }

    const identities = resolveEventIdentities(
      event.attendees,
      {
        id: event.id,
        summary: event.summary,
        organizerEmail: event.organizer?.email,
      },
      contactsHints,
    );

    const title = event.summary?.trim() || "Calendar meeting";
    gCalSyncLog("PROCESS", {
      id: event.id,
      title: title.slice(0, 120),
      date,
      identities: identities.map((i) => ({
        name: i.name,
        confidence: i.confidence,
        hasEmail: Boolean(i.email),
        workDomainCompany: i.workDomainCompany,
        reason: i.evidence.reason,
      })),
    });

    if (identities.length === 0) {
      // Event had attendees but none resolvable — skip silently. No reminder is
      // created; this event still appears in today's meetings briefing card if
      // it falls within the briefing window.
      skippedEvents++;
      continue;
    }

    processedEvents++;
    const interactionNotes = `Synced from Google Calendar${event.htmlLink ? ` (${event.htmlLink})` : ""}`;

    for (const identity of identities) {
      const normalizedName = identity.name.trim().toLowerCase();

      // Look up existing contact by email first (authoritative), then by name.
      const contactMatch =
        (identity.email ? contactsByEmail.get(identity.email) : null) ??
        (identity.confidence === "verified" ? contactsByName.get(normalizedName) : null) ??
        null;

      let contactId = contactMatch?.id ?? null;
      let contactDisplayName = contactMatch?.name ?? identity.name;

      if (!contactId) {
        // New contact. Decide if we should try to enrich.
        const domainCompany = identity.workDomainCompany;
        const wantsEnrichment = identity.confidence === "verified" || identity.confidence === "likely";

        let enriched: Awaited<ReturnType<typeof enrichContactFromWeb>> | null = null;
        if (wantsEnrichment) {
          enriched = await enrichContactFromWeb({
            name: identity.name,
            email: identity.email,
            companyHint: domainCompany,
            relationshipContext: `Synced from calendar meeting: ${title}. Tags: google-calendar.`,
            whenNoWebData: {
              role: "",
              company: domainCompany,
              notes: "",
            },
            strictMatch: true,
          });
        }

        // Decide the name to persist. Only upgrade when Exa returned a clearly
        // matching full name AND the identity wasn't already a full name.
        const resolvedFullName = enriched?.resolvedFullName ?? null;
        const identityHasFullName = identity.name.split(/\s+/).filter(Boolean).length >= 2;
        const contactName =
          !identityHasFullName &&
          resolvedFullName &&
          resolvedFullName.split(/\s+/)[0]?.toLowerCase() === identity.name.split(/\s+/)[0]?.toLowerCase()
            ? resolvedFullName
            : identity.name;

        const needsVerification =
          identity.confidence !== "verified" ||
          (enriched?.needsVerification ?? false);

        const verificationReason =
          identity.confidence !== "verified"
            ? identity.evidence.reason
            : (enriched?.verificationReason ?? "");

        contactId = randomUUID();
        contactDisplayName = contactName;
        await supabase.from("contacts").insert({
          id: contactId,
          user_id: userId,
          name: contactName,
          email: identity.email ?? "",
          company: enriched?.company?.trim() || domainCompany,
          role: enriched?.role?.trim() ?? "",
          linkedin: enriched?.linkedin ?? "",
          avatar: avatarInitials(contactName),
          avatar_color: "#60a5fa",
          tags: ["google-calendar"],
          last_contact_type: "meeting",
          last_contact_date: date,
          last_contact_description: title,
          notes: enriched?.notes ?? "",
          connection_strength: 2,
          mutual_connections: [],
          needs_verification: needsVerification,
          verification_reason: verificationReason,
          verification_candidates: enriched?.candidates ?? [],
          identity_evidence: {
            primaryNameSource: identity.evidence.primaryNameSource,
            displayName: identity.evidence.displayName,
            googleContactsName: identity.evidence.googleContactsName,
            googleContactsSource: identity.evidence.googleContactsSource,
            emailLocalName: identity.evidence.emailLocalName,
            titleHintName: identity.evidence.titleHintName,
            email: identity.evidence.email,
            emailIsPersonalProvider: identity.evidence.emailIsPersonalProvider,
            workDomainCompany: identity.evidence.workDomainCompany,
            eventSummary: identity.evidence.eventSummary,
            attendeeCount: identity.evidence.attendeeCount,
            resolverConfidence: identity.confidence,
            enrichmentConfidence: enriched?.confidence ?? null,
          },
          origin_event_id: event.id,
        });

        if (identity.email) contactsByEmail.set(identity.email, { id: contactId, name: contactName });
        contactsByName.set(contactName.trim().toLowerCase(), { id: contactId, name: contactName });
        createdContacts++;
        if (needsVerification) flaggedForReview++;

        gCalSyncLog("CONTACT_CREATED", {
          id: contactId,
          name: contactName,
          confidence: identity.confidence,
          needsVerification,
          enrichmentConfidence: enriched?.confidence ?? null,
          reason: verificationReason,
        });
      } else {
        // Existing contact — refresh last-contact metadata only; do not overwrite
        // verified profile fields.
        await supabase
          .from("contacts")
          .update({
            last_contact_type: "meeting",
            last_contact_date: date,
            last_contact_description: title,
          })
          .eq("id", contactId)
          .eq("user_id", userId);
      }

      // Interaction — dedupe via (user_id, contact_id, external_event_id) unique index.
      const { error: interactionErr } = await supabase.from("interactions").upsert(
        {
          id: randomUUID(),
          user_id: userId,
          contact_id: contactId,
          date,
          type: "meeting",
          title,
          notes: interactionNotes,
          reminder: null,
          external_event_id: event.id,
        },
        { onConflict: "user_id,contact_id,external_event_id" },
      );
      if (interactionErr) {
        // Fall back for installs that haven't run the migration: check then insert.
        const { data: existingInteraction } = await supabase
          .from("interactions")
          .select("id")
          .eq("user_id", userId)
          .eq("contact_id", contactId)
          .eq("date", date)
          .eq("type", "meeting")
          .eq("title", title)
          .maybeSingle();
        if (!existingInteraction) {
          await supabase.from("interactions").insert({
            id: randomUUID(),
            user_id: userId,
            contact_id: contactId,
            date,
            type: "meeting",
            title,
            notes: interactionNotes,
            reminder: null,
          });
        }
      }

      // Intentionally no reminder upsert. Meeting attendees are surfaced via
      // the pre-meeting briefing on Home; action items come only from captured
      // intent, user-scheduled pings, or tier-aware drift detection.
      void contactDisplayName;
    }
  }

  const legacyPurged = purgedLegacyReminders ?? 0;
  const actions: string[] = [
    `Google Calendar sync: ${events.length} events fetched`,
    `Processed ${processedEvents} meetings · skipped ${skippedEvents}`,
    `Created ${createdContacts} contacts (${flaggedForReview} flagged for review)`,
  ];
  if (legacyPurged > 0) {
    actions.push(`Removed ${legacyPurged} legacy per-attendee reminders`);
  }
  await supabase.from("recent_updates").insert({
    id: randomUUID(),
    user_id: userId,
    timestamp: new Date().toISOString(),
    input: "Synced Google Calendar events",
    actions,
  });
  console.log(
    `[GCal sync] Summary: fetched=${events.length}, processed=${processedEvents}, skipped=${skippedEvents}, contacts=${createdContacts} (review=${flaggedForReview}), legacyRemindersPurged=${legacyPurged}`,
  );

  return {
    ok: true,
    processedEvents,
    skippedEvents,
    fetchedEvents: events.length,
    createdContacts,
    flaggedForReview,
    purgedLegacyReminders: legacyPurged,
  };
}
