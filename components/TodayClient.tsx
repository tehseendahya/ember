"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { Bell, CalendarClock, ChevronRight, Clock, RefreshCw, User } from "lucide-react";
import type { Contact, ReachOutRecommendation, StandaloneReminder, WeeklyDigest } from "@/lib/types";

type ReminderRow = StandaloneReminder & { contactName: string | null };
const REACH_OUT_CACHE_KEY = "today-reach-out-cache-v1";
const REACH_OUT_CACHE_TTL_MS = 24 * 60 * 60 * 1000;

export default function TodayClient({
  staleContacts,
  dueReminders,
  digest,
  googleIntegrationStatus,
}: {
  staleContacts: { contact: Contact; daysSince: number }[];
  dueReminders: ReminderRow[];
  digest: WeeklyDigest;
  googleIntegrationStatus: {
    enabled: boolean;
    connected: boolean;
    missingConfig: string[];
    lastSyncAt: string | null;
    tokenExpiresAt: string | null;
  };
}) {
  const router = useRouter();
  const [pending, setPending] = useState<string | null>(null);
  const [reachOut, setReachOut] = useState<ReachOutRecommendation | null>(null);
  const [reachOutLoading, setReachOutLoading] = useState(false);
  const [reachOutError, setReachOutError] = useState<string | null>(null);
  const [profileContextConfigured, setProfileContextConfigured] = useState(true);

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

  async function syncGoogleCalendar() {
    setPending("google-sync");
    try {
      await fetch("/api/integrations/google-calendar/sync", {
        method: "POST",
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
          // Ignore malformed cache and proceed to API fetch.
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

  return (
    <div className="today-container" style={{ padding: "32px 40px", maxWidth: "960px" }}>
      <div style={{ marginBottom: "28px" }}>
        <h1 style={{ fontSize: "28px", fontWeight: "800", color: "#111827", letterSpacing: "-0.5px", marginBottom: "8px" }}>
          Today
        </h1>
        <p style={{ fontSize: "14px", color: "#9ca3af" }}>
          Reconnect with people you have not spoken to in a while, and follow through on reminders.
        </p>
      </div>

      <section style={{ marginBottom: "20px" }}>
        <div
          style={{
            padding: "16px",
            border: "1px solid rgba(79, 70, 229, 0.25)",
            borderRadius: "12px",
            background: "linear-gradient(135deg, rgba(79, 70, 229, 0.08) 0%, rgba(99, 102, 241, 0.08) 100%)",
          }}
        >
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: "8px", flexWrap: "wrap", marginBottom: "8px" }}>
            <h2 style={{ fontSize: "16px", fontWeight: "700", color: "#111827", margin: 0 }}>
              Who to reach out to today
            </h2>
            <button
              type="button"
              onClick={() => { void fetchReachOutRecommendation(true); }}
              disabled={reachOutLoading}
              style={{
                fontSize: "12px",
                fontWeight: "600",
                color: "#fff",
                background: reachOutLoading ? "#9ca3af" : "#4f46e5",
                border: "none",
                borderRadius: "8px",
                padding: "8px 12px",
                cursor: reachOutLoading ? "wait" : "pointer",
              }}
            >
              Source new contact
            </button>
          </div>
          {reachOut ? (
            <>
              <div style={{ fontSize: "15px", fontWeight: "700", color: "#111827" }}>
                {reachOut.person.name}
              </div>
              <div style={{ fontSize: "12px", color: "#4b5563", marginTop: "2px" }}>
                {reachOut.person.role} {reachOut.person.company ? `@ ${reachOut.person.company}` : ""}
              </div>
              <p style={{ fontSize: "13px", color: "#374151", marginTop: "10px", marginBottom: "10px", lineHeight: 1.5 }}>
                {reachOut.person.reason}
              </p>
              <a
                href={reachOut.person.sourceUrl}
                target="_blank"
                rel="noreferrer"
                style={{ fontSize: "12px", color: "#4338ca", textDecoration: "none", fontWeight: 600 }}
              >
                View source
              </a>
            </>
          ) : (
            <p style={{ fontSize: "13px", color: "#6b7280", margin: 0 }}>
              {profileContextConfigured
                ? reachOutLoading
                  ? "Generating recommendation..."
                  : "No recommendation yet."
                : "Add profile context in Settings to enable personalized recommendations."}
            </p>
          )}
          {reachOutError && (
            <p style={{ fontSize: "12px", color: "#b91c1c", marginTop: "8px", marginBottom: 0 }}>
              {reachOutError}
            </p>
          )}
          {!profileContextConfigured && (
            <div style={{ marginTop: "10px" }}>
              <Link href="/settings" style={{ fontSize: "12px", fontWeight: 600, color: "#4f46e5", textDecoration: "none" }}>
                Open Settings
              </Link>
            </div>
          )}
        </div>
      </section>

      <section style={{ marginBottom: "20px" }}>
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            flexWrap: "wrap",
            gap: "12px",
            padding: "12px 14px",
            border: "1px solid #e5e7eb",
            borderRadius: "10px",
            background: "#fff",
          }}
        >
          <div style={{ fontSize: "13px", color: "#374151" }}>
            <strong>Google Calendar:</strong>{" "}
            {!googleIntegrationStatus.enabled
              ? `Missing env config (${googleIntegrationStatus.missingConfig.join(", ")})`
              : googleIntegrationStatus.connected
                ? "Connected"
                : "Not connected"}
            {googleIntegrationStatus.lastSyncAt ? ` · Last sync ${new Date(googleIntegrationStatus.lastSyncAt).toLocaleString()}` : ""}
          </div>
          <div style={{ display: "flex", gap: "8px", alignItems: "center" }}>
            {!googleIntegrationStatus.connected ? (
              <a
                href="/api/integrations/google-calendar/connect?redirectTo=/"
                style={{
                  fontSize: "12px",
                  fontWeight: "600",
                  color: "#fff",
                  background: googleIntegrationStatus.enabled ? "#4f46e5" : "#9ca3af",
                  border: "none",
                  borderRadius: "8px",
                  padding: "8px 12px",
                  textDecoration: "none",
                  pointerEvents: googleIntegrationStatus.enabled ? "auto" : "none",
                }}
              >
                Connect Google
              </a>
            ) : (
              <button
                type="button"
                onClick={() => { void syncGoogleCalendar(); }}
                disabled={pending !== null}
                style={{
                  fontSize: "12px",
                  fontWeight: "600",
                  color: "#fff",
                  background: pending === "google-sync" ? "#9ca3af" : "#059669",
                  border: "none",
                  borderRadius: "8px",
                  padding: "8px 12px",
                  cursor: pending !== null ? "wait" : "pointer",
                }}
              >
                Sync calendar
              </button>
            )}
          </div>
        </div>
      </section>

      {/* Due reminders */}
      <section style={{ marginBottom: "28px" }}>
        <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "14px" }}>
          <Bell size={18} style={{ color: "#d97706" }} />
          <h2 style={{ fontSize: "16px", fontWeight: "700", color: "#111827" }}>Due follow-ups</h2>
        </div>
        {dueReminders.length === 0 ? (
          <p style={{ fontSize: "14px", color: "#9ca3af", padding: "16px", background: "#fafafa", borderRadius: "12px", border: "1px solid #f3f4f6" }}>
            No reminders due today. Log updates on the Update page to add more.
          </p>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
            {dueReminders.map((r) => (
              <div
                key={r.id}
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  gap: "12px",
                  flexWrap: "wrap",
                  padding: "14px 18px",
                  background: "#ffffff",
                  border: "1px solid #e5e7eb",
                  borderRadius: "12px",
                }}
              >
                <div style={{ flex: 1, minWidth: "200px" }}>
                  <div style={{ fontSize: "14px", fontWeight: "600", color: "#111827" }}>{r.text}</div>
                  <div style={{ fontSize: "12px", color: "#9ca3af", marginTop: "4px", display: "flex", alignItems: "center", gap: "8px" }}>
                    <CalendarClock size={12} />
                    {r.date}
                    {r.source === "google_calendar" && (
                      <>
                        <span style={{ color: "#d1d5db" }}>|</span>
                        <span style={{ color: "#4f46e5", fontWeight: 600 }}>Google Calendar</span>
                      </>
                    )}
                    {r.contactName && (
                      <>
                        <span style={{ color: "#d1d5db" }}>|</span>
                        <User size={12} />
                        {r.contactName}
                      </>
                    )}
                  </div>
                </div>
                <div style={{ display: "flex", gap: "8px" }}>
                  {r.externalUrl && (
                    <a
                      href={r.externalUrl}
                      target="_blank"
                      rel="noreferrer"
                      style={{
                        fontSize: "13px",
                        fontWeight: "600",
                        color: "#111827",
                        padding: "8px 12px",
                        borderRadius: "8px",
                        border: "1px solid #e5e7eb",
                        textDecoration: "none",
                      }}
                    >
                      Open event
                    </a>
                  )}
                  {r.contactId && (
                    <Link
                      href={`/my-people/${r.contactId}`}
                      style={{
                        fontSize: "13px",
                        fontWeight: "600",
                        color: "#4f46e5",
                        padding: "8px 12px",
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
                    onClick={() => { void completeReminder(r.id); }}
                    disabled={pending !== null}
                    style={{
                      fontSize: "13px",
                      fontWeight: "600",
                      color: "#fff",
                      background: pending === `done-${r.id}` ? "#9ca3af" : "#059669",
                      border: "none",
                      padding: "8px 14px",
                      borderRadius: "8px",
                      cursor: pending !== null ? "wait" : "pointer",
                    }}
                  >
                    Done
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* Stale / reconnect */}
      <section style={{ marginBottom: "36px" }}>
        <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "14px" }}>
          <RefreshCw size={18} style={{ color: "#4f46e5" }} />
          <h2 style={{ fontSize: "16px", fontWeight: "700", color: "#111827" }}>Reconnect (45+ days)</h2>
        </div>
        {staleContacts.length === 0 ? (
          <p style={{ fontSize: "14px", color: "#9ca3af", padding: "16px", background: "#fafafa", borderRadius: "12px", border: "1px solid #f3f4f6" }}>
            Nobody is overdue for a touch right now. Nice work staying in touch.
          </p>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
            {staleContacts.map(({ contact: c, daysSince }) => (
              <div
                key={c.id}
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  gap: "12px",
                  flexWrap: "wrap",
                  padding: "14px 18px",
                  background: "#ffffff",
                  border: "1px solid #e5e7eb",
                  borderRadius: "12px",
                }}
              >
                <div style={{ display: "flex", alignItems: "center", gap: "12px", flex: 1, minWidth: "200px" }}>
                  <div
                    style={{
                      width: "40px",
                      height: "40px",
                      borderRadius: "10px",
                      background: `${c.avatarColor}22`,
                      color: c.avatarColor,
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      fontSize: "13px",
                      fontWeight: "700",
                    }}
                  >
                    {c.avatar}
                  </div>
                  <div>
                    <div style={{ fontSize: "14px", fontWeight: "600", color: "#111827" }}>{c.name}</div>
                    <div style={{ fontSize: "12px", color: "#9ca3af" }}>
                      {c.role} @ {c.company}
                    </div>
                    <div style={{ fontSize: "12px", color: "#d97706", marginTop: "2px", display: "flex", alignItems: "center", gap: "4px" }}>
                      <Clock size={12} />
                      Last touch {daysSince} days ago
                    </div>
                  </div>
                </div>
                <div style={{ display: "flex", gap: "8px", alignItems: "center" }}>
                  <Link
                    href={`/update`}
                    style={{
                      fontSize: "13px",
                      fontWeight: "600",
                      color: "#4f46e5",
                      padding: "8px 12px",
                      borderRadius: "8px",
                      border: "1px solid rgba(79, 70, 229, 0.2)",
                      textDecoration: "none",
                    }}
                  >
                    Log note
                  </Link>
                  <Link
                    href={`/my-people/${c.id}`}
                    style={{
                      fontSize: "13px",
                      fontWeight: "600",
                      color: "#111827",
                      padding: "8px 12px",
                      borderRadius: "8px",
                      border: "1px solid #e5e7eb",
                      textDecoration: "none",
                      display: "flex",
                      alignItems: "center",
                      gap: "4px",
                    }}
                  >
                    Open <ChevronRight size={14} />
                  </Link>
                  <button
                    type="button"
                    onClick={() => { void snooze(c.id); }}
                    disabled={pending !== null}
                    style={{
                      fontSize: "13px",
                      fontWeight: "600",
                      color: "#6b7280",
                      background: "#f3f4f6",
                      border: "none",
                      padding: "8px 12px",
                      borderRadius: "8px",
                      cursor: pending !== null ? "wait" : "pointer",
                    }}
                  >
                    Snooze 7d
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* Weekly digest */}
      <section>
        <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "14px" }}>
          <Clock size={18} style={{ color: "#6366f1" }} />
          <h2 style={{ fontSize: "16px", fontWeight: "700", color: "#111827" }}>This week at a glance</h2>
        </div>
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))",
            gap: "12px",
            padding: "20px",
            background: "linear-gradient(135deg, rgba(79, 70, 229, 0.04) 0%, rgba(99, 102, 241, 0.06) 100%)",
            border: "1px solid rgba(79, 70, 229, 0.12)",
            borderRadius: "14px",
          }}
        >
          <div>
            <div style={{ fontSize: "28px", fontWeight: "800", color: "#111827" }}>{digest.driftingCount}</div>
            <div style={{ fontSize: "12px", color: "#6b7280", fontWeight: "600" }}>Contacts drifting (30+ days)</div>
          </div>
          <div>
            <div style={{ fontSize: "28px", fontWeight: "800", color: "#111827" }}>{digest.followUpsThisWeek}</div>
            <div style={{ fontSize: "12px", color: "#6b7280", fontWeight: "600" }}>Follow-ups due this week</div>
          </div>
          <div>
            <div style={{ fontSize: "28px", fontWeight: "800", color: "#111827" }}>{digest.interactionsLoggedLast7Days}</div>
            <div style={{ fontSize: "12px", color: "#6b7280", fontWeight: "600" }}>Interactions logged (7 days)</div>
          </div>
        </div>
        <p style={{ fontSize: "12px", color: "#9ca3af", marginTop: "10px" }}>{digest.weekLabel}</p>
        {digest.topStale.length > 0 && (
          <div style={{ marginTop: "14px" }}>
            <div style={{ fontSize: "12px", fontWeight: "600", color: "#6b7280", marginBottom: "8px" }}>Longest quiet</div>
            <ul style={{ margin: 0, paddingLeft: "18px", color: "#4b5563", fontSize: "13px", lineHeight: 1.6 }}>
              {digest.topStale.map((row) => (
                <li key={row.id}>
                  <Link href={`/my-people/${row.id}`} style={{ color: "#4f46e5", fontWeight: "600", textDecoration: "none" }}>
                    {row.name}
                  </Link>
                  {" — "}
                  {row.daysSince} days
                </li>
              ))}
            </ul>
          </div>
        )}
      </section>

      <style>{`
        @media (max-width: 768px) {
          .today-container { padding: 20px 16px !important; }
        }
      `}</style>
    </div>
  );
}
