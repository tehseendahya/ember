import "server-only";

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { randomUUID } from "crypto";
import { join } from "path";
import { requireUserId } from "@/lib/auth";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

const DATA_DIR = join(process.cwd(), "data");
const GOOGLE_TOKEN_PATH = join(DATA_DIR, "google-calendar-token.json");
const OAUTH_STATE_PATH = join(DATA_DIR, "google-oauth-state.json");
const GOOGLE_AUTH_BASE = "https://accounts.google.com/o/oauth2/v2/auth";
const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";
const GOOGLE_CALENDAR_EVENTS_URL = "https://www.googleapis.com/calendar/v3/calendars/primary/events";
const DEFAULT_SCOPES = [
  "openid",
  "https://www.googleapis.com/auth/userinfo.email",
  "https://www.googleapis.com/auth/calendar.readonly",
];
const STATE_TTL_MS = 10 * 60 * 1000;

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
}

export interface CalendarSyncResult {
  ok: boolean;
  reason?: string;
  addedReminders: number;
  updatedReminders: number;
  skippedEvents: number;
  fetchedEvents: number;
}

interface GoogleCalendarEvent {
  id: string;
  summary?: string;
  description?: string;
  htmlLink?: string;
  start?: { date?: string; dateTime?: string };
  end?: { date?: string; dateTime?: string };
  status?: string;
}

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

function safeReadJSON<T>(path: string): T | null {
  if (!existsSync(path)) return null;
  try {
    return JSON.parse(readFileSync(path, "utf-8")) as T;
  } catch {
    return null;
  }
}

function writeJSON(path: string, value: unknown): void {
  if (!existsSync(DATA_DIR)) {
    mkdirSync(DATA_DIR, { recursive: true });
  }
  writeFileSync(path, JSON.stringify(value, null, 2), "utf-8");
}

function readToken(): StoredGoogleToken | null {
  return safeReadJSON<StoredGoogleToken>(GOOGLE_TOKEN_PATH);
}

function writeToken(payload: GoogleTokenPayload, previous?: StoredGoogleToken | null): StoredGoogleToken {
  const token: StoredGoogleToken = {
    accessToken: payload.access_token,
    expiresAt: Date.now() + payload.expires_in * 1000,
    refreshToken: payload.refresh_token ?? previous?.refreshToken,
    scope: payload.scope ?? previous?.scope,
    tokenType: payload.token_type ?? previous?.tokenType ?? "Bearer",
    updatedAt: new Date().toISOString(),
  };
  writeJSON(GOOGLE_TOKEN_PATH, token);
  return token;
}

function writeOAuthState(state: StoredOAuthState): void {
  writeJSON(OAUTH_STATE_PATH, state);
}

function readOAuthState(): StoredOAuthState | null {
  return safeReadJSON<StoredOAuthState>(OAUTH_STATE_PATH);
}

async function exchangeCodeForToken(code: string): Promise<StoredGoogleToken> {
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
  return writeToken(token, readToken());
}

async function refreshAccessTokenIfNeeded(token: StoredGoogleToken): Promise<StoredGoogleToken> {
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
  return writeToken(refreshed, token);
}

async function getUsableAccessToken(): Promise<StoredGoogleToken> {
  const stored = readToken();
  if (!stored) {
    throw new Error("Google Calendar is not connected.");
  }
  return refreshAccessTokenIfNeeded(stored);
}

function eventDate(event: GoogleCalendarEvent): string | null {
  const raw = event.start?.date ?? event.start?.dateTime;
  if (!raw) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;
  const parsed = new Date(raw);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed.toISOString().slice(0, 10);
}

function toReminderText(event: GoogleCalendarEvent): string {
  const summary = event.summary?.trim();
  if (summary) return `Calendar: ${summary}`;
  return "Calendar event follow-up";
}

export async function getGoogleIntegrationStatus(): Promise<GoogleIntegrationStatus> {
  const missingConfig = getMissingConfig();
  const token = readToken();
  const userId = await requireUserId();
  const supabase = createSupabaseAdminClient();
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
  };
}

export function buildGoogleAuthUrl(redirectTo?: string): string {
  const clientId = getRequiredEnv("GOOGLE_CLIENT_ID");
  const redirectUri = getRequiredEnv("GOOGLE_REDIRECT_URI");
  if (!clientId || !redirectUri) {
    throw new Error("Google OAuth config missing");
  }
  const state = randomUUID();
  writeOAuthState({
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
  const saved = readOAuthState();
  if (!saved || saved.state !== state || saved.expiresAt < Date.now()) {
    throw new Error("OAuth state mismatch or expired");
  }
  await exchangeCodeForToken(code);
  return { redirectTo: saved.redirectTo ?? "/" };
}

export async function syncRecentGoogleCalendarEvents(): Promise<CalendarSyncResult> {
  const missingConfig = getMissingConfig();
  if (missingConfig.length > 0) {
    return {
      ok: false,
      reason: `Missing config: ${missingConfig.join(", ")}`,
      addedReminders: 0,
      updatedReminders: 0,
      skippedEvents: 0,
      fetchedEvents: 0,
    };
  }

  let token: StoredGoogleToken;
  try {
    token = await getUsableAccessToken();
  } catch (err) {
    return {
      ok: false,
      reason: String(err),
      addedReminders: 0,
      updatedReminders: 0,
      skippedEvents: 0,
      fetchedEvents: 0,
    };
  }

  const since = new Date();
  since.setDate(since.getDate() - 14);
  const timeMin = since.toISOString();

  const eventsUrl = new URL(GOOGLE_CALENDAR_EVENTS_URL);
  eventsUrl.searchParams.set("singleEvents", "true");
  eventsUrl.searchParams.set("orderBy", "startTime");
  eventsUrl.searchParams.set("timeMin", timeMin);
  eventsUrl.searchParams.set("maxResults", "50");

  const res = await fetch(eventsUrl.toString(), {
    headers: { Authorization: `Bearer ${token.accessToken}` },
    cache: "no-store",
  });
  if (!res.ok) {
    const details = await res.text();
    return {
      ok: false,
      reason: `Google Calendar read failed: ${details}`,
      addedReminders: 0,
      updatedReminders: 0,
      skippedEvents: 0,
      fetchedEvents: 0,
    };
  }

  const payload = (await res.json()) as { items?: GoogleCalendarEvent[] };
  const events = (payload.items ?? []).filter((event) => event.status !== "cancelled");
  const userId = await requireUserId();
  const supabase = createSupabaseAdminClient();
  const { data: existingReminders } = await supabase
    .from("reminders")
    .select("*")
    .eq("user_id", userId)
    .eq("source", "google_calendar");

  let addedReminders = 0;
  let updatedReminders = 0;
  let skippedEvents = 0;

  for (const event of events) {
    const date = eventDate(event);
    if (!date || !event.id) {
      skippedEvents++;
      continue;
    }
    const text = toReminderText(event);
    const existing = (existingReminders ?? []).find(
      (reminder) => reminder.source === "google_calendar" && reminder.external_event_id === event.id,
    );
    if (existing) {
      await supabase
        .from("reminders")
        .update({
          date,
          text,
          external_url: event.htmlLink ?? existing.external_url ?? null,
          done: false,
        })
        .eq("id", existing.id)
        .eq("user_id", userId);
      updatedReminders++;
      continue;
    }
    await supabase.from("reminders").insert({
      id: randomUUID(),
      user_id: userId,
      contact_id: null,
      date,
      text,
      done: false,
      source: "google_calendar",
      external_event_id: event.id,
      external_url: event.htmlLink ?? null,
    });
    addedReminders++;
  }

  await supabase.from("recent_updates").insert({
    id: randomUUID(),
    user_id: userId,
    timestamp: new Date().toISOString(),
    input: "Synced Google Calendar events",
    actions: [
      `Google Calendar sync: ${events.length} events fetched`,
      `Created ${addedReminders} reminders`,
      `Updated ${updatedReminders} reminders`,
      `Skipped ${skippedEvents} events`,
    ],
  });
  return {
    ok: true,
    addedReminders,
    updatedReminders,
    skippedEvents,
    fetchedEvents: events.length,
  };
}
