import "server-only";
import { randomUUID } from "crypto";
import type { Contact, ContactSummary, ExtendedProfile, Interaction, RecentUpdate, SecondDegreeEdge, SecondDegreeEvidence, StandaloneReminder, WeeklyDigest } from "@/lib/types";
import { requireUserId } from "@/lib/auth";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

const STALE_CONTACT_DAYS = 45;
const DRIFT_DAYS = 30;
const INTERACTION_TYPES: Interaction["type"][] = ["meeting", "email", "zoom", "intro", "message", "event"];
const EVIDENCE: SecondDegreeEvidence[] = ["colleague", "friend", "investor_relation", "intro_offer", "event", "other"];

const AVATAR_COLORS = ["#6c63ff", "#10b981", "#f59e0b", "#a78bfa", "#34d399", "#f472b6", "#fb923c", "#60a5fa", "#818cf8", "#f87171"];
const todayISO = () => new Date().toISOString().slice(0, 10);
const asInteractionType = (t: string): Interaction["type"] => (INTERACTION_TYPES.includes(t as Interaction["type"]) ? (t as Interaction["type"]) : "message");
const asEvidence = (t: string): SecondDegreeEvidence => (EVIDENCE.includes(t as SecondDegreeEvidence) ? (t as SecondDegreeEvidence) : "other");
const daysBetween = (older: string, newer: string) => Math.floor((new Date(newer + "T12:00:00").getTime() - new Date(older + "T12:00:00").getTime()) / (86400 * 1000));
const initials = (name: string) => {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
};
const avatarColor = (name: string) => {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h + name.charCodeAt(i) * (i + 1)) % AVATAR_COLORS.length;
  return AVATAR_COLORS[h] ?? AVATAR_COLORS[0];
};

type ApplyPayload = {
  matched_contact?: { id: string; name: string } | null;
  new_contact?: { name: string; company: string; role: string } | null;
  interaction?: { type: string; title: string; notes: string } | null;
  reminder?: { date: string; text: string } | null;
  tags?: string[];
  summary?: string;
  sourceInput?: string;
};
export type { ApplyPayload };
export type AddSecondDegreeEdgeInput = {
  introducerContactId: string; targetName: string; targetCompany: string; targetRole: string; targetContactId?: string; targetLinkedIn?: string; evidence: string; confidence: 1 | 2 | 3 | 4 | 5; notes?: string;
};
export interface TodayData { staleContacts: { contact: Contact; daysSince: number }[]; dueReminders: StandaloneReminder[] }

async function hydratedContacts(userId: string): Promise<Contact[]> {
  const supabase = createSupabaseAdminClient();
  const [{ data: contacts, error: cErr }, { data: interactions, error: iErr }] = await Promise.all([
    supabase.from("contacts").select("*").eq("user_id", userId).order("name"),
    supabase.from("interactions").select("*").eq("user_id", userId).order("date", { ascending: false }),
  ]);
  if (cErr) throw cErr;
  if (iErr) throw iErr;
  const byContact = new Map<string, Interaction[]>();
  for (const i of interactions ?? []) {
    const arr = byContact.get(i.contact_id) ?? [];
    arr.push({ id: i.id, date: i.date, type: i.type, title: i.title, notes: i.notes ?? "", reminder: i.reminder ?? undefined });
    byContact.set(i.contact_id, arr);
  }
  return (contacts ?? []).map((c) => ({
    id: c.id, name: c.name, email: c.email ?? "", company: c.company ?? "", role: c.role ?? "", linkedIn: c.linkedin ?? "",
    avatar: c.avatar ?? initials(c.name), avatarColor: c.avatar_color ?? avatarColor(c.name), tags: c.tags ?? [],
    lastContact: { type: c.last_contact_type ?? "message", date: c.last_contact_date ?? todayISO(), description: c.last_contact_description ?? "Added to CRM" },
    interactions: byContact.get(c.id) ?? [], notes: c.notes ?? "", connectionStrength: c.connection_strength ?? 2, mutualConnections: c.mutual_connections ?? [],
  }));
}

export async function getContacts() { return hydratedContacts(await requireUserId()); }
export async function getContactById(id: string) { return (await getContacts()).find((c) => c.id === id); }
export async function getContactSummariesForPrompt(): Promise<ContactSummary[]> { return (await getContacts()).map((c) => ({ id: c.id, name: c.name, company: c.company, role: c.role })); }

export async function getRecentUpdates(): Promise<RecentUpdate[]> {
  const userId = await requireUserId();
  const { data, error } = await createSupabaseAdminClient().from("recent_updates").select("*").eq("user_id", userId).order("timestamp", { ascending: false }).limit(80);
  if (error) throw error;
  return (data ?? []).map((u) => ({ id: u.id, timestamp: u.timestamp, input: u.input, actions: u.actions ?? [] }));
}

export async function applyCrmUpdate(payload: ApplyPayload): Promise<{ ok: true; contactId: string | null; actions: string[] } | { ok: false; error: string }> {
  const userId = await requireUserId();
  const supabase = createSupabaseAdminClient();
  const inputText = payload.sourceInput?.trim() || "(update)";
  const actions: string[] = [];
  let contactId: string | null = payload.matched_contact?.id ?? null;
  if (payload.new_contact && !contactId) {
    const id = randomUUID(); const today = todayISO();
    const interaction = payload.interaction ? { id: randomUUID(), date: today, type: asInteractionType(payload.interaction.type), title: payload.interaction.title, notes: payload.interaction.notes, reminder: payload.reminder?.date } : null;
    const contact = { id, user_id: userId, name: payload.new_contact.name, email: "", company: payload.new_contact.company ?? "", role: payload.new_contact.role ?? "", linkedin: "", avatar: initials(payload.new_contact.name), avatar_color: avatarColor(payload.new_contact.name), tags: [...new Set((payload.tags ?? []).filter(Boolean))], last_contact_type: interaction?.type ?? "message", last_contact_date: interaction?.date ?? today, last_contact_description: interaction?.title ?? "Added to CRM", notes: interaction?.notes ?? "", connection_strength: 2, mutual_connections: [] as string[] };
    if (contact.tags.length === 0) contact.tags = ["network"];
    const { error } = await supabase.from("contacts").insert(contact); if (error) return { ok: false, error: error.message };
    if (interaction) { const { error: iErr } = await supabase.from("interactions").insert({ ...interaction, user_id: userId, contact_id: id }); if (iErr) return { ok: false, error: iErr.message }; actions.push(`Logged ${interaction.type}: ${interaction.title}`); }
    contactId = id; actions.unshift(`Created contact: ${contact.name}`);
  } else if (contactId) {
    const { data: c, error } = await supabase.from("contacts").select("*").eq("id", contactId).eq("user_id", userId).single();
    if (error || !c) return { ok: false, error: "Contact not found" };
    const tags = [...new Set([...(c.tags ?? []), ...(payload.tags ?? [])])];
    let notes = c.notes ?? ""; let lastType = c.last_contact_type; let lastDate = c.last_contact_date; let lastDesc = c.last_contact_description;
    if (payload.interaction) {
      const interaction = { id: randomUUID(), user_id: userId, contact_id: contactId, date: todayISO(), type: asInteractionType(payload.interaction.type), title: payload.interaction.title, notes: payload.interaction.notes, reminder: payload.reminder?.date ?? null };
      const { error: iErr } = await supabase.from("interactions").insert(interaction); if (iErr) return { ok: false, error: iErr.message };
      lastType = interaction.type; lastDate = interaction.date; lastDesc = interaction.title;
      if (interaction.notes.trim()) notes = notes.trim() ? `${notes.trim()}\n\n${interaction.notes.trim()}` : interaction.notes.trim();
      actions.push(`Updated ${c.name}`, `Added ${interaction.type}: ${interaction.title}`);
    }
    const { error: uErr } = await supabase.from("contacts").update({ tags, notes, last_contact_type: lastType, last_contact_date: lastDate, last_contact_description: lastDesc }).eq("id", contactId).eq("user_id", userId);
    if (uErr) return { ok: false, error: uErr.message };
  }
  if (payload.reminder) {
    const { error } = await supabase.from("reminders").insert({ id: randomUUID(), user_id: userId, contact_id: contactId, date: payload.reminder.date, text: payload.reminder.text, done: false, source: "manual" });
    if (error) return { ok: false, error: error.message };
    actions.push(contactId ? `Reminder: ${payload.reminder.text} (${payload.reminder.date})` : `Reminder: ${payload.reminder.text}`);
  }
  const list = payload.summary ? [payload.summary, ...actions] : actions.length ? actions : ["CRM updated"];
  const { error } = await supabase.from("recent_updates").insert({ id: randomUUID(), user_id: userId, timestamp: new Date().toISOString(), input: inputText, actions: list.slice(0, 12) });
  if (error) return { ok: false, error: error.message };
  return { ok: true, contactId, actions };
}

export async function snoozeContact(contactId: string, days: number) {
  const until = new Date(); until.setDate(until.getDate() + days);
  await createSupabaseAdminClient().from("contact_snoozes").upsert({ user_id: await requireUserId(), contact_id: contactId, snoozed_until: until.toISOString().slice(0, 10) });
}
export async function completeReminder(reminderId: string) {
  await createSupabaseAdminClient().from("reminders").update({ done: true }).eq("id", reminderId).eq("user_id", await requireUserId());
}

export async function getTodayData(): Promise<TodayData> {
  const userId = await requireUserId(); const contacts = await hydratedContacts(userId); const supabase = createSupabaseAdminClient();
  const [{ data: reminders }, { data: snoozes }] = await Promise.all([supabase.from("reminders").select("*").eq("user_id", userId), supabase.from("contact_snoozes").select("contact_id,snoozed_until").eq("user_id", userId)]);
  const today = todayISO(); const snoozeMap = new Map((snoozes ?? []).map((s) => [s.contact_id, s.snoozed_until]));
  const dueReminders = (reminders ?? []).filter((r) => !r.done && r.date <= today).map((r) => ({ id: r.id, contactId: r.contact_id, date: r.date, text: r.text, done: r.done, source: r.source ?? "manual", externalEventId: r.external_event_id ?? undefined, externalUrl: r.external_url ?? undefined }));
  const stale = contacts.map((contact) => ({ contact, daysSince: daysBetween(contact.lastContact.date, today) })).filter((x) => x.daysSince >= STALE_CONTACT_DAYS && (!snoozeMap.get(x.contact.id) || snoozeMap.get(x.contact.id)! <= today)).sort((a, b) => b.daysSince - a.daysSince).slice(0, 20);
  return { staleContacts: stale, dueReminders };
}

export async function getWeeklyDigest(): Promise<WeeklyDigest> {
  const userId = await requireUserId(); const contacts = await hydratedContacts(userId); const supabase = createSupabaseAdminClient();
  const today = new Date(); const todayStr = today.toISOString().slice(0, 10); const weekStart = new Date(today); weekStart.setDate(weekStart.getDate() - 7); const weekStartStr = weekStart.toISOString().slice(0, 10);
  const horizon = new Date(today); horizon.setDate(horizon.getDate() + 7); const horizonStr = horizon.toISOString().slice(0, 10);
  const [{ data: reminders }, { data: interactions }] = await Promise.all([supabase.from("reminders").select("date,done").eq("user_id", userId), supabase.from("interactions").select("date").eq("user_id", userId)]);
  const stale = contacts.map((c) => ({ id: c.id, name: c.name, daysSince: daysBetween(c.lastContact.date, todayStr) })).filter((x) => x.daysSince >= DRIFT_DAYS).sort((a, b) => b.daysSince - a.daysSince);
  return {
    weekLabel: `Week of ${weekStart.toLocaleDateString("en-US", { month: "short", day: "numeric" })}`,
    driftingCount: stale.length,
    followUpsThisWeek: (reminders ?? []).filter((r) => !r.done && r.date >= todayStr && r.date <= horizonStr).length,
    interactionsLoggedLast7Days: (interactions ?? []).filter((i) => i.date >= weekStartStr && i.date <= todayStr).length,
    topStale: stale.slice(0, 8),
  };
}

export async function getSecondDegreeEdges(): Promise<SecondDegreeEdge[]> {
  const { data, error } = await createSupabaseAdminClient().from("second_degree_edges").select("*").eq("user_id", await requireUserId()).order("last_evidence_at", { ascending: false });
  if (error) throw error;
  return (data ?? []).map((e) => ({ id: e.id, introducerContactId: e.introducer_contact_id, targetName: e.target_name, targetCompany: e.target_company, targetRole: e.target_role, targetContactId: e.target_contact_id ?? undefined, targetLinkedIn: e.target_linkedin ?? undefined, evidence: e.evidence, confidence: e.confidence, lastEvidenceAt: e.last_evidence_at, notes: e.notes ?? undefined, source: e.source }));
}
export async function buildExtendedConnectionsMap(): Promise<Record<string, ExtendedProfile[]>> {
  const map: Record<string, ExtendedProfile[]> = {};
  for (const e of await getSecondDegreeEdges()) { (map[e.introducerContactId] ??= []).push({ name: e.targetName, company: e.targetCompany, role: e.targetRole, edgeId: e.id, confidence: e.confidence, evidence: e.evidence }); }
  return map;
}
export async function addSecondDegreeEdge(input: AddSecondDegreeEdgeInput): Promise<{ ok: true; edge: SecondDegreeEdge } | { ok: false; error: string }> {
  const contacts = await getContacts(); if (!contacts.some((c) => c.id === input.introducerContactId)) return { ok: false, error: "Introducer not found" };
  const edge: SecondDegreeEdge = { id: randomUUID(), introducerContactId: input.introducerContactId, targetName: input.targetName.trim(), targetCompany: input.targetCompany.trim(), targetRole: input.targetRole.trim(), targetContactId: input.targetContactId, targetLinkedIn: input.targetLinkedIn?.trim() || undefined, evidence: asEvidence(input.evidence), confidence: input.confidence, lastEvidenceAt: todayISO(), notes: input.notes?.trim() || undefined, source: "manual" };
  const { error } = await createSupabaseAdminClient().from("second_degree_edges").insert({ id: edge.id, user_id: await requireUserId(), introducer_contact_id: edge.introducerContactId, target_name: edge.targetName, target_company: edge.targetCompany, target_role: edge.targetRole, target_contact_id: edge.targetContactId ?? null, target_linkedin: edge.targetLinkedIn ?? null, evidence: edge.evidence, confidence: edge.confidence, last_evidence_at: edge.lastEvidenceAt, notes: edge.notes ?? null, source: edge.source });
  if (error) return { ok: false, error: error.message }; return { ok: true, edge };
}
export async function deleteSecondDegreeEdge(edgeId: string) {
  const { error, count } = await createSupabaseAdminClient().from("second_degree_edges").delete({ count: "exact" }).eq("id", edgeId).eq("user_id", await requireUserId());
  return !error && (count ?? 0) > 0;
}
export async function confirmSecondDegreeIntro(edgeId: string, noteAppend?: string) {
  const userId = await requireUserId(); const supabase = createSupabaseAdminClient();
  const { data, error } = await supabase.from("second_degree_edges").select("notes").eq("id", edgeId).eq("user_id", userId).single(); if (error || !data) return false;
  const notes = noteAppend?.trim() ? (data.notes?.trim() ? `${data.notes.trim()}\n${noteAppend.trim()}` : noteAppend.trim()) : data.notes;
  const { error: uErr } = await supabase.from("second_degree_edges").update({ last_evidence_at: todayISO(), notes: notes ?? null }).eq("id", edgeId).eq("user_id", userId);
  return !uErr;
}
import "server-only";

import { randomUUID } from "crypto";
import type {
  Contact,
  ContactSummary,
  ExtendedProfile,
  Interaction,
  RecentUpdate,
  SecondDegreeEdge,
  SecondDegreeEvidence,
  StandaloneReminder,
  WeeklyDigest,
} from "@/lib/types";
import { requireUserId } from "@/lib/auth";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

const STALE_CONTACT_DAYS = 45;
const DRIFT_DAYS = 30;

function todayISO(): string {
  return new Date().toISOString().slice(0, 10);
}

const AVATAR_COLORS = ["#6c63ff", "#10b981", "#f59e0b", "#a78bfa", "#34d399", "#f472b6", "#fb923c", "#60a5fa", "#818cf8", "#f87171"];

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

function avatarColor(name: string): string {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h + name.charCodeAt(i) * (i + 1)) % AVATAR_COLORS.length;
  return AVATAR_COLORS[h] ?? AVATAR_COLORS[0];
}

function daysBetween(older: string, newer: string): number {
  const a = new Date(older + "T12:00:00");
  const b = new Date(newer + "T12:00:00");
  return Math.floor((b.getTime() - a.getTime()) / (86400 * 1000));
}

type DbContact = {
  id: string;
  name: string;
  email: string | null;
  company: string | null;
  role: string | null;
  linkedin: string | null;
  avatar: string | null;
  avatar_color: string | null;
  tags: string[] | null;
  last_contact_type: Interaction["type"] | null;
  last_contact_date: string | null;
  last_contact_description: string | null;
  notes: string | null;
  connection_strength: 1 | 2 | 3 | 4 | 5 | null;
  mutual_connections: string[] | null;
};

async function loadContactsAndInteractions(userId: string) {
  const supabase = createSupabaseAdminClient();
  const [{ data: contacts, error: contactsError }, { data: interactions, error: interactionsError }] = await Promise.all([
    supabase.from("contacts").select("*").eq("user_id", userId).order("name", { ascending: true }),
    supabase.from("interactions").select("*").eq("user_id", userId).order("date", { ascending: false }),
  ]);
  if (contactsError) throw contactsError;
  if (interactionsError) throw interactionsError;
  return { contacts: (contacts ?? []) as DbContact[], interactions: interactions ?? [] };
}

function hydrateContacts(contactRows: DbContact[], interactionRows: Array<Record<string, unknown>>): Contact[] {
  const byContact = new Map<string, Interaction[]>();
  for (const row of interactionRows) {
    const contactId = String(row.contact_id);
    const list = byContact.get(contactId) ?? [];
    list.push({
      id: String(row.id),
      date: String(row.date),
      type: row.type as Interaction["type"],
      title: String(row.title ?? ""),
      notes: String(row.notes ?? ""),
      reminder: row.reminder ? String(row.reminder) : undefined,
    });
    byContact.set(contactId, list);
  }
  return contactRows.map((row) => ({
    id: row.id,
    name: row.name,
    email: row.email ?? "",
    company: row.company ?? "",
    role: row.role ?? "",
    linkedIn: row.linkedin ?? "",
    avatar: row.avatar ?? initials(row.name),
    avatarColor: row.avatar_color ?? avatarColor(row.name),
    tags: row.tags ?? [],
    lastContact: {
      type: row.last_contact_type ?? "message",
      date: row.last_contact_date ?? todayISO(),
      description: row.last_contact_description ?? "Added to CRM",
    },
    interactions: byContact.get(row.id) ?? [],
    notes: row.notes ?? "",
    connectionStrength: row.connection_strength ?? 2,
    mutualConnections: row.mutual_connections ?? [],
  }));
}

export async function getContacts(): Promise<Contact[]> {
  const userId = await requireUserId();
  const { contacts, interactions } = await loadContactsAndInteractions(userId);
  return hydrateContacts(contacts, interactions);
}

export async function getContactById(id: string): Promise<Contact | undefined> {
  const contacts = await getContacts();
  return contacts.find((c) => c.id === id);
}

export async function getContactSummariesForPrompt(): Promise<ContactSummary[]> {
  const contacts = await getContacts();
  return contacts.map((c) => ({ id: c.id, name: c.name, company: c.company, role: c.role }));
}

export async function getRecentUpdates(): Promise<RecentUpdate[]> {
  const userId = await requireUserId();
  const supabase = createSupabaseAdminClient();
  const { data, error } = await supabase
    .from("recent_updates")
    .select("*")
    .eq("user_id", userId)
    .order("timestamp", { ascending: false })
    .limit(80);
  if (error) throw error;
  return (data ?? []).map((row) => ({
    id: row.id,
    timestamp: row.timestamp,
    input: row.input,
    actions: row.actions ?? [],
  }));
}

export type ApplyPayload = {
  matched_contact?: { id: string; name: string } | null;
  new_contact?: { name: string; company: string; role: string } | null;
  interaction?: { type: string; title: string; notes: string } | null;
  reminder?: { date: string; text: string } | null;
  tags?: string[];
  summary?: string;
  sourceInput?: string;
};

const interactionTypes: Interaction["type"][] = ["meeting", "email", "zoom", "intro", "message", "event"];
function asInteractionType(t: string): Interaction["type"] {
  return interactionTypes.includes(t as Interaction["type"]) ? (t as Interaction["type"]) : "message";
}

export async function applyCrmUpdate(payload: ApplyPayload): Promise<{ ok: true; contactId: string | null; actions: string[] } | { ok: false; error: string }> {
  const userId = await requireUserId();
  const supabase = createSupabaseAdminClient();
  const actions: string[] = [];
  const inputText = payload.sourceInput?.trim() || "(update)";
  let contactId: string | null = payload.matched_contact?.id ?? null;

  if (payload.new_contact && !contactId) {
    const id = randomUUID();
    const today = todayISO();
    const tags = [...new Set((payload.tags ?? []).filter(Boolean))];
    const inter = payload.interaction;
    const newInteraction: Interaction | null = inter
      ? { id: randomUUID(), date: today, type: asInteractionType(inter.type), title: inter.title, notes: inter.notes, ...(payload.reminder ? { reminder: payload.reminder.date } : {}) }
      : null;
    const contact: Contact = {
      id,
      name: payload.new_contact.name,
      email: "",
      company: payload.new_contact.company ?? "",
      role: payload.new_contact.role ?? "",
      linkedIn: "",
      avatar: initials(payload.new_contact.name),
      avatarColor: avatarColor(payload.new_contact.name),
      tags: tags.length > 0 ? tags : ["network"],
      lastContact: newInteraction
        ? { type: newInteraction.type, date: newInteraction.date, description: newInteraction.title }
        : { type: "message", date: today, description: "Added to CRM" },
      connectionStrength: 2,
      mutualConnections: [],
      notes: inter?.notes ?? "",
      interactions: newInteraction ? [newInteraction] : [],
    };
    const { error: contactError } = await supabase.from("contacts").insert({
      id: contact.id,
      user_id: userId,
      name: contact.name,
      email: contact.email,
      company: contact.company,
      role: contact.role,
      linkedin: contact.linkedIn,
      avatar: contact.avatar,
      avatar_color: contact.avatarColor,
      tags: contact.tags,
      last_contact_type: contact.lastContact.type,
      last_contact_date: contact.lastContact.date,
      last_contact_description: contact.lastContact.description,
      notes: contact.notes,
      connection_strength: contact.connectionStrength,
      mutual_connections: contact.mutualConnections,
    });
    if (contactError) return { ok: false, error: contactError.message };
    if (newInteraction) {
      const { error: interactionError } = await supabase.from("interactions").insert({
        id: newInteraction.id,
        user_id: userId,
        contact_id: id,
        date: newInteraction.date,
        type: newInteraction.type,
        title: newInteraction.title,
        notes: newInteraction.notes,
        reminder: newInteraction.reminder ?? null,
      });
      if (interactionError) return { ok: false, error: interactionError.message };
    }
    contactId = id;
    actions.push(`Created contact: ${contact.name}`);
    if (newInteraction) actions.push(`Logged ${newInteraction.type}: ${newInteraction.title}`);
  } else if (contactId) {
    const { data: row, error: getError } = await supabase.from("contacts").select("*").eq("id", contactId).eq("user_id", userId).single();
    if (getError || !row) return { ok: false, error: "Contact not found" };
    const existingTags: string[] = row.tags ?? [];
    const tagSet = new Set([...existingTags, ...(payload.tags ?? [])]);
    let notes = String(row.notes ?? "");
    let lastType = row.last_contact_type as Interaction["type"] | null;
    let lastDate = row.last_contact_date as string | null;
    let lastDesc = row.last_contact_description as string | null;
    if (payload.interaction) {
      const today = todayISO();
      const newInteraction: Interaction = {
        id: randomUUID(),
        date: today,
        type: asInteractionType(payload.interaction.type),
        title: payload.interaction.title,
        notes: payload.interaction.notes,
        ...(payload.reminder ? { reminder: payload.reminder.date } : {}),
      };
      const { error: interactionError } = await supabase.from("interactions").insert({
        id: newInteraction.id,
        user_id: userId,
        contact_id: contactId,
        date: newInteraction.date,
        type: newInteraction.type,
        title: newInteraction.title,
        notes: newInteraction.notes,
        reminder: newInteraction.reminder ?? null,
      });
      if (interactionError) return { ok: false, error: interactionError.message };
      lastType = newInteraction.type;
      lastDate = newInteraction.date;
      lastDesc = newInteraction.title;
      if (newInteraction.notes.trim()) {
        notes = notes.trim() ? `${notes.trim()}\n\n${newInteraction.notes.trim()}` : newInteraction.notes.trim();
      }
      actions.push(`Updated ${row.name}`);
      actions.push(`Added ${newInteraction.type}: ${newInteraction.title}`);
    } else if ((payload.tags?.length ?? 0) > 0) {
      actions.push(`Updated tags for ${row.name}`);
    }
    const { error: updateError } = await supabase
      .from("contacts")
      .update({
        tags: [...tagSet],
        notes,
        last_contact_type: lastType,
        last_contact_date: lastDate,
        last_contact_description: lastDesc,
      })
      .eq("id", contactId)
      .eq("user_id", userId);
    if (updateError) return { ok: false, error: updateError.message };
  }

  if (payload.reminder) {
    const { error: reminderError } = await supabase.from("reminders").insert({
      id: randomUUID(),
      user_id: userId,
      contact_id: contactId,
      date: payload.reminder.date,
      text: payload.reminder.text,
      done: false,
      source: "manual",
    });
    if (reminderError) return { ok: false, error: reminderError.message };
    actions.push(contactId ? `Reminder: ${payload.reminder.text} (${payload.reminder.date})` : `Reminder: ${payload.reminder.text}`);
  }

  const actionList = payload.summary ? [payload.summary, ...actions] : actions.length > 0 ? actions : ["CRM updated"];
  const { error: updateError } = await supabase.from("recent_updates").insert({
    id: randomUUID(),
    user_id: userId,
    timestamp: new Date().toISOString(),
    input: inputText,
    actions: actionList.slice(0, 12),
  });
  if (updateError) return { ok: false, error: updateError.message };
  return { ok: true, contactId, actions };
}

export async function snoozeContact(contactId: string, days: number): Promise<void> {
  const userId = await requireUserId();
  const supabase = createSupabaseAdminClient();
  const until = new Date();
  until.setDate(until.getDate() + days);
  await supabase.from("contact_snoozes").upsert({ user_id: userId, contact_id: contactId, snoozed_until: until.toISOString().slice(0, 10) });
}

export async function completeReminder(reminderId: string): Promise<void> {
  const userId = await requireUserId();
  const supabase = createSupabaseAdminClient();
  await supabase.from("reminders").update({ done: true }).eq("id", reminderId).eq("user_id", userId);
}

export interface TodayData {
  staleContacts: { contact: Contact; daysSince: number }[];
  dueReminders: StandaloneReminder[];
}

export async function getTodayData(): Promise<TodayData> {
  const [contacts, userId] = await Promise.all([getContacts(), requireUserId()]);
  const supabase = createSupabaseAdminClient();
  const [{ data: reminders }, { data: snoozes }] = await Promise.all([
    supabase.from("reminders").select("*").eq("user_id", userId),
    supabase.from("contact_snoozes").select("contact_id,snoozed_until").eq("user_id", userId),
  ]);
  const today = todayISO();
  const snoozeMap = new Map((snoozes ?? []).map((s) => [s.contact_id, s.snoozed_until]));
  const dueReminders = (reminders ?? [])
    .filter((r) => !r.done && r.date <= today)
    .map((r) => ({
      id: r.id,
      contactId: r.contact_id,
      date: r.date,
      text: r.text,
      done: r.done,
      source: r.source ?? "manual",
      externalEventId: r.external_event_id ?? undefined,
      externalUrl: r.external_url ?? undefined,
    }));
  const stale: { contact: Contact; daysSince: number }[] = [];
  for (const c of contacts) {
    const snoozedUntil = snoozeMap.get(c.id);
    if (snoozedUntil && snoozedUntil > today) continue;
    const d = daysBetween(c.lastContact.date, today);
    if (d >= STALE_CONTACT_DAYS) stale.push({ contact: c, daysSince: d });
  }
  stale.sort((a, b) => b.daysSince - a.daysSince);
  return { staleContacts: stale.slice(0, 20), dueReminders };
}

export async function getWeeklyDigest(): Promise<WeeklyDigest> {
  const [contacts, userId] = await Promise.all([getContacts(), requireUserId()]);
  const supabase = createSupabaseAdminClient();
  const [{ data: reminders }, { data: interactions }] = await Promise.all([
    supabase.from("reminders").select("date,done").eq("user_id", userId),
    supabase.from("interactions").select("date").eq("user_id", userId),
  ]);
  const today = new Date();
  const todayStr = today.toISOString().slice(0, 10);
  const weekStart = new Date(today);
  weekStart.setDate(weekStart.getDate() - 7);
  const weekStartStr = weekStart.toISOString().slice(0, 10);
  let driftingCount = 0;
  const staleList: { id: string; name: string; daysSince: number }[] = [];
  for (const c of contacts) {
    const d = daysBetween(c.lastContact.date, todayStr);
    if (d >= DRIFT_DAYS) {
      driftingCount++;
      if (staleList.length < 8) staleList.push({ id: c.id, name: c.name, daysSince: d });
    }
  }
  staleList.sort((a, b) => b.daysSince - a.daysSince);
  const horizon = new Date(today);
  horizon.setDate(horizon.getDate() + 7);
  const horizonStr = horizon.toISOString().slice(0, 10);
  let followUpsThisWeek = 0;
  for (const r of reminders ?? []) {
    if (r.done) continue;
    if (r.date >= todayStr && r.date <= horizonStr) followUpsThisWeek++;
  }
  let interactionsLoggedLast7Days = 0;
  for (const i of interactions ?? []) {
    if (i.date >= weekStartStr && i.date <= todayStr) interactionsLoggedLast7Days++;
  }
  return {
    weekLabel: `Week of ${weekStart.toLocaleDateString("en-US", { month: "short", day: "numeric" })}`,
    driftingCount,
    followUpsThisWeek,
    interactionsLoggedLast7Days,
    topStale: staleList,
  };
}

export async function getSecondDegreeEdges(): Promise<SecondDegreeEdge[]> {
  const userId = await requireUserId();
  const supabase = createSupabaseAdminClient();
  const { data, error } = await supabase
    .from("second_degree_edges")
    .select("*")
    .eq("user_id", userId)
    .order("last_evidence_at", { ascending: false });
  if (error) throw error;
  return (data ?? []).map((row) => ({
    id: row.id,
    introducerContactId: row.introducer_contact_id,
    targetName: row.target_name,
    targetCompany: row.target_company,
    targetRole: row.target_role,
    targetContactId: row.target_contact_id ?? undefined,
    targetLinkedIn: row.target_linkedin ?? undefined,
    evidence: row.evidence,
    confidence: row.confidence,
    lastEvidenceAt: row.last_evidence_at,
    notes: row.notes ?? undefined,
    source: row.source,
  }));
}

export async function buildExtendedConnectionsMap(): Promise<Record<string, ExtendedProfile[]>> {
  const edges = await getSecondDegreeEdges();
  const map: Record<string, ExtendedProfile[]> = {};
  for (const e of edges) {
    const row: ExtendedProfile = { name: e.targetName, company: e.targetCompany, role: e.targetRole, edgeId: e.id, confidence: e.confidence, evidence: e.evidence };
    if (!map[e.introducerContactId]) map[e.introducerContactId] = [];
    map[e.introducerContactId].push(row);
  }
  return map;
}

const EVIDENCE: SecondDegreeEvidence[] = ["colleague", "friend", "investor_relation", "intro_offer", "event", "other"];
function asEvidence(t: string): SecondDegreeEvidence {
  return EVIDENCE.includes(t as SecondDegreeEvidence) ? (t as SecondDegreeEvidence) : "other";
}

export type AddSecondDegreeEdgeInput = {
  introducerContactId: string;
  targetName: string;
  targetCompany: string;
  targetRole: string;
  targetContactId?: string;
  targetLinkedIn?: string;
  evidence: string;
  confidence: 1 | 2 | 3 | 4 | 5;
  notes?: string;
};

export async function addSecondDegreeEdge(input: AddSecondDegreeEdgeInput): Promise<{ ok: true; edge: SecondDegreeEdge } | { ok: false; error: string }> {
  const [contacts, userId] = await Promise.all([getContacts(), requireUserId()]);
  if (!contacts.some((c) => c.id === input.introducerContactId)) return { ok: false, error: "Introducer not found" };
  const edge: SecondDegreeEdge = {
    id: randomUUID(),
    introducerContactId: input.introducerContactId,
    targetName: input.targetName.trim(),
    targetCompany: input.targetCompany.trim(),
    targetRole: input.targetRole.trim(),
    targetContactId: input.targetContactId,
    targetLinkedIn: input.targetLinkedIn?.trim() || undefined,
    evidence: asEvidence(input.evidence),
    confidence: input.confidence,
    lastEvidenceAt: todayISO(),
    notes: input.notes?.trim() || undefined,
    source: "manual",
  };
  const supabase = createSupabaseAdminClient();
  const { error } = await supabase.from("second_degree_edges").insert({
    id: edge.id,
    user_id: userId,
    introducer_contact_id: edge.introducerContactId,
    target_name: edge.targetName,
    target_company: edge.targetCompany,
    target_role: edge.targetRole,
    target_contact_id: edge.targetContactId ?? null,
    target_linkedin: edge.targetLinkedIn ?? null,
    evidence: edge.evidence,
    confidence: edge.confidence,
    last_evidence_at: edge.lastEvidenceAt,
    notes: edge.notes ?? null,
    source: edge.source,
  });
  if (error) return { ok: false, error: error.message };
  return { ok: true, edge };
}

export async function deleteSecondDegreeEdge(edgeId: string): Promise<boolean> {
  const userId = await requireUserId();
  const supabase = createSupabaseAdminClient();
  const { error, count } = await supabase.from("second_degree_edges").delete({ count: "exact" }).eq("id", edgeId).eq("user_id", userId);
  if (error) return false;
  return (count ?? 0) > 0;
}

export async function confirmSecondDegreeIntro(edgeId: string, noteAppend?: string): Promise<boolean> {
  const userId = await requireUserId();
  const supabase = createSupabaseAdminClient();
  const { data, error } = await supabase.from("second_degree_edges").select("notes").eq("id", edgeId).eq("user_id", userId).single();
  if (error || !data) return false;
  const notes = noteAppend?.trim() ? (data.notes?.trim() ? `${data.notes.trim()}\n${noteAppend.trim()}` : noteAppend.trim()) : data.notes;
  const { error: updateError } = await supabase
    .from("second_degree_edges")
    .update({ last_evidence_at: todayISO(), notes: notes ?? null })
    .eq("id", edgeId)
    .eq("user_id", userId);
  return !updateError;
}
import "server-only";

import { mkdirSync, readFileSync, writeFileSync, existsSync } from "fs";
import { join } from "path";
import { randomUUID } from "crypto";
import type {
  Contact,
  ContactSummary,
  ExtendedProfile,
  Interaction,
  RecentUpdate,
  SecondDegreeEdge,
  SecondDegreeEvidence,
  StandaloneReminder,
  WeeklyDigest,
  ReachOutRecommendation,
} from "@/lib/types";
import { contacts as seedContacts, recentUpdates as seedRecentUpdates } from "@/lib/data/mock/fixtures";
import { extendedConnections as seedExtendedProfiles } from "@/lib/data/mock/extended-network";

const DATA_DIR = join(process.cwd(), "data");
const STORE_PATH = join(DATA_DIR, "crm-store.json");

const STALE_CONTACT_DAYS = 45;
const DRIFT_DAYS = 30;

export interface CrmStore {
  contacts: Contact[];
  recentUpdates: RecentUpdate[];
  reminders: StandaloneReminder[];
  /** contactId -> YYYY-MM-DD show in stale lists again after this date */
  contactSnoozes: Record<string, string>;
  /** Second-degree edges: who (CRM contact) can intro whom (possibly outside CRM) */
  secondDegreeEdges: SecondDegreeEdge[];
  /** User-provided profile context used by network intelligence features. */
  profileContext: string;
  reachOutRecommendation: ReachOutRecommendation | null;
}

function todayISO(): string {
  return new Date().toISOString().slice(0, 10);
}

function ensureDataDir(): void {
  if (!existsSync(DATA_DIR)) {
    mkdirSync(DATA_DIR, { recursive: true });
  }
}

function seedSecondDegreeEdgesFromFixture(): SecondDegreeEdge[] {
  const today = todayISO();
  const out: SecondDegreeEdge[] = [];
  for (const [introducerId, profiles] of Object.entries(seedExtendedProfiles)) {
    for (const p of profiles) {
      out.push({
        id: randomUUID(),
        introducerContactId: introducerId,
        targetName: p.name,
        targetCompany: p.company,
        targetRole: p.role,
        evidence: "other",
        confidence: 3,
        lastEvidenceAt: today,
        source: "import",
      });
    }
  }
  return out;
}

function initialStore(): CrmStore {
  return {
    contacts: structuredClone(seedContacts) as Contact[],
    recentUpdates: structuredClone(seedRecentUpdates) as RecentUpdate[],
    reminders: [],
    contactSnoozes: {},
    secondDegreeEdges: seedSecondDegreeEdgesFromFixture(),
    profileContext: "",
    reachOutRecommendation: null,
  };
}

export function loadStore(): CrmStore {
  ensureDataDir();
  if (!existsSync(STORE_PATH)) {
    const seed = initialStore();
    saveStore(seed);
    return seed;
  }
  try {
    const raw = readFileSync(STORE_PATH, "utf-8");
    const parsed = JSON.parse(raw) as CrmStore;
    if (!Array.isArray(parsed.contacts)) throw new Error("invalid store");
    parsed.recentUpdates = Array.isArray(parsed.recentUpdates) ? parsed.recentUpdates : [];
    parsed.reminders = Array.isArray(parsed.reminders) ? parsed.reminders : [];
    parsed.reminders = parsed.reminders.map((r) => ({
      ...r,
      source: r.source === "google_calendar" ? "google_calendar" : "manual",
    }));
    parsed.contactSnoozes = parsed.contactSnoozes && typeof parsed.contactSnoozes === "object" ? parsed.contactSnoozes : {};
    if (!("secondDegreeEdges" in parsed) || !Array.isArray(parsed.secondDegreeEdges)) {
      parsed.secondDegreeEdges = seedSecondDegreeEdgesFromFixture();
      saveStore(parsed);
    }
    parsed.profileContext = typeof parsed.profileContext === "string" ? parsed.profileContext : "";
    parsed.reachOutRecommendation = parsed.reachOutRecommendation ?? null;
    return parsed;
  } catch {
    const seed = initialStore();
    saveStore(seed);
    return seed;
  }
}

export function saveStore(store: CrmStore): void {
  ensureDataDir();
  writeFileSync(STORE_PATH, JSON.stringify(store, null, 2), "utf-8");
}

function mutate(fn: (s: CrmStore) => void): void {
  const s = loadStore();
  fn(s);
  saveStore(s);
}

const AVATAR_COLORS = ["#6c63ff", "#10b981", "#f59e0b", "#a78bfa", "#34d399", "#f472b6", "#fb923c", "#60a5fa", "#818cf8", "#f87171"];

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

function avatarColor(name: string): string {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h + name.charCodeAt(i) * (i + 1)) % AVATAR_COLORS.length;
  return AVATAR_COLORS[h] ?? AVATAR_COLORS[0];
}

function daysBetween(older: string, newer: string): number {
  const a = new Date(older + "T12:00:00");
  const b = new Date(newer + "T12:00:00");
  return Math.floor((b.getTime() - a.getTime()) / (86400 * 1000));
}

export async function getContacts(): Promise<Contact[]> {
  return loadStore().contacts;
}

export async function getContactById(id: string): Promise<Contact | undefined> {
  return loadStore().contacts.find((c) => c.id === id);
}

export async function getContactSummariesForPrompt(): Promise<ContactSummary[]> {
  return loadStore().contacts.map((c) => ({
    id: c.id,
    name: c.name,
    company: c.company,
    role: c.role,
  }));
}

export async function getRecentUpdates(): Promise<RecentUpdate[]> {
  const u = loadStore().recentUpdates;
  return [...u].sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
}

export type ApplyPayload = {
  matched_contact?: { id: string; name: string } | null;
  new_contact?: { name: string; company: string; role: string } | null;
  interaction?: { type: string; title: string; notes: string } | null;
  reminder?: { date: string; text: string } | null;
  tags?: string[];
  summary?: string;
  sourceInput?: string;
};

const interactionTypes: Interaction["type"][] = [
  "meeting",
  "email",
  "zoom",
  "intro",
  "message",
  "event",
];

function asInteractionType(t: string): Interaction["type"] {
  return interactionTypes.includes(t as Interaction["type"]) ? (t as Interaction["type"]) : "message";
}

export function applyCrmUpdate(payload: ApplyPayload): { ok: true; contactId: string | null; actions: string[] } | { ok: false; error: string } {
  const actions: string[] = [];
  const store = loadStore();
  const inputText = payload.sourceInput?.trim() || "(update)";

  let contactId: string | null = payload.matched_contact?.id ?? null;

  if (payload.new_contact && !contactId) {
    const id = randomUUID();
    const nc = payload.new_contact;
    const tags = [...new Set((payload.tags ?? []).filter(Boolean))];
    const today = todayISO();
    const inter = payload.interaction;
    const newInteraction: Interaction | null = inter
      ? {
          id: randomUUID(),
          date: today,
          type: asInteractionType(inter.type),
          title: inter.title,
          notes: inter.notes,
          ...(payload.reminder ? { reminder: payload.reminder.date } : {}),
        }
      : null;
    const newContact: Contact = {
      id,
      name: nc.name,
      email: "",
      company: nc.company ?? "",
      role: nc.role ?? "",
      linkedIn: "",
      avatar: initials(nc.name),
      avatarColor: avatarColor(nc.name),
      tags: tags.length > 0 ? tags : ["network"],
      lastContact: newInteraction
        ? {
            type: newInteraction.type,
            date: newInteraction.date,
            description: newInteraction.title,
          }
        : { type: "message", date: today, description: "Added to CRM" },
      connectionStrength: 2,
      mutualConnections: [],
      notes: inter?.notes ?? "",
      interactions: newInteraction ? [newInteraction] : [],
    };
    store.contacts.push(newContact);
    contactId = id;
    actions.push(`Created contact: ${nc.name}`);
    if (newInteraction) actions.push(`Logged ${newInteraction.type}: ${newInteraction.title}`);
  } else if (contactId) {
    const idx = store.contacts.findIndex((c) => c.id === contactId);
    if (idx === -1) {
      return { ok: false, error: "Contact not found" };
    }
    const c = store.contacts[idx];
    if (c === undefined) return { ok: false, error: "Contact not found" };
    const tagSet = new Set([...c.tags, ...(payload.tags ?? [])]);
    c.tags = [...tagSet];
    const today = todayISO();
    if (payload.interaction) {
      const inter = payload.interaction;
      const newInteraction: Interaction = {
        id: randomUUID(),
        date: today,
        type: asInteractionType(inter.type),
        title: inter.title,
        notes: inter.notes,
        ...(payload.reminder ? { reminder: payload.reminder.date } : {}),
      };
      c.interactions = [newInteraction, ...c.interactions];
      c.lastContact = {
        type: newInteraction.type,
        date: newInteraction.date,
        description: newInteraction.title,
      };
      if (inter.notes && inter.notes.trim()) {
        c.notes = c.notes.trim() ? `${c.notes.trim()}\n\n${inter.notes.trim()}` : inter.notes.trim();
      }
      actions.push(`Updated ${c.name}`);
      actions.push(`Added ${newInteraction.type}: ${newInteraction.title}`);
    } else if ((payload.tags?.length ?? 0) > 0) {
      actions.push(`Updated tags for ${c.name}`);
    }
    store.contacts[idx] = c;
  }

  if (payload.reminder && contactId) {
    const r = payload.reminder;
    store.reminders.push({
      id: randomUUID(),
      contactId,
      date: r.date,
      text: r.text,
      done: false,
      source: "manual",
    });
    actions.push(`Reminder: ${r.text} (${r.date})`);
  } else if (payload.reminder && !contactId) {
    store.reminders.push({
      id: randomUUID(),
      contactId: null,
      date: payload.reminder.date,
      text: payload.reminder.text,
      done: false,
      source: "manual",
    });
    actions.push(`Reminder: ${payload.reminder.text}`);
  }

  const actionList =
    payload.summary != null && payload.summary !== ""
      ? [payload.summary, ...actions]
      : actions.length > 0
        ? actions
        : ["CRM updated"];
  store.recentUpdates.unshift({
    id: randomUUID(),
    timestamp: new Date().toISOString(),
    input: inputText,
    actions: actionList.slice(0, 12),
  });
  store.recentUpdates = store.recentUpdates.slice(0, 80);

  saveStore(store);
  return { ok: true, contactId, actions };
}

export function snoozeContact(contactId: string, days: number): void {
  const until = new Date();
  until.setDate(until.getDate() + days);
  const iso = until.toISOString().slice(0, 10);
  mutate((s) => {
    s.contactSnoozes[contactId] = iso;
  });
}

export function completeReminder(reminderId: string): void {
  mutate((s) => {
    const r = s.reminders.find((x) => x.id === reminderId);
    if (r) r.done = true;
  });
}

export interface TodayData {
  staleContacts: { contact: Contact; daysSince: number }[];
  dueReminders: StandaloneReminder[];
}

export async function getTodayData(): Promise<TodayData> {
  const store = loadStore();
  const today = todayISO();
  const dueReminders = store.reminders.filter((r) => !r.done && r.date <= today);

  const stale: { contact: Contact; daysSince: number }[] = [];
  for (const c of store.contacts) {
    const snoozedUntil = store.contactSnoozes[c.id];
    if (snoozedUntil && snoozedUntil > today) continue;
    const d = daysBetween(c.lastContact.date, today);
    if (d >= STALE_CONTACT_DAYS) {
      stale.push({ contact: c, daysSince: d });
    }
  }
  stale.sort((a, b) => b.daysSince - a.daysSince);
  return { staleContacts: stale.slice(0, 20), dueReminders };
}

export async function getWeeklyDigest(): Promise<WeeklyDigest> {
  const store = loadStore();
  const today = new Date();
  const todayStr = today.toISOString().slice(0, 10);
  const weekStart = new Date(today);
  weekStart.setDate(weekStart.getDate() - 7);
  const weekStartStr = weekStart.toISOString().slice(0, 10);

  let driftingCount = 0;
  const staleList: { id: string; name: string; daysSince: number }[] = [];
  for (const c of store.contacts) {
    const d = daysBetween(c.lastContact.date, todayStr);
    if (d >= DRIFT_DAYS) {
      driftingCount++;
      if (staleList.length < 8) {
        staleList.push({ id: c.id, name: c.name, daysSince: d });
      }
    }
  }
  staleList.sort((a, b) => b.daysSince - a.daysSince);

  const horizon = new Date(today);
  horizon.setDate(horizon.getDate() + 7);
  const horizonStr = horizon.toISOString().slice(0, 10);
  let followUpsThisWeek = 0;
  for (const r of store.reminders) {
    if (r.done) continue;
    if (r.date >= todayStr && r.date <= horizonStr) followUpsThisWeek++;
  }

  let interactionsLoggedLast7Days = 0;
  for (const c of store.contacts) {
    for (const i of c.interactions) {
      if (i.date >= weekStartStr && i.date <= todayStr) interactionsLoggedLast7Days++;
    }
  }

  const label = `Week of ${weekStart.toLocaleDateString("en-US", { month: "short", day: "numeric" })}`;

  return {
    weekLabel: label,
    driftingCount,
    followUpsThisWeek,
    interactionsLoggedLast7Days,
    topStale: staleList,
  };
}

export async function getSecondDegreeEdges(): Promise<SecondDegreeEdge[]> {
  return loadStore().secondDegreeEdges;
}

export async function getProfileContext(): Promise<string> {
  return loadStore().profileContext ?? "";
}

export function setProfileContext(value: string): void {
  mutate((s) => {
    s.profileContext = value.trim();
  });
}

export async function getReachOutRecommendation(): Promise<ReachOutRecommendation | null> {
  return loadStore().reachOutRecommendation ?? null;
}

export function setReachOutRecommendation(value: ReachOutRecommendation | null): void {
  mutate((s) => {
    s.reachOutRecommendation = value;
  });
}

/** Group second-degree edges by introducer for graph UI (ExtendedProfile list per CRM contact). */
export function buildExtendedConnectionsMap(): Record<string, ExtendedProfile[]> {
  const store = loadStore();
  const map: Record<string, ExtendedProfile[]> = {};
  for (const e of store.secondDegreeEdges) {
    const row: ExtendedProfile = {
      name: e.targetName,
      company: e.targetCompany,
      role: e.targetRole,
      edgeId: e.id,
      confidence: e.confidence,
      evidence: e.evidence,
    };
    if (!map[e.introducerContactId]) map[e.introducerContactId] = [];
    map[e.introducerContactId].push(row);
  }
  return map;
}

const EVIDENCE: SecondDegreeEvidence[] = [
  "colleague",
  "friend",
  "investor_relation",
  "intro_offer",
  "event",
  "other",
];

function asEvidence(t: string): SecondDegreeEvidence {
  return EVIDENCE.includes(t as SecondDegreeEvidence) ? (t as SecondDegreeEvidence) : "other";
}

export type AddSecondDegreeEdgeInput = {
  introducerContactId: string;
  targetName: string;
  targetCompany: string;
  targetRole: string;
  targetContactId?: string;
  targetLinkedIn?: string;
  evidence: string;
  confidence: 1 | 2 | 3 | 4 | 5;
  notes?: string;
};

export function addSecondDegreeEdge(input: AddSecondDegreeEdgeInput): { ok: true; edge: SecondDegreeEdge } | { ok: false; error: string } {
  const store = loadStore();
  if (!store.contacts.some((c) => c.id === input.introducerContactId)) {
    return { ok: false, error: "Introducer not found" };
  }
  const edge: SecondDegreeEdge = {
    id: randomUUID(),
    introducerContactId: input.introducerContactId,
    targetName: input.targetName.trim(),
    targetCompany: input.targetCompany.trim(),
    targetRole: input.targetRole.trim(),
    targetContactId: input.targetContactId,
    targetLinkedIn: input.targetLinkedIn?.trim() || undefined,
    evidence: asEvidence(input.evidence),
    confidence: input.confidence,
    lastEvidenceAt: todayISO(),
    notes: input.notes?.trim() || undefined,
    source: "manual",
  };
  store.secondDegreeEdges.push(edge);
  saveStore(store);
  return { ok: true, edge };
}

export function deleteSecondDegreeEdge(edgeId: string): boolean {
  const store = loadStore();
  const i = store.secondDegreeEdges.findIndex((e) => e.id === edgeId);
  if (i === -1) return false;
  store.secondDegreeEdges.splice(i, 1);
  saveStore(store);
  return true;
}

/** Call after an intro happened to refresh recency (and optional note). */
export function confirmSecondDegreeIntro(edgeId: string, noteAppend?: string): boolean {
  const store = loadStore();
  const e = store.secondDegreeEdges.find((x) => x.id === edgeId);
  if (!e) return false;
  e.lastEvidenceAt = todayISO();
  if (noteAppend?.trim()) {
    e.notes = e.notes?.trim() ? `${e.notes.trim()}\n${noteAppend.trim()}` : noteAppend.trim();
  }
  saveStore(store);
  return true;
}
