/**
 * Domain types for the CRM. UI and data layers depend on these — not on mock vs Supabase.
 */

export interface Interaction {
  id: string;
  date: string;
  type: "meeting" | "email" | "zoom" | "intro" | "message" | "event";
  title: string;
  notes: string;
  reminder?: string;
}

export interface Contact {
  id: string;
  name: string;
  email: string;
  company: string;
  role: string;
  linkedIn: string;
  avatar: string;
  avatarColor: string;
  tags: string[];
  lastContact: {
    type: "meeting" | "email" | "zoom" | "intro" | "message" | "event";
    date: string;
    description: string;
  };
  interactions: Interaction[];
  notes: string;
  connectionStrength: 1 | 2 | 3 | 4 | 5;
  mutualConnections: string[];
}

export interface NetworkEdge {
  source: string;
  target: string;
  label?: string;
}

export interface EmailWeeklyPoint {
  week: string;
  sent: number;
  received: number;
}

export interface EmailHeatmapCell {
  day: string;
  hour: string;
  rate: number;
}

export interface EmailResponseByType {
  type: string;
  rate: number;
}

/** Row keys beyond `month` are contact-first names used as chart series. */
export type RelationshipHealthRow = { month: string } & Record<string, string | number>;

export interface EmailRecentRow {
  id: string;
  contactId: string;
  contact: string;
  avatar: string;
  avatarColor: string;
  subject: string;
  date: string;
  type: "sent" | "received";
  opened: boolean;
  replied: boolean;
  openCount: number;
  sentiment: string;
}

export interface EmailTrackerItem {
  id: string;
  contactId: string;
  contact: string;
  avatar: string;
  avatarColor: string;
  subject: string;
  openCount: number;
  lastOpened: string | null;
  daysAgo: number;
  suggestion: string;
  urgency: "high" | "medium" | "low";
}

export interface EmailStats {
  totalSent: number;
  openRate: number;
  responseRate: number;
  avgResponseTime: number;
  weeklyData: EmailWeeklyPoint[];
  heatmapData: EmailHeatmapCell[];
  responseRateByType: EmailResponseByType[];
  relationshipHealth: RelationshipHealthRow[];
  recentEmails: EmailRecentRow[];
  trackerItems: EmailTrackerItem[];
}

export interface RecentUpdate {
  id: string;
  timestamp: string;
  input: string;
  actions: string[];
}

export interface WorldSearchResult {
  id: string;
  name: string;
  role: string;
  company: string;
  avatar: string;
  avatarColor: string;
  relevance: number;
  reason: string;
  /** CRM contact ids who might intro — only when derived from graph data; web search usually omits this */
  introducers?: string[];
  connectionPath?: string;
  /** 0–100 composite when ranked via second-degree + intent + recency */
  pathScore?: number;
  /** How pathScore was computed (for transparency) */
  pathScoreBreakdown?: {
    connectionStrength: number;
    edgeConfidence: number;
    intentMatch: number;
    recency: number;
  };
  /** Primary source page (e.g. profile or article) */
  sourceUrl: string;
  snippet?: string;
}

/** How the 1° contact is believed to know the target (drives confidence copy and ranking). */
export type SecondDegreeEvidence =
  | "colleague"
  | "friend"
  | "investor_relation"
  | "intro_offer"
  | "event"
  | "other";

/**
 * A knows B — B may be outside the CRM. Persisted in Supabase.
 * introducerContactId is the CRM id of the person who could make a warm intro.
 */
export interface SecondDegreeEdge {
  id: string;
  introducerContactId: string;
  targetName: string;
  targetCompany: string;
  targetRole: string;
  /** If the target is also a CRM contact */
  targetContactId?: string;
  targetLinkedIn?: string;
  evidence: SecondDegreeEvidence;
  /** 1–5 — strength of the introducer→target relationship for intro purposes */
  confidence: 1 | 2 | 3 | 4 | 5;
  /** Last time this relationship was confirmed or relevant (ISO date) */
  lastEvidenceAt: string;
  notes?: string;
  source: "manual" | "import" | "inferred";
}

export interface ExtendedProfile {
  name: string;
  company: string;
  role: string;
  edgeId?: string;
  confidence?: number;
  evidence?: SecondDegreeEvidence;
}

/** UI/local tracking for the intro request flow (not persisted). */
export type IntroRequestWorkflowStep = "compose" | "outreach" | "track";

/** Variants for introducer-facing message copy. */
export type IntroDraftTone = "default" | "double_opt_in" | "short";

/** Minimal contact row for prompts and lookups (e.g. LLM system prompt). */
export interface ContactSummary {
  id: string;
  name: string;
  company: string;
  role: string;
}

/** Persisted follow-up reminders (may exist without a linked contact). */
export interface StandaloneReminder {
  id: string;
  contactId: string | null;
  date: string;
  text: string;
  done: boolean;
  source?: "manual" | "google_calendar";
  externalEventId?: string;
  externalUrl?: string;
}

/** In-app weekly summary for relationship upkeep. */
export interface WeeklyDigest {
  weekLabel: string;
  driftingCount: number;
  followUpsThisWeek: number;
  interactionsLoggedLast7Days: number;
  topStale: { id: string; name: string; daysSince: number }[];
}

/** Daily "who to reach out to" recommendation generated from profile context + Exa. */
export interface ReachOutRecommendation {
  generatedForDate: string;
  generatedAt: string;
  source: "exa";
  query: string;
  person: {
    name: string;
    role: string;
    company: string;
    reason: string;
    sourceUrl: string;
    snippet?: string;
  };
}
