import { NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import {
  syncRecentGoogleCalendarEvents,
  type CalendarSyncResult,
} from "@/lib/integrations/google-calendar";

function syncFailureStatus(result: CalendarSyncResult): number {
  if (result.ok) return 200;
  switch (result.errorCode) {
    case "rate_limit":
      return 429;
    case "not_connected":
    case "oauth_refresh":
    case "oauth_exchange":
    case "auth":
      return 401;
    case "missing_config":
      return 400;
    case "google_api":
      return 502;
    default:
      return 400;
  }
}

export async function POST() {
  const result = await syncRecentGoogleCalendarEvents();
  if (result.ok) {
    revalidatePath("/");
    revalidatePath("/people");
  }
  return NextResponse.json(result, { status: result.ok ? 200 : syncFailureStatus(result) });
}
