/**
 * Builds Discover search suggestions per mode, optionally tuned from profile context keywords.
 */

const NETWORK_BASE: string[] = [
  "Someone who can intro me to a specific company",
  "Warm path to a decision-maker I need",
  "Investors or advisors I've met before",
  "People I should reconnect with this month",
  "Engineering leaders in my network",
  "Founders I already know",
];

const WORLD_BASE: string[] = [
  "Series A fintech founders hiring",
  "Product leaders at growth-stage startups",
  "Angel investors active in climate tech",
  "ML engineers open to advisory chats",
  "Design leaders at consumer apps",
  "Operators who scaled GTM at B2B SaaS",
];

type KeywordPick = { keys: string[]; network: string; world: string };

const PROFILE_KEYWORD_PICKS: KeywordPick[] = [
  {
    keys: ["invest", "investor", "vc", "venture", "fundraising", "raise"],
    network: "Investors in my CRM I should ping",
    world: "Early-stage investors in my space",
  },
  {
    keys: ["founder", "ceo", "startup", "company i"],
    network: "Founders I should intro each other",
    world: "Founders building in my industry",
  },
  {
    keys: ["engineer", "engineering", "developer", "swe", "cto"],
    network: "Engineers I already know",
    world: "Senior engineers hiring or consulting",
  },
  {
    keys: ["product", "pm", "design", "ux"],
    network: "Product and design people in my network",
    world: "Product leaders at companies I admire",
  },
  {
    keys: ["sales", "gtm", "revenue", "marketing"],
    network: "GTM people who can open doors",
    world: "VP Sales or marketing leaders to learn from",
  },
  {
    keys: ["climate", "climate tech", "sustainability"],
    network: "Climate tech connections to leverage",
    world: "Climate founders and operators",
  },
  {
    keys: ["ai", "ml", "machine learning", "llm"],
    network: "AI/ML people I've met",
    world: "AI researchers or applied ML leads",
  },
  {
    keys: ["health", "healthcare", "biotech", "medical"],
    network: "Healthcare contacts in my CRM",
    world: "Healthcare founders or operators",
  },
];

function dedupe(items: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const s of items) {
    const k = s.trim().toLowerCase();
    if (!k || seen.has(k)) continue;
    seen.add(k);
    out.push(s.trim());
  }
  return out;
}

export function buildDiscoverSuggestions(profileContext: string): {
  network: string[];
  world: string[];
} {
  const p = profileContext.toLowerCase();

  const networkExtras: string[] = [];
  const worldExtras: string[] = [];

  for (const row of PROFILE_KEYWORD_PICKS) {
    if (row.keys.some((k) => p.includes(k))) {
      networkExtras.push(row.network);
      worldExtras.push(row.world);
    }
  }

  return {
    network: dedupe([...networkExtras, ...NETWORK_BASE]),
    world: dedupe([...worldExtras, ...WORLD_BASE]),
  };
}
