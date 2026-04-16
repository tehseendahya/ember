/**
 * Application data layer — import from here in routes and server components.
 *
 * Contact data and CRM mutations persist to Supabase tables (see `lib/data/store/supabase-store.ts`).
 * Email analytics remain mock-backed. Network edges (1°) are fixtures; second-degree edges persist in Supabase.
 */

export type {
  Contact,
  ContactSummary,
  EmailStats,
  ExtendedProfile,
  Interaction,
  IntroDraftTone,
  IntroRequestWorkflowStep,
  NetworkEdge,
  RecentUpdate,
  ReachOutRecommendation,
  SecondDegreeEdge,
  SecondDegreeEvidence,
  StandaloneReminder,
  WeeklyDigest,
  WorldSearchResult,
} from "@/lib/types";

export type { AddContactInteractionInput, AddSecondDegreeEdgeInput, ApplyPayload, TodayData } from "./store/supabase-store";

export {
  addSecondDegreeEdge,
  addContactInteraction,
  applyCrmUpdate,
  buildExtendedConnectionsMap,
  completeReminder,
  confirmSecondDegreeIntro,
  deleteSecondDegreeEdge,
  getContactById,
  getContactSummariesForPrompt,
  getContacts,
  getProfileContext,
  getReachOutRecommendation,
  getSecondDegreeEdges,
  getRecentUpdates,
  setProfileContext,
  setReachOutRecommendation,
  getTodayData,
  getWeeklyDigest,
  snoozeContact,
} from "./store/supabase-store";

export {
  getEmailStats,
  getExtendedConnections,
  getNetworkEdges,
  getWorldSearchResults,
} from "./mock/queries";
