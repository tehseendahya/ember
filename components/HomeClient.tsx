"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import {
  AlertCircle,
  CalendarClock,
  CheckCircle2,
  ChevronRight,
  Clock,
  MessageSquare,
  RefreshCw,
  Sparkles,
} from "lucide-react";
import type { Contact, ReachOutRecommendation, StandaloneReminder } from "@/lib/types";
import type { MeetingBriefingItem } from "@/lib/briefings/types";
import MeetingBriefing from "./MeetingBriefing";
import { useCommandBar } from "./CommandBarProvider";

type ReminderRow = StandaloneReminder & { contactName: string | null };

const REACH_OUT_CACHE_KEY = "today-reach-out-cache-v1";
const REACH_OUT_CACHE_TTL_MS = 24 * 60 * 60 * 1000;

type ActionItem =
  | { kind: "reminder"; id: string; reminder: ReminderRow }
  | { kind: "drift"; id: string; contact: Contact; daysSince: number };

export default function HomeClient({
  staleContacts,
  dueReminders,
  todaysMeetings,
  googleIntegrationStatus,
}: {
  staleContacts: { contact: Contact; daysSince: number }[];
  dueReminders: ReminderRow[];
  todaysMeetings: MeetingBriefingItem[];
  googleIntegrationStatus: {
    enabled: boolean;
    connected: boolean;
    missingConfig: string[];
    lastSyncAt: string | null;
    tokenExpiresAt: string | null;
    needsReauthForContacts: boolean;
  };
}) {
  const router = useRouter();
  const { openCapture } = useCommandBar();
  const [pending, setPending] = useState<string | null>(null);
  const [reachOut, setReachOut] = useState<ReachOutRecommendation | null>(null);
  const [reachOutLoading, setReachOutLoading] = useState(false);
  const [reachOutError, setReachOutError] = useState<string | null>(null);
  const [profileContextConfigured, setProfileContextConfigured] = useState(true);
  const [syncState, setSyncState] = useState<"idle" | "syncing" | "done" | "error">("idle");
  const [syncMessage, setSyncMessage] = useState<string | null>(null);

  const greeting = useMemo(() => {
    const hour = new Date().getHours();
    if (hour < 5) return "Good evening";
    if (hour < 12) return "Good morning";
    if (hour < 18) return "Good afternoon";
    return "Good evening";
  }, []);

  const actionQueue: ActionItem[] = useMemo(() => {
    const reminderItems = dueReminders.map<ActionItem>((r) => ({ kind: "reminder", id: r.id, reminder: r }));
    const driftItems = staleContacts.map<ActionItem>(({ contact, daysSince }) => ({
      kind: "drift",
      id: `drift-${contact.id}`,
      contact,
      daysSince,
    }));
    return [...reminderItems, ...driftItems].slice(0, 7);
  }, [dueReminders, staleContacts]);

  async function snooze(contactId: string) {
    setPending(`snooze-${contactId}`);
    try {
      await fetch("/api/crm/action", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "snooze", contactId, days: 7 }),
      });
      router.refresh();
    } finally {
      setPending(null);
    }
  }

  async function resyncCalendar() {
    if (syncState === "syncing") return;
    setSyncState("syncing");
    setSyncMessage(null);
    try {
      const res = await fetch("/api/integrations/google-calendar/sync", { method: "POST" });
      const data = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        reason?: string;
        fetchedEvents?: number;
        processedEvents?: number;
        createdContacts?: number;
        purgedLegacyReminders?: number;
      };
      if (!res.ok || data.ok === false) {
        setSyncState("error");
        setSyncMessage(data.reason ?? "Sync failed");
        return;
      }
      setSyncState("done");
      setSyncMessage(
        `Synced ${data.fetchedEvents ?? 0} events · ${data.processedEvents ?? 0} processed · ${data.createdContacts ?? 0} new contacts${
          data.purgedLegacyReminders ? ` · purged ${data.purgedLegacyReminders} legacy reminders` : ""
        }`,
      );
      router.refresh();
    } catch (e) {
      setSyncState("error");
      setSyncMessage(String(e));
    }
  }

  async function completeReminder(reminderId: string) {
    setPending(`done-${reminderId}`);
    try {
      await fetch("/api/crm/action", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "complete_reminder", reminderId }),
      });
      router.refresh();
    } finally {
      setPending(null);
    }
  }

  async function fetchReachOutRecommendation(forceRefresh: boolean) {
    if (!forceRefresh && typeof window !== "undefined") {
      const rawCached = window.localStorage.getItem(REACH_OUT_CACHE_KEY);
      if (rawCached) {
        try {
          const parsed = JSON.parse(rawCached) as { recommendation: ReachOutRecommendation; cachedAt: number };
          if (parsed.recommendation && Date.now() - parsed.cachedAt < REACH_OUT_CACHE_TTL_MS) {
            setReachOut(parsed.recommendation);
            setReachOutError(null);
            setProfileContextConfigured(true);
            return;
          }
        } catch {
          // ignore malformed cache
        }
      }
    }

    setReachOutLoading(true);
    setReachOutError(null);
    try {
      const res = await fetch("/api/reach-out", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ forceRefresh }),
      });
      const body = (await res.json().catch(() => ({}))) as {
        recommendation?: ReachOutRecommendation;
        error?: string;
      };
      if (!res.ok) {
        setReachOutError(body.error || "Could not generate recommendation right now.");
        if ((body.error || "").toLowerCase().includes("settings")) {
          setProfileContextConfigured(false);
        }
        return;
      }
      if (body.recommendation) {
        setReachOut(body.recommendation);
        if (typeof window !== "undefined") {
          window.localStorage.setItem(
            REACH_OUT_CACHE_KEY,
            JSON.stringify({ recommendation: body.recommendation, cachedAt: Date.now() }),
          );
        }
      }
      setProfileContextConfigured(true);
    } finally {
      setReachOutLoading(false);
    }
  }

  useEffect(() => {
    void fetchReachOutRecommendation(false);
  }, []);

  const showGoogleBanner = googleIntegrationStatus.enabled && !googleIntegrationStatus.connected;
  const showCalendarConfigWarning = !googleIntegrationStatus.enabled;

  return (
    <div className="home-container" style={{ padding: "32px 40px", maxWidth: "960px" }}>
      <div style={{ marginBottom: "28px" }}>
        <h1
          style={{
            fontSize: "28px",
            fontWeight: "800",
            color: "#111827",
            letterSpacing: "-0.5px",
            marginBottom: "6px",
          }}
        >
          {greeting}
        </h1>
        <p style={{ fontSize: "14px", color: "#9ca3af" }}>
          Here is what needs attention today.
        </p>
      </div>

      {(showGoogleBanner || showCalendarConfigWarning) && (
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            flexWrap: "wrap",
            gap: "10px",
            padding: "12px 14px",
            marginBottom: "20px",
            background: "#fffbeb",
            border: "1px solid #fde68a",
            borderRadius: "10px",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
            <AlertCircle size={16} style={{ color: "#d97706", flexShrink: 0 }} />
            <div style={{ fontSize: "13px", color: "#92400e" }}>
              {showCalendarConfigWarning
                ? `Google Calendar not configured (${googleIntegrationStatus.missingConfig.join(", ")}).`
                : "Connect Google Calendar to see today's meetings with briefings."}
            </div>
          </div>
          {!showCalendarConfigWarning && (
            <a
              href="/api/integrations/google-calendar/connect?redirectTo=/"
              style={{
                fontSize: "12px",
                fontWeight: 600,
                color: "#fff",
                background: "#4f46e5",
                borderRadius: "8px",
                padding: "7px 12px",
                textDecoration: "none",
              }}
            >
              Connect Google
            </a>
          )}
        </div>
      )}

      {/* Card 1: Today's meetings with briefings */}
      <section style={{ marginBottom: "28px" }}>
        <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "14px" }}>
          <CalendarClock size={18} style={{ color: "#4f46e5" }} />
          <h2 style={{ fontSize: "16px", fontWeight: "700", color: "#111827" }}>Today&apos;s meetings</h2>
          {googleIntegrationStatus.connected && (
            <button
              type="button"
              onClick={() => void resyncCalendar()}
              disabled={syncState === "syncing"}
              title="Dev: re-run the 14-day calendar backfill"
              style={{
                marginLeft: "auto",
                display: "inline-flex",
                alignItems: "center",
                gap: "4px",
                fontSize: "11px",
                fontWeight: 600,
                color: syncState === "error" ? "#b91c1c" : "#6b7280",
                background: "transparent",
                border: "1px dashed #e5e7eb",
                borderRadius: "6px",
                padding: "4px 8px",
                cursor: syncState === "syncing" ? "wait" : "pointer",
              }}
            >
              <RefreshCw
                size={11}
                style={{
                  animation: syncState === "syncing" ? "hc-spin 1s linear infinite" : undefined,
                }}
              />
              {syncState === "syncing" ? "Syncing…" : "Resync"}
            </button>
          )}
        </div>
        {syncMessage && (
          <div
            style={{
              fontSize: "11px",
              marginBottom: "10px",
              color: syncState === "error" ? "#b91c1c" : "#059669",
            }}
          >
            {syncMessage}
          </div>
        )}
        {todaysMeetings.length === 0 ? (
          <div
            style={{
              padding: "20px",
              background: "#fafafa",
              border: "1px dashed #e5e7eb",
              borderRadius: "12px",
              fontSize: "13px",
              color: "#9ca3af",
            }}
          >
            {googleIntegrationStatus.connected
              ? "No meetings on your calendar today."
              : "Connect Google Calendar to see pre-meeting briefings for everyone you meet with."}
          </div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
            {todaysMeetings.map((m) => (
              <MeetingBriefing key={m.eventId} meeting={m} onLog={(contactId) => openCapture({ contactId })} />
            ))}
          </div>
        )}
      </section>

      {/* Card 2: Action queue */}
      <section style={{ marginBottom: "28px" }}>
        <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "14px" }}>
          <CheckCircle2 size={18} style={{ color: "#059669" }} />
          <h2 style={{ fontSize: "16px", fontWeight: "700", color: "#111827" }}>Action queue</h2>
          {actionQueue.length > 0 && (
            <span
              style={{
                fontSize: "11px",
                fontWeight: 600,
                color: "#059669",
                background: "rgba(5, 150, 105, 0.08)",
                padding: "2px 8px",
                borderRadius: "10px",
              }}
            >
              {actionQueue.length}
            </span>
          )}
        </div>
        {actionQueue.length === 0 ? (
          <div
            style={{
              padding: "20px",
              background: "#fafafa",
              border: "1px dashed #e5e7eb",
              borderRadius: "12px",
              fontSize: "13px",
              color: "#9ca3af",
            }}
          >
            Inbox zero. Nothing needs attention today.
          </div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
            {actionQueue.map((item) =>
              item.kind === "reminder" ? (
                <ReminderRow
                  key={item.id}
                  reminder={item.reminder}
                  pending={pending}
                  onDone={() => completeReminder(item.reminder.id)}
                />
              ) : (
                <DriftRow
                  key={item.id}
                  contact={item.contact}
                  daysSince={item.daysSince}
                  pending={pending}
                  onLog={() => openCapture({ contactId: item.contact.id })}
                  onSnooze={() => snooze(item.contact.id)}
                />
              ),
            )}
          </div>
        )}
      </section>

      {/* Card 3: Compact reach-out suggestion */}
      <section>
        <div
          style={{
            padding: "14px 16px",
            border: "1px solid #e5e7eb",
            borderRadius: "12px",
            background: "#fff",
            display: "flex",
            alignItems: "center",
            gap: "14px",
            flexWrap: "wrap",
          }}
        >
          <Sparkles size={18} style={{ color: "#7c3aed", flexShrink: 0 }} />
          <div style={{ flex: 1, minWidth: "200px" }}>
            {reachOut ? (
              <>
                <div style={{ fontSize: "12px", color: "#9ca3af", fontWeight: 600, marginBottom: "2px" }}>
                  Someone new to meet
                </div>
                <div style={{ fontSize: "14px", color: "#111827" }}>
                  <strong>{reachOut.person.name}</strong>
                  {reachOut.person.role && <span style={{ color: "#6b7280" }}>{` — ${reachOut.person.role}`}</span>}
                  {reachOut.person.company && <span style={{ color: "#6b7280" }}>{` @ ${reachOut.person.company}`}</span>}
                </div>
                <div style={{ fontSize: "12px", color: "#6b7280", marginTop: "4px", lineHeight: 1.4 }}>
                  {reachOut.person.reason}
                </div>
              </>
            ) : (
              <div style={{ fontSize: "13px", color: "#6b7280" }}>
                {profileContextConfigured
                  ? reachOutLoading
                    ? "Finding someone worth meeting..."
                    : reachOutError ?? "No recommendation available."
                  : "Add profile context in Settings to see personalized recommendations."}
              </div>
            )}
          </div>
          <div style={{ display: "flex", gap: "8px", alignItems: "center" }}>
            {reachOut && (
              <a
                href={reachOut.person.sourceUrl}
                target="_blank"
                rel="noreferrer"
                style={{
                  fontSize: "12px",
                  fontWeight: 600,
                  color: "#4338ca",
                  textDecoration: "none",
                  padding: "6px 10px",
                  borderRadius: "8px",
                  border: "1px solid #e0e7ff",
                }}
              >
                View
              </a>
            )}
            <button
              type="button"
              onClick={() => { void fetchReachOutRecommendation(true); }}
              disabled={reachOutLoading}
              style={{
                fontSize: "12px",
                fontWeight: 600,
                color: "#6b7280",
                background: "transparent",
                border: "1px solid #e5e7eb",
                borderRadius: "8px",
                padding: "6px 10px",
                cursor: reachOutLoading ? "wait" : "pointer",
                display: "inline-flex",
                alignItems: "center",
                gap: "4px",
              }}
              aria-label="New recommendation"
            >
              <RefreshCw size={12} />
              New
            </button>
            {!profileContextConfigured && (
              <Link
                href="/settings"
                style={{
                  fontSize: "12px",
                  fontWeight: 600,
                  color: "#4f46e5",
                  textDecoration: "none",
                  padding: "6px 10px",
                  borderRadius: "8px",
                  border: "1px solid rgba(79, 70, 229, 0.2)",
                }}
              >
                Settings
              </Link>
            )}
          </div>
        </div>
      </section>

      <style>{`
        @media (max-width: 768px) {
          .home-container { padding: 20px 16px !important; }
        }
        @keyframes hc-spin {
          from { transform: rotate(0deg); }
          to { transform: rotate(360deg); }
        }
      `}</style>
    </div>
  );
}

function ReminderRow({
  reminder,
  pending,
  onDone,
}: {
  reminder: ReminderRow;
  pending: string | null;
  onDone: () => void;
}) {
  const isBusy = pending !== null;
  const sourceLabel =
    reminder.source === "google_calendar"
      ? "Calendar"
      : reminder.source === "scheduled"
        ? "Scheduled"
        : reminder.source === "captured"
          ? "From capture"
          : "Manual";
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        gap: "12px",
        flexWrap: "wrap",
        padding: "12px 14px",
        background: "#fff",
        border: "1px solid #e5e7eb",
        borderRadius: "10px",
      }}
    >
      <div style={{ flex: 1, minWidth: "200px" }}>
        <div style={{ fontSize: "14px", fontWeight: 600, color: "#111827" }}>{reminder.text}</div>
        <div style={{ fontSize: "12px", color: "#9ca3af", marginTop: "4px", display: "flex", alignItems: "center", gap: "8px" }}>
          <Clock size={12} />
          {reminder.date}
          <span style={{ color: "#d1d5db" }}>|</span>
          <span style={{ color: "#6b7280", fontWeight: 500 }}>{sourceLabel}</span>
          {reminder.contactName && (
            <>
              <span style={{ color: "#d1d5db" }}>|</span>
              <span>{reminder.contactName}</span>
            </>
          )}
        </div>
      </div>
      <div style={{ display: "flex", gap: "6px" }}>
        {reminder.externalUrl && (
          <a
            href={reminder.externalUrl}
            target="_blank"
            rel="noreferrer"
            style={{
              fontSize: "12px",
              fontWeight: 600,
              color: "#111827",
              padding: "7px 10px",
              borderRadius: "8px",
              border: "1px solid #e5e7eb",
              textDecoration: "none",
            }}
          >
            Open
          </a>
        )}
        {reminder.contactId && (
          <Link
            href={`/people/${reminder.contactId}`}
            style={{
              fontSize: "12px",
              fontWeight: 600,
              color: "#4f46e5",
              padding: "7px 10px",
              borderRadius: "8px",
              border: "1px solid rgba(79, 70, 229, 0.2)",
              textDecoration: "none",
            }}
          >
            Profile
          </Link>
        )}
        <button
          type="button"
          onClick={onDone}
          disabled={isBusy}
          style={{
            fontSize: "12px",
            fontWeight: 600,
            color: "#fff",
            background: pending === `done-${reminder.id}` ? "#9ca3af" : "#059669",
            border: "none",
            padding: "7px 12px",
            borderRadius: "8px",
            cursor: isBusy ? "wait" : "pointer",
          }}
        >
          Done
        </button>
      </div>
    </div>
  );
}

function DriftRow({
  contact,
  daysSince,
  pending,
  onLog,
  onSnooze,
}: {
  contact: Contact;
  daysSince: number;
  pending: string | null;
  onLog: () => void;
  onSnooze: () => void;
}) {
  const isBusy = pending !== null;
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        gap: "12px",
        flexWrap: "wrap",
        padding: "12px 14px",
        background: "#fff",
        border: "1px solid #e5e7eb",
        borderRadius: "10px",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: "12px", flex: 1, minWidth: "200px" }}>
        <div
          style={{
            width: "36px",
            height: "36px",
            borderRadius: "10px",
            background: `${contact.avatarColor}22`,
            color: contact.avatarColor,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            fontSize: "12px",
            fontWeight: 700,
            flexShrink: 0,
          }}
        >
          {contact.avatar}
        </div>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontSize: "14px", fontWeight: 600, color: "#111827" }}>
            Reconnect with {contact.name}
          </div>
          <div style={{ fontSize: "12px", color: "#9ca3af", marginTop: "2px", display: "flex", alignItems: "center", gap: "6px" }}>
            <Clock size={12} />
            {daysSince} days since last touch
            <span style={{ color: "#d1d5db" }}>|</span>
            <span>{contact.role}{contact.company ? ` @ ${contact.company}` : ""}</span>
          </div>
        </div>
      </div>
      <div style={{ display: "flex", gap: "6px" }}>
        <button
          type="button"
          onClick={onLog}
          style={{
            fontSize: "12px",
            fontWeight: 600,
            color: "#4f46e5",
            padding: "7px 10px",
            borderRadius: "8px",
            border: "1px solid rgba(79, 70, 229, 0.2)",
            background: "transparent",
            cursor: "pointer",
            display: "inline-flex",
            alignItems: "center",
            gap: "4px",
          }}
        >
          <MessageSquare size={12} /> Log
        </button>
        <Link
          href={`/people/${contact.id}`}
          style={{
            fontSize: "12px",
            fontWeight: 600,
            color: "#111827",
            padding: "7px 10px",
            borderRadius: "8px",
            border: "1px solid #e5e7eb",
            textDecoration: "none",
            display: "inline-flex",
            alignItems: "center",
            gap: "4px",
          }}
        >
          Open <ChevronRight size={12} />
        </Link>
        <button
          type="button"
          onClick={onSnooze}
          disabled={isBusy}
          style={{
            fontSize: "12px",
            fontWeight: 600,
            color: "#6b7280",
            background: "#f3f4f6",
            border: "none",
            padding: "7px 10px",
            borderRadius: "8px",
            cursor: isBusy ? "wait" : "pointer",
          }}
        >
          Snooze
        </button>
      </div>
    </div>
  );
}
