import "server-only";

import { resolvePersonFromWeb } from "@/lib/integrations/google-calendar";
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
};

/**
 * Resolve LinkedIn + optional snapshot bullets (role, company, notes) from web search + LLM.
 * Shared by repopulate, calendar sync, and manual contact creation.
 */
export async function enrichContactFromWeb(input: EnrichContactFromWebInput): Promise<EnrichContactFromWebResult> {
  const { linkedin, bio, sourceTitle } = await resolvePersonFromWeb(
    input.name,
    input.companyHint,
    input.email,
  );
  const hasText = Boolean(bio?.trim()) || Boolean(sourceTitle?.trim());
  if (!hasText) {
    return {
      linkedin,
      role: input.whenNoWebData.role,
      company: input.whenNoWebData.company,
      notes: input.whenNoWebData.notes,
      snapshotFromWeb: false,
    };
  }
  const summarized = await summarizePersonForCrm({
    name: input.name,
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
  };
}
