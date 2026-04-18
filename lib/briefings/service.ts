import "server-only";

import { requireUserId } from "@/lib/auth";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import {
  fetchCalendarEventsForCurrentUser,
  getCalendarAccessTokenForCurrentUser,
  type GoogleCalendarEvent,
} from "@/lib/integrations/google-calendar";
import {
  resolveEventIdentities,
  type CalendarAttendee,
  type GoogleContactsHint,
} from "@/lib/integrations/calendar-identity-resolver";
import { lookupContactsByEmail } from "@/lib/integrations/google-people-api";
import type { MeetingBriefingItem } from "./types";

/**
 * Maximum meetings to surface on the Home briefing card. Beyond this the page
 * becomes visual noise — better to keep it tight.
 */
const MAX_TODAYS_MEETINGS = 8;

function startOfTodayLocal(): Date {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
}

function endOfTodayLocal(): Date {
  const d = new Date();
  d.setHours(23, 59, 59, 999);
  return d;
}

function eventStartDate(event: GoogleCalendarEvent): Date | null {
  const raw = event.start?.dateTime ?? event.start?.date;
  if (!raw) return null;
  const parsed = new Date(raw);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function eventEndDate(event: GoogleCalendarEvent): Date | null {
  const raw = event.end?.dateTime ?? event.end?.date;
  if (!raw) return null;
  const parsed = new Date(raw);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function formatLocalTime(date: Date): string {
  return date.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
}

function isTimedPeopleMeeting(event: GoogleCalendarEvent): boolean {
  if (!event.start?.dateTime) return false;
  const real = (event.attendees ?? []).filter((a) => !a.self && !a.resource);
  return real.length > 0;
}

/**
 * Pull today's meetings from Google Calendar and hydrate them with any context
 * we already have about the primary attendee. This is the data backbone for
 * the flagship pre-meeting briefing card on Home.
 *
 * Returned items are sorted by start time. Each item includes a `briefingStatus`:
 *   - "ready"       — we already have a cached prepLine
 *   - "pending"     — we have enough context to generate one on demand
 *   - "unavailable" — we don't know who they are or have no context
 */
export async function getTodaysMeetingsWithBriefings(): Promise<MeetingBriefingItem[]> {
  const timeMin = startOfTodayLocal().toISOString();
  const timeMax = endOfTodayLocal().toISOString();
  const events = await fetchCalendarEventsForCurrentUser(timeMin, timeMax);
  if (!events || events.length === 0) return [];

  const peopleMeetings = events.filter(isTimedPeopleMeeting);
  if (peopleMeetings.length === 0) return [];

  const now = Date.now();
  // Prefer upcoming first, then any ongoing, then just-ended. Skip meetings
  // that ended more than 2 hours ago — the "how did it go?" prompt belongs
  // on those, but they stop being urgent.
  const twoHoursAgo = now - 2 * 60 * 60 * 1000;
  const relevant = peopleMeetings.filter((e) => {
    const end = eventEndDate(e);
    if (!end) return false;
    return end.getTime() >= twoHoursAgo;
  });
  if (relevant.length === 0) return [];

  relevant.sort((a, b) => {
    const aStart = eventStartDate(a)?.getTime() ?? 0;
    const bStart = eventStartDate(b)?.getTime() ?? 0;
    return aStart - bStart;
  });

  const userId = await requireUserId();
  const supabase = await createSupabaseServerClient();

  // Optional People API hint pass for higher-quality attendee names.
  const uniqueEmails = new Set<string>();
  for (const event of relevant) {
    for (const a of event.attendees ?? []) {
      if (a.self || a.resource) continue;
      const email = (a.email ?? "").trim().toLowerCase();
      if (email) uniqueEmails.add(email);
    }
  }
  const contactsHints = new Map<string, GoogleContactsHint>();
  if (uniqueEmails.size > 0) {
    const accessToken = await getCalendarAccessTokenForCurrentUser();
    if (accessToken) {
      try {
        const matches = await lookupContactsByEmail(accessToken, uniqueEmails);
        for (const [email, match] of matches.entries()) {
          contactsHints.set(email, { displayName: match.displayName, source: match.source });
        }
      } catch {
        // Non-fatal: fall back to heuristic name resolution.
      }
    }
  }

  // Load all user contacts to resolve attendees against the CRM.
  type ContactRow = {
    id: string;
    name: string;
    email: string | null;
    company: string | null;
    role: string | null;
    avatar: string | null;
    avatar_color: string | null;
    notes: string | null;
    connection_strength: number | null;
  };
  const { data: contactsRaw } = await supabase
    .from("contacts")
    .select("id, name, email, company, role, avatar, avatar_color, notes, connection_strength")
    .eq("user_id", userId);
  const contacts: ContactRow[] = (contactsRaw ?? []) as ContactRow[];

  const contactsByEmail = new Map<string, ContactRow>();
  const contactsByName = new Map<string, ContactRow>();
  for (const c of contacts) {
    if (c.email) contactsByEmail.set(c.email.toLowerCase(), c);
    contactsByName.set(c.name.trim().toLowerCase(), c);
  }

  const contactIdsNeeded = new Set<string>();
  const meetingShells: Array<{
    event: GoogleCalendarEvent;
    attendees: MeetingBriefingItem["attendees"];
    primaryContactId: string | null;
    capturedContextSummary?: string;
    title: string;
  }> = [];

  for (const event of relevant) {
    const attendees = event.attendees ?? [];
    const identities = resolveEventIdentities(
      attendees as CalendarAttendee[],
      {
        id: event.id,
        summary: event.summary,
        organizerEmail: event.organizer?.email,
      },
      contactsHints,
    );
    const enriched: MeetingBriefingItem["attendees"] = [];
    let primaryContactId: string | null = null;
    for (const identity of identities) {
      const match =
        (identity.email ? contactsByEmail.get(identity.email) : null) ??
        contactsByName.get(identity.name.trim().toLowerCase()) ??
        null;
      if (match && !primaryContactId) primaryContactId = match.id;
      enriched.push({
        contactId: match?.id ?? null,
        name: match?.name ?? identity.name,
        company: match?.company ?? identity.workDomainCompany ?? undefined,
        role: match?.role ?? undefined,
        avatar: match?.avatar ?? undefined,
        avatarColor: match?.avatar_color ?? undefined,
      });
    }
    if (primaryContactId) contactIdsNeeded.add(primaryContactId);
    meetingShells.push({
      event,
      attendees: enriched,
      primaryContactId,
      title: event.summary?.trim() || "Calendar meeting",
    });
  }

  // Fetch most recent interaction per primary contact, and their notes.
  const lastInteractionByContact = new Map<string, { type: string; title: string; date: string; notes: string | null }>();
  const notesByContact = new Map<string, string>();
  if (contactIdsNeeded.size > 0) {
    const ids = Array.from(contactIdsNeeded);
    const { data: interactions } = await supabase
      .from("interactions")
      .select("contact_id, type, title, date, notes")
      .eq("user_id", userId)
      .in("contact_id", ids)
      .order("date", { ascending: false });
    for (const row of interactions ?? []) {
      if (!lastInteractionByContact.has(row.contact_id)) {
        lastInteractionByContact.set(row.contact_id, {
          type: row.type,
          title: row.title,
          date: row.date,
          notes: row.notes,
        });
      }
    }
    for (const c of contacts) {
      if (contactIdsNeeded.has(c.id) && c.notes) {
        notesByContact.set(c.id, c.notes);
      }
    }
  }

  const output: MeetingBriefingItem[] = [];
  for (const shell of meetingShells.slice(0, MAX_TODAYS_MEETINGS)) {
    const start = eventStartDate(shell.event);
    const end = eventEndDate(shell.event);
    if (!start) continue;
    const hasStarted = start.getTime() <= now;
    const hasEnded = (end?.getTime() ?? start.getTime()) <= now;
    const lastInteraction = shell.primaryContactId
      ? lastInteractionByContact.get(shell.primaryContactId)
      : null;
    const lastInteractionSummary = lastInteraction
      ? `${lastInteraction.type} on ${lastInteraction.date} — ${lastInteraction.title}`
      : undefined;
    const capturedContextSummary = shell.primaryContactId
      ? notesByContact.get(shell.primaryContactId)
      : undefined;
    const hasAnyContext = Boolean(lastInteractionSummary || capturedContextSummary);
    const briefingStatus: MeetingBriefingItem["briefingStatus"] = shell.primaryContactId
      ? hasAnyContext
        ? "pending"
        : "unavailable"
      : "unavailable";
    output.push({
      eventId: shell.event.id,
      startLocal: formatLocalTime(start),
      endLocal: end ? formatLocalTime(end) : null,
      title: shell.title,
      externalUrl: shell.event.htmlLink,
      attendees: shell.attendees,
      primaryContactId: shell.primaryContactId,
      lastInteractionSummary,
      capturedContextSummary:
        capturedContextSummary && capturedContextSummary.length > 240
          ? `${capturedContextSummary.slice(0, 237)}...`
          : capturedContextSummary,
      hasStarted,
      hasEnded,
      briefingStatus,
    });
  }

  return output;
}
