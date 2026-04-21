import { NextRequest, NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";

function decodeOAuthParam(value: string): string {
  try {
    return decodeURIComponent(value.replace(/\+/g, " "));
  } catch {
    return value.replace(/\+/g, " ");
  }
}

export async function GET(req: NextRequest) {
  const oauthError = req.nextUrl.searchParams.get("error");
  const oauthDescription = req.nextUrl.searchParams.get("error_description");
  if (oauthError) {
    const url = new URL("/auth", req.url);
    const detail = oauthDescription ? decodeOAuthParam(oauthDescription) : oauthError;
    url.searchParams.set("message", detail);
    return NextResponse.redirect(url);
  }

  const code = req.nextUrl.searchParams.get("code");
  const next = req.nextUrl.searchParams.get("next") || "/";
  if (!code) {
    return NextResponse.redirect(new URL("/auth", req.url));
  }
  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.auth.exchangeCodeForSession(code);
  if (error) {
    const url = new URL("/auth", req.url);
    url.searchParams.set("message", error.message);
    return NextResponse.redirect(url);
  }
  return NextResponse.redirect(new URL(next, req.url));
}
