import "server-only";

import { createSupabaseServerClient } from "@/lib/supabase/server";
import { requireUserId } from "@/lib/auth";

const EXA_URL = "https://api.exa.ai/search";
const OPENAI_URL = "https://api.openai.com/v1/chat/completions";

interface ExaHit {
  url: string;
  title?: string;
  highlights?: string[];
  text?: string;
}

export interface ContactEnrichmentResult {
  company: string;
  role: string;
  school: string;
  location: string;
  bio: string;
  linkedIn: string;
  confidence: number;
  sourceUrls: string[];
  summaryNote: string;
}

function excerpt(hit: ExaHit): string {
  if (hit.highlights?.length) return hit.highlights.join(" ").slice(0, 900);
  if (hit.text) return hit.text.slice(0, 900);
  return hit.title ?? "";
}

function normalizeUrl(url: string): string {
  return url.trim();
}

function fallbackLinkedIn(name: string, company: string): string {
  return `https://www.linkedin.com/search/results/people/?keywords=${encodeURIComponent([name, company].filter(Boolean).join(" "))}`;
}

async function fetchExaHits(query: string): Promise<ExaHit[]> {
  const exaKey = process.env.EXA_API_KEY?.trim();
  if (!exaKey) return [];
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
      num_results: 6,
      contents: {
        highlights: { max_characters: 3000 },
        text: { max_characters: 3000 },
      },
    }),
    cache: "no-store",
  });
  if (!res.ok) return [];
  const data = (await res.json()) as { results?: ExaHit[] };
  return data.results ?? [];
}

async function parseWithOpenAI(name: string, query: string, hits: ExaHit[]): Promise<ContactEnrichmentResult | null> {
  const openaiKey = process.env.OPENAI_API_KEY?.trim();
  if (!openaiKey || hits.length === 0) return null;
  const compactHits = hits.map((hit, idx) => ({
    idx,
    url: hit.url,
    title: hit.title ?? "",
    excerpt: excerpt(hit),
  }));
  const systemPrompt = `You extract a single person's professional profile from web search hits.
Use only the provided evidence.
Return strict JSON:
{"person":{"company":"...","role":"...","school":"...","location":"...","bio":"...","linkedIn":"...","confidence":0,"summaryNote":"..."}}`;
  const userPrompt = `Target person: ${name}
Search query: ${query}
Candidates: ${JSON.stringify(compactHits)}`;
  const res = await fetch(OPENAI_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${openaiKey}`,
    },
    body: JSON.stringify({
      model: "gpt-4o-mini",
      temperature: 0.1,
      max_tokens: 500,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
    }),
  });
  if (!res.ok) return null;
  const data = await res.json();
  const raw = data.choices?.[0]?.message?.content ?? "{}";
  try {
    const parsed = JSON.parse(raw) as {
      person?: {
        company?: string;
        role?: string;
        school?: string;
        location?: string;
        bio?: string;
        linkedIn?: string;
        confidence?: number;
        summaryNote?: string;
      };
    };
    const linkedInHit = hits.find((hit) => /linkedin\.com\/in\//i.test(hit.url));
    return {
      company: parsed.person?.company?.trim() ?? "",
      role: parsed.person?.role?.trim() ?? "",
      school: parsed.person?.school?.trim() ?? "",
      location: parsed.person?.location?.trim() ?? "",
      bio: parsed.person?.bio?.trim() ?? "",
      linkedIn: parsed.person?.linkedIn?.trim() || linkedInHit?.url || "",
      confidence: Math.max(0, Math.min(100, Number(parsed.person?.confidence ?? 0))),
      sourceUrls: compactHits.slice(0, 3).map((hit) => hit.url),
      summaryNote: parsed.person?.summaryNote?.trim() ?? "",
    };
  } catch {
    return null;
  }
}

function fallbackEnrichment(name: string, companyHint: string, hits: ExaHit[]): ContactEnrichmentResult {
  const linkedInHit = hits.find((hit) => /linkedin\.com\/in\//i.test(hit.url));
  const topHit = hits[0];
  return {
    company: companyHint,
    role: "",
    school: "",
    location: "",
    bio: excerpt(topHit).slice(0, 220),
    linkedIn: linkedInHit?.url ?? fallbackLinkedIn(name, companyHint),
    confidence: linkedInHit ? 55 : 25,
    sourceUrls: hits.slice(0, 3).map((hit) => hit.url),
    summaryNote: excerpt(topHit).slice(0, 220),
  };
}

export async function lookupContactEnrichment(seed: {
  name: string;
  email?: string;
  company?: string;
  role?: string;
  linkedIn?: string;
}): Promise<ContactEnrichmentResult | null> {
  const companyHint = seed.company?.trim() || seed.email?.split("@")[1]?.split(".")[0]?.replace(/[-_]/g, " ") || "";
  const query = [seed.name.trim(), companyHint, seed.role?.trim(), "LinkedIn current role school location"].filter(Boolean).join(" ");
  const hits = await fetchExaHits(query);
  if (hits.length === 0) return null;
  const parsed = await parseWithOpenAI(seed.name.trim(), query, hits);
  return parsed ?? fallbackEnrichment(seed.name.trim(), companyHint, hits);
}

function mergeField(current: string, incoming: string, lockedFields: string[], field: string): string {
  if (!incoming.trim()) return current;
  if (lockedFields.includes(field)) return current;
  if (current.trim()) return current;
  return incoming.trim();
}

export async function enrichAndMergeContactProfile(contactId: string): Promise<{ ok: true; enrichment: ContactEnrichmentResult | null } | { ok: false; error: string }> {
  const userId = await requireUserId();
  const supabase = await createSupabaseServerClient();
  const { data: contact, error } = await supabase
    .from("contacts")
    .select("*")
    .eq("id", contactId)
    .eq("user_id", userId)
    .single();
  if (error || !contact) return { ok: false, error: "Contact not found" };

  const enrichment = await lookupContactEnrichment({
    name: contact.name,
    email: contact.email,
    company: contact.company,
    role: contact.role,
    linkedIn: contact.linkedin,
  });
  if (!enrichment) return { ok: true, enrichment: null };

  const lockedFields = (contact.locked_fields ?? []) as string[];
  const nextNotes = enrichment.summaryNote && !String(contact.notes ?? "").includes(enrichment.summaryNote)
    ? `${String(contact.notes ?? "").trim()}${String(contact.notes ?? "").trim() ? "\n" : ""}${enrichment.summaryNote}`.trim()
    : String(contact.notes ?? "");

  const updatePayload = {
    company: mergeField(contact.company ?? "", enrichment.company, lockedFields, "company"),
    role: mergeField(contact.role ?? "", enrichment.role, lockedFields, "role"),
    school: mergeField(contact.school ?? "", enrichment.school, lockedFields, "school"),
    location: mergeField(contact.location ?? "", enrichment.location, lockedFields, "location"),
    bio: mergeField(contact.bio ?? "", enrichment.bio, lockedFields, "bio"),
    linkedin: mergeField(contact.linkedin ?? "", enrichment.linkedIn, lockedFields, "linkedin"),
    notes: nextNotes,
    profile_source: contact.profile_source === "manual" ? "mixed" : "enriched",
    profile_confidence: Math.max(Number(contact.profile_confidence ?? 0), enrichment.confidence),
    profile_source_urls: Array.from(new Set([...(contact.profile_source_urls ?? []), ...enrichment.sourceUrls.map(normalizeUrl)])).slice(0, 5),
  };

  const { error: updateErr } = await supabase
    .from("contacts")
    .update(updatePayload)
    .eq("id", contactId)
    .eq("user_id", userId);
  if (updateErr) return { ok: false, error: updateErr.message };
  return { ok: true, enrichment };
}
