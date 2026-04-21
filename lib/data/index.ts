/**
 * Application data layer — import from here in routes and server components.
 *
 * Contact data and CRM mutations persist to Supabase tables (see `lib/data/store/supabase-store.ts`).
 * Network edges (1°) are fixtures; second-degree edges persist in Supabase.
 */

export type {
  Contact,
  ContactSummary,
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

export type { AddContactInteractionInput, AddSecondDegreeEdgeInput, ApplyPayload, TodayData, UpdateInteractionNotesInput } from "./store/supabase-store";

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
  persistConnectionStrengthsForContacts,
  recomputeAllConnectionStrengthsForUser,
  scheduleReminder,
  setProfileContext,
  setReachOutRecommendation,
  getTodayData,
  getWeeklyDigest,
  snoozeContact,
  updateInteractionNotes,
} from "./store/supabase-store";

export {
  getExtendedConnections,
  getNetworkEdges,
  getWorldSearchResults,
} from "./mock/queries";
