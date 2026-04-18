import "server-only";

/**
 * Lookup display names for attendee emails via Google People API.
 *
 * The Google Calendar API's `attendees[].displayName` is only populated when the
 * organizer typed a name into the invite — for gmail-to-gmail invites it's
 * usually blank. The Calendar web UI, by contrast, joins the attendee email
 * against the viewer's Google Contacts / "Other contacts" to show a name.
 *
 * This module reproduces that behavior server-side so the identity resolver can
 * treat a People API hit as a high-trust `verified` signal.
 *
 * Scopes needed on the OAuth token:
 *   - https://www.googleapis.com/auth/contacts.readonly
 *   - https://www.googleapis.com/auth/contacts.other.readonly
 *
 * If the token lacks these scopes we fail soft — the sync still runs, the
 * resolver just doesn't get the extra signal.
 */

const OTHER_CONTACTS_SEARCH = "https://people.googleapis.com/v1/otherContacts:search";
const CONTACTS_SEARCH = "https://people.googleapis.com/v1/people:searchContacts";
/** Read mask shared by both endpoints. */
const READ_MASK = "names,emailAddresses";
/** How many unique emails to resolve in parallel — keep modest to stay under quotas. */
const CONCURRENCY = 4;

export type GooglePeopleMatchSource = "savedContact" | "otherContact";

export interface GooglePeopleMatch {
  email: string;
  displayName: string;
  givenName: string | null;
  familyName: string | null;
  source: GooglePeopleMatchSource;
}

interface PeopleApiPerson {
  resourceName?: string;
  names?: Array<{ displayName?: string; givenName?: string; familyName?: string }>;
  emailAddresses?: Array<{ value?: string }>;
}

interface PeopleApiSearchResponse {
  results?: Array<{ person?: PeopleApiPerson }>;
}

function logVerbose(): boolean {
  const v = process.env.GOOGLE_CALENDAR_SYNC_LOG?.trim().toLowerCase();
  return v === "1" || v === "true" || v === "all";
}

/**
 * Google's Search APIs require a cache-warmup call before the first real query:
 * https://developers.google.com/people/v1/other-contacts#search_the_users_other_contacts
 *
 * We issue one warmup per endpoint per process startup.
 */
let warmedOtherContacts = false;
let warmedSearchContacts = false;

async function warmup(url: string, accessToken: string): Promise<void> {
  const u = new URL(url);
  u.searchParams.set("query", "");
  u.searchParams.set("pageSize", "1");
  u.searchParams.set("readMask", READ_MASK);
  try {
    await fetch(u.toString(), {
      headers: { Authorization: `Bearer ${accessToken}` },
      cache: "no-store",
    });
  } catch {
    // Warmup is best-effort.
  }
}

async function searchOne(
  endpoint: string,
  accessToken: string,
  query: string,
): Promise<PeopleApiPerson[]> {
  const u = new URL(endpoint);
  u.searchParams.set("query", query);
  u.searchParams.set("pageSize", "10");
  u.searchParams.set("readMask", READ_MASK);
  const res = await fetch(u.toString(), {
    headers: { Authorization: `Bearer ${accessToken}` },
    cache: "no-store",
  });
  if (!res.ok) {
    // 403 → scope not granted; 429 → quota. Either way we return nothing so the
    // caller can fall back to heuristics without crashing the sync.
    if (logVerbose()) {
      const body = await res.text().catch(() => "");
      console.log("[People API]", endpoint, res.status, body.slice(0, 200));
    }
    return [];
  }
  const data = (await res.json()) as PeopleApiSearchResponse;
  return (data.results ?? [])
    .map((r) => r.person)
    .filter((p): p is PeopleApiPerson => Boolean(p));
}

function pickMatchForEmail(
  people: PeopleApiPerson[],
  email: string,
  source: GooglePeopleMatchSource,
): GooglePeopleMatch | null {
  const target = email.trim().toLowerCase();
  if (!target) return null;
  for (const person of people) {
    const hasMatchingEmail = (person.emailAddresses ?? []).some(
      (e) => e.value?.trim().toLowerCase() === target,
    );
    if (!hasMatchingEmail) continue;
    const primaryName = (person.names ?? []).find(
      (n) => (n.displayName ?? "").trim().length > 0,
    );
    const displayName = primaryName?.displayName?.trim();
    if (!displayName) continue;
    return {
      email: target,
      displayName,
      givenName: primaryName?.givenName?.trim() || null,
      familyName: primaryName?.familyName?.trim() || null,
      source,
    };
  }
  return null;
}

async function lookupOne(
  accessToken: string,
  email: string,
): Promise<GooglePeopleMatch | null> {
  const q = email.trim().toLowerCase();
  if (!q) return null;

  // Saved contacts first — stronger signal than auto-tracked "other" contacts.
  if (!warmedSearchContacts) {
    warmedSearchContacts = true;
    await warmup(CONTACTS_SEARCH, accessToken);
  }
  const saved = await searchOne(CONTACTS_SEARCH, accessToken, q);
  const savedMatch = pickMatchForEmail(saved, q, "savedContact");
  if (savedMatch) return savedMatch;

  if (!warmedOtherContacts) {
    warmedOtherContacts = true;
    await warmup(OTHER_CONTACTS_SEARCH, accessToken);
  }
  const other = await searchOne(OTHER_CONTACTS_SEARCH, accessToken, q);
  return pickMatchForEmail(other, q, "otherContact");
}

/**
 * Batch-lookup display names for a set of emails. Returns a Map keyed by
 * lowercased email. Missing lookups are simply absent from the map.
 *
 * Fails soft on auth/quota errors — individual failures become absent keys.
 */
export async function lookupContactsByEmail(
  accessToken: string,
  emails: Iterable<string>,
): Promise<Map<string, GooglePeopleMatch>> {
  const unique = Array.from(
    new Set(
      Array.from(emails)
        .map((e) => e?.trim().toLowerCase() ?? "")
        .filter(Boolean),
    ),
  );
  const out = new Map<string, GooglePeopleMatch>();
  if (unique.length === 0) return out;

  let cursor = 0;
  async function worker() {
    while (cursor < unique.length) {
      const idx = cursor++;
      const email = unique[idx];
      try {
        const match = await lookupOne(accessToken, email);
        if (match) out.set(email, match);
      } catch {
        // Swallow — the resolver will fall back to heuristics.
      }
    }
  }
  await Promise.all(
    Array.from({ length: Math.min(CONCURRENCY, unique.length) }, worker),
  );
  if (logVerbose()) {
    console.log(
      `[People API] resolved ${out.size}/${unique.length} attendee emails to names`,
    );
  }
  return out;
}
