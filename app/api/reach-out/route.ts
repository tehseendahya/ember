import { NextRequest, NextResponse } from "next/server";
import type { ReachOutRecommendation } from "@/lib/types";
import {
  getProfileContext,
  getReachOutRecommendation,
  setReachOutRecommendation,
} from "@/lib/data";

const EXA_URL = "https://api.exa.ai/search";
const OPENAI_URL = "https://api.openai.com/v1/chat/completions";

interface ExaHit {
  url: string;
  title?: string;
  highlights?: string[];
  text?: string;
}

function todayISO(): string {
  return new Date().toISOString().slice(0, 10);
}

function excerptFromHit(hit: ExaHit): string {
  if (hit.highlights?.length) return hit.highlights.join(" ").slice(0, 700);
  if (hit.text) return hit.text.slice(0, 700);
  return hit.title ?? "";
}

function toFallbackRecommendation(hit: ExaHit, query: string): ReachOutRecommendation {
  const title = hit.title?.trim() || "Potential contact";
  const [name, rolePart] = title.split(/\s*[-–—|]\s*/);
  return {
    generatedForDate: todayISO(),
    generatedAt: new Date().toISOString(),
    source: "exa",
    query,
    person: {
      name: (name || title).slice(0, 120),
      role: rolePart?.slice(0, 120) || "Unknown role",
      company: "Unknown company",
      reason: excerptFromHit(hit).slice(0, 240) || "Relevant person based on your profile context.",
      sourceUrl: hit.url,
      snippet: excerptFromHit(hit).slice(0, 300) || undefined,
    },
  };
}

async function generateRecommendation(profileContext: string): Promise<ReachOutRecommendation> {
  const exaKey = process.env.EXA_API_KEY;
  if (!exaKey) {
    throw new Error("EXA_API_KEY is not configured.");
  }

  const contextCompact = profileContext.replace(/\s+/g, " ").slice(0, 1200);
  const query = `Best person I should reach out to this week given this profile: ${contextCompact}`;
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
      num_results: 8,
      contents: {
        highlights: { max_characters: 2400 },
      },
    }),
  });

  if (!exaRes.ok) {
    throw new Error(`Exa failed with status ${exaRes.status}`);
  }

  const exaJson = (await exaRes.json()) as { results?: ExaHit[] };
  const hits = exaJson.results ?? [];
  if (hits.length === 0) {
    throw new Error("Exa returned no people for this profile context.");
  }

  const openaiKey = process.env.OPENAI_API_KEY;
  if (!openaiKey) return toFallbackRecommendation(hits[0] as ExaHit, query);

  const compactHits = hits.map((hit, idx) => ({
    idx,
    title: hit.title ?? "",
    url: hit.url,
    excerpt: excerptFromHit(hit),
  }));

  const systemPrompt = `You select exactly one best networking outreach target from Exa people search results.
Use ONLY provided evidence.
Return strict JSON:
{"pick":{"idx":0,"name":"...","role":"...","company":"...","reason":"1-2 sentences with specific why-now outreach rationale based on the user profile context."}}`;

  const userPrompt = `User profile context:\n${contextCompact}\n\nCandidates:\n${JSON.stringify(compactHits)}`;
  const openaiRes = await fetch(OPENAI_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${openaiKey}`,
    },
    body: JSON.stringify({
      model: "gpt-4o-mini",
      temperature: 0.2,
      max_tokens: 500,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
    }),
  });

  if (!openaiRes.ok) return toFallbackRecommendation(hits[0] as ExaHit, query);
  const data = await openaiRes.json();
  const raw = data.choices?.[0]?.message?.content ?? "{}";
  let parsed: {
    pick?: { idx: number; name?: string; role?: string; company?: string; reason?: string };
  } = {};
  try {
    parsed = JSON.parse(raw);
  } catch {
    return toFallbackRecommendation(hits[0] as ExaHit, query);
  }

  const chosenIdx = Number(parsed.pick?.idx ?? 0);
  const hit = hits[Math.min(Math.max(chosenIdx, 0), hits.length - 1)] as ExaHit;

  return {
    generatedForDate: todayISO(),
    generatedAt: new Date().toISOString(),
    source: "exa",
    query,
    person: {
      name: parsed.pick?.name?.trim()?.slice(0, 120) || hit.title?.slice(0, 120) || "Potential contact",
      role: parsed.pick?.role?.trim()?.slice(0, 120) || "Unknown role",
      company: parsed.pick?.company?.trim()?.slice(0, 120) || "Unknown company",
      reason: parsed.pick?.reason?.trim()?.slice(0, 320) || excerptFromHit(hit).slice(0, 240),
      sourceUrl: hit.url,
      snippet: excerptFromHit(hit).slice(0, 300) || undefined,
    },
  };
}

export async function GET() {
  const [profileContext, cached] = await Promise.all([getProfileContext(), getReachOutRecommendation()]);
  return NextResponse.json({
    profileContextConfigured: profileContext.trim().length > 0,
    recommendation: cached,
  });
}

export async function POST(req: NextRequest) {
  let body: { forceRefresh?: boolean } = {};
  try {
    body = await req.json();
  } catch {
    // allow empty body
  }

  const forceRefresh = body.forceRefresh === true;
  const [profileContext, cached] = await Promise.all([getProfileContext(), getReachOutRecommendation()]);
  if (!profileContext.trim()) {
    return NextResponse.json(
      { error: "Add your profile context in Settings before generating recommendations." },
      { status: 400 },
    );
  }

  const today = todayISO();
  if (!forceRefresh && cached && cached.generatedForDate === today) {
    return NextResponse.json({ recommendation: cached, cached: true as const });
  }

  try {
    const recommendation = await generateRecommendation(profileContext);
    await setReachOutRecommendation(recommendation);
    return NextResponse.json({ recommendation, cached: false as const });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to generate recommendation";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
