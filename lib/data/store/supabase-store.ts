import "server-only";
import { randomUUID } from "crypto";
import type { Contact, ContactSummary, ExtendedProfile, Interaction, ReachOutRecommendation, RecentUpdate, SecondDegreeEdge, SecondDegreeEvidence, StandaloneReminder, WeeklyDigest } from "@/lib/types";
import { requireUserId } from "@/lib/auth";
import { createSupabaseServerClient } from "@/lib/supabase/server";

const STALE_CONTACT_DAYS = 45;
const DRIFT_DAYS = 30;
const INTERACTION_TYPES: Interaction["type"][] = ["meeting", "email", "zoom", "intro", "message", "event"];
const EVIDENCE: SecondDegreeEvidence[] = ["colleague", "friend", "investor_relation", "intro_offer", "event", "other"];
const AVATAR_COLORS = ["#6c63ff", "#10b981", "#f59e0b", "#a78bfa", "#34d399", "#f472b6", "#fb923c", "#60a5fa", "#818cf8", "#f87171"];
const todayISO = () => new Date().toISOString().slice(0, 10);
const asInteractionType = (t: string): Interaction["type"] => (INTERACTION_TYPES.includes(t as Interaction["type"]) ? (t as Interaction["type"]) : "message");
const asEvidence = (t: string): SecondDegreeEvidence => (EVIDENCE.includes(t as SecondDegreeEvidence) ? (t as SecondDegreeEvidence) : "other");
const daysBetween = (older: string, newer: string) => Math.floor((new Date(newer + "T12:00:00").getTime() - new Date(older + "T12:00:00").getTime()) / (86400 * 1000));
const initials = (name: string) => { const p = name.trim().split(/\s+/).filter(Boolean); return p.length < 2 ? (p[0]?.slice(0, 2).toUpperCase() ?? "?") : (p[0][0] + p[p.length - 1][0]).toUpperCase(); };
const avatarColor = (name: string) => { let h = 0; for (let i = 0; i < name.length; i++) h = (h + name.charCodeAt(i) * (i + 1)) % AVATAR_COLORS.length; return AVATAR_COLORS[h] ?? AVATAR_COLORS[0]; };

export type ApplyPayload = { matched_contact?: { id: string; name: string } | null; new_contact?: { name: string; company: string; role: string } | null; interaction?: { type: string; title: string; notes: string } | null; reminder?: { date: string; text: string } | null; tags?: string[]; summary?: string; sourceInput?: string };
export type AddSecondDegreeEdgeInput = { introducerContactId: string; targetName: string; targetCompany: string; targetRole: string; targetContactId?: string; targetLinkedIn?: string; evidence: string; confidence: 1 | 2 | 3 | 4 | 5; notes?: string };
export interface TodayData { staleContacts: { contact: Contact; daysSince: number }[]; dueReminders: StandaloneReminder[] }

async function getHydratedContacts(userId: string): Promise<Contact[]> {
  const supabase = await createSupabaseServerClient();
  const [{ data: contacts, error: cErr }, { data: interactions, error: iErr }] = await Promise.all([
    supabase.from("contacts").select("*").eq("user_id", userId).order("name"),
    supabase.from("interactions").select("*").eq("user_id", userId).order("date", { ascending: false }),
  ]);
  if (cErr) throw cErr;
  if (iErr) throw iErr;
  const byId = new Map<string, Interaction[]>();
  for (const i of interactions ?? []) {
    const arr = byId.get(i.contact_id) ?? [];
    arr.push({ id: i.id, date: i.date, type: i.type, title: i.title, notes: i.notes ?? "", reminder: i.reminder ?? undefined });
    byId.set(i.contact_id, arr);
  }
  return (contacts ?? []).map((c) => ({
    id: c.id, name: c.name, email: c.email ?? "", company: c.company ?? "", role: c.role ?? "", linkedIn: c.linkedin ?? "",
    avatar: c.avatar ?? initials(c.name), avatarColor: c.avatar_color ?? avatarColor(c.name), tags: c.tags ?? [],
    lastContact: { type: c.last_contact_type ?? "message", date: c.last_contact_date ?? todayISO(), description: c.last_contact_description ?? "Added to CRM" },
    interactions: byId.get(c.id) ?? [], notes: c.notes ?? "", connectionStrength: c.connection_strength ?? 2, mutualConnections: c.mutual_connections ?? [],
  }));
}

export async function getContacts() { return getHydratedContacts(await requireUserId()); }
export async function getContactById(id: string) { return (await getContacts()).find((c) => c.id === id); }
export async function getContactSummariesForPrompt(): Promise<ContactSummary[]> { return (await getContacts()).map((c) => ({ id: c.id, name: c.name, company: c.company, role: c.role })); }
export async function getRecentUpdates(): Promise<RecentUpdate[]> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.from("recent_updates").select("*").eq("user_id", await requireUserId()).order("timestamp", { ascending: false }).limit(80);
  if (error) throw error;
  return (data ?? []).map((u) => ({ id: u.id, timestamp: u.timestamp, input: u.input, actions: u.actions ?? [] }));
}

export async function applyCrmUpdate(payload: ApplyPayload): Promise<{ ok: true; contactId: string | null; actions: string[] } | { ok: false; error: string }> {
  const userId = await requireUserId(); const supabase = await createSupabaseServerClient(); const actions: string[] = [];
  let contactId: string | null = payload.matched_contact?.id ?? null;
  if (payload.new_contact && !contactId) {
    const id = randomUUID(); const now = todayISO();
    const interaction = payload.interaction ? { id: randomUUID(), user_id: userId, contact_id: id, date: now, type: asInteractionType(payload.interaction.type), title: payload.interaction.title, notes: payload.interaction.notes, reminder: payload.reminder?.date ?? null } : null;
    const tags = [...new Set((payload.tags ?? []).filter(Boolean))]; if (tags.length === 0) tags.push("network");
    const { error: cErr } = await supabase.from("contacts").insert({ id, user_id: userId, name: payload.new_contact.name, email: "", company: payload.new_contact.company ?? "", role: payload.new_contact.role ?? "", linkedin: "", avatar: initials(payload.new_contact.name), avatar_color: avatarColor(payload.new_contact.name), tags, last_contact_type: interaction?.type ?? "message", last_contact_date: interaction?.date ?? now, last_contact_description: interaction?.title ?? "Added to CRM", notes: interaction?.notes ?? "", connection_strength: 2, mutual_connections: [] });
    if (cErr) return { ok: false, error: cErr.message };
    if (interaction) { const { error } = await supabase.from("interactions").insert(interaction); if (error) return { ok: false, error: error.message }; actions.push(`Logged ${interaction.type}: ${interaction.title}`); }
    contactId = id; actions.unshift(`Created contact: ${payload.new_contact.name}`);
  } else if (contactId) {
    const { data: c, error } = await supabase.from("contacts").select("*").eq("id", contactId).eq("user_id", userId).single();
    if (error || !c) return { ok: false, error: "Contact not found" };
    const tags = [...new Set([...(c.tags ?? []), ...(payload.tags ?? [])])];
    let notes = c.notes ?? ""; let lastType = c.last_contact_type; let lastDate = c.last_contact_date; let lastDesc = c.last_contact_description;
    if (payload.interaction) {
      const inter = { id: randomUUID(), user_id: userId, contact_id: contactId, date: todayISO(), type: asInteractionType(payload.interaction.type), title: payload.interaction.title, notes: payload.interaction.notes, reminder: payload.reminder?.date ?? null };
      const { error: iErr } = await supabase.from("interactions").insert(inter); if (iErr) return { ok: false, error: iErr.message };
      lastType = inter.type; lastDate = inter.date; lastDesc = inter.title;
      if (inter.notes.trim()) notes = notes.trim() ? `${notes.trim()}\n\n${inter.notes.trim()}` : inter.notes.trim();
      actions.push(`Updated ${c.name}`, `Added ${inter.type}: ${inter.title}`);
    }
    const { error: uErr } = await supabase.from("contacts").update({ tags, notes, last_contact_type: lastType, last_contact_date: lastDate, last_contact_description: lastDesc }).eq("id", contactId).eq("user_id", userId);
    if (uErr) return { ok: false, error: uErr.message };
  }
  if (payload.reminder) {
    const { error } = await supabase.from("reminders").insert({ id: randomUUID(), user_id: userId, contact_id: contactId, date: payload.reminder.date, text: payload.reminder.text, done: false, source: "manual" });
    if (error) return { ok: false, error: error.message };
    actions.push(contactId ? `Reminder: ${payload.reminder.text} (${payload.reminder.date})` : `Reminder: ${payload.reminder.text}`);
  }
  const updates = payload.summary ? [payload.summary, ...actions] : (actions.length ? actions : ["CRM updated"]);
  const { error } = await supabase.from("recent_updates").insert({ id: randomUUID(), user_id: userId, timestamp: new Date().toISOString(), input: payload.sourceInput?.trim() || "(update)", actions: updates.slice(0, 12) });
  if (error) return { ok: false, error: error.message };
  return { ok: true, contactId, actions };
}

export async function snoozeContact(contactId: string, days: number) { const d = new Date(); d.setDate(d.getDate() + days); const supabase = await createSupabaseServerClient(); await supabase.from("contact_snoozes").upsert({ user_id: await requireUserId(), contact_id: contactId, snoozed_until: d.toISOString().slice(0, 10) }); }
export async function completeReminder(reminderId: string) { const supabase = await createSupabaseServerClient(); await supabase.from("reminders").update({ done: true }).eq("id", reminderId).eq("user_id", await requireUserId()); }

export async function getTodayData(): Promise<TodayData> {
  const userId = await requireUserId(); const contacts = await getHydratedContacts(userId); const supabase = await createSupabaseServerClient();
  const [{ data: reminders }, { data: snoozes }] = await Promise.all([supabase.from("reminders").select("*").eq("user_id", userId), supabase.from("contact_snoozes").select("contact_id,snoozed_until").eq("user_id", userId)]);
  const today = todayISO(); const snoozeMap = new Map((snoozes ?? []).map((s) => [s.contact_id, s.snoozed_until]));
  const staleContacts = contacts.map((contact) => ({ contact, daysSince: daysBetween(contact.lastContact.date, today) })).filter((x) => x.daysSince >= STALE_CONTACT_DAYS && (!snoozeMap.get(x.contact.id) || snoozeMap.get(x.contact.id)! <= today)).sort((a, b) => b.daysSince - a.daysSince).slice(0, 20);
  const dueReminders = (reminders ?? []).filter((r) => !r.done && r.date <= today).map((r) => ({ id: r.id, contactId: r.contact_id, date: r.date, text: r.text, done: r.done, source: r.source ?? "manual", externalEventId: r.external_event_id ?? undefined, externalUrl: r.external_url ?? undefined }));
  return { staleContacts, dueReminders };
}

export async function getWeeklyDigest(): Promise<WeeklyDigest> {
  const userId = await requireUserId(); const contacts = await getHydratedContacts(userId); const supabase = await createSupabaseServerClient();
  const today = new Date(); const todayStr = today.toISOString().slice(0, 10); const weekStart = new Date(today); weekStart.setDate(weekStart.getDate() - 7); const weekStartStr = weekStart.toISOString().slice(0, 10); const horizon = new Date(today); horizon.setDate(horizon.getDate() + 7); const horizonStr = horizon.toISOString().slice(0, 10);
  const [{ data: reminders }, { data: interactions }] = await Promise.all([supabase.from("reminders").select("date,done").eq("user_id", userId), supabase.from("interactions").select("date").eq("user_id", userId)]);
  const stale = contacts.map((c) => ({ id: c.id, name: c.name, daysSince: daysBetween(c.lastContact.date, todayStr) })).filter((x) => x.daysSince >= DRIFT_DAYS).sort((a, b) => b.daysSince - a.daysSince);
  return { weekLabel: `Week of ${weekStart.toLocaleDateString("en-US", { month: "short", day: "numeric" })}`, driftingCount: stale.length, followUpsThisWeek: (reminders ?? []).filter((r) => !r.done && r.date >= todayStr && r.date <= horizonStr).length, interactionsLoggedLast7Days: (interactions ?? []).filter((i) => i.date >= weekStartStr && i.date <= todayStr).length, topStale: stale.slice(0, 8) };
}

export async function getSecondDegreeEdges(): Promise<SecondDegreeEdge[]> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.from("second_degree_edges").select("*").eq("user_id", await requireUserId()).order("last_evidence_at", { ascending: false });
  if (error) throw error;
  return (data ?? []).map((e) => ({ id: e.id, introducerContactId: e.introducer_contact_id, targetName: e.target_name, targetCompany: e.target_company, targetRole: e.target_role, targetContactId: e.target_contact_id ?? undefined, targetLinkedIn: e.target_linkedin ?? undefined, evidence: e.evidence, confidence: e.confidence, lastEvidenceAt: e.last_evidence_at, notes: e.notes ?? undefined, source: e.source }));
}
export async function buildExtendedConnectionsMap(): Promise<Record<string, ExtendedProfile[]>> { const map: Record<string, ExtendedProfile[]> = {}; for (const e of await getSecondDegreeEdges()) (map[e.introducerContactId] ??= []).push({ name: e.targetName, company: e.targetCompany, role: e.targetRole, edgeId: e.id, confidence: e.confidence, evidence: e.evidence }); return map; }
export async function addSecondDegreeEdge(input: AddSecondDegreeEdgeInput): Promise<{ ok: true; edge: SecondDegreeEdge } | { ok: false; error: string }> {
  if (!(await getContacts()).some((c) => c.id === input.introducerContactId)) return { ok: false, error: "Introducer not found" };
  const edge: SecondDegreeEdge = { id: randomUUID(), introducerContactId: input.introducerContactId, targetName: input.targetName.trim(), targetCompany: input.targetCompany.trim(), targetRole: input.targetRole.trim(), targetContactId: input.targetContactId, targetLinkedIn: input.targetLinkedIn?.trim() || undefined, evidence: asEvidence(input.evidence), confidence: input.confidence, lastEvidenceAt: todayISO(), notes: input.notes?.trim() || undefined, source: "manual" };
  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.from("second_degree_edges").insert({ id: edge.id, user_id: await requireUserId(), introducer_contact_id: edge.introducerContactId, target_name: edge.targetName, target_company: edge.targetCompany, target_role: edge.targetRole, target_contact_id: edge.targetContactId ?? null, target_linkedin: edge.targetLinkedIn ?? null, evidence: edge.evidence, confidence: edge.confidence, last_evidence_at: edge.lastEvidenceAt, notes: edge.notes ?? null, source: edge.source });
  if (error) return { ok: false, error: error.message }; return { ok: true, edge };
}
export async function deleteSecondDegreeEdge(edgeId: string) { const supabase = await createSupabaseServerClient(); const { error, count } = await supabase.from("second_degree_edges").delete({ count: "exact" }).eq("id", edgeId).eq("user_id", await requireUserId()); return !error && (count ?? 0) > 0; }
export async function confirmSecondDegreeIntro(edgeId: string, noteAppend?: string) {
  const userId = await requireUserId(); const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.from("second_degree_edges").select("notes").eq("id", edgeId).eq("user_id", userId).single(); if (error || !data) return false;
  const notes = noteAppend?.trim() ? (data.notes?.trim() ? `${data.notes.trim()}\n${noteAppend.trim()}` : noteAppend.trim()) : data.notes;
  const { error: uErr } = await supabase.from("second_degree_edges").update({ last_evidence_at: todayISO(), notes: notes ?? null }).eq("id", edgeId).eq("user_id", userId);
  return !uErr;
}

export async function getProfileContext(): Promise<string> {
  const userId = await requireUserId();
  const supabase = await createSupabaseServerClient();
  const { data } = await supabase.from("user_settings").select("profile_context").eq("user_id", userId).maybeSingle();
  return data?.profile_context ?? "";
}

export async function setProfileContext(value: string): Promise<void> {
  const userId = await requireUserId();
  const supabase = await createSupabaseServerClient();
  await supabase.from("user_settings").upsert({ user_id: userId, profile_context: value.trim() });
}

export async function getReachOutRecommendation(): Promise<ReachOutRecommendation | null> {
  const userId = await requireUserId();
  const supabase = await createSupabaseServerClient();
  const { data } = await supabase.from("user_settings").select("reach_out_recommendation").eq("user_id", userId).maybeSingle();
  return (data?.reach_out_recommendation as ReachOutRecommendation | null) ?? null;
}

export async function setReachOutRecommendation(value: ReachOutRecommendation | null): Promise<void> {
  const userId = await requireUserId();
  const supabase = await createSupabaseServerClient();
  await supabase.from("user_settings").upsert({ user_id: userId, reach_out_recommendation: value });
}
