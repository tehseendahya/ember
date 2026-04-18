/**
 * Trims user profile context for inclusion in LLM prompts (avoids runaway tokens).
 */
export function compactProfileContext(raw: string, maxChars = 900): string {
  return raw.replace(/\s+/g, " ").trim().slice(0, maxChars);
}
