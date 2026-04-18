import "server-only";

import type { MeetingBriefingItem } from "./types";
import { getTodaysMeetingsWithBriefings as impl } from "./service";

/**
 * Today's meetings shaped for the Home briefing card. Thin re-export so
 * `app/page.tsx` can stay unaware of the integration details behind the scenes.
 */
export async function getTodaysMeetingsWithBriefings(): Promise<MeetingBriefingItem[]> {
  try {
    return await impl();
  } catch {
    // Home should never fail because of a calendar hiccup — degrade silently.
    return [];
  }
}
