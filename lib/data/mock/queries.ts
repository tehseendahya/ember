import type { EmailStats, ExtendedProfile, NetworkEdge, WorldSearchResult } from "@/lib/types";
import { buildExtendedConnectionsMap } from "@/lib/data/store/supabase-store";
import { emailStats, networkEdges } from "./fixtures";
import { worldSearchResults } from "./world-search";

/**
 * Mock implementation for non-CRM data (email charts, graph fixtures, world search).
 * Contacts and updates use `lib/data/store/supabase-store.ts`.
 */

export async function getNetworkEdges(): Promise<NetworkEdge[]> {
  return networkEdges;
}

export async function getEmailStats(): Promise<EmailStats> {
  return emailStats;
}

export async function getWorldSearchResults(): Promise<WorldSearchResult[]> {
  return worldSearchResults;
}

export async function getExtendedConnections(): Promise<
  Record<string, ExtendedProfile[]>
> {
  return await buildExtendedConnectionsMap();
}
