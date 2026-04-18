/**
 * Pre-meeting briefing data shown on Home. Populated by
 * `getTodaysMeetingsWithBriefings()` and generated on-demand via
 * `/api/briefings/generate`.
 */
export interface MeetingBriefingItem {
  eventId: string;
  startLocal: string;
  endLocal: string | null;
  title: string;
  externalUrl?: string;
  attendees: {
    contactId: string | null;
    name: string;
    company?: string;
    role?: string;
    avatar?: string;
    avatarColor?: string;
  }[];
  primaryContactId: string | null;
  lastInteractionSummary?: string;
  capturedContextSummary?: string;
  prepLine?: string;
  hasStarted: boolean;
  hasEnded: boolean;
  briefingStatus: "ready" | "pending" | "unavailable";
}
