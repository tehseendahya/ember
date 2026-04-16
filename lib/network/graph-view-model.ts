import type { Contact, NetworkEdge, SecondDegreeEdge } from "@/lib/types";

type MetricSource = "real" | "inferred";

export interface GraphMetric {
  value: number;
  source: MetricSource;
}

export type GraphCluster = "investors" | "builders" | "operators" | "other";

export interface GraphContactNode {
  id: string;
  name: string;
  role: string;
  company: string;
  avatar: string;
  avatarColor: string;
  cluster: GraphCluster;
  relationshipScore: number;
  relationshipBreakdown: {
    strength: GraphMetric;
    recency: GraphMetric;
    frequency: GraphMetric;
    diversity: GraphMetric;
  };
  recentlyActive: boolean;
}

export interface GraphTargetNode {
  id: string;
  edgeId: string;
  name: string;
  role: string;
  company: string;
  introducedByContactId: string;
  introScore: number;
  introScoreSource: MetricSource;
  confidence: number;
  lastEvidenceAt: string;
}

export interface IntroQueueItem {
  edgeId: string;
  targetName: string;
  targetCompany: string;
  targetRole: string;
  introducerContactId: string;
  introducerName: string;
  introScore: number;
  rationale: string;
  source: MetricSource;
}

export interface UnifiedGraphViewModel {
  generatedAt: string;
  contacts: GraphContactNode[];
  targets: GraphTargetNode[];
  contactLinks: Array<{ sourceContactId: string; targetContactId: string; source: MetricSource; reason: string }>;
  introQueue: IntroQueueItem[];
}

function clamp01(n: number): number {
  return Math.max(0, Math.min(1, n));
}

function hashTo01(seed: string): number {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return ((h >>> 0) % 1000) / 1000;
}

function daysSince(dateISO: string): number | null {
  const t = new Date(`${dateISO}T12:00:00`).getTime();
  if (Number.isNaN(t)) return null;
  return Math.max(0, Math.floor((Date.now() - t) / 86400000));
}

function clusterForContact(c: Contact): GraphCluster {
  const role = `${c.role} ${c.company}`.toLowerCase();
  const tags = c.tags.map((t) => t.toLowerCase());
  if (tags.includes("investor") || /(vc|venture|investor|capital|partner)/.test(role)) return "investors";
  if (tags.includes("founder") || /(founder|ceo|cofounder|entrepreneur)/.test(role)) return "builders";
  if (tags.includes("engineer") || /(engineer|product|design|developer|cto)/.test(role)) return "operators";
  return "other";
}

function recencyMetric(c: Contact): GraphMetric {
  const d = daysSince(c.lastContact.date);
  if (d === null) return { value: hashTo01(`recency:${c.id}`) * 0.5 + 0.25, source: "inferred" };
  return { value: clamp01(1 - d / 120), source: "real" };
}

function frequencyMetric(c: Contact): GraphMetric {
  const interactions = c.interactions.length;
  if (interactions === 0) return { value: hashTo01(`freq:${c.id}`) * 0.4 + 0.2, source: "inferred" };
  const recent = c.interactions.filter((i) => {
    const d = daysSince(i.date);
    return d !== null && d <= 90;
  }).length;
  return { value: clamp01(recent / 12), source: "real" };
}

function diversityMetric(c: Contact): GraphMetric {
  if (c.interactions.length === 0) return { value: hashTo01(`mix:${c.id}`) * 0.35 + 0.3, source: "inferred" };
  const kinds = new Set(c.interactions.map((i) => i.type)).size;
  return { value: clamp01(kinds / 4), source: "real" };
}

function strengthMetric(c: Contact): GraphMetric {
  return { value: clamp01(c.connectionStrength / 5), source: "real" };
}

function introScoreFromEdge(contactScore: number, edge: SecondDegreeEdge): { score: number; source: MetricSource } {
  const conf = clamp01(edge.confidence / 5);
  const d = daysSince(edge.lastEvidenceAt);
  const recency = d === null ? hashTo01(`edge:${edge.id}`) * 0.4 + 0.3 : clamp01(1 - d / 180);
  const source: MetricSource = d === null ? "inferred" : "real";
  return { score: Math.round(clamp01(contactScore * 0.55 + conf * 0.25 + recency * 0.2) * 100), source };
}

function addInferredContactLinks(contacts: Contact[], existing: Set<string>): Array<{ sourceContactId: string; targetContactId: string; source: MetricSource; reason: string }> {
  const inferred: Array<{ sourceContactId: string; targetContactId: string; source: MetricSource; reason: string }> = [];
  for (let i = 0; i < contacts.length; i++) {
    for (let j = i + 1; j < contacts.length; j++) {
      const a = contacts[i]!;
      const b = contacts[j]!;
      const key = `${a.id}:${b.id}`;
      if (existing.has(key)) continue;
      const sameCompany = a.company && b.company && a.company.toLowerCase() === b.company.toLowerCase();
      const tagOverlap = a.tags.some((t) => b.tags.includes(t));
      const roll = hashTo01(`link:${a.id}:${b.id}`);
      if (!sameCompany && !tagOverlap && roll < 0.87) continue;
      inferred.push({
        sourceContactId: a.id,
        targetContactId: b.id,
        source: "inferred",
        reason: sameCompany ? "same-company" : tagOverlap ? "shared-tag" : "cohort",
      });
    }
  }
  return inferred.slice(0, 60);
}

export function buildGraphViewModel(params: {
  contacts: Contact[];
  networkEdges: NetworkEdge[];
  secondDegreeEdges: SecondDegreeEdge[];
}): UnifiedGraphViewModel {
  const { contacts, networkEdges, secondDegreeEdges } = params;
  const contactNodes: GraphContactNode[] = contacts.map((c) => {
    const strength = strengthMetric(c);
    const recency = recencyMetric(c);
    const frequency = frequencyMetric(c);
    const diversity = diversityMetric(c);
    const relationshipScore = Math.round(
      clamp01(strength.value * 0.4 + recency.value * 0.25 + frequency.value * 0.25 + diversity.value * 0.1) * 100,
    );
    return {
      id: c.id,
      name: c.name,
      role: c.role,
      company: c.company,
      avatar: c.avatar,
      avatarColor: c.avatarColor,
      cluster: clusterForContact(c),
      relationshipScore,
      relationshipBreakdown: { strength, recency, frequency, diversity },
      recentlyActive: recency.value >= 0.75,
    };
  });

  const byId = new Map(contactNodes.map((c) => [c.id, c]));
  const seenPairs = new Set<string>();
  const contactLinks: Array<{ sourceContactId: string; targetContactId: string; source: MetricSource; reason: string }> = [];
  for (const e of networkEdges) {
    const a = byId.get(e.source);
    const b = byId.get(e.target);
    if (!a || !b) continue;
    const [x, y] = a.id < b.id ? [a.id, b.id] : [b.id, a.id];
    const k = `${x}:${y}`;
    if (seenPairs.has(k)) continue;
    seenPairs.add(k);
    contactLinks.push({ sourceContactId: x, targetContactId: y, source: "real", reason: e.label ?? "network-link" });
  }
  const inferredLinks = addInferredContactLinks(contacts, seenPairs);
  for (const l of inferredLinks) {
    const [x, y] = l.sourceContactId < l.targetContactId ? [l.sourceContactId, l.targetContactId] : [l.targetContactId, l.sourceContactId];
    const k = `${x}:${y}`;
    if (seenPairs.has(k)) continue;
    seenPairs.add(k);
    contactLinks.push({ ...l, sourceContactId: x, targetContactId: y });
  }

  const mappedTargets = secondDegreeEdges
    .map((edge): GraphTargetNode | null => {
      const introducer = byId.get(edge.introducerContactId);
      if (!introducer) return null;
      const { score, source } = introScoreFromEdge(introducer.relationshipScore / 100, edge);
      return {
        id: `target:${edge.id}`,
        edgeId: edge.id,
        name: edge.targetName,
        role: edge.targetRole,
        company: edge.targetCompany,
        introducedByContactId: edge.introducerContactId,
        introScore: score,
        introScoreSource: source,
        confidence: edge.confidence,
        lastEvidenceAt: edge.lastEvidenceAt,
      };
    })
    .filter((t): t is GraphTargetNode => t !== null);

  const targets: GraphTargetNode[] = mappedTargets
    .sort((a, b) => b.introScore - a.introScore);

  const introQueue: IntroQueueItem[] = targets.slice(0, 20).map((t) => {
    const introducer = byId.get(t.introducedByContactId)!;
    return {
      edgeId: t.edgeId,
      targetName: t.name,
      targetCompany: t.company,
      targetRole: t.role,
      introducerContactId: introducer.id,
      introducerName: introducer.name,
      introScore: t.introScore,
      rationale: `${introducer.name} is ${introducer.relationshipScore >= 75 ? "warm" : "active"} and has evidence for this path.`,
      source: t.introScoreSource,
    };
  });

  return {
    generatedAt: new Date().toISOString(),
    contacts: contactNodes.sort((a, b) => b.relationshipScore - a.relationshipScore),
    targets,
    contactLinks,
    introQueue,
  };
}

