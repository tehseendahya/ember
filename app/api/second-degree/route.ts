import { NextRequest, NextResponse } from "next/server";
import {
  addSecondDegreeEdge,
  confirmSecondDegreeIntro,
  deleteSecondDegreeEdge,
  getSecondDegreeEdges,
} from "@/lib/data";

export async function GET(req: NextRequest) {
  const introducerId = req.nextUrl.searchParams.get("introducerContactId");
  const edges = await getSecondDegreeEdges();
  if (introducerId) {
    return NextResponse.json({
      edges: edges.filter((e) => e.introducerContactId === introducerId),
    });
  }
  return NextResponse.json({ edges });
}

export async function POST(req: NextRequest) {
  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const rawConf = Number(body.confidence);
  const confidence = Math.min(5, Math.max(1, Math.round(Number.isFinite(rawConf) ? rawConf : 3))) as
    | 1
    | 2
    | 3
    | 4
    | 5;

  const result = await addSecondDegreeEdge({
    introducerContactId: String(body.introducerContactId ?? ""),
    targetName: String(body.targetName ?? ""),
    targetCompany: String(body.targetCompany ?? ""),
    targetRole: String(body.targetRole ?? ""),
    targetContactId: body.targetContactId ? String(body.targetContactId) : undefined,
    targetLinkedIn: body.targetLinkedIn ? String(body.targetLinkedIn) : undefined,
    evidence: String(body.evidence ?? "other"),
    confidence,
    notes: body.notes ? String(body.notes) : undefined,
  });
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: 400 });
  }
  return NextResponse.json({ edge: result.edge });
}

export async function DELETE(req: NextRequest) {
  const id = req.nextUrl.searchParams.get("id");
  if (!id) {
    return NextResponse.json({ error: "Missing id" }, { status: 400 });
  }
  const ok = await deleteSecondDegreeEdge(id);
  if (!ok) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  return NextResponse.json({ ok: true });
}

export async function PATCH(req: NextRequest) {
  let body: { id?: string; noteAppend?: string };
  try {
    body = (await req.json()) as { id?: string; noteAppend?: string };
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const id = String(body.id ?? "");
  if (!id) {
    return NextResponse.json({ error: "Missing id" }, { status: 400 });
  }
  const ok = await confirmSecondDegreeIntro(id, body.noteAppend ? String(body.noteAppend) : undefined);
  if (!ok) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  return NextResponse.json({ ok: true });
}
