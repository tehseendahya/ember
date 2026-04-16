import { NextRequest, NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { addContactInteraction, completeReminder, snoozeContact, updateInteractionNotes } from "@/lib/data";

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as
      | { action: "snooze"; contactId: string; days?: number }
      | { action: "complete_reminder"; reminderId: string }
      | { action: "add_interaction"; contactId: string; type: string; title: string; notes: string; date?: string }
      | { action: "update_interaction_notes"; interactionId: string; notes: string; contactId: string };

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
    if (body.action === "add_interaction") {
      if (!body.contactId) {
        return NextResponse.json({ ok: false, error: "contactId required" }, { status: 400 });
      }
      if (!body.notes?.trim()) {
        return NextResponse.json({ ok: false, error: "notes required" }, { status: 400 });
      }
      const result = await addContactInteraction({
        contactId: body.contactId,
        type: body.type,
        title: body.title,
        notes: body.notes,
        date: body.date,
      });
      if (!result.ok) {
        return NextResponse.json({ ok: false, error: result.error }, { status: 400 });
      }
      revalidatePath(`/my-people/${body.contactId}`);
      revalidatePath("/my-people");
      revalidatePath("/");
      return NextResponse.json({ ok: true });
    }
    if (body.action === "update_interaction_notes") {
      if (!body.interactionId) {
        return NextResponse.json({ ok: false, error: "interactionId required" }, { status: 400 });
      }
      if (!body.notes?.trim()) {
        return NextResponse.json({ ok: false, error: "notes required" }, { status: 400 });
      }
      const result = await updateInteractionNotes({
        interactionId: body.interactionId,
        notes: body.notes,
      });
      if (!result.ok) {
        return NextResponse.json({ ok: false, error: result.error }, { status: 400 });
      }
      revalidatePath(`/my-people/${body.contactId}`);
      revalidatePath("/my-people");
      revalidatePath("/");
      return NextResponse.json({ ok: true });
    }
    return NextResponse.json({ ok: false, error: "Unknown action" }, { status: 400 });
  } catch (e) {
    return NextResponse.json({ ok: false, error: String(e) }, { status: 500 });
  }
}
