import { NextRequest, NextResponse } from "next/server";
import { getContacts, getProfileContext } from "@/lib/data";
import { compactProfileContext } from "@/lib/profile-context";
import type { Contact } from "@/lib/types";
import { contactToSearchCandidate, recallContacts } from "@/lib/search/network-recall";

const MAX_QUERY = 500;
const RECALL_LIMIT = 40;
const MAX_RESULTS = 10;

const OPENAI_URL = "https://api.openai.com/v1/chat/completions";

type RankedItem = { contactId: string; relevance: number; reason: string };

function fallbackRank(candidates: Contact[], query: string): RankedItem[] {
  return candidates.slice(0, MAX_RESULTS).map((c) => ({
    contactId: c.id,
    relevance: Math.min(95, 60 + c.connectionStrength * 5),
    reason: `${c.name} (${c.role} @ ${c.company}) matches your search for "${query.slice(0, 80)}${query.length > 80 ? "…" : ""}"`,
  }));
}

export async function POST(req: NextRequest) {
  let body: { query?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const query = typeof body.query === "string" ? body.query.trim() : "";
  if (!query) {
    return NextResponse.json({ error: "Missing query" }, { status: 400 });
  }
  if (query.length > MAX_QUERY) {
    return NextResponse.json({ error: "Query too long" }, { status: 400 });
  }

  const apiKey = process.env.OPENAI_API_KEY;
  const [contacts, profileRaw] = await Promise.all([getContacts(), getProfileContext()]);
  const profileBlurb = compactProfileContext(profileRaw, 700);
  const candidates = recallContacts(contacts, query, RECALL_LIMIT);

  if (candidates.length === 0) {
    return NextResponse.json({ results: [] });
  }

  if (!apiKey) {
    const ranked = fallbackRank(candidates, query);
    const byId = new Map(contacts.map((c) => [c.id, c]));
    const results = ranked
      .map((r) => {
        const c = byId.get(r.contactId);
        if (!c) return null;
        return { contact: c, relevance: r.relevance, reason: r.reason };
      })
      .filter(Boolean);
    return NextResponse.json({ results, degraded: true as const });
  }

  const candidatePayload = candidates.map(contactToSearchCandidate);

  const systemPrompt = `You are a precise search ranker for a personal CRM. The user searches with natural language; you must rank only the provided candidates.

Rules:
- Return ONLY contact IDs that appear in the candidates list.
- Order by relevance (most relevant first).
- relevance is 0–100 (integer). Only include people with relevance >= 35 who truly fit the user's intent.
- reason: one concise sentence (max 220 chars) explaining why this person fits the query, using facts from the candidate fields.
- When the query is vague or could mean several things, use the optional "CRM owner profile" (if provided) as a tie-breaker for what the user likely cares about — do not invent facts about candidates from it.
- If no one fits well, return an empty ranked array.
- Maximum ${MAX_RESULTS} entries.`;

  const userPrompt = `User search query: ${query}
${profileBlurb ? `\nCRM owner profile (tie-breaker for intent only):\n${profileBlurb}\n` : ""}
Candidates (JSON):
${JSON.stringify(candidatePayload, null, 0)}

Respond with ONLY valid JSON (no markdown, no commentary):
{"ranked":[{"contactId":"...","relevance":87,"reason":"..."}]}`;

  try {
    const response = await fetch(OPENAI_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt },
        ],
        temperature: 0.15,
        max_tokens: 2000,
        response_format: { type: "json_object" },
      }),
    });

    if (!response.ok) {
      const err = await response.text();
      const ranked = fallbackRank(candidates, query);
      const byId = new Map(contacts.map((c) => [c.id, c]));
      return NextResponse.json({
        results: ranked
          .map((r) => {
            const c = byId.get(r.contactId);
            if (!c) return null;
            return { contact: c, relevance: r.relevance, reason: r.reason };
          })
          .filter(Boolean),
        degraded: true as const,
        warning: `OpenAI error: ${err.slice(0, 200)}`,
      });
    }

    const data = await response.json();
    const raw = data.choices?.[0]?.message?.content ?? "{}";
    let parsed: { ranked?: RankedItem[] };
    try {
      parsed = JSON.parse(raw);
    } catch {
      const ranked = fallbackRank(candidates, query);
      const byId = new Map(contacts.map((c) => [c.id, c]));
      return NextResponse.json({
        results: ranked
          .map((r) => {
            const c = byId.get(r.contactId);
            if (!c) return null;
            return { contact: c, relevance: r.relevance, reason: r.reason };
          })
          .filter(Boolean),
        degraded: true as const,
      });
    }

    const allowed = new Set(candidates.map((c) => c.id));
    const ranked = (parsed.ranked ?? [])
      .filter((r) => r && typeof r.contactId === "string" && allowed.has(r.contactId))
      .slice(0, MAX_RESULTS);

    if (ranked.length === 0) {
      return NextResponse.json({ results: [] });
    }

    const byId = new Map(contacts.map((c) => [c.id, c]));
    const results = ranked
      .map((r) => {
        const c = byId.get(r.contactId);
        if (!c) return null;
        const rel = Math.min(100, Math.max(0, Math.round(Number(r.relevance) || 0)));
        const reason =
          typeof r.reason === "string" && r.reason.trim() ? r.reason.trim().slice(0, 280) : "Relevant to your search.";
        return { contact: c, relevance: rel, reason };
      })
      .filter(Boolean);

    return NextResponse.json({ results });
  } catch {
    const ranked = fallbackRank(candidates, query);
    const byId = new Map(contacts.map((c) => [c.id, c]));
    return NextResponse.json({
      results: ranked
        .map((r) => {
          const c = byId.get(r.contactId);
          if (!c) return null;
          return { contact: c, relevance: r.relevance, reason: r.reason };
        })
        .filter(Boolean),
      degraded: true as const,
    });
  }
}
