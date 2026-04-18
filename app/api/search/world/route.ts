import { NextRequest, NextResponse } from "next/server";
import { getContacts, getProfileContext, getSecondDegreeEdges } from "@/lib/data";
import { compactProfileContext } from "@/lib/profile-context";
import type { WorldSearchResult } from "@/lib/types";
import { enrichWorldResultsWithIntroducers } from "@/lib/network/ranking";
import { colorFromString, initialsFromName } from "@/lib/search/avatar";

const MAX_QUERY = 500;
const EXA_URL = "https://api.exa.ai/search";
const OPENAI_URL = "https://api.openai.com/v1/chat/completions";
const NUM_RESULTS = 8;

interface ExaHit {
  url: string;
  title?: string;
  highlights?: string[];
  text?: string;
}

function simpleHash(s: string): string {
  let h = 0;
  for (let i = 0; i < s.length; i++) {
    h = (h * 31 + s.charCodeAt(i)) >>> 0;
  }
  return h.toString(36);
}

function excerptFromHit(hit: ExaHit): string {
  if (hit.highlights?.length) return hit.highlights.join(" ").slice(0, 1200);
  if (hit.text) return hit.text.slice(0, 1200);
  return hit.title ?? "";
}

async function attachIntroducers(rows: WorldSearchResult[], searchQuery: string): Promise<WorldSearchResult[]> {
  const [contacts, edges] = await Promise.all([getContacts(), getSecondDegreeEdges()]);
  return enrichWorldResultsWithIntroducers(rows, contacts, edges, searchQuery);
}

function heuristicWorldResults(hits: ExaHit[]): WorldSearchResult[] {
  return hits.map((hit, i) => {
    const title = hit.title?.trim() || "Unknown";
    const parts = title.split(/\s*[-–—|]\s*/).map((p) => p.trim());
    const name = parts[0] || title;
    const rest = parts.slice(1).join(" · ") || "—";
    const excerpt = excerptFromHit(hit);
    return {
      id: `w-${i}-${simpleHash(hit.url)}`,
      name: name.slice(0, 120),
      role: rest.slice(0, 80),
      company: "",
      avatar: initialsFromName(name),
      avatarColor: colorFromString(hit.url + name),
      relevance: Math.max(55, 92 - i * 5),
      reason: excerpt.slice(0, 220) || `Match from web: ${title.slice(0, 100)}`,
      sourceUrl: hit.url,
      snippet: excerpt || undefined,
    };
  });
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

  const exaKey = process.env.EXA_API_KEY;
  if (!exaKey) {
    return NextResponse.json(
      { error: "EXA_API_KEY is not configured. Add it to your environment." },
      { status: 503 },
    );
  }

  const exaRes = await fetch(EXA_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": exaKey,
    },
    body: JSON.stringify({
      query,
      category: "people",
      type: "auto",
      num_results: NUM_RESULTS,
      contents: {
        highlights: { max_characters: 4000 },
      },
    }),
  });

  if (!exaRes.ok) {
    const errText = await exaRes.text();
    return NextResponse.json(
      { error: `Exa search failed: ${errText.slice(0, 300)}` },
      { status: 502 },
    );
  }

  const exaJson = (await exaRes.json()) as { results?: ExaHit[] };
  const hits = exaJson.results ?? [];
  if (hits.length === 0) {
    return NextResponse.json({ results: [] as WorldSearchResult[] });
  }

  const openaiKey = process.env.OPENAI_API_KEY;
  if (!openaiKey) {
    return NextResponse.json({
      results: await attachIntroducers(heuristicWorldResults(hits), query),
      degraded: true as const,
      warning: "OPENAI_API_KEY not set; using heuristic formatting only.",
    });
  }

  let profileBlurb = "";
  try {
    profileBlurb = compactProfileContext(await getProfileContext(), 700);
  } catch {
    profileBlurb = "";
  }

  const compact = hits.map((hit, resultIndex) => ({
    resultIndex,
    title: hit.title ?? "",
    url: hit.url,
    excerpt: excerptFromHit(hit),
  }));

  const systemPrompt = `You help format web search hits into a CRM "discover people" list. You must ONLY use facts supported by each result's title and excerpt. If role or company is unclear, use "Unknown" or a short best-effort label from the excerpt. Do not invent employers or bios.

When the query is ambiguous, you may use the optional "CRM owner profile" only to interpret what kind of people the user likely wants — still ground every person field in the excerpts/titles.

Respond with JSON only:
{"people":[{"resultIndex":0,"name":"...","role":"...","company":"...","relevance":0-100,"reason":"one short sentence why they match the user's query"}]}

Include at most ${hits.length} people. Use each resultIndex at most once. Skip weak matches. relevance should reflect fit to the user's query.`;

  const userPrompt = `User query: ${query}
${profileBlurb ? `\nCRM owner profile (intent only; do not fabricate facts about results):\n${profileBlurb}\n` : ""}
Search results (JSON):
${JSON.stringify(compact, null, 0)}`;

  try {
    const response = await fetch(OPENAI_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${openaiKey}`,
      },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt },
        ],
        temperature: 0.2,
        max_tokens: 2500,
        response_format: { type: "json_object" },
      }),
    });

    if (!response.ok) {
      return NextResponse.json({
        results: await attachIntroducers(heuristicWorldResults(hits), query),
        degraded: true as const,
        warning: (await response.text()).slice(0, 200),
      });
    }

    const data = await response.json();
    const raw = data.choices?.[0]?.message?.content ?? "{}";
    let parsed: {
      people?: Array<{
        resultIndex: number;
        name: string;
        role?: string;
        company?: string;
        relevance: number;
        reason: string;
      }>;
    };
    try {
      parsed = JSON.parse(raw);
    } catch {
      return NextResponse.json({
        results: await attachIntroducers(heuristicWorldResults(hits), query),
        degraded: true as const,
      });
    }

    const people = parsed.people ?? [];
    const out: WorldSearchResult[] = [];

    for (const p of people) {
      const idx = Number(p.resultIndex);
      if (!Number.isInteger(idx) || idx < 0 || idx >= hits.length) continue;
      const hit = hits[idx];
      const name = typeof p.name === "string" && p.name.trim() ? p.name.trim().slice(0, 120) : (hit.title ?? "Unknown").slice(0, 120);
      const role = typeof p.role === "string" ? p.role.trim().slice(0, 120) : "Unknown";
      const company = typeof p.company === "string" ? p.company.trim().slice(0, 120) : "Unknown";
      const relevance = Math.min(100, Math.max(0, Math.round(Number(p.relevance) || 70)));
      const reason =
        typeof p.reason === "string" && p.reason.trim()
          ? p.reason.trim().slice(0, 280)
          : excerptFromHit(hit).slice(0, 220);

      out.push({
        id: `w-${idx}-${simpleHash(hit.url)}`,
        name,
        role,
        company,
        avatar: initialsFromName(name),
        avatarColor: colorFromString(hit.url + name),
        relevance,
        reason,
        sourceUrl: hit.url,
        snippet: excerptFromHit(hit).slice(0, 400) || undefined,
      });
    }

    if (out.length === 0) {
      return NextResponse.json({
        results: await attachIntroducers(heuristicWorldResults(hits), query),
        degraded: true as const,
      });
    }

    return NextResponse.json({ results: await attachIntroducers(out, query) });
  } catch {
    return NextResponse.json({
      results: await attachIntroducers(heuristicWorldResults(hits), query),
      degraded: true as const,
    });
  }
}
