import type { Contact, SecondDegreeEdge, WorldSearchResult } from "@/lib/types";

const MS_PER_DAY = 86400000;

function tokenize(s: string): Set<string> {
  return new Set(
    s
      .toLowerCase()
      .split(/\W+/)
      .filter((t) => t.length > 2)
  );
}

/** 0–1 overlap between query tokens and target fields. */
export function intentMatchScore(
  query: string,
  row: Pick<WorldSearchResult, "name" | "company" | "role">
): number {
  const qTokens = tokenize(query);
  if (qTokens.size === 0) return 0.5;
  const blob = `${row.name} ${row.company} ${row.role}`.toLowerCase();
  let hit = 0;
  for (const t of qTokens) {
    if (blob.includes(t)) hit++;
  }
  return Math.min(1, hit / Math.max(1, qTokens.size));
}

/** Decays from 1.0 (today) toward ~0.35 at 2 years without refresh. */
export function recencyFactor(lastEvidenceIso: string, now = new Date()): number {
  const d = new Date(lastEvidenceIso + "T12:00:00");
  if (Number.isNaN(d.getTime())) return 0.5;
  const days = Math.max(0, (now.getTime() - d.getTime()) / MS_PER_DAY);
  return Math.max(0.15, Math.min(1, 1 - days / 730));
}

export function edgeMatchesTarget(
  edge: SecondDegreeEdge,
  row: Pick<WorldSearchResult, "name" | "company">
): boolean {
  const rn = row.name.toLowerCase().trim();
  const en = edge.targetName.toLowerCase().trim();
  const rFirst = rn.split(/\s+/)[0] ?? "";
  const eFirst = en.split(/\s+/)[0] ?? "";
  if (rFirst.length > 1 && eFirst.length > 1 && rn.includes(eFirst) && en.includes(rFirst)) {
    return true;
  }
  if (edge.targetCompany && row.company) {
    const tc = edge.targetCompany.toLowerCase().trim();
    const rc = row.company.toLowerCase().trim();
    if (tc.length > 1 && rc.length > 1 && (tc === rc || tc.includes(rc) || rc.includes(tc))) {
      return true;
    }
  }
  const a = tokenize(`${edge.targetName} ${edge.targetCompany}`);
  const b = tokenize(`${row.name} ${row.company}`);
  let overlap = 0;
  for (const t of b) {
    if (a.has(t)) overlap++;
  }
  return overlap >= 2 || (overlap >= 1 && row.name.length < 24);
}

export interface RankedIntroducer {
  introducerId: string;
  score: number;
  breakdown: {
    connectionStrength: number;
    edgeConfidence: number;
    intentMatch: number;
    recency: number;
  };
  edgeId?: string;
  source: "edge" | "heuristic";
}

/**
 * Composite score: connectionStrength × edgeConfidence × intentMatch × recency (normalized to 0–100).
 * Prefers CRM edges that match the target; falls back to token overlap on introducer profile text.
 */
export function rankIntroducersForWorldResult(
  contacts: Contact[],
  edges: SecondDegreeEdge[],
  row: Pick<WorldSearchResult, "name" | "company" | "role">,
  searchQuery: string
): RankedIntroducer[] {
  const intent = intentMatchScore(searchQuery, row);
  const matchingEdges = edges.filter((e) => edgeMatchesTarget(e, row));

  const byIntroducerFromEdges = new Map<string, SecondDegreeEdge[]>();
  for (const e of matchingEdges) {
    const list = byIntroducerFromEdges.get(e.introducerContactId) ?? [];
    list.push(e);
    byIntroducerFromEdges.set(e.introducerContactId, list);
  }

  const ranked: RankedIntroducer[] = [];

  for (const [introducerId, es] of byIntroducerFromEdges) {
    const contact = contacts.find((c) => c.id === introducerId);
    if (!contact) continue;
    const best = es.reduce((a, b) => (a.confidence >= b.confidence ? a : b));
    const strength = contact.connectionStrength / 5;
    const conf = best.confidence / 5;
    const rec = recencyFactor(best.lastEvidenceAt);
    const raw = strength * conf * intent * rec;
    const score = Math.round(Math.min(100, raw * 100));
    ranked.push({
      introducerId,
      score,
      breakdown: {
        connectionStrength: strength,
        edgeConfidence: conf,
        intentMatch: intent,
        recency: rec,
      },
      edgeId: best.id,
      source: "edge",
    });
  }

  const tokens = tokenize(`${row.name} ${row.company} ${row.role} ${searchQuery}`);
  for (const c of contacts) {
    if (ranked.some((r) => r.introducerId === c.id)) continue;
    const blob = `${c.company} ${c.role} ${c.tags.join(" ")} ${c.notes}`.toLowerCase();
    let tokHit = 0;
    for (const t of tokens) {
      if (t.length > 3 && blob.includes(t)) tokHit++;
    }
    if (tokHit === 0) continue;
    const strength = c.connectionStrength / 5;
    const pseudoConf = 0.35;
    const rec = 0.7;
    const raw = strength * pseudoConf * intent * rec * (Math.min(1, tokHit / 4));
    const score = Math.round(Math.min(72, raw * 100));
    ranked.push({
      introducerId: c.id,
      score,
      breakdown: {
        connectionStrength: strength,
        edgeConfidence: pseudoConf,
        intentMatch: intent,
        recency: rec,
      },
      source: "heuristic",
    });
  }

  ranked.sort((a, b) => b.score - a.score);
  return ranked.slice(0, 5);
}

/**
 * Attach ranked introducers, path copy, and score breakdown to each web search row.
 */
export function enrichWorldResultsWithIntroducers(
  rows: WorldSearchResult[],
  contacts: Contact[],
  edges: SecondDegreeEdge[],
  searchQuery: string
): WorldSearchResult[] {
  return rows.map((row) => {
    const ranked = rankIntroducersForWorldResult(contacts, edges, row, searchQuery);
    if (ranked.length === 0) return row;
    const top = ranked[0]!;
    const bridge = contacts.find((c) => c.id === top.introducerId)?.name ?? "?";
    const pathKind = top.source === "edge" ? "network path" : "heuristic — verify";
    const path = `You → ${bridge} → ${row.name} (${pathKind})`;
    return {
      ...row,
      introducers: ranked.map((r) => r.introducerId),
      connectionPath: path,
      pathScore: top.score,
      pathScoreBreakdown: {
        connectionStrength: top.breakdown.connectionStrength,
        edgeConfidence: top.breakdown.edgeConfidence,
        intentMatch: top.breakdown.intentMatch,
        recency: top.breakdown.recency,
      },
    };
  });
}
