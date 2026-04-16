import { NextRequest, NextResponse } from "next/server";
import { handleGoogleOAuthCallback, syncRecentGoogleCalendarEvents } from "@/lib/integrations/google-calendar";

export async function GET(req: NextRequest) {
  const code = req.nextUrl.searchParams.get("code");
  const state = req.nextUrl.searchParams.get("state");
  const error = req.nextUrl.searchParams.get("error");

  if (error) {
    return NextResponse.redirect(new URL(`/?googleCalendar=error&reason=${encodeURIComponent(error)}`, req.url));
  }
  if (!code || !state) {
    return NextResponse.json({ ok: false, error: "Missing OAuth code/state" }, { status: 400 });
  }

  try {
    const { redirectTo } = await handleGoogleOAuthCallback(code, state);
    await syncRecentGoogleCalendarEvents();
    return NextResponse.redirect(new URL(`${redirectTo}?googleCalendar=connected`, req.url));
  } catch (err) {
    return NextResponse.redirect(new URL(`/?googleCalendar=error&reason=${encodeURIComponent(String(err))}`, req.url));
  }
}
