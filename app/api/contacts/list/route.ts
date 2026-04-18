import { NextResponse } from "next/server";
import { getContacts } from "@/lib/data";

/**
 * Lightweight contact list for the global command bar. Returns only what
 * the command UI needs to render and filter results — no notes, interactions,
 * or identity evidence.
 */
export async function GET() {
  try {
    const contacts = await getContacts();
    return NextResponse.json({
      contacts: contacts.map((c) => ({
        id: c.id,
        name: c.name,
        company: c.company,
        role: c.role,
        avatar: c.avatar,
        avatarColor: c.avatarColor,
        email: c.email,
        tags: c.tags,
      })),
    });
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
