import { NextRequest, NextResponse } from "next/server";
import { buildGoogleAuthUrl } from "@/lib/integrations/google-calendar";

export async function GET(req: NextRequest) {
  try {
    const redirectTo = req.nextUrl.searchParams.get("redirectTo") ?? "/";
    const url = buildGoogleAuthUrl(redirectTo);
    return NextResponse.redirect(url);
  } catch (err) {
    return NextResponse.json({ ok: false, error: String(err) }, { status: 400 });
  }
}
