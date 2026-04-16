import { NextRequest, NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { requireUserId } from "@/lib/auth";

export async function POST(req: NextRequest) {
  try {
    const { contactId, name } = (await req.json()) as {
      contactId?: string;
      name?: string;
    };

    if (!contactId || typeof contactId !== "string") {
      return NextResponse.json({ ok: false, error: "contactId required" }, { status: 400 });
    }
    if (!name || typeof name !== "string" || !name.trim()) {
      return NextResponse.json({ ok: false, error: "name required" }, { status: 400 });
    }

    const userId = await requireUserId();
    const supabase = await createSupabaseServerClient();

    const { error } = await supabase
      .from("contacts")
      .update({ name: name.trim() })
      .eq("id", contactId)
      .eq("user_id", userId);

    if (error) {
      return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
    }

    revalidatePath("/my-people");
    revalidatePath(`/my-people/${contactId}`);

    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ ok: false, error: String(e) }, { status: 500 });
  }
}

