import { NextRequest, NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { applyCrmUpdate, type ApplyPayload } from "@/lib/data";

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as ApplyPayload & { sourceInput?: string };
    const result = await applyCrmUpdate(body);
    if (!result.ok) {
      return NextResponse.json(result, { status: 400 });
    }
    revalidatePath("/");
    revalidatePath("/people");
    if (result.contactId) {
      revalidatePath(`/people/${result.contactId}`);
    }
    return NextResponse.json(result);
  } catch (e) {
    return NextResponse.json({ ok: false, error: String(e) }, { status: 500 });
  }
}
