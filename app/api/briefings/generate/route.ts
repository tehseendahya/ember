import { NextRequest, NextResponse } from "next/server";
import { requireUserId } from "@/lib/auth";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { fetchCalendarEventsForCurrentUser } from "@/lib/integrations/google-calendar";

const OPENAI_URL = "https://api.openai.com/v1/chat/completions";
const DEFAULT_LOOKBACK_HOURS = 12;

/**
 * Generate a single-line prep note for an upcoming meeting. Uses the contact
 * notes + last interaction as grounding. We deliberately do not web-search
 * here — the goal is to remind the user of what *they* already know about
 * this person, so they walk in warmer.
 */
export async function POST(req: NextRequest) {
  let body: { eventId?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const eventId = body.eventId?.trim();
  if (!eventId) {
    return NextResponse.json({ error: "Missing eventId" }, { status: 400 });
  }

  const now = new Date();
  const from = new Date(now.getTime() - DEFAULT_LOOKBACK_HOURS * 60 * 60 * 1000).toISOString();
  const to = new Date(now.getTime() + 24 * 60 * 60 * 1000).toISOString();
  const events = await fetchCalendarEventsForCurrentUser(from, to);
  if (!events) {
    return NextResponse.json({ error: "Calendar not connected" }, { status: 503 });
  }
  const event = events.find((e) => e.id === eventId);
  if (!event) {
    return NextResponse.json({ error: "Event not found" }, { status: 404 });
  }

  const title = event.summary?.trim() || "Calendar meeting";
  const userId = await requireUserId();
  const supabase = await createSupabaseServerClient();

  type ContactRow = {
    id: string;
    name: string;
    email: string | null;
    company: string | null;
    role: string | null;
    notes: string | null;
  };
  const { data: contactsRaw } = await supabase
    .from("contacts")
    .select("id, name, email, company, role, notes")
    .eq("user_id", userId);
  const contacts: ContactRow[] = (contactsRaw ?? []) as ContactRow[];

  const byEmail = new Map<string, ContactRow>();
  const byName = new Map<string, ContactRow>();
  for (const c of contacts) {
    if (c.email) byEmail.set(c.email.toLowerCase(), c);
    byName.set(c.name.trim().toLowerCase(), c);
  }

  // Pick the first attendee with a matching CRM contact as the primary focus.
  let primary: ContactRow | null = null;
  for (const a of event.attendees ?? []) {
    if (a.self || a.resource) continue;
    const email = (a.email ?? "").trim().toLowerCase();
    const match =
      (email ? byEmail.get(email) : null) ??
      (a.displayName ? byName.get(a.displayName.trim().toLowerCase()) : null);
    if (match) {
      primary = match;
      break;
    }
  }

  if (!primary) {
    return NextResponse.json({ prepLine: null, error: "No CRM contact matched this meeting." });
  }

  // Grab last 5 interactions as grounding.
  const { data: interactions } = await supabase
    .from("interactions")
    .select("type, title, notes, date")
    .eq("user_id", userId)
    .eq("contact_id", primary.id)
    .order("date", { ascending: false })
    .limit(5);

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    // Graceful degradation: build a prep line from raw context.
    const last = interactions?.[0];
    const fallback = last
      ? `Last ${last.type} with ${primary.name} on ${last.date}: ${last.title}.`
      : primary.notes
        ? `You noted: ${primary.notes.slice(0, 140)}`
        : `${primary.name}${primary.role ? `, ${primary.role}` : ""}${primary.company ? ` @ ${primary.company}` : ""}.`;
    return NextResponse.json({ prepLine: fallback, degraded: true });
  }

  const systemPrompt = `You write one-line prep notes for pre-meeting briefings in a personal CRM. The user is walking into a meeting in minutes and wants a quick cue on who this person is and what you last discussed. Be specific, friendly, and useful.

Rules:
- One sentence, max 240 characters.
- No emoji, no filler like "Here is".
- Reference at most two concrete facts (e.g. last meeting, their role, an open question).
- Never invent facts; use only what's in the provided notes/interactions.
- If context is thin, give a direct "First touchpoint with {name}" style line.`;

  const userPrompt = `Meeting: ${title}
Contact: ${primary.name}${primary.role ? `, ${primary.role}` : ""}${primary.company ? ` @ ${primary.company}` : ""}

CRM notes:
${primary.notes?.slice(0, 500) ?? "(none)"}

Recent interactions (most recent first):
${(interactions ?? [])
  .map(
    (i, idx) => `${idx + 1}. ${i.date} — ${i.type}: ${i.title}${i.notes ? ` (${String(i.notes).slice(0, 160)})` : ""}`,
  )
  .join("\n") || "(none)"}

Respond with ONLY the single-line prep note. No markdown, no preface.`;

  try {
    const res = await fetch(OPENAI_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        temperature: 0.3,
        max_tokens: 180,
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt },
        ],
      }),
    });
    if (!res.ok) {
      const err = await res.text();
      return NextResponse.json({ error: `OpenAI error: ${err.slice(0, 200)}` }, { status: 502 });
    }
    const data = await res.json();
    const prepLine = (data.choices?.[0]?.message?.content ?? "").trim();
    return NextResponse.json({ prepLine: prepLine || null, contactId: primary.id });
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
