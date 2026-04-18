import { NextRequest, NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { requireUserId } from "@/lib/auth";
import { enrichContactFromWeb } from "@/lib/integrations/enrich-contact-from-web";
import { companyFromWorkEmailDomain } from "@/lib/integrations/calendar-identity-resolver";
import { parseVerificationInput } from "@/lib/integrations/parse-verification-input";
import { getProfileContext } from "@/lib/data";
import { compactProfileContext } from "@/lib/profile-context";

type VerifyAction =
  | { action: "confirm" } // user says "this profile is correct, stop bugging me"
  | { action: "dismiss" } // user says "not a real contact, leave alone but clear flag"
  | { action: "delete" } // user says "this contact shouldn't exist"
  | { action: "apply_candidate"; candidateIndex: number; context?: string } // pick one of the stored candidates; optional clarifying context
  | {
      /**
       * Prefer `prompt`: one free-form line; the server uses an LLM to split
       * display name vs supporting context (so the whole sentence is not stored as name).
       * Legacy: `name` / `context` are still accepted and merged if `prompt` is absent.
       */
      action: "rename_and_reenrich";
      prompt?: string;
      name?: string;
      context?: string;
    };

export async function POST(req: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params;
    if (!id) return NextResponse.json({ ok: false, error: "contact id required" }, { status: 400 });

    const body = (await req.json()) as VerifyAction;
    const userId = await requireUserId();
    const supabase = await createSupabaseServerClient();

    const { data: contact, error: readErr } = await supabase
      .from("contacts")
      .select(
        "id, name, email, company, role, linkedin, notes, needs_verification, verification_reason, verification_candidates, identity_evidence",
      )
      .eq("id", id)
      .eq("user_id", userId)
      .maybeSingle();
    if (readErr) return NextResponse.json({ ok: false, error: readErr.message }, { status: 500 });
    if (!contact) return NextResponse.json({ ok: false, error: "Contact not found" }, { status: 404 });

    if (body.action === "confirm") {
      const { error } = await supabase
        .from("contacts")
        .update({ needs_verification: false, verification_reason: "" })
        .eq("id", id)
        .eq("user_id", userId);
      if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
      revalidatePath(`/people/${id}`);
      revalidatePath("/people");
      return NextResponse.json({ ok: true });
    }

    if (body.action === "dismiss") {
      const { error } = await supabase
        .from("contacts")
        .update({ needs_verification: false, verification_reason: "dismissed by user", verification_candidates: [] })
        .eq("id", id)
        .eq("user_id", userId);
      if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
      revalidatePath(`/people/${id}`);
      revalidatePath("/people");
      return NextResponse.json({ ok: true });
    }

    if (body.action === "delete") {
      const { error } = await supabase.from("contacts").delete().eq("id", id).eq("user_id", userId);
      if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
      revalidatePath("/people");
      return NextResponse.json({ ok: true, deleted: true });
    }

    if (body.action === "apply_candidate") {
      const idx = Number(body.candidateIndex);
      const candidates = (contact.verification_candidates ?? []) as Array<{
        name?: string;
        linkedin?: string;
        title?: string;
        snippet?: string;
      }>;
      const pick = candidates[idx];
      if (!pick) return NextResponse.json({ ok: false, error: "candidate not found" }, { status: 400 });

      // Re-run enrichment focused on the picked LinkedIn's headline/title so we
      // pull role + bullets from *that* profile, not the previous best guess.
      const companyHint = companyFromWorkEmailDomain(contact.email ?? "") || (contact.company ?? "");
      const effectiveName = (pick.name?.trim() || contact.name).trim();
      const extraContext = body.context?.trim() ?? "";
      const enriched = await enrichContactFromWeb({
        name: effectiveName,
        email: contact.email ?? null,
        companyHint,
        relationshipContext: `User picked LinkedIn candidate: ${pick.linkedin ?? ""}`,
        whenNoWebData: {
          role: contact.role ?? "",
          company: contact.company ?? "",
          notes: contact.notes ?? "",
        },
        strictMatch: false,
        userHint: [pick.title, extraContext].filter(Boolean).join(" · "),
      });

      const { error } = await supabase
        .from("contacts")
        .update({
          name: effectiveName,
          linkedin: pick.linkedin ?? enriched.linkedin,
          role: enriched.role || contact.role,
          company: enriched.company || contact.company,
          notes: enriched.notes || contact.notes,
          needs_verification: false,
          verification_reason: "",
          verification_candidates: [],
        })
        .eq("id", id)
        .eq("user_id", userId);
      if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
      revalidatePath(`/people/${id}`);
      revalidatePath("/people");
      return NextResponse.json({
        ok: true,
        name: effectiveName,
        linkedin: pick.linkedin ?? enriched.linkedin,
        role: enriched.role || contact.role,
        company: enriched.company || contact.company,
        notes: enriched.notes || contact.notes,
      });
    }

    if (body.action === "rename_and_reenrich") {
      const prompt = body.prompt?.trim() ?? "";
      const legacyName = body.name?.trim() ?? "";
      const legacyContext = body.context?.trim() ?? "";
      const combined =
        prompt ||
        (legacyName && legacyContext
          ? `${legacyName} — ${legacyContext}`
          : legacyName || legacyContext);
      if (!combined) {
        return NextResponse.json(
          { ok: false, error: "provide a corrected name, a clarification, or both" },
          { status: 400 },
        );
      }

      const placeholder = String(contact.name ?? "").trim();
      let ownerProfileForParse = "";
      try {
        ownerProfileForParse = compactProfileContext(await getProfileContext(), 500);
      } catch {
        ownerProfileForParse = "";
      }
      const { name: parsedName, context: parsedContext } = await parseVerificationInput(
        combined,
        placeholder,
        ownerProfileForParse || undefined,
      );
      const name = parsedName.trim() || placeholder || combined;
      const context = parsedContext.trim();
      const companyHint = companyFromWorkEmailDomain(contact.email ?? "") || (contact.company ?? "");
      const relationshipContext = [
        name && name !== placeholder ? `User corrected or clarified the name.` : "",
        context ? `User-provided context: ${context}` : "",
        `Email: ${contact.email ?? "(none)"}.`,
      ]
        .filter(Boolean)
        .join(" ");

      const enriched = await enrichContactFromWeb({
        name,
        email: contact.email ?? null,
        companyHint,
        relationshipContext,
        whenNoWebData: {
          role: contact.role ?? "",
          company: contact.company ?? "",
          notes: contact.notes ?? "",
        },
        // When the user supplied clarifying context, enrichContactFromWeb internally
        // relaxes strict matching ("user-vouched" mode).
        strictMatch: true,
        userHint: context || undefined,
      });

      // When the user typed clarifying context but the enricher couldn't
      // corroborate it, we still respect their input and keep the record
      // flagged so the candidate list stays visible — but we record *why*
      // so they know to refine.
      const { error } = await supabase
        .from("contacts")
        .update({
          name,
          linkedin: enriched.linkedin,
          role: enriched.role,
          company: enriched.company,
          notes: enriched.notes,
          needs_verification: enriched.needsVerification,
          verification_reason: enriched.verificationReason,
          verification_candidates: enriched.candidates,
        })
        .eq("id", id)
        .eq("user_id", userId);
      if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
      revalidatePath(`/people/${id}`);
      revalidatePath("/people");
      return NextResponse.json({
        ok: true,
        name,
        linkedin: enriched.linkedin,
        role: enriched.role,
        company: enriched.company,
        notes: enriched.notes,
        needsVerification: enriched.needsVerification,
        verificationReason: enriched.verificationReason,
        candidates: enriched.candidates,
      });
    }

    return NextResponse.json({ ok: false, error: "unknown action" }, { status: 400 });
  } catch (e) {
    return NextResponse.json({ ok: false, error: String(e) }, { status: 500 });
  }
}
