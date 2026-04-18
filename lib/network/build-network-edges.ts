import type { Contact, NetworkEdge } from "@/lib/types";

function edgeKey(a: string, b: string): string {
  return a < b ? `${a}:${b}` : `${b}:${a}`;
}

function labelForPair(a: Contact, b: Contact): string {
  const shared = a.tags.filter((t) => b.tags.includes(t));
  if (shared.includes("warm")) return "warm circle";
  if (shared.length) return shared[0]!;
  if (a.company && b.company && a.company.toLowerCase() === b.company.toLowerCase()) {
    return "same company";
  }
  return "connected";
}

/**
 * Builds 1° graph edges from CRM contacts. Uses `mutualConnections` (contact ids)
 * when present; otherwise infers a small set of links from shared tags / cohort heuristics
 * so the graph is never empty for tiny networks.
 */
export function buildNetworkEdgesFromContacts(contacts: Contact[]): NetworkEdge[] {
  const byId = new Map(contacts.map((c) => [c.id, c]));
  const seen = new Set<string>();
  const edges: NetworkEdge[] = [];

  function addUndirected(idA: string, idB: string, label: string) {
    if (idA === idB) return;
    const k = edgeKey(idA, idB);
    if (seen.has(k)) return;
    const a = byId.get(idA);
    const b = byId.get(idB);
    if (!a || !b) return;
    seen.add(k);
    const [x, y] = idA < idB ? [idA, idB] : [idB, idA];
    edges.push({ source: x, target: y, label });
  }

  for (const c of contacts) {
    for (const raw of c.mutualConnections) {
      const tid = raw.trim();
      if (!tid || !byId.has(tid)) continue;
      const other = byId.get(tid)!;
      addUndirected(c.id, tid, labelForPair(c, other));
    }
  }

  if (edges.length > 0) return edges;

  // Fallback: connect pairs that share at least one tag (deterministic, demo-friendly).
  const sorted = [...contacts].sort((a, b) => a.id.localeCompare(b.id));
  for (let i = 0; i < sorted.length; i++) {
    for (let j = i + 1; j < sorted.length; j++) {
      const a = sorted[i]!;
      const b = sorted[j]!;
      const shared = a.tags.filter((t) => b.tags.includes(t));
      if (shared.length) {
        addUndirected(a.id, b.id, shared[0]!);
      }
    }
  }

  return edges;
}
