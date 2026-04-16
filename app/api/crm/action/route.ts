import { NextRequest, NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { completeReminder, snoozeContact } from "@/lib/data";

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as
      | { action: "snooze"; contactId: string; days?: number }
      | { action: "complete_reminder"; reminderId: string };

    if (body.action === "snooze") {
      if (!body.contactId) {
        return NextResponse.json({ ok: false, error: "contactId required" }, { status: 400 });
      }
      await snoozeContact(body.contactId, body.days ?? 7);
      revalidatePath("/");
      return NextResponse.json({ ok: true });
    }
    if (body.action === "complete_reminder") {
      if (!body.reminderId) {
        return NextResponse.json({ ok: false, error: "reminderId required" }, { status: 400 });
      }
      await completeReminder(body.reminderId);
      revalidatePath("/");
      return NextResponse.json({ ok: true });
    }
    return NextResponse.json({ ok: false, error: "Unknown action" }, { status: 400 });
  } catch (e) {
    return NextResponse.json({ ok: false, error: String(e) }, { status: 500 });
  }
}
