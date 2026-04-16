import { NextRequest, NextResponse } from "next/server";
import { getProfileContext, setProfileContext } from "@/lib/data";

export async function GET() {
  const profileContext = await getProfileContext();
  return NextResponse.json({ profileContext });
}

export async function POST(req: NextRequest) {
  let body: { profileContext?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const profileContext = typeof body.profileContext === "string" ? body.profileContext.trim() : "";
  setProfileContext(profileContext);
  return NextResponse.json({ ok: true });
}
