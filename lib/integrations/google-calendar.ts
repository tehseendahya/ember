import "server-only";

import { randomUUID } from "crypto";
import { requireUserId } from "@/lib/auth";
import { createSupabaseServerClient } from "@/lib/supabase/server";

const GOOGLE_AUTH_BASE = "https://accounts.google.com/o/oauth2/v2/auth";
const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";
const GOOGLE_CALENDAR_EVENTS_URL = "https://www.googleapis.com/calendar/v3/calendars/primary/events";

/**
 * Past-only sync window: we query [now − N days, now] so recurring series do not expand into the future forever.
 */
const SYNC_LOOKBACK_DAYS = 14;
/** Google allows up to 2500; we paginate until no nextPageToken (fixes the old maxResults=50 cap). */
const SYNC_PAGE_SIZE = 250;

function gCalSyncVerbose(): boolean {
  const v = process.env.GOOGLE_CALENDAR_SYNC_LOG?.trim().toLowerCase();
  return v === "1" || v === "true" || v === "all";
}

function gCalSyncLog(...args: unknown[]): void {
  if (gCalSyncVerbose()) {
    console.log("[GCal sync]", ...args);
  }
}
const EXA_URL = "https://api.exa.ai/search";
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
  attendees?: Array<{
    email?: string;
    displayName?: string;
    self?: boolean;
    organizer?: boolean;
    resource?: boolean;
    responseStatus?: string;
  }>;
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

async function writeToken(userId: string, payload: GoogleTokenPayload, previous?: StoredGoogleToken | null): Promise<StoredGoogleToken> {
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

function looksLikePersonName(value: string): boolean {
  const v = value.trim();
  if (!v) return false;
  if (v.length < 3 || v.length > 60) return false;
  if (/@/.test(v)) return false;
  const blocked = /(birthday|holiday|ooo|out of office|focus time|gym|workout|commute|travel|dentist|doctor|flight|pickup|dropoff|lunch|dinner|breakfast|standup|sync|retro|planning|all hands|town hall)/i;
  if (blocked.test(v)) return false;
  return /^[A-Z][a-z]+(?:\s+[A-Z][a-z.'-]+){1,2}$/.test(v);
}

function nameFromEmail(email: string): string {
  const local = email.split("@")[0] ?? "";
  const cleaned = local.replace(/[._-]+/g, " ").trim();
  if (!cleaned) return "";
  return cleaned
    .split(" ")
    .filter(Boolean)
    .map((part) => part.slice(0, 1).toUpperCase() + part.slice(1))
    .join(" ");
}

type EventParticipant = {
  name: string;
  email: string | null;
  /** When false, we only create a reminder — no new CRM contact (avoids junk from "lunch with Sarah"). */
  confidenceHigh: boolean;
  /** Name came only from event title parsing (no attendees). */
  summaryOnly: boolean;
};

function participantConfidence(
  name: string,
  email: string | null,
  summaryOnly: boolean,
  eventSummary?: string,
): { confidenceHigh: boolean; summaryOnly: boolean } {
  const em = email?.trim().toLowerCase() ?? "";
  if (em && isLikelyHumanEmail(em)) {
    return { confidenceHigh: true, summaryOnly };
  }
  const n = name.trim();
  if (!n) return { confidenceHigh: false, summaryOnly };
  const parts = n.split(/\s+/).filter(Boolean);
  if (parts.length >= 2 && looksLikePersonNameFlexible(n, false)) {
    return { confidenceHigh: true, summaryOnly };
  }
  const summary = eventSummary?.trim() ?? "";
  if (summary && inviteStyleCoAttendanceTitle(summary) && looksLikePersonNameFlexible(n, true)) {
    return { confidenceHigh: true, summaryOnly };
  }
  if (summaryOnly) {
    return { confidenceHigh: false, summaryOnly: true };
  }
  return { confidenceHigh: false, summaryOnly: false };
}

const MEETING_PREFIXES = [
  "catch up",
  "call",
  "meeting",
  "sync",
  "chat",
  "intro",
  "catchup",
  "catch-up",
  "coffee",
  "lunch",
  "dinner",
  "standup",
  "1:1",
];

function normalizePersonCandidate(value: string): string {
  const raw = value
    .replace(/[()[\]{}]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!raw) return "";
  const lower = raw.toLowerCase();
  for (const prefix of MEETING_PREFIXES) {
    const pref = `${prefix} `;
    if (lower.startsWith(pref)) {
      return raw.slice(pref.length).trim();
    }
  }
  return raw;
}

function isLikelyCompanyPhrase(value: string): boolean {
  return /\b(inc|llc|ltd|corp|company|health|labs|technologies|partners|capital|ventures)\b/i.test(value);
}

function titleCaseWords(value: string): string {
  return value
    .split(" ")
    .filter(Boolean)
    .map((part) => part.slice(0, 1).toUpperCase() + part.slice(1).toLowerCase())
    .join(" ");
}

function isLikelyHumanEmail(email: string): boolean {
  const local = email.split("@")[0] ?? "";
  if (!local) return false;
  if (/(no-?reply|notifications?|calendar|team|support|help|info|hello|admin)/i.test(local)) return false;
  return true;
}

/** Single-segment local parts like "avihanj" are often handles, not "First Last" names. Prefer display name / event title. */
function isUnreliableEmailLocalPartAsName(email: string): boolean {
  const local = email.split("@")[0]?.trim() ?? "";
  if (!local) return true;
  if (/[._-]/.test(local)) return false;
  return /^[a-z][a-z0-9]{3,}$/.test(local);
}

export function companyFromEmailDomain(email: string | null): string {
  if (!email) return "";
  const domain = email.split("@")[1]?.toLowerCase() ?? "";
  if (!domain) return "";
  if (/(gmail\.com|outlook\.com|hotmail\.com|yahoo\.com|icloud\.com|proton\.me|protonmail\.com)$/i.test(domain)) return "";
  const base = domain.split(".")[0] ?? "";
  if (!base) return "";
  return base
    .split(/[-_]/g)
    .filter(Boolean)
    .map((part) => part.slice(0, 1).toUpperCase() + part.slice(1))
    .join(" ");
}

function companyHintFromSummary(summary: string): string {
  const normalized = summary.trim();
  if (!normalized) return "";
  const m = normalized.match(/^([A-Z][A-Za-z0-9&.'-]*(?:\s+[A-Z][A-Za-z0-9&.'-]*){0,2})\s+(?:Call|Meeting|Sync|Intro|Chat)\b/i);
  if (!m?.[1]) return "";
  const candidate = m[1].trim();
  if (looksLikePersonNameFlexible(candidate, true)) return "";
  return candidate;
}

function linkedInSearchUrl(name: string, companyHint?: string): string {
  const q = companyHint?.trim() ? `${name} ${companyHint}` : name;
  return `https://www.linkedin.com/search/results/people/?keywords=${encodeURIComponent(q)}`;
}

function excerptFromExaHit(hit: { title?: string; highlights?: string[]; text?: string }): string {
  if (hit.highlights?.length) return hit.highlights.join(" ").trim();
  if (hit.text) return hit.text.trim();
  return hit.title ?? "";
}

/** First segment of a LinkedIn SERP title is usually "First Last — headline…". */
function parseFullNameFromLinkedInTitle(title: string | undefined): string | null {
  if (!title) return null;
  const cleaned = title.replace(/\s*\|\s*LinkedIn.*$/i, "").trim();
  const firstSeg = cleaned.split(/\s*[-–—]\s/)[0]?.trim() ?? "";
  if (!firstSeg || firstSeg.length < 3) return null;
  if (looksLikePersonNameFlexible(firstSeg, false)) return titleCaseWords(firstSeg);
  const parts = firstSeg.split(/\s+/).filter(Boolean);
  if (parts.length >= 2 && looksLikePersonNameFlexible(firstSeg, true)) return titleCaseWords(firstSeg);
  return null;
}

function emailLocalSearchSlug(email: string | null): string {
  if (!email) return "";
  const local = email.split("@")[0] ?? "";
  const alpha = local.replace(/[^a-z0-9]/gi, "").toLowerCase();
  if (alpha.length < 4) return "";
  return alpha;
}

/** Lowercase alphanumeric from work email domain (e.g. majente.com → majente). Empty for personal providers. */
function workEmailDomainSlug(email: string | null): string {
  if (!email) return "";
  const domain = email.split("@")[1]?.toLowerCase() ?? "";
  if (!domain) return "";
  if (/(gmail\.com|outlook\.com|hotmail\.com|yahoo\.com|icloud\.com|proton\.me|protonmail\.com)$/i.test(domain)) {
    return "";
  }
  const base = domain.split(".")[0] ?? "";
  return base.replace(/[^a-z0-9]/gi, "").toLowerCase();
}

function companyHintToSlug(hint: string): string {
  return hint.trim().toLowerCase().replace(/[^a-z0-9]/g, "");
}

type LinkedInScoreOpts = {
  emailLocalSlug?: string;
  /** From work email domain — strongest tie-break for common names (e.g. Ryan Johnson @majente.com). */
  workDomainSlug?: string;
  /** From merged company hint when distinct from workDomainSlug. */
  companyHintSlug?: string;
};

function scoreLinkedInHitForName(hit: { title?: string; url?: string }, name: string, opts: LinkedInScoreOpts = {}): number {
  const tokens = name
    .toLowerCase()
    .split(/\s+/)
    .filter((t) => t.length > 1);
  if (tokens.length === 0) return 0;
  const slug = (hit.url ?? "").toLowerCase();
  const title = (hit.title ?? "").toLowerCase();
  let score = 0;
  for (const t of tokens) {
    if (slug.includes(t)) score += 6;
    if (title.includes(t)) score += 4;
  }
  if (tokens[0] && !title.includes(tokens[0]) && !slug.includes(tokens[0])) score -= 8;

  const { emailLocalSlug, workDomainSlug, companyHintSlug } = opts;

  if (workDomainSlug && workDomainSlug.length >= 3) {
    if (slug.includes(workDomainSlug)) score += 32;
    if (title.includes(workDomainSlug)) score += 22;
  }

  if (companyHintSlug && companyHintSlug.length >= 3 && companyHintSlug !== workDomainSlug) {
    if (slug.includes(companyHintSlug)) score += 18;
    if (title.includes(companyHintSlug)) score += 12;
  }

  if (emailLocalSlug && emailLocalSlug.length >= 4) {
    const hasWorkDomain = Boolean(workDomainSlug && workDomainSlug.length >= 3);
    const shortGenericLocal = hasWorkDomain && emailLocalSlug.length < 8;
    if (!shortGenericLocal) {
      if (slug.includes(emailLocalSlug)) score += 28;
      if (title.includes(emailLocalSlug)) score += 18;
    }
  }
  return score;
}

export interface PersonWebResult {
  linkedin: string;
  /** Raw excerpt for LLM / notes (may be long). */
  bio: string | null;
  /** Exa/LinkedIn hit title, e.g. "Name - Role - Company | LinkedIn" — helps set role/company. */
  sourceTitle: string | null;
  /** Full name parsed from the chosen LinkedIn result title when better than a first-name-only input. */
  resolvedFullName: string | null;
}

/**
 * One Exa people search: best LinkedIn /in/ URL for the given name + company hint, plus a short bio excerpt.
 * Used for calendar-created contacts and manual "Repopulate from web".
 */
export async function resolvePersonFromWeb(
  name: string,
  companyHint: string,
  email: string | null,
): Promise<PersonWebResult> {
  const trimmed = name.trim();
  const emailCompanyHint = companyFromEmailDomain(email);
  const fallbackHint = emailCompanyHint || companyHint.trim();
  const fallbackSearch = linkedInSearchUrl(trimmed, fallbackHint);
  if (!trimmed) {
    return { linkedin: fallbackSearch, bio: null, sourceTitle: null, resolvedFullName: null };
  }

  const exaKey = process.env.EXA_API_KEY?.trim();
  if (!exaKey) {
    return { linkedin: fallbackSearch, bio: null, sourceTitle: null, resolvedFullName: null };
  }

  const emailLocalSlug = emailLocalSearchSlug(email);
  const workDomainSlug = workEmailDomainSlug(email);
  const companyHintSlugRaw = companyHintToSlug(fallbackHint);
  const companyHintSlug =
    companyHintSlugRaw && companyHintSlugRaw !== workDomainSlug ? companyHintSlugRaw : undefined;

  const queryParts = [trimmed];
  if (fallbackHint.trim()) queryParts.push(fallbackHint.trim());
  if (workDomainSlug && !fallbackHint.toLowerCase().replace(/[^a-z0-9]/g, "").includes(workDomainSlug)) {
    queryParts.push(workDomainSlug);
  }
  if (emailLocalSlug) queryParts.push(emailLocalSlug);
  queryParts.push("linkedin");
  const query = queryParts.join(" ");

  try {
    const res = await fetch(EXA_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": exaKey,
      },
      body: JSON.stringify({
        query,
        category: "people",
        type: "auto",
        num_results: 8,
        contents: {
          highlights: { max_characters: 2000 },
        },
      }),
      cache: "no-store",
    });
    if (!res.ok) {
      return { linkedin: fallbackSearch, bio: null, sourceTitle: null, resolvedFullName: null };
    }
    const data = (await res.json()) as {
      results?: Array<{ url?: string; title?: string; highlights?: string[]; text?: string }>;
    };
    const hits = data.results ?? [];
    const linkedInHits = hits.filter((h) => /linkedin\.com\/in\//i.test(h.url ?? ""));

    if (linkedInHits.length === 0) {
      const any = hits[0];
      if (any?.url && /linkedin\.com\/in\//i.test(any.url)) {
        const bio = excerptFromExaHit(any).slice(0, 1200) || null;
        const resolvedFullName = parseFullNameFromLinkedInTitle(any.title);
        return { linkedin: any.url, bio, sourceTitle: any.title ?? null, resolvedFullName };
      }
      return { linkedin: fallbackSearch, bio: null, sourceTitle: null, resolvedFullName: null };
    }

    const scored = linkedInHits
      .map((h) => ({
        hit: h,
        score: scoreLinkedInHitForName(h, trimmed, {
          emailLocalSlug,
          workDomainSlug,
          companyHintSlug,
        }),
      }))
      .sort((a, b) => b.score - a.score);
    const best = scored[0]?.hit;
    if (!best?.url) {
      return { linkedin: fallbackSearch, bio: null, sourceTitle: null, resolvedFullName: null };
    }
    const bio = excerptFromExaHit(best).slice(0, 1200) || null;
    const resolvedFullName = parseFullNameFromLinkedInTitle(best.title);
    return { linkedin: best.url, bio, sourceTitle: best.title ?? null, resolvedFullName };
  } catch {
    return { linkedin: fallbackSearch, bio: null, sourceTitle: null, resolvedFullName: null };
  }
}

export async function resolveLinkedInUrl(name: string, companyHint: string, email: string | null): Promise<string> {
  const { linkedin } = await resolvePersonFromWeb(name, companyHint, email);
  return linkedin;
}

function looksLikePersonNameFlexible(value: string, allowSingleToken: boolean): boolean {
  const normalized = normalizePersonCandidate(value);
  if (!normalized) return false;
  if (isLikelyCompanyPhrase(normalized)) return false;
  const parts = normalized.split(/\s+/).filter(Boolean);
  if (parts.length === 0) return false;
  if (!allowSingleToken && parts.length < 2) return false;
  if (parts.length > 3) return false;
  return parts.every((part) => /^[A-Za-z][A-Za-z.'-]*$/.test(part));
}

/** Reject phrases that match "name" heuristics but are not real people (e.g. event titles). */
function isBogusExtractedPersonName(name: string): boolean {
  const t = name.trim().toLowerCase().replace(/\s+/g, " ");
  if (!t) return true;
  if (/^(an?|the|my)\s+old\s+friend$/i.test(t)) return true;
  if (/^a\s+friend$/i.test(t)) return true;
  if (/^old\s+friend$/i.test(t)) return true;
  if (/^(some|any)one$/i.test(t)) return true;
  if (/^the\s+team$/i.test(t)) return true;
  if (/^a\s+colleague$/i.test(t)) return true;
  if (/^(an?\s+)?(old\s+)?friend$/i.test(t)) return true;
  return false;
}

/** Titles like "Zoom | Tehseen + Alex" or "1:1 Sam + Jordan" — guest is usually after "+". */
function extractNameAfterPlusInSummary(summary: string): string {
  const normalized = summary.replace(/[-–:|]/g, " ").replace(/\s+/g, " ").trim();
  const plus = normalized.match(/\S+\s*\+\s*([A-Za-z][A-Za-z.'-]*(?:\s+[A-Za-z][A-Za-z.'-]*){0,2})\b/);
  if (!plus?.[1]) return "";
  const candidate = normalizePersonCandidate(plus[1]);
  if (!looksLikePersonNameFlexible(candidate, true)) return "";
  const titled = titleCaseWords(candidate);
  return isBogusExtractedPersonName(titled) ? "" : titled;
}

function inviteStyleCoAttendanceTitle(summary: string): boolean {
  const t = summary.replace(/[-–:|]/g, " ").replace(/\s+/g, " ").trim();
  return /\S+\s*\+\s*\S+/.test(t);
}

function extractNameFromSummary(summary: string): string {
  const normalized = summary.replace(/[-–:|]/g, " ").replace(/\s+/g, " ").trim();
  const afterPlus = extractNameAfterPlusInSummary(summary);
  if (afterPlus) return afterPlus;
  const withPattern = normalized.match(/\b(?:with|w\/)\s+([A-Za-z][A-Za-z.'-]*(?:\s+[A-Za-z][A-Za-z.'-]*){0,2})\b/i);
  if (withPattern?.[1]) {
    const candidate = normalizePersonCandidate(withPattern[1]);
    if (looksLikePersonNameFlexible(candidate, true)) {
      const titled = titleCaseWords(candidate);
      if (!isBogusExtractedPersonName(titled)) return titled;
    }
  }
  for (const prefix of MEETING_PREFIXES) {
    const rx = new RegExp(`\\b${prefix.replace(/[-/\\^$*+?.()|[\]{}]/g, "\\$&")}\\s+([A-Za-z][A-Za-z.'-]*(?:\\s+[A-Za-z][A-Za-z.'-]*){0,2})\\b`, "i");
    const m = normalized.match(rx);
    if (m?.[1]) {
      const candidate = normalizePersonCandidate(m[1]);
      if (looksLikePersonNameFlexible(candidate, true)) {
        const titled = titleCaseWords(candidate);
        if (!isBogusExtractedPersonName(titled)) return titled;
      }
    }
  }
  return "";
}

function extractParticipants(event: GoogleCalendarEvent): EventParticipant[] {
  const participants: EventParticipant[] = [];
  const seen = new Set<string>();
  const summary = event.summary?.trim() ?? "";

  for (const attendee of event.attendees ?? []) {
    if (attendee.self || attendee.resource) continue;
    const email = attendee.email?.trim().toLowerCase() ?? "";
    if (email && /@(group\.calendar\.google\.com|resource\.calendar\.google\.com)$/.test(email)) continue;

    const displayName = normalizePersonCandidate(attendee.displayName?.trim() ?? "");
    const emailNameRaw = email ? nameFromEmail(email) : "";
    const emailName = normalizePersonCandidate(emailNameRaw);

    let selectedName = "";
    let nameSource: "display" | "email" | "title" | "" = "";
    if (looksLikePersonNameFlexible(displayName, true)) {
      selectedName = titleCaseWords(displayName);
      nameSource = "display";
    } else if (
      email &&
      isLikelyHumanEmail(email) &&
      looksLikePersonNameFlexible(emailName, true) &&
      !isUnreliableEmailLocalPartAsName(email)
    ) {
      selectedName = titleCaseWords(emailName);
      nameSource = "email";
    } else if (email && isLikelyHumanEmail(email) && looksLikePersonNameFlexible(emailName, true)) {
      selectedName = titleCaseWords(emailName);
      nameSource = "email";
    } else if (summary) {
      const fromSummary = extractNameFromSummary(summary);
      if (fromSummary) {
        selectedName = fromSummary;
        nameSource = "title";
      }
    }

    if (!selectedName) continue;
    const key = email || selectedName.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    const { confidenceHigh, summaryOnly } = participantConfidence(selectedName, email || null, false, summary);
    gCalSyncLog("ATTENDEE", {
      name: selectedName,
      nameSource,
      hasEmail: Boolean(email),
      emailLooksHuman: email ? isLikelyHumanEmail(email) : false,
      confidenceHigh,
      title: summary.slice(0, 100),
    });
    participants.push({ name: selectedName, email: email || null, confidenceHigh, summaryOnly });
  }
  if (participants.length > 0) return participants;

  const fromSummary = extractNameFromSummary(summary);
  if (fromSummary) {
    const { confidenceHigh, summaryOnly } = participantConfidence(fromSummary, null, true, summary);
    participants.push({ name: fromSummary, email: null, confidenceHigh, summaryOnly });
  }
  return participants;
}

function isLikelyPeopleMeeting(event: GoogleCalendarEvent): boolean {
  if (!event.start?.dateTime) return false; // skip all-day blocks
  const participants = extractParticipants(event);
  if (participants.length > 0) return true;
  const summary = event.summary?.trim() ?? "";
  return /\b(1:1|coffee|lunch|dinner|meet|intro|call|sync|chat|catch|catchup|zoom)\b/i.test(summary);
}

function syncSkipReason(event: GoogleCalendarEvent, date: string | null): string {
  if (!event.id) return "missing event id";
  if (!date) return "missing or invalid start (no usable start.date / dateTime)";
  if (!isLikelyPeopleMeeting(event)) {
    if (!event.start?.dateTime) return "all-day only (start.date) — sync uses timed events with start.dateTime";
    const summary = event.summary?.trim() ?? "(no title)";
    return `no extractable person + title has no trigger word (1:1 coffee lunch dinner meet intro call sync chat catch zoom): "${summary.slice(0, 100)}"`;
  }
  return "";
}

async function fetchPrimaryCalendarEvents(
  accessToken: string,
  timeMinIso: string,
  timeMaxIso: string,
): Promise<{
  events: GoogleCalendarEvent[];
  pages: number;
}> {
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

  const userId = await requireUserId();
  let token: StoredGoogleToken;
  try {
    token = await getUsableAccessToken(userId);
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

  const now = new Date();
  const timeMax = now.toISOString();
  const since = new Date(now);
  since.setDate(since.getDate() - SYNC_LOOKBACK_DAYS);
  const timeMin = since.toISOString();

  console.log(
    `[GCal sync] Query: calendars/primary/events · timeMin=${timeMin} · timeMax=${timeMax} (past-only window: now − ${SYNC_LOOKBACK_DAYS}d … now), singleEvents=true, orderBy=startTime, pageSize=${SYNC_PAGE_SIZE}, paginate until exhausted.`,
  );

  let events: GoogleCalendarEvent[];
  let pageCount: number;
  try {
    const fetched = await fetchPrimaryCalendarEvents(token.accessToken, timeMin, timeMax);
    events = fetched.events;
    pageCount = fetched.pages;
  } catch (err) {
    const details = err instanceof Error ? err.message : String(err);
    return {
      ok: false,
      reason: `Google Calendar read failed: ${details}`,
      addedReminders: 0,
      updatedReminders: 0,
      skippedEvents: 0,
      fetchedEvents: 0,
    };
  }

  console.log(
    `[GCal sync] Loaded ${events.length} non-cancelled event(s) in ${pageCount} page(s). Per-event detail: set GOOGLE_CALENDAR_SYNC_LOG=1 in .env.local`,
  );

  const supabase = await createSupabaseServerClient();
  await supabase
    .from("reminders")
    .delete()
    .eq("user_id", userId)
    .eq("source", "google_calendar");

  const [{ data: existingReminders }, { data: contacts }] = await Promise.all([
    supabase.from("reminders").select("*").eq("user_id", userId).eq("source", "google_calendar"),
    supabase.from("contacts").select("*").eq("user_id", userId),
  ]);

  const contactsByEmail = new Map<string, { id: string; name: string }>();
  const contactsByName = new Map<string, { id: string; name: string }>();
  for (const c of contacts ?? []) {
    if (c.email) contactsByEmail.set(c.email.toLowerCase(), { id: c.id, name: c.name });
    contactsByName.set(c.name.trim().toLowerCase(), { id: c.id, name: c.name });
  }

  let addedReminders = 0;
  let updatedReminders = 0;
  let skippedEvents = 0;

  for (const event of events) {
    const date = eventDate(event);
    if (!date || !event.id || !isLikelyPeopleMeeting(event)) {
      skippedEvents++;
      gCalSyncLog("SKIP", {
        id: event.id,
        summary: (event.summary ?? "").slice(0, 120),
        start: event.start?.date ?? event.start?.dateTime,
        reason: syncSkipReason(event, date),
      });
      continue;
    }
    const participants = extractParticipants(event);
    const title = event.summary?.trim() || "Calendar meeting";
    gCalSyncLog("PROCESS", {
      id: event.id,
      title: title.slice(0, 120),
      date,
      participantCount: participants.length,
      participants: participants.map((p) => ({
        name: p.name,
        hasEmail: Boolean(p.email),
        confidenceHigh: p.confidenceHigh,
      })),
    });
    const interactionNotes = `Synced from Google Calendar${event.htmlLink ? ` (${event.htmlLink})` : ""}`;

    if (participants.length === 0) {
      const existing = (existingReminders ?? []).find(
        (reminder) => reminder.source === "google_calendar" && reminder.external_event_id === event.id,
      );
      const text = toReminderText(event);
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
      } else {
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
      continue;
    }

    for (const participant of participants) {
      const normalizedName = participant.name.trim().toLowerCase();
      const summaryCompanyHint = companyHintFromSummary(title);
      const emailCompanyHint = companyFromEmailDomain(participant.email);
      const companyHint = emailCompanyHint || summaryCompanyHint;

      const contactMatch =
        (participant.email ? contactsByEmail.get(participant.email) : null) ??
        (participant.confidenceHigh ? contactsByName.get(normalizedName) : null) ??
        null;

      /** Title-only / first-name-only — do not create CRM contacts or guess LinkedIn; reminder only. */
      if (!participant.confidenceHigh) {
        gCalSyncLog("REMINDER_ONLY", {
          eventId: event.id,
          title: title.slice(0, 120),
          participantName: participant.name,
          hasEmail: Boolean(participant.email),
          note: "No CRM contact: need human attendee email and/or full name, or invite-style title (e.g. Name + Name) for single names.",
        });
        const lowCtxKey = `${event.id}:ctx:${normalizedName.slice(0, 80)}`;
        const text = `Calendar follow-up: ${title}${participant.name ? ` — mentioned: ${participant.name}` : ""}`;
        const existingLow = (existingReminders ?? []).find(
          (r) => r.source === "google_calendar" && r.external_event_id === lowCtxKey,
        );
        if (existingLow) {
          await supabase
            .from("reminders")
            .update({
              date,
              text,
              contact_id: null,
              external_url: event.htmlLink ?? existingLow.external_url ?? null,
              done: false,
            })
            .eq("id", existingLow.id)
            .eq("user_id", userId);
          updatedReminders++;
        } else {
          await supabase.from("reminders").insert({
            id: randomUUID(),
            user_id: userId,
            contact_id: null,
            date,
            text,
            done: false,
            source: "google_calendar",
            external_event_id: lowCtxKey,
            external_url: event.htmlLink ?? null,
          });
          addedReminders++;
        }
        continue;
      }

      let contactId = contactMatch?.id ?? null;
      let contactDisplayName = contactMatch?.name ?? participant.name;
      if (!contactId) {
        contactId = randomUUID();
        const { enrichContactFromWeb } = await import("@/lib/integrations/enrich-contact-from-web");
        const enriched = await enrichContactFromWeb({
          name: participant.name,
          email: participant.email,
          companyHint,
          relationshipContext: `Synced from calendar meeting: ${title}. Tags: google-calendar.`,
          whenNoWebData: {
            role: "",
            company: companyHint,
            notes: "",
          },
        });
        const resolved = enriched.resolvedFullName?.trim() ?? "";
        const contactName =
          resolved &&
          resolved.split(/\s+/).length >= 2 &&
          participant.name.trim().toLowerCase() === resolved.split(/\s+/)[0]?.toLowerCase()
            ? resolved
            : participant.name;
        contactDisplayName = contactName;
        const avatar =
          contactName
            .split(" ")
            .filter(Boolean)
            .slice(0, 2)
            .map((p) => p[0]?.toUpperCase() ?? "")
            .join("") || "?";
        await supabase.from("contacts").insert({
          id: contactId,
          user_id: userId,
          name: contactName,
          email: participant.email ?? "",
          company: enriched.company || companyHint,
          role: enriched.role,
          linkedin: enriched.linkedin,
          avatar,
          avatar_color: "#60a5fa",
          tags: ["google-calendar"],
          last_contact_type: "meeting",
          last_contact_date: date,
          last_contact_description: title,
          notes: enriched.notes,
          connection_strength: 2,
          mutual_connections: [],
        });
        if (participant.email) contactsByEmail.set(participant.email, { id: contactId, name: contactName });
        contactsByName.set(contactName.trim().toLowerCase(), { id: contactId, name: contactName });
      } else {
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

      const reminderKey = participant.email
        ? `${event.id}:${participant.email}`
        : `${event.id}:${contactDisplayName.trim().toLowerCase().slice(0, 80)}`;
      const existing = (existingReminders ?? []).find(
        (reminder) => reminder.source === "google_calendar" && reminder.external_event_id === reminderKey,
      );
      const text = `Follow up with ${contactDisplayName}: ${title}`;
      if (existing) {
        await supabase
          .from("reminders")
          .update({
            contact_id: contactId,
            date,
            text,
            external_url: event.htmlLink ?? existing.external_url ?? null,
            done: false,
          })
          .eq("id", existing.id)
          .eq("user_id", userId);
        updatedReminders++;
      } else {
        await supabase.from("reminders").insert({
          id: randomUUID(),
          user_id: userId,
          contact_id: contactId,
          date,
          text,
          done: false,
          source: "google_calendar",
          external_event_id: reminderKey,
          external_url: event.htmlLink ?? null,
        });
        addedReminders++;
      }
    }
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
  console.log(
    `[GCal sync] Summary: fetched=${events.length}, skippedByFilters=${skippedEvents}, remindersInserted=${addedReminders}, remindersUpdated=${updatedReminders}`,
  );
  return {
    ok: true,
    addedReminders,
    updatedReminders,
    skippedEvents,
    fetchedEvents: events.length,
  };
}
