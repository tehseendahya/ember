import type { Contact } from "@/lib/types";

/**
 * Cheap keyword recall: scores contacts so we only send a bounded candidate set to the LLM.
 */
export function scoreContactForRecall(contact: Contact, query: string): number {
  const q = query.toLowerCase().trim();
  if (!q) return 0;

  let score = 0;

  if (contact.name.toLowerCase().includes(q)) score += 40;
  if (contact.company.toLowerCase().includes(q)) score += 30;
  if (contact.role.toLowerCase().includes(q)) score += 25;
  if (contact.tags.some((t) => t.includes(q))) score += 30;
  if (contact.notes.toLowerCase().includes(q)) score += 15;

  const qTokens = q.split(/\s+/).filter((t) => t.length > 2);
  for (const tok of qTokens) {
    if (contact.name.toLowerCase().includes(tok)) score += 8;
    if (contact.company.toLowerCase().includes(tok)) score += 6;
    if (contact.role.toLowerCase().includes(tok)) score += 6;
    if (contact.tags.some((t) => t.includes(tok))) score += 10;
    if (contact.notes.toLowerCase().includes(tok)) score += 4;
  }

  score += contact.connectionStrength * 3;

  const keywords: Record<string, string[]> = {
    fundrais: ["investor", "vc", "series-a"],
    invest: ["investor", "vc"],
    ml: ["ai", "data", "engineer"],
    engineer: ["engineer", "swe", "tech"],
    design: ["design", "product"],
    founder: ["founder"],
    product: ["product", "pm"],
    growth: ["growth", "saas"],
    climate: ["climate"],
    sequoia: ["vc", "investor"],
    openai: ["ai", "research"],
    marketing: ["marketing"],
    finance: ["finance"],
  };

  for (const [kw, tags] of Object.entries(keywords)) {
    if (q.includes(kw)) {
      if (contact.tags.some((t) => tags.includes(t))) score += 35;
    }
  }

  return score;
}

export function recallContacts(contacts: Contact[], query: string, limit: number): Contact[] {
  const q = query.trim();
  if (!q) return [];

  return [...contacts]
    .map((c) => ({ c, score: scoreContactForRecall(c, q) }))
    .filter(({ score }) => score > 5)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map(({ c }) => c);
}

const NOTES_MAX = 1200;

export function contactToSearchCandidate(c: Contact) {
  return {
    id: c.id,
    name: c.name,
    company: c.company,
    role: c.role,
    tags: c.tags,
    connectionStrength: c.connectionStrength,
    notes: c.notes.length > NOTES_MAX ? `${c.notes.slice(0, NOTES_MAX)}…` : c.notes,
  };
}
