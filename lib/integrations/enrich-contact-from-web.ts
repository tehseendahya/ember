import "server-only";

import { companyFromEmailDomain, resolvePersonFromWeb } from "@/lib/integrations/google-calendar";
import { summarizePersonForCrm } from "@/lib/integrations/person-profile-summary";

export type EnrichContactFromWebInput = {
  name: string;
  email: string | null;
  companyHint: string;
  relationshipContext: string;
  /** Used when Exa returns nothing useful — keep existing CRM / form values */
  whenNoWebData: { role: string; company: string; notes: string };
};

export type EnrichContactFromWebResult = {
  linkedin: string;
  role: string;
  company: string;
  notes: string;
  snapshotFromWeb: boolean;
  /** When Exa/LinkedIn yields a full name (e.g. "Max Tabachnik") better than first-name-only input. */
  resolvedFullName: string | null;
};

function shouldUpgradeNameToResolved(current: string, resolved: string | null | undefined): boolean {
  const r = resolved?.trim() ?? "";
  if (!r) return false;
  const rParts = r.split(/\s+/).filter(Boolean);
  if (rParts.length < 2) return false;
  const c = current.trim().toLowerCase();
  if (c === r.toLowerCase()) return false;
  return c === rParts[0].toLowerCase();
}

/**
 * Resolve LinkedIn + optional snapshot bullets (role, company, notes) from web search + LLM.
 * Shared by repopulate, calendar sync, and manual contact creation.
 */
export async function enrichContactFromWeb(input: EnrichContactFromWebInput): Promise<EnrichContactFromWebResult> {
  const { linkedin, bio, sourceTitle, resolvedFullName } = await resolvePersonFromWeb(
    input.name,
    input.companyHint,
    input.email,
  );
  const nameForSummary =
    resolvedFullName?.trim() && shouldUpgradeNameToResolved(input.name, resolvedFullName)
      ? resolvedFullName.trim()
      : input.name.trim();
  const hasText = Boolean(bio?.trim()) || Boolean(sourceTitle?.trim());
  if (!hasText) {
    return {
      linkedin,
      role: input.whenNoWebData.role,
      company: input.whenNoWebData.company,
      notes: input.whenNoWebData.notes,
      snapshotFromWeb: false,
      resolvedFullName: resolvedFullName ?? null,
    };
  }
  const summarized = await summarizePersonForCrm({
    name: nameForSummary,
    email: input.email,
    workDomainCompany: companyFromEmailDomain(input.email),
    rawExcerpt: bio ?? "",
    linkedInResultTitle: sourceTitle,
    relationshipContext: input.relationshipContext,
  });
  return {
    linkedin,
    role: summarized.role,
    company: summarized.company,
    notes: summarized.notes,
    snapshotFromWeb: true,
    resolvedFullName: resolvedFullName ?? null,
  };
}

export { shouldUpgradeNameToResolved };
