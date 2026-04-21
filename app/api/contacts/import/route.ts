import { NextRequest, NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { randomUUID } from "crypto";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { requireUserId } from "@/lib/auth";
import { enrichContactFromWeb, shouldUpgradeNameToResolved } from "@/lib/integrations/enrich-contact-from-web";
import { companyFromEmailDomain } from "@/lib/integrations/google-calendar";
import { persistConnectionStrengthsForContacts } from "@/lib/data/store/supabase-store";

export const maxDuration = 120;

const AVATAR_COLORS = [
  "#6c63ff",
  "#10b981",
  "#f59e0b",
  "#a78bfa",
  "#34d399",
  "#f472b6",
  "#fb923c",
  "#60a5fa",
  "#818cf8",
  "#f87171",
];

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length < 2) return (parts[0]?.slice(0, 2).toUpperCase() ?? "?");
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

function avatarColor(name: string): string {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h + name.charCodeAt(i) * (i + 1)) % AVATAR_COLORS.length;
  return AVATAR_COLORS[h] ?? AVATAR_COLORS[0];
}

/** Canonicalize email for dedupe. Returns "" for falsy input. */
function normalizeEmail(email: string | null | undefined): string {
  return (email ?? "").trim().toLowerCase();
}

/** Canonicalize LinkedIn URL to a stable slug for dedupe (ignore protocol, trailing slashes, query). */
function normalizeLinkedIn(url: string | null | undefined): string {
  const raw = (url ?? "").trim().toLowerCase();
  if (!raw) return "";
  return raw
    .replace(/^https?:\/\//, "")
    .replace(/^www\./, "")
    .replace(/\?.*$/, "")
    .replace(/\/+$/, "");
}

interface IncomingRow {
  name: string;
  email?: string;
  company?: string;
  role?: string;
  linkedIn?: string;
  notes?: string;
  tags?: string[];
  /** Whether the client flagged this row as sparse. Purely advisory. */
  looksSparse?: boolean;
}

type AiMode = "auto" | "always" | "never";

interface ImportRequest {
  rows?: IncomingRow[];
  aiMode?: AiMode;
}

interface ResultRow {
  name: string;
  status: "created" | "skipped_duplicate" | "failed";
  contactId?: string;
  enriched?: boolean;
  reason?: string;
}

/** Should we bother calling the web enrichment for this row? */
function shouldEnrich(row: IncomingRow, aiMode: AiMode): boolean {
  if (aiMode === "never") return false;
  if (aiMode === "always") return true;
  return row.looksSparse === true;
}

async function loadExistingIndex(
  supabase: Awaited<ReturnType<typeof createSupabaseServerClient>>,
  userId: string,
): Promise<{ emails: Set<string>; linkedins: Set<string>; nameCompany: Set<string> }> {
  const { data } = await supabase
    .from("contacts")
    .select("email, linkedin, name, company")
    .eq("user_id", userId);
  const emails = new Set<string>();
  const linkedins = new Set<string>();
  const nameCompany = new Set<string>();
  for (const row of data ?? []) {
    const e = normalizeEmail(row.email as string);
    if (e) emails.add(e);
    const li = normalizeLinkedIn(row.linkedin as string);
    if (li) linkedins.add(li);
    const key = `${(row.name ?? "").trim().toLowerCase()}|${(row.company ?? "").trim().toLowerCase()}`;
    if (key !== "|") nameCompany.add(key);
  }
  return { emails, linkedins, nameCompany };
}

function isDuplicate(
  row: IncomingRow,
  resolvedName: string,
  resolvedCompany: string,
  resolvedLinkedIn: string,
  existing: { emails: Set<string>; linkedins: Set<string>; nameCompany: Set<string> },
): boolean {
  const email = normalizeEmail(row.email);
  if (email && existing.emails.has(email)) return true;
  const li = normalizeLinkedIn(resolvedLinkedIn);
  if (li && existing.linkedins.has(li)) return true;
  const key = `${resolvedName.trim().toLowerCase()}|${resolvedCompany.trim().toLowerCase()}`;
  if (key !== "|" && existing.nameCompany.has(key)) return true;
  return false;
}

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as ImportRequest;
    const rows = Array.isArray(body.rows) ? body.rows : [];
    const aiMode: AiMode = body.aiMode === "always" || body.aiMode === "never" ? body.aiMode : "auto";

    if (rows.length === 0) {
      return NextResponse.json({ ok: false, error: "No rows to import" }, { status: 400 });
    }
    if (rows.length > 200) {
      return NextResponse.json(
        { ok: false, error: "Please import in batches of 200 rows or fewer" },
        { status: 400 },
      );
    }

    const userId = await requireUserId();
    const supabase = await createSupabaseServerClient();
    const existing = await loadExistingIndex(supabase, userId);

    const results: ResultRow[] = [];
    const createdContactIds: string[] = [];

    // Sequential is fine for small batches; the expensive path is enrichContactFromWeb
    // (Exa + OpenAI). Batches are capped client-side, so this stays responsive.
    for (const row of rows) {
      const name = row.name?.trim() ?? "";
      if (!name) {
        results.push({ name: "", status: "failed", reason: "Missing name" });
        continue;
      }

      let finalName = name;
      let finalCompany = row.company?.trim() ?? "";
      let finalRole = row.role?.trim() ?? "";
      let finalLinkedIn = row.linkedIn?.trim() ?? "";
      const baseNotes = row.notes?.trim() ?? "";
      let finalNotes = baseNotes;
      let enriched = false;

      if (shouldEnrich(row, aiMode)) {
        try {
          const companyHint = finalCompany || companyFromEmailDomain(row.email ?? "") || "";
          const tagStr = (row.tags ?? []).filter(Boolean).join(", ");
          const relationshipContext =
            [baseNotes && `Imported note: ${baseNotes}`, tagStr && `Tags: ${tagStr}`]
              .filter(Boolean)
              .join(" · ") || "Imported from CSV.";
          const result = await enrichContactFromWeb({
            name: finalName,
            email: row.email?.trim() || null,
            companyHint,
            relationshipContext,
            whenNoWebData: {
              role: finalRole,
              company: finalCompany,
              notes: baseNotes,
            },
          });
          // Prefer CSV-provided values; fill missing fields from enrichment.
          if (!finalCompany && result.company) finalCompany = result.company;
          if (!finalRole && result.role) finalRole = result.role;
          if (!finalLinkedIn && result.linkedin) finalLinkedIn = result.linkedin;
          if (!finalNotes && result.notes) finalNotes = result.notes;
          if (
            result.resolvedFullName &&
            shouldUpgradeNameToResolved(finalName, result.resolvedFullName)
          ) {
            finalName = result.resolvedFullName.trim();
          }
          enriched = result.snapshotFromWeb;
        } catch (err) {
          // Non-fatal: we still insert whatever we had from the CSV.
          console.warn("[import] enrichment failed for", name, err);
        }
      }

      if (isDuplicate(row, finalName, finalCompany, finalLinkedIn, existing)) {
        results.push({
          name: finalName,
          status: "skipped_duplicate",
          reason: "A contact with this email, LinkedIn, or name+company already exists",
        });
        continue;
      }

      const id = randomUUID();
      const tags = Array.from(new Set((row.tags ?? []).map((t) => t.trim()).filter(Boolean))).slice(0, 8);
      if (tags.length === 0) tags.push("imported");

      const { error } = await supabase.from("contacts").insert({
        id,
        user_id: userId,
        name: finalName,
        email: row.email?.trim() ?? "",
        company: finalCompany,
        role: finalRole,
        linkedin: finalLinkedIn,
        avatar: initials(finalName),
        avatar_color: avatarColor(finalName),
        tags,
        last_contact_type: "message",
        last_contact_date: new Date().toISOString().slice(0, 10),
        last_contact_description: "Imported from CSV",
        notes: finalNotes,
        connection_strength: 2,
        mutual_connections: [],
      });

      if (error) {
        results.push({ name: finalName, status: "failed", reason: error.message });
        continue;
      }

      // Track just-inserted contact so subsequent rows in the same batch also dedupe.
      const emailKey = normalizeEmail(row.email);
      if (emailKey) existing.emails.add(emailKey);
      const liKey = normalizeLinkedIn(finalLinkedIn);
      if (liKey) existing.linkedins.add(liKey);
      existing.nameCompany.add(`${finalName.trim().toLowerCase()}|${finalCompany.trim().toLowerCase()}`);

      results.push({ name: finalName, status: "created", contactId: id, enriched });
      createdContactIds.push(id);
    }

    const anyCreated = results.some((r) => r.status === "created");
    if (createdContactIds.length > 0) {
      await persistConnectionStrengthsForContacts(userId, createdContactIds);
    }
    if (anyCreated) {
      revalidatePath("/people");
    }

    return NextResponse.json({
      ok: true,
      results,
      summary: {
        created: results.filter((r) => r.status === "created").length,
        skipped: results.filter((r) => r.status === "skipped_duplicate").length,
        failed: results.filter((r) => r.status === "failed").length,
        enriched: results.filter((r) => r.enriched).length,
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const status = message === "Unauthorized" ? 401 : 500;
    return NextResponse.json({ ok: false, error: message }, { status });
  }
}
