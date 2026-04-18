import { NextRequest, NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { enrichAndMergeContactProfile } from "@/lib/integrations/contact-enrichment";

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as { contactId?: string };
    if (!body.contactId?.trim()) {
      return NextResponse.json({ ok: false, error: "contactId required" }, { status: 400 });
    }
    const result = await enrichAndMergeContactProfile(body.contactId);
    if (!result.ok) {
      return NextResponse.json(result, { status: 400 });
    }
    revalidatePath(`/people/${body.contactId}`);
    revalidatePath("/people");
    return NextResponse.json({ ok: true, enrichment: result.enrichment });
  } catch (error) {
    return NextResponse.json({ ok: false, error: String(error) }, { status: 500 });
  }
}
