import "server-only";

import { summarizePersonForCrm } from "@/lib/integrations/person-profile-summary";
import {
  companyFromWorkEmailDomain,
  isPersonalEmailProvider,
} from "@/lib/integrations/calendar-identity-resolver";

const EXA_URL = "https://api.exa.ai/search";

export type EnrichContactFromWebInput = {
  name: string;
  email: string | null;
  companyHint: string;
  relationshipContext: string;
  /** Used when Exa returns nothing trustable — keep existing CRM / form values */
  whenNoWebData: { role: string; company: string; notes: string };
  /**
   * When true (the default for calendar sync), we refuse to pull role / bullets
   * from any LinkedIn hit that doesn't match the invitee's work domain or a
   * clear name match. Set to false for manual adds where the user typed the
   * name themselves and we can be a bit looser.
   */
  strictMatch?: boolean;
  /**
   * Free-text clarification from the user about *who* this person is — e.g.
   * "founder of Majente", "MBA at Duke Fuqua", "Kleiner Perkins partner".
   * When present we:
   *   1. fold its tokens into the Exa query,
   *   2. boost hits that mention those tokens, and
   *   3. pass it to the LLM as an authoritative disambiguation signal so the
   *      summary prefers the matching profile even when the name is common.
   * This also loosens strict matching, because the user has vouched for who
   * this is — we just need the web data for the right person.
   */
  userHint?: string;
};

export type EnrichmentCandidate = {
  name: string;
  linkedin: string;
  title: string;
  snippet: string;
  score: number;
  workDomainMatch: boolean;
};

export type EnrichContactFromWebResult = {
  linkedin: string;
  role: string;
  company: string;
  notes: string;
  /** True when Exa text was trusted and used to populate bullets. */
  snapshotFromWeb: boolean;
  /**
   * 0–100 confidence score:
   *   80+  strong LinkedIn hit that matches the work domain / name signals
   *   50–79 probable, but worth user review
   *   <50  we did not trust the hit — no role / bullets populated
   */
  confidence: number;
  /** We could not confidently pick a single profile; user should review. */
  needsVerification: boolean;
  /** Short human-readable reason for the verification flag. */
  verificationReason: string;
  /** Up to 3 candidate LinkedIn profiles from the Exa search. */
  candidates: EnrichmentCandidate[];
  /** When a trusted hit provided a better "First Last" than the input. */
  resolvedFullName: string | null;
};

interface ExaHit {
  url?: string;
  title?: string;
  highlights?: string[];
  text?: string;
}

/**
 * Only upgrade a single-token name to a resolved "First Last" when both:
 *  1. The resolved name has ≥2 tokens, and
 *  2. The current name matches the resolved first token.
 * Kept for callers that want to preview an upgrade before applying it.
 */
function shouldUpgradeNameToResolved(current: string, resolved: string | null | undefined): boolean {
  const r = resolved?.trim() ?? "";
  if (!r) return false;
  const rParts = r.split(/\s+/).filter(Boolean);
  if (rParts.length < 2) return false;
  const c = current.trim().toLowerCase();
  if (c === r.toLowerCase()) return false;
  return c === rParts[0].toLowerCase();
}

function linkedInSearchUrl(name: string, companyHint?: string): string {
  const q = companyHint?.trim() ? `${name} ${companyHint}` : name;
  return `https://www.linkedin.com/search/results/people/?keywords=${encodeURIComponent(q)}`;
}

function excerptFromExaHit(hit: ExaHit): string {
  if (hit.highlights?.length) return hit.highlights.join(" ").trim();
  if (hit.text) return hit.text.trim();
  return hit.title ?? "";
}

function workDomainSlug(email: string | null): string {
  const domain = email?.split("@")[1]?.toLowerCase() ?? "";
  if (!domain || isPersonalEmailProvider(email)) return "";
  const base = domain.split(".")[0] ?? "";
  return base.replace(/[^a-z0-9]/g, "").toLowerCase();
}

function companyHintSlug(hint: string): string {
  return hint.trim().toLowerCase().replace(/[^a-z0-9]/g, "");
}

function nameTokens(name: string): string[] {
  return name
    .toLowerCase()
    .split(/\s+/)
    .filter((t) => t.length > 1);
}

/** Stop words we strip from the user's free-text clarification before scoring. */
const USER_HINT_STOPWORDS = new Set([
  "the", "and", "for", "with", "from", "that", "this", "who", "his", "her",
  "their", "works", "work", "worked", "founder", "co-founder", "cofounder",
  "ceo", "cto", "cfo", "coo", "vp", "svp", "evp", "head", "lead", "senior",
  "principal", "manager", "director", "engineer", "designer", "founder,",
  "i", "my", "me", "our", "was", "is", "are", "at", "of", "an", "a", "he",
  "she", "they", "also", "former", "current", "ex", "ex-", "formerly",
  "one", "person", "guy", "girl", "friend", "colleague", "mate",
]);

/**
 * Extract slug tokens from the user's free-text clarification. We keep any
 * alphanumeric word of length ≥3 that isn't a common stop word, lowercased.
 * Example:
 *   "Ryan Johnson, founder of Majente (ex-Stripe, Stanford MBA)"
 *   → ["ryan", "johnson", "majente", "stripe", "stanford", "mba"]
 *
 * The name itself is harmless to include — `scoreHit` also looks for name
 * tokens, so overlap just slightly rewards a hit that mentions the name twice.
 */
function userHintTokens(raw: string | undefined): string[] {
  if (!raw) return [];
  const text = raw.toLowerCase();
  const tokens = text
    .split(/[^a-z0-9]+/)
    .map((t) => t.trim())
    .filter((t) => t.length >= 3 && !USER_HINT_STOPWORDS.has(t));
  return Array.from(new Set(tokens)).slice(0, 12);
}

function parseFullNameFromLinkedInTitle(title: string | undefined): string | null {
  if (!title) return null;
  const cleaned = title.replace(/\s*\|\s*LinkedIn.*$/i, "").trim();
  const firstSeg = cleaned.split(/\s*[-–—]\s/)[0]?.trim() ?? "";
  if (!firstSeg || firstSeg.length < 3) return null;
  const parts = firstSeg.split(/\s+/).filter(Boolean);
  if (parts.length < 2 || parts.length > 4) return null;
  if (!parts.every((p) => /^[A-Za-z][A-Za-z.'-]*$/.test(p))) return null;
  return parts
    .map((p) => p.slice(0, 1).toUpperCase() + p.slice(1).toLowerCase())
    .join(" ");
}

interface ScoredHit {
  hit: ExaHit;
  score: number;
  workDomainMatch: boolean;
  nameMatch: "full" | "first-only" | "none";
  /** How many user-hint tokens this hit matched (0 when user gave no hint). */
  userHintMatches: number;
}

function scoreHit(
  hit: ExaHit,
  name: string,
  opts: {
    workDomainSlug: string;
    hintSlug: string;
    userHintTokens: string[];
  },
): ScoredHit {
  const tokens = nameTokens(name);
  const slug = (hit.url ?? "").toLowerCase();
  const title = (hit.title ?? "").toLowerCase();
  const text = `${title} ${(hit.highlights ?? []).join(" ")} ${hit.text ?? ""}`.toLowerCase();
  let score = 0;
  let firstMatch = false;
  let lastMatch = false;

  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];
    if (slug.includes(t)) score += 6;
    if (title.includes(t)) score += 4;
    if (i === 0 && (slug.includes(t) || title.includes(t))) firstMatch = true;
    if (i === tokens.length - 1 && i > 0 && (slug.includes(t) || title.includes(t))) lastMatch = true;
  }

  let workDomainMatch = false;
  if (opts.workDomainSlug && opts.workDomainSlug.length >= 3) {
    if (slug.includes(opts.workDomainSlug) || title.includes(opts.workDomainSlug) || text.includes(opts.workDomainSlug)) {
      workDomainMatch = true;
      score += 40;
    }
  }
  if (opts.hintSlug && opts.hintSlug.length >= 3 && opts.hintSlug !== opts.workDomainSlug) {
    if (slug.includes(opts.hintSlug) || title.includes(opts.hintSlug) || text.includes(opts.hintSlug)) {
      score += 18;
    }
  }

  // User-provided clarification tokens ("majente", "stanford", "duke", …):
  // +15 per distinct matched token. This is deliberately strong — the user
  // has vouched for who this person is, so a hit that corroborates those
  // tokens is almost always the right profile.
  let userHintMatches = 0;
  const nameTokenSet = new Set(tokens);
  for (const t of opts.userHintTokens) {
    if (t.length < 3) continue;
    if (nameTokenSet.has(t)) continue; // already counted as a name match
    if (slug.includes(t) || title.includes(t) || text.includes(t)) {
      userHintMatches++;
      score += 15;
    }
  }

  const nameMatch: ScoredHit["nameMatch"] =
    tokens.length >= 2 && firstMatch && lastMatch
      ? "full"
      : firstMatch
        ? "first-only"
        : "none";

  if (nameMatch === "none") score -= 30;
  if (nameMatch === "first-only" && tokens.length >= 2) score -= 10;

  return { hit, score, workDomainMatch, nameMatch, userHintMatches };
}

async function runExaPeopleSearch(query: string): Promise<ExaHit[]> {
  const exaKey = process.env.EXA_API_KEY?.trim();
  if (!exaKey) return [];
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
    if (!res.ok) return [];
    const data = (await res.json()) as { results?: ExaHit[] };
    return (data.results ?? []).filter((h) => typeof h.url === "string" && h.url.length > 0);
  } catch {
    return [];
  }
}

function buildQuery(
  name: string,
  companyHint: string,
  workSlug: string,
  hintTokens: string[],
): string {
  const parts = [name.trim()];
  if (companyHint.trim()) parts.push(companyHint.trim());
  if (workSlug && !companyHint.toLowerCase().replace(/[^a-z0-9]/g, "").includes(workSlug)) {
    parts.push(workSlug);
  }
  // User-provided tokens go *before* "linkedin" so Exa weights them as
  // disambiguation context (e.g. "Ryan Johnson majente linkedin").
  const nameTokenSet = new Set(nameTokens(name));
  for (const t of hintTokens) {
    if (!nameTokenSet.has(t)) parts.push(t);
  }
  parts.push("linkedin");
  return parts.join(" ");
}

function fallbackResult(
  input: EnrichContactFromWebInput,
  opts: { reason: string; candidates: EnrichmentCandidate[]; company: string },
): EnrichContactFromWebResult {
  return {
    linkedin: linkedInSearchUrl(input.name, opts.company || input.companyHint),
    role: input.whenNoWebData.role,
    company: opts.company || input.whenNoWebData.company,
    notes: input.whenNoWebData.notes,
    snapshotFromWeb: false,
    confidence: opts.candidates.length > 0 ? 30 : 10,
    needsVerification: true,
    verificationReason: opts.reason,
    candidates: opts.candidates,
    resolvedFullName: null,
  };
}

/**
 * Resolve LinkedIn + optional snapshot bullets (role, company, notes) from web
 * search + LLM. The refactor tightens matching so we don't pull profile data
 * from a hit unless it's clearly the right person:
 *
 *   - If the invitee has a work email (e.g. `ryan@majente.com`), we require
 *     the top hit to mention that domain or company. Otherwise we treat all
 *     hits as candidates, populate `company` from the domain only, and set
 *     `needsVerification: true`.
 *   - If the invitee uses a personal provider (gmail etc.), we require a full
 *     first-and-last name match against the hit; otherwise we treat hits as
 *     candidates and flag for review.
 *   - When no trustable hit is found we never fabricate role / company / notes.
 */
export async function enrichContactFromWeb(
  input: EnrichContactFromWebInput,
): Promise<EnrichContactFromWebResult> {
  const userHintRaw = input.userHint?.trim() ?? "";
  const hasUserHint = userHintRaw.length > 0;
  // When the user has explicitly vouched for who this person is, we relax the
  // work-domain hard requirement — otherwise we'd keep rejecting their own
  // manually-provided context.
  const strict = hasUserHint ? false : (input.strictMatch ?? true);
  const trimmedName = input.name.trim();
  const domainCompany = companyFromWorkEmailDomain(input.email);
  const hintCompany = input.companyHint.trim();
  const resolvedCompanyHint = hintCompany || domainCompany;
  const workSlug = workDomainSlug(input.email);
  const hintSlug = companyHintSlug(resolvedCompanyHint);
  const userTokens = userHintTokens(userHintRaw);

  if (!trimmedName) {
    return fallbackResult(input, {
      reason: "missing name",
      candidates: [],
      company: domainCompany || hintCompany,
    });
  }

  const hits = await runExaPeopleSearch(
    buildQuery(trimmedName, resolvedCompanyHint, workSlug, userTokens),
  );
  const linkedInHits = hits.filter((h) => /linkedin\.com\/in\//i.test(h.url ?? ""));

  // If Exa gave us *nothing*, return a verification-flagged stub.
  if (linkedInHits.length === 0) {
    return fallbackResult(input, {
      reason: hits.length === 0 ? "no web results" : "no LinkedIn profile in results",
      candidates: [],
      company: domainCompany || hintCompany,
    });
  }

  const scored = linkedInHits
    .map((h) =>
      scoreHit(h, trimmedName, {
        workDomainSlug: workSlug,
        hintSlug,
        userHintTokens: userTokens,
      }),
    )
    .sort((a, b) => b.score - a.score);

  const candidates: EnrichmentCandidate[] = scored.slice(0, 3).map((s) => ({
    name: parseFullNameFromLinkedInTitle(s.hit.title) ?? trimmedName,
    linkedin: s.hit.url ?? "",
    title: s.hit.title ?? "",
    snippet: excerptFromExaHit(s.hit).slice(0, 400),
    score: s.score,
    workDomainMatch: s.workDomainMatch,
  }));

  const best = scored[0];

  // Decide whether to trust `best`.
  const hasWorkDomain = workSlug.length > 0;
  let trustBest = false;
  let reason = "";

  // Short-circuit: user provided clarification AND the top hit corroborates
  // at least one of those tokens. That's the signal we care most about —
  // when the user says "Ryan Johnson, founder of Majente" and a LinkedIn
  // result mentions Majente, that's the right profile even if it's a .com
  // domain we couldn't verify ourselves.
  if (hasUserHint && best.userHintMatches > 0 && best.nameMatch !== "none") {
    trustBest = true;
  } else if (strict) {
    if (hasWorkDomain && best.workDomainMatch) {
      trustBest = true;
    } else if (hasWorkDomain && !best.workDomainMatch) {
      trustBest = false;
      reason = `no LinkedIn result mentions the work domain (${workSlug})`;
    } else if (best.nameMatch === "full") {
      trustBest = true;
    } else {
      trustBest = false;
      reason = "top result does not match the full name confidently";
    }
  } else {
    // Loose mode — only require the name to match at least on the first token.
    trustBest = best.nameMatch !== "none";
    if (!trustBest) reason = "top result does not match the given name";
  }

  // If the user gave a hint but NO hit corroborated it, that's suspicious —
  // likely Exa pulled a same-name profile that doesn't match what the user
  // described. Flag for review instead of writing a wrong profile.
  if (hasUserHint && best.userHintMatches === 0) {
    trustBest = false;
    reason =
      "user-provided clarification did not match any LinkedIn result — verify the candidate list or refine the hint";
  }

  if (!trustBest) {
    return {
      linkedin: linkedInSearchUrl(trimmedName, resolvedCompanyHint),
      role: input.whenNoWebData.role,
      company: domainCompany || hintCompany || input.whenNoWebData.company,
      notes: input.whenNoWebData.notes,
      snapshotFromWeb: false,
      confidence: 25,
      needsVerification: true,
      verificationReason: reason,
      candidates,
      resolvedFullName: null,
    };
  }

  const bio = excerptFromExaHit(best.hit).slice(0, 1200) || null;
  const sourceTitle = best.hit.title ?? null;
  const linkedin = best.hit.url ?? linkedInSearchUrl(trimmedName, resolvedCompanyHint);
  const resolvedFullName = parseFullNameFromLinkedInTitle(sourceTitle ?? undefined);

  const nameForSummary =
    resolvedFullName && shouldUpgradeNameToResolved(trimmedName, resolvedFullName)
      ? resolvedFullName
      : trimmedName;

  const hasText = Boolean(bio?.trim()) || Boolean(sourceTitle?.trim());
  if (!hasText) {
    return {
      linkedin,
      role: input.whenNoWebData.role,
      company: domainCompany || hintCompany || input.whenNoWebData.company,
      notes: input.whenNoWebData.notes,
      snapshotFromWeb: false,
      confidence: 40,
      needsVerification: false,
      verificationReason: "",
      candidates,
      resolvedFullName,
    };
  }

  const summarized = await summarizePersonForCrm({
    name: nameForSummary,
    email: input.email,
    workDomainCompany: domainCompany,
    rawExcerpt: bio ?? "",
    linkedInResultTitle: sourceTitle,
    relationshipContext: input.relationshipContext,
    userHint: userHintRaw || null,
  });

  const confidence = best.workDomainMatch
    ? 92
    : best.userHintMatches > 0
      ? 88 // user vouched + Exa corroborated → very high trust
      : best.nameMatch === "full"
        ? 78
        : 60;

  return {
    linkedin,
    role: summarized.role,
    company: summarized.company || domainCompany || hintCompany,
    notes: summarized.notes,
    snapshotFromWeb: true,
    confidence,
    needsVerification: false,
    verificationReason: "",
    candidates,
    resolvedFullName,
  };
}

export { shouldUpgradeNameToResolved };
