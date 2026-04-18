import "server-only";

const OPENAI_URL = "https://api.openai.com/v1/chat/completions";

export type ParsedVerificationInput = {
  /** Display name only (e.g. "Sarah Chen"), not a full sentence. */
  name: string;
  /** Title, company, relationship, or other disambiguation; may be empty. */
  context: string;
};

/** Same rules as the old client helper — used when OpenAI is unavailable. */
export function heuristicSplitVerificationInput(input: string): ParsedVerificationInput {
  const trimmed = input.trim();
  if (!trimmed) return { name: "", context: "" };
  const match = trimmed.match(/^([^,—–\-]+)\s*[,—–\-]\s*(.+)$/);
  if (match) return { name: match[1]!.trim(), context: match[2]!.trim() };
  return { name: trimmed, context: "" };
}

/**
 * Turns a single free-form line ("Ryan Johnson founder at Majente") into a
 * structured name + context for enrichment. Uses OpenAI when configured.
 */
export async function parseVerificationInput(
  rawUserText: string,
  currentPlaceholderName: string,
  ownerProfileContext?: string,
): Promise<ParsedVerificationInput> {
  const trimmed = rawUserText.trim();
  if (!trimmed) return { name: currentPlaceholderName.trim(), context: "" };

  const key = process.env.OPENAI_API_KEY?.trim();
  if (!key) {
    return heuristicSplitVerificationInput(trimmed);
  }

  const ownerLine =
    ownerProfileContext?.trim() ?
      `\nCRM owner profile (use only to interpret vague phrases or typical network; do not copy into "name" or "context"):\n${ownerProfileContext.trim()}\n`
    : "";

  const system = `You structure CRM "who is this person?" notes from calendar contact review.
The user typed one short message. Split it into:
- "name": The person's own name only, as used on LinkedIn (given name + family name, 1–4 words). No job titles in this field.
- "context": Everything else: job title, company, school, investor firm, how they know the user, event names, or other clues. Use an empty string if the message was only a name.
${ownerLine}
Rules:
- If the whole message looks like a name only (e.g. "Priya Patel"), context is "".
- If it mixes name + details (e.g. "Sarah Chen PM at Google met at SaaStr"), name is "Sarah Chen", context is "PM at Google met at SaaStr".
- Never put a full sentence or bio entirely into "name"; keep "name" short.
Return strict JSON: {"name":"...","context":"..."}`;

  const user = `Current placeholder on the record: "${currentPlaceholderName}"
User message:
"""
${trimmed}
"""`;

  try {
    const res = await fetch(OPENAI_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${key}`,
      },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        temperature: 0,
        max_tokens: 200,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: system },
          { role: "user", content: user },
        ],
      }),
      cache: "no-store",
    });
    if (!res.ok) {
      return heuristicSplitVerificationInput(trimmed);
    }
    const data = (await res.json()) as { choices?: Array<{ message?: { content?: string } }> };
    const text = data.choices?.[0]?.message?.content?.trim() ?? "";
    const parsed = JSON.parse(text) as { name?: unknown; context?: unknown };
    let name = typeof parsed.name === "string" ? parsed.name.trim() : "";
    const context = typeof parsed.context === "string" ? parsed.context.trim() : "";
    if (!name) {
      return heuristicSplitVerificationInput(trimmed);
    }
    if (name.length > 120) {
      return heuristicSplitVerificationInput(trimmed);
    }
    return { name, context };
  } catch {
    return heuristicSplitVerificationInput(trimmed);
  }
}
