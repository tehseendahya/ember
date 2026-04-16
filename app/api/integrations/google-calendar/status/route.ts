import { NextResponse } from "next/server";
import { getGoogleIntegrationStatus } from "@/lib/integrations/google-calendar";

export async function GET() {
  return NextResponse.json(await getGoogleIntegrationStatus());
}
