import "server-only";

const OPENAI_URL = "https://api.openai.com/v1/chat/completions";

function stripMarkdownNoise(text: string): string {
  return text
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/\*([^*]+)\*/g, "$1")
    .replace(/`+/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function fallbackSummary(input: {
  name: string;
  rawExcerpt: string;
  linkedInResultTitle: string | null;
  relationshipContext: string;
  workDomainCompany?: string | null;
}): { role: string; company: string; notes: string } {
  const title = input.linkedInResultTitle?.replace(/\s*\|\s*LinkedIn.*$/i, "").trim() ?? "";
  let role = "";
  let company = "";
  const segments = title.split(/\s*[-–—]\s+/).map((s) => s.trim()).filter(Boolean);
  if (segments.length >= 3) {
    role = segments[segments.length - 2]?.slice(0, 120) ?? "";
    company = segments[segments.length - 1]?.replace(/\s*\|\s*LinkedIn.*$/i, "").trim().slice(0, 120) ?? "";
  } else if (segments.length === 2) {
    const [, b] = segments;
    role = b.slice(0, 120);
  } else if (segments.length === 1 && segments[0]) {
    role = segments[0].slice(0, 120);
  }

  const clean = stripMarkdownNoise(input.rawExcerpt);
  const oneLine = clean.slice(0, 200);
  const secondLine = clean.length > 200 ? clean.slice(200, 400).trim() : "";
  const thirdLine = clean.length > 400 ? clean.slice(400, 600).trim() : "";

  const bullets: string[] = [];
  if (oneLine) bullets.push(oneLine + (clean.length > 200 ? "…" : ""));
  if (secondLine) bullets.push(secondLine + (clean.length > 400 ? "…" : ""));
  if (thirdLine) bullets.push(thirdLine + (clean.length > 600 ? "…" : ""));
  const rel = input.relationshipContext.trim();
  if (bullets.length < 4) {
    bullets.push(rel || "Add how you know them — edit notes to capture your relationship.");
  }

  const notes = bullets.slice(0, 4).map((b) => `• ${b.replace(/^•\s*/, "")}`).join("\n");

  const orgFromEmail = input.workDomainCompany?.trim();
  const companyOut =
    (company && company !== "Unknown company" ? company : "") ||
    orgFromEmail ||
    "Unknown company";

  return {
    role: role || "Unknown role",
    company: companyOut,
    notes,
  };
}

/**
 * Turn noisy Exa/LinkedIn text into short role/company + 3–4 plain-text bullets (school, past, now, relationship).
 */
export async function summarizePersonForCrm(input: {
  name: string;
  rawExcerpt: string;
  linkedInResultTitle: string | null;
  relationshipContext: string;
  /** When present, helps disambiguate common first names. */
  email?: string | null;
  /**
   * Human label from work email domain (non-generic mail only), e.g. "Majente" for @majente.com.
   * Strong signal for which person + employer when the name is common.
   */
  workDomainCompany?: string | null;
  /**
   * Free-text clarification the user typed while resolving a `needs_verification`
   * contact (e.g. "founder of Majente", "MBA at Duke Fuqua"). Treat as
   * authoritative: when multiple same-name profiles could match, pick the one
   * consistent with this hint.
   */
  userHint?: string | null;
}): Promise<{ role: string; company: string; notes: string }> {
  const key = process.env.OPENAI_API_KEY?.trim();
  if (!key) {
    return fallbackSummary(input);
  }
  if (!input.rawExcerpt.trim() && !input.linkedInResultTitle?.trim()) {
    return fallbackSummary(input);
  }

  const system = `You format web search snippets into a compact CRM profile. Reply with JSON only. Be concise. No markdown headers or bullet symbols in string values.`;

  const emailLine = input.email?.trim()
    ? `INVITEE_EMAIL: ${input.email.trim()}`
    : "INVITEE_EMAIL: (none)";

  const workOrgLine = input.workDomainCompany?.trim()
    ? `WORK_ORGANIZATION_FROM_EMAIL (this invitee uses a work domain — treat as the likely employer when choosing which "${input.name}" the text describes; if RAW_WEB_TEXT clearly describes a different person, say so in bullets instead): ${input.workDomainCompany.trim()}`
    : "WORK_ORGANIZATION_FROM_EMAIL: (none — personal email or missing)";

  const userHintLine = input.userHint?.trim()
    ? `USER_PROVIDED_CLARIFICATION (the user typed this to tell us exactly who this person is — treat as authoritative when deciding which same-name profile to describe): ${input.userHint.trim()}`
    : "USER_PROVIDED_CLARIFICATION: (none)";

  const user = `Person name: ${input.name}

${emailLine}

${workOrgLine}

${userHintLine}

LINKEDIN_SEARCH_RESULT_TITLE (may help disambiguate role/company; may be empty):
${input.linkedInResultTitle ?? "(none)"}

RAW_WEB_TEXT (noisy; may include markdown, duplicates):
${input.rawExcerpt.slice(0, 8000)}

HOW_THE_USER_KNOWS_THEM (from CRM: last touch, meetings, tags — use for the relationship bullet only):
${input.relationshipContext.trim() || "Not specified — use one short line asking to add how they know each other."}

Important: Infer "role" and "company" primarily from RAW_WEB_TEXT and LINKEDIN_SEARCH_RESULT_TITLE. When USER_PROVIDED_CLARIFICATION is present, it outranks WORK_ORGANIZATION_FROM_EMAIL — pick the same-name profile consistent with the user's clarification. When RAW_WEB_TEXT matches the clarified organization/role, use it for "company" and for roles. If RAW_WEB_TEXT clearly describes a different person than the clarification, say so briefly in one bullet rather than silently writing the wrong profile. Ignore stale employers that might have been stored in CRM before.

Return this JSON shape:
{"role":"short current job title only","company":"primary organization they work for now","bullets":["Education / school — one short line, or Unknown","Past experience — one short line","What they are doing now — one short line","Relationship — based on HOW_THE_USER_KNOWS_THEM; if empty say they should add context in CRM"]}

Hard rules:
- bullets: exactly 4 items, each max 130 characters, plain sentences (no leading dashes or #).
- role and company must reflect current work from the text when possible (not stale employers unless RAW_WEB_TEXT only mentions those).
- Do not copy long hashtags or section titles verbatim; paraphrase.
- Priority order for disambiguating multiple "${input.name}"s: USER_PROVIDED_CLARIFICATION > WORK_ORGANIZATION_FROM_EMAIL > LINKEDIN_SEARCH_RESULT_TITLE.
- If RAW_WEB_TEXT clearly describes a different person than this invitee, say so briefly in one bullet.`;

  try {
    const res = await fetch(OPENAI_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${key}`,
      },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        temperature: 0.15,
        max_tokens: 700,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: system },
          { role: "user", content: user },
        ],
      }),
      cache: "no-store",
    });
    if (!res.ok) {
      return fallbackSummary(input);
    }
    const data = (await res.json()) as { choices?: Array<{ message?: { content?: string } }> };
    const raw = data.choices?.[0]?.message?.content ?? "{}";
    const parsed = JSON.parse(raw) as {
      role?: string;
      company?: string;
      bullets?: string[];
    };
    const role = (parsed.role ?? "").trim().slice(0, 120) || "Unknown role";
    const company = (parsed.company ?? "").trim().slice(0, 120) || "Unknown company";
    const rawBullets = Array.isArray(parsed.bullets) ? parsed.bullets : [];
    const bullets = rawBullets
      .map((b) =>
        stripMarkdownNoise(b)
          .replace(/^[•\-\*]\s*/, "")
          .trim()
          .slice(0, 130),
      )
      .filter(Boolean)
      .slice(0, 4);
    const notes = bullets.map((b) => `• ${b}`).join("\n");
    return { role, company, notes: notes || fallbackSummary(input).notes };
  } catch {
    return fallbackSummary(input);
  }
}
