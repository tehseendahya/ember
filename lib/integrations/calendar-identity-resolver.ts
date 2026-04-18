import "server-only";

/**
 * Identity resolution for Google Calendar attendees.
 *
 * The pipeline is: collect every signal, weigh them, and emit a tiered result
 * with the evidence we used. The sync layer then decides whether to create a
 * verified contact, a `needs_verification` contact, or skip entirely.
 *
 * Design rule: never invent a person. If signals conflict or are too weak, we
 * either mark the contact for human review or skip it.
 */

export interface CalendarAttendee {
  email?: string;
  displayName?: string;
  self?: boolean;
  organizer?: boolean;
  resource?: boolean;
  responseStatus?: string;
}

export interface CalendarEventMeta {
  id: string;
  summary?: string;
  organizerEmail?: string;
  /** Total non-self, non-resource attendees — helps with 1:1 vs group heuristics. */
  attendeeCount?: number;
}

export type IdentityConfidence =
  | "verified" // we are confident in both the name and that this is a real person
  | "likely" // probable person, worth creating a contact but flag for user review
  | "needs_review" // ambiguous — create contact with needs_verification=true
  | "skip"; // clearly not a useful contact (bot, resource, no usable signal)

export type NameSource =
  | "displayName"
  | "googleContacts" // name came from the viewer's Google Contacts via People API
  | "emailLocal" // e.g. "karan.gupta@duke.edu" → "Karan Gupta"
  | "emailLocalPlusTitle" // email handle opaque, but title hints at a single-name match
  | "titleOnly" // only the event title gave us a name (weak)
  | "none";

export type GoogleContactsSource = "savedContact" | "otherContact";

export interface GoogleContactsHint {
  /** Full display name as Google knows it (e.g. "Alexander Kvamme"). */
  displayName: string;
  /** Whether this came from the user's saved contacts or "other contacts" cache. */
  source: GoogleContactsSource;
}

export interface IdentityEvidence {
  primaryNameSource: NameSource;
  displayName: string | null;
  /** Name from Google People API (otherContacts/searchContacts), if resolved. */
  googleContactsName: string | null;
  googleContactsSource: GoogleContactsSource | null;
  emailLocalName: string | null;
  titleHintName: string | null;
  email: string | null;
  emailIsPersonalProvider: boolean;
  workDomainCompany: string | null;
  eventSummary: string | null;
  attendeeCount: number | null;
  reason: string;
}

export interface ResolvedIdentity {
  confidence: IdentityConfidence;
  /** The name we picked (empty when confidence=skip or there is truly no name). */
  name: string;
  /** Email lowercased, or null if the attendee had none. */
  email: string | null;
  /** Company derived from the email's domain (empty for personal providers). */
  workDomainCompany: string;
  evidence: IdentityEvidence;
}

const PERSONAL_PROVIDERS = new Set([
  "gmail.com",
  "googlemail.com",
  "outlook.com",
  "hotmail.com",
  "yahoo.com",
  "icloud.com",
  "me.com",
  "mac.com",
  "proton.me",
  "protonmail.com",
  "aol.com",
  "live.com",
  "msn.com",
  "pm.me",
]);

const ROLE_LIKE_EMAIL_LOCAL = /^(no-?reply|notifications?|calendar|team|support|help|info|hello|admin|billing|security|office|events?|press|contact|sales|hr|people|careers|jobs|noc|ops|dev|root|webmaster|postmaster|abuse)(\d*|[-_.].*)?$/i;

const BLOCKED_DISPLAY_NAME_RX = /(birthday|holiday|ooo|out of office|focus time|gym|workout|commute|travel|dentist|doctor|flight|pickup|dropoff|standup|retro|planning|all hands|town hall|resource|room|conference|webinar|meeting room)/i;

const MEETING_PREFIX_RX = /^(catch-?up|call|meeting|sync|chat|intro|coffee|lunch|dinner|standup|1:1)\s+/i;

export function isPersonalEmailProvider(email: string | null | undefined): boolean {
  if (!email) return false;
  const domain = email.split("@")[1]?.toLowerCase().trim();
  if (!domain) return false;
  return PERSONAL_PROVIDERS.has(domain);
}

export function companyFromWorkEmailDomain(email: string | null | undefined): string {
  if (!email) return "";
  const domain = email.split("@")[1]?.toLowerCase().trim() ?? "";
  if (!domain) return "";
  if (PERSONAL_PROVIDERS.has(domain)) return "";
  // .edu → use the institution name (e.g. duke.edu → "Duke")
  const parts = domain.split(".");
  const base = parts[0] ?? "";
  if (!base) return "";
  return base
    .split(/[-_]/g)
    .filter(Boolean)
    .map((p) => p.slice(0, 1).toUpperCase() + p.slice(1))
    .join(" ");
}

function titleCase(value: string): string {
  return value
    .split(/\s+/)
    .filter(Boolean)
    .map((p) => p.slice(0, 1).toUpperCase() + p.slice(1).toLowerCase())
    .join(" ");
}

function stripMeetingPrefix(value: string): string {
  return value.replace(MEETING_PREFIX_RX, "").trim();
}

function normalize(value: string): string {
  return value
    .replace(/[()[\]{}]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Looks like a real "First Last" (optionally "First M Last"). Conservative:
 * rejects single tokens unless `allowSingle` is true; rejects tokens with digits;
 * rejects obvious company/event phrases.
 */
function looksLikePersonName(raw: string, opts: { allowSingle?: boolean } = {}): boolean {
  const value = stripMeetingPrefix(normalize(raw));
  if (!value) return false;
  if (value.length < 2 || value.length > 60) return false;
  if (/@/.test(value)) return false;
  if (BLOCKED_DISPLAY_NAME_RX.test(value)) return false;
  if (/\b(inc|llc|ltd|corp|company|labs|technologies|partners|capital|ventures|foundation)\b/i.test(value)) return false;
  const parts = value.split(/\s+/).filter(Boolean);
  if (parts.length === 0) return false;
  if (!opts.allowSingle && parts.length < 2) return false;
  if (parts.length > 4) return false;
  return parts.every((p) => /^[A-Za-z][A-Za-z.'-]*$/.test(p));
}

/**
 * Decompose an email local-part into a candidate full name.
 * "karan.gupta" → "Karan Gupta" (strong: has a separator)
 * "ryan"        → "Ryan" (weak: single token)
 * "apfk88"      → ""     (opaque handle, no usable signal)
 * "kvamme"      → "Kvamme" (weak: single alphabetic token)
 * "alex.j"      → "Alex J" (weak: one-letter second token)
 */
function nameFromEmailLocal(email: string): { name: string; strong: boolean } {
  const local = (email.split("@")[0] ?? "").trim();
  if (!local) return { name: "", strong: false };
  if (ROLE_LIKE_EMAIL_LOCAL.test(local)) return { name: "", strong: false };
  if (/\d/.test(local) && !/[._-]/.test(local)) return { name: "", strong: false };

  // Drop trailing numeric suffix (ryan.johnson12 → ryan.johnson)
  const deSuffixed = local.replace(/[.-_]*\d+$/, "");
  const tokens = deSuffixed
    .split(/[._-]+/)
    .map((t) => t.replace(/\d/g, ""))
    .filter((t) => t.length > 0);
  if (tokens.length === 0) return { name: "", strong: false };
  if (tokens.length === 1) {
    // Single-token local part ("ryan", "kvamme") — weak at best.
    if (tokens[0].length < 3) return { name: "", strong: false };
    return { name: titleCase(tokens[0]), strong: false };
  }
  // Multi-token with separator → strong.
  const recomposed = tokens.map((t) => t.toLowerCase()).join(" ");
  if (!looksLikePersonName(recomposed, { allowSingle: false })) {
    return { name: "", strong: false };
  }
  return { name: titleCase(recomposed), strong: true };
}

/**
 * Parse a candidate name from an event title. Only handles clear patterns:
 * "Zoom | Tehseen + Alex", "1:1 with Jordan", "Coffee Jordan Lee".
 * Returns "" when the title is generic ("Team sync", "Planning").
 */
export function extractNameFromEventTitle(summary: string): { name: string; isGivenNameOnly: boolean } {
  const norm = summary.replace(/[-–:|]/g, " ").replace(/\s+/g, " ").trim();
  if (!norm) return { name: "", isGivenNameOnly: false };

  // "X + Y" pattern → second token is typically the guest.
  const plus = norm.match(/\S+\s*\+\s*([A-Za-z][A-Za-z.'-]*(?:\s+[A-Za-z][A-Za-z.'-]*){0,2})\b/);
  if (plus?.[1]) {
    const candidate = stripMeetingPrefix(normalize(plus[1]));
    if (looksLikePersonName(candidate, { allowSingle: true })) {
      const titled = titleCase(candidate);
      return { name: titled, isGivenNameOnly: titled.split(/\s+/).length < 2 };
    }
  }

  // "with/w/ NAME" pattern.
  const withPattern = norm.match(/\b(?:with|w\/)\s+([A-Za-z][A-Za-z.'-]*(?:\s+[A-Za-z][A-Za-z.'-]*){0,2})\b/i);
  if (withPattern?.[1]) {
    const candidate = stripMeetingPrefix(normalize(withPattern[1]));
    if (looksLikePersonName(candidate, { allowSingle: true })) {
      const titled = titleCase(candidate);
      return { name: titled, isGivenNameOnly: titled.split(/\s+/).length < 2 };
    }
  }

  // Known meeting prefixes followed by a name: "coffee Jordan Lee", "1:1 Sam".
  const prefixPattern = norm.match(/^(?:catch-?up|call|meeting|sync|chat|intro|coffee|lunch|dinner|standup|1:1|zoom)\s+([A-Za-z][A-Za-z.'-]*(?:\s+[A-Za-z][A-Za-z.'-]*){0,2})\b/i);
  if (prefixPattern?.[1]) {
    const candidate = stripMeetingPrefix(normalize(prefixPattern[1]));
    if (looksLikePersonName(candidate, { allowSingle: true })) {
      const titled = titleCase(candidate);
      return { name: titled, isGivenNameOnly: titled.split(/\s+/).length < 2 };
    }
  }

  return { name: "", isGivenNameOnly: false };
}

function isBotOrGroupEmail(email: string): boolean {
  if (!email) return false;
  if (/@(group\.calendar\.google\.com|resource\.calendar\.google\.com|import\.calendar\.google\.com|.*\.calendar\.google\.com)$/i.test(email)) {
    return true;
  }
  const local = email.split("@")[0] ?? "";
  return ROLE_LIKE_EMAIL_LOCAL.test(local);
}

/**
 * Main resolver. Collects all available signals for one attendee and returns
 * a confidence tier + the evidence used. Callers should:
 *   - `verified` → create/update the CRM contact normally
 *   - `likely`   → create contact, mark needs_verification=true (soft flag)
 *   - `needs_review` → create contact, needs_verification=true, surface candidates
 *   - `skip`     → do not create a contact; optionally create a bare reminder
 */
export function resolveAttendeeIdentity(
  attendee: CalendarAttendee,
  event: CalendarEventMeta,
  contactsHint?: GoogleContactsHint | null,
): ResolvedIdentity {
  const email = (attendee.email ?? "").trim().toLowerCase() || null;
  const rawDisplayName = (attendee.displayName ?? "").trim();
  const displayName = rawDisplayName ? normalize(rawDisplayName) : "";
  const summary = event.summary?.trim() ?? "";
  const workDomainCompany = companyFromWorkEmailDomain(email);
  const emailPersonal = isPersonalEmailProvider(email);

  const contactsName = contactsHint?.displayName
    ? normalize(contactsHint.displayName)
    : "";
  const contactsSource = contactsHint?.source ?? null;

  const base: IdentityEvidence = {
    primaryNameSource: "none",
    displayName: displayName || null,
    googleContactsName: contactsName || null,
    googleContactsSource: contactsSource,
    emailLocalName: null,
    titleHintName: null,
    email,
    emailIsPersonalProvider: emailPersonal,
    workDomainCompany: workDomainCompany || null,
    eventSummary: summary || null,
    attendeeCount: event.attendeeCount ?? null,
    reason: "",
  };

  // --- Hard skips ---
  if (attendee.self || attendee.resource) {
    return {
      confidence: "skip",
      name: "",
      email,
      workDomainCompany,
      evidence: { ...base, reason: attendee.self ? "self" : "resource/room" },
    };
  }
  if (email && isBotOrGroupEmail(email)) {
    return {
      confidence: "skip",
      name: "",
      email,
      workDomainCompany,
      evidence: { ...base, reason: "role/bot/group email" },
    };
  }

  // --- Signal collection ---
  const displayLooksFull = looksLikePersonName(displayName, { allowSingle: false });
  const displayLooksAtLeastSingle = looksLikePersonName(displayName, { allowSingle: true });
  const emailLocalParse = email ? nameFromEmailLocal(email) : { name: "", strong: false };
  const titleHint = summary ? extractNameFromEventTitle(summary) : { name: "", isGivenNameOnly: false };

  const evidence: IdentityEvidence = {
    ...base,
    emailLocalName: emailLocalParse.name || null,
    titleHintName: titleHint.name || null,
  };

  // --- Tier A: verified -----------------------------------------------------
  // Google Contacts hit (saved or "other") — this is what the Calendar web UI
  // renders for the attendee, so it's the highest-trust signal. We prefer it
  // over the raw displayName because displayName is frequently absent or a
  // single given name (e.g. "Alex"), whereas the Contacts entry is "Alexander
  // Kvamme". A saved contact is always verified; an "other contact" is
  // verified only when it's a proper full name (guards against autosaved
  // self-name edge cases).
  const contactsLooksFull = contactsName
    ? looksLikePersonName(contactsName, { allowSingle: false })
    : false;
  if (contactsName && (contactsSource === "savedContact" || contactsLooksFull)) {
    return {
      confidence: "verified",
      name: titleCase(contactsName),
      email,
      workDomainCompany,
      evidence: {
        ...evidence,
        primaryNameSource: "googleContacts",
        reason:
          contactsSource === "savedContact"
            ? "name from user's saved Google Contacts"
            : "name from user's Google 'Other contacts' (autosaved)",
      },
    };
  }

  // Strong display name (First Last) — always trusted.
  if (displayLooksFull) {
    return {
      confidence: "verified",
      name: titleCase(displayName),
      email,
      workDomainCompany,
      evidence: { ...evidence, primaryNameSource: "displayName", reason: "displayName is a full name" },
    };
  }

  // Email local with dot-separated full name ("karan.gupta@duke.edu").
  if (emailLocalParse.strong) {
    // Cross-check: if the display name is a single token that matches the first
    // token of the email-derived name, use the email-derived full name.
    return {
      confidence: "verified",
      name: emailLocalParse.name,
      email,
      workDomainCompany,
      evidence: { ...evidence, primaryNameSource: "emailLocal", reason: "email local decomposes to First Last" },
    };
  }

  // --- Tier B: likely -------------------------------------------------------
  // Single-token display name matches the title hint (e.g. displayName "Alex",
  // title "Zoom | Tehseen + Alex"): we know at least the given name, but not
  // the surname. If work domain is known we can still build a useful contact.
  if (displayLooksAtLeastSingle && titleHint.name) {
    const dn = displayName.toLowerCase();
    const ht = titleHint.name.toLowerCase();
    if (dn === ht || ht.startsWith(dn + " ") || dn === ht.split(" ")[0]) {
      const name = titleHint.name.split(/\s+/).length >= 2 ? titleHint.name : titleCase(displayName);
      return {
        confidence: "likely",
        name,
        email,
        workDomainCompany,
        evidence: {
          ...evidence,
          primaryNameSource: "emailLocalPlusTitle",
          reason: "displayName (single token) agrees with title hint",
        },
      };
    }
  }

  // Weak email local (single token like "kvamme") + 1:1 style event with few
  // attendees → probable but needs review.
  if (emailLocalParse.name && !emailLocalParse.strong && (event.attendeeCount ?? 0) <= 2) {
    return {
      confidence: "needs_review",
      name: emailLocalParse.name,
      email,
      workDomainCompany,
      evidence: {
        ...evidence,
        primaryNameSource: "emailLocal",
        reason: "single-token email local; surname unknown",
      },
    };
  }

  // Title-only hint with a human-looking email (e.g. "apfk88@gmail.com" +
  // "Zoom | Tehseen + Alex"). The classic case: we know a meeting happened
  // with this email, but we don't know for sure this is "Alex Smith" vs some
  // other person the email belongs to. Needs review.
  if (email && titleHint.name && !displayName) {
    return {
      confidence: "needs_review",
      name: titleHint.name,
      email,
      workDomainCompany,
      evidence: {
        ...evidence,
        primaryNameSource: "titleOnly",
        reason: titleHint.isGivenNameOnly
          ? "only a given name from event title; email local is opaque"
          : "name parsed from event title; email local is opaque",
      },
    };
  }

  // Email only, no name signal at all → use the email itself as the display
  // name placeholder and flag for review.
  if (email && !displayName && !titleHint.name && !emailLocalParse.name) {
    const fallbackLabel = email.split("@")[0] ?? email;
    return {
      confidence: "needs_review",
      name: titleCase(fallbackLabel.replace(/[._-]+/g, " ")),
      email,
      workDomainCompany,
      evidence: {
        ...evidence,
        primaryNameSource: "emailLocal",
        reason: "opaque email local; no display name or title hint",
      },
    };
  }

  // --- Skip ---
  return {
    confidence: "skip",
    name: "",
    email,
    workDomainCompany,
    evidence: { ...evidence, reason: "insufficient signal" },
  };
}

/**
 * Walk all attendees of an event, return only identities that produced a
 * useful result. De-dupes by email (if present) or by lowercased name.
 *
 * `contactsHints` is an optional Map<lowercased-email, GoogleContactsHint>
 * produced by `lookupContactsByEmail()` for this sync run. When provided, the
 * resolver uses it as a high-trust name source.
 */
export function resolveEventIdentities(
  attendees: CalendarAttendee[] | undefined,
  event: CalendarEventMeta,
  contactsHints?: Map<string, GoogleContactsHint>,
): ResolvedIdentity[] {
  const out: ResolvedIdentity[] = [];
  const seenEmail = new Set<string>();
  const seenName = new Set<string>();
  const meaningful = (attendees ?? []).filter((a) => !a.self && !a.resource);
  const attendeeCount = meaningful.length;
  for (const a of meaningful) {
    const emailKey = (a.email ?? "").trim().toLowerCase();
    const hint = emailKey && contactsHints ? contactsHints.get(emailKey) ?? null : null;
    const id = resolveAttendeeIdentity(a, { ...event, attendeeCount }, hint);
    if (id.confidence === "skip") continue;
    const key = id.email ?? id.name.toLowerCase();
    if (!key) continue;
    if (id.email) {
      if (seenEmail.has(id.email)) continue;
      seenEmail.add(id.email);
    }
    if (!id.email) {
      const nk = id.name.toLowerCase();
      if (seenName.has(nk)) continue;
      seenName.add(nk);
    }
    out.push(id);
  }
  return out;
}
