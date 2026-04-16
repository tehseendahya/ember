import { NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { syncRecentGoogleCalendarEvents } from "@/lib/integrations/google-calendar";

export async function POST() {
  const result = await syncRecentGoogleCalendarEvents();
  if (result.ok) {
    revalidatePath("/");
    revalidatePath("/update");
  }
  return NextResponse.json(result, { status: result.ok ? 200 : 400 });
}
