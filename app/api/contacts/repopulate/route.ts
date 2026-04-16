import { NextRequest, NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { requireUserId } from "@/lib/auth";
import { companyFromEmailDomain } from "@/lib/integrations/google-calendar";
import { enrichContactFromWeb } from "@/lib/integrations/enrich-contact-from-web";

export async function POST(req: NextRequest) {
  try {
    const { contactId, nameOverride } = (await req.json()) as {
      contactId?: string;
      nameOverride?: string;
    };
    if (!contactId || typeof contactId !== "string") {
      return NextResponse.json({ ok: false, error: "contactId required" }, { status: 400 });
    }

    const userId = await requireUserId();
    const supabase = await createSupabaseServerClient();

    const { data: contact, error } = await supabase
      .from("contacts")
      .select("id, name, email, company, role, linkedin, notes, tags, last_contact_description")
      .eq("id", contactId)
      .eq("user_id", userId)
      .maybeSingle();

    if (error) {
      return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
    }
    if (!contact) {
      return NextResponse.json({ ok: false, error: "Contact not found" }, { status: 404 });
    }

    const { data: recentInteractions } = await supabase
      .from("interactions")
      .select("title, type, date")
      .eq("user_id", userId)
      .eq("contact_id", contactId)
      .order("date", { ascending: false })
      .limit(4);

    const companyHint = contact.company?.trim() || companyFromEmailDomain(contact.email ?? "");
    const effectiveName =
      typeof nameOverride === "string" && nameOverride.trim().length > 0
        ? nameOverride.trim()
        : contact.name;

    const tagStr = (contact.tags ?? []).filter(Boolean).join(", ");
    const meetingHints = (recentInteractions ?? [])
      .map((i) => i.title?.trim())
      .filter(Boolean)
      .slice(0, 3);
    const relationshipContext = [
      contact.last_contact_description?.trim() && `Last activity: ${contact.last_contact_description.trim()}`,
      tagStr && `Tags: ${tagStr}`,
      meetingHints.length > 0 && `Recent meetings: ${meetingHints.join("; ")}`,
    ]
      .filter(Boolean)
      .join(" · ");

    const enriched = await enrichContactFromWeb({
      name: effectiveName,
      email: contact.email ?? null,
      companyHint,
      relationshipContext,
      whenNoWebData: {
        role: (contact.role ?? "").trim(),
        company: (contact.company ?? "").trim(),
        notes: (contact.notes ?? "").trim(),
      },
    });

    const updatePayload: {
      linkedin: string;
      role: string;
      company: string;
      notes: string;
      name?: string;
    } = {
      linkedin: enriched.linkedin,
      role: enriched.role,
      company: enriched.company,
      notes: enriched.notes,
    };
    if (effectiveName.trim() && effectiveName.trim() !== contact.name.trim()) {
      updatePayload.name = effectiveName.trim();
    }

    const { error: updateError } = await supabase
      .from("contacts")
      .update(updatePayload)
      .eq("id", contact.id)
      .eq("user_id", userId);

    if (updateError) {
      return NextResponse.json({ ok: false, error: updateError.message }, { status: 500 });
    }

    revalidatePath("/my-people");
    revalidatePath(`/my-people/${contactId}`);

    return NextResponse.json({
      ok: true,
      linkedin: enriched.linkedin,
      notes: enriched.notes,
      role: enriched.role,
      company: enriched.company,
      bioUpdated: enriched.snapshotFromWeb,
    });
  } catch (e) {
    return NextResponse.json({ ok: false, error: String(e) }, { status: 500 });
  }
}
