"use client";

import Link from "next/link";
import {
  ArrowLeft,
  Mail,
  Linkedin,
  Calendar,
  MessageSquare,
  Video,
  Users,
  Zap,
  Bell,
  ChevronDown,
  ChevronUp,
  Plus,
  Handshake,
  MapPin,
  GitBranch,
} from "lucide-react";
import type { Contact, Interaction, SecondDegreeEdge, SecondDegreeEvidence } from "@/lib/types";
import { Suspense, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";

const strengthColors: Record<number, string> = {
  5: "#4f46e5",
  4: "#059669",
  3: "#d97706",
  2: "#dc2626",
  1: "#9ca3af",
};

const typeConfig: Record<
  string,
  { icon: React.ReactNode; label: string; color: string }
> = {
  meeting: {
    icon: <Handshake size={14} />,
    label: "Meeting",
    color: "#4f46e5",
  },
  email: { icon: <Mail size={14} />, label: "Email", color: "#059669" },
  zoom: { icon: <Video size={14} />, label: "Zoom", color: "#3b82f6" },
  intro: { icon: <Users size={14} />, label: "Intro", color: "#d97706" },
  message: {
    icon: <MessageSquare size={14} />,
    label: "Message",
    color: "#7c3aed",
  },
  event: { icon: <MapPin size={14} />, label: "Event", color: "#ec4899" },
};

const EVIDENCE_LABELS: Record<SecondDegreeEvidence, string> = {
  colleague: "Colleague / coworker",
  friend: "Friend",
  investor_relation: "Investor relation",
  intro_offer: "Offered to intro",
  event: "Met at event / community",
  other: "Other",
};

function formatDate(dateStr: string): string {
  return new Date(dateStr).toLocaleDateString("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
  });
}

function IntroFromSearchBannerInner() {
  const searchParams = useSearchParams();
  const [dismissed, setDismissed] = useState(false);
  const introTarget = searchParams.get("introTarget");
  const introCompany = searchParams.get("introCompany");
  const introQuery = searchParams.get("introQuery");

  if (!introTarget || dismissed) return null;

  return (
    <div
      style={{
        display: "flex",
        alignItems: "flex-start",
        gap: "12px",
        padding: "12px 16px",
        background: "rgba(79, 70, 229, 0.06)",
        border: "1px solid rgba(79, 70, 229, 0.18)",
        borderRadius: "10px",
        marginBottom: "24px",
      }}
    >
      <Users size={16} style={{ color: "#4f46e5", flexShrink: 0, marginTop: "2px" }} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: "13px", fontWeight: "600", color: "#111827", marginBottom: "4px" }}>
          Intro request context
        </div>
        <p style={{ fontSize: "13px", color: "#6b7280", margin: 0, lineHeight: 1.5 }}>
          You opened this profile to ask for an introduction to{" "}
          <strong style={{ color: "#111827" }}>
            {introTarget}
            {introCompany ? ` @ ${introCompany}` : ""}
          </strong>
          {introQuery ? (
            <>
              {" "}
              (search: &ldquo;{introQuery}&rdquo;)
            </>
          ) : null}
          . Draft your message below or use their email / LinkedIn from this page.
        </p>
      </div>
      <button
        type="button"
        onClick={() => setDismissed(true)}
        style={{
          flexShrink: 0,
          padding: "4px 10px",
          fontSize: "12px",
          fontWeight: "500",
          color: "#6b7280",
          background: "#fff",
          border: "1px solid #e5e7eb",
          borderRadius: "6px",
          cursor: "pointer",
        }}
      >
        Dismiss
      </button>
    </div>
  );
}

function InteractionItem({ interaction }: { interaction: Interaction }) {
  const [expanded, setExpanded] = useState(false);
  const config = typeConfig[interaction.type] || typeConfig.meeting;

  return (
    <div
      style={{
        padding: "16px",
        background: "#f8f9fa",
        borderRadius: "10px",
        border: "1px solid #e5e7eb",
        marginBottom: "8px",
        transition: "border-color 0.15s",
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.borderColor = "#d1d5db";
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.borderColor = "#e5e7eb";
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "flex-start",
          justifyContent: "space-between",
          gap: "12px",
        }}
      >
        <div style={{ display: "flex", alignItems: "flex-start", gap: "12px", flex: 1 }}>
          <div
            style={{
              width: "30px",
              height: "30px",
              borderRadius: "8px",
              background: `${config.color}0d`,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              color: config.color,
              flexShrink: 0,
              marginTop: "2px",
            }}
          >
            {config.icon}
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: "8px",
                marginBottom: "4px",
                flexWrap: "wrap",
              }}
            >
              <span
                style={{
                  fontSize: "13px",
                  fontWeight: "600",
                  color: "#111827",
                }}
              >
                {interaction.title}
              </span>
              <span
                style={{
                  fontSize: "10px",
                  padding: "2px 8px",
                  borderRadius: "20px",
                  background: `${config.color}0d`,
                  color: config.color,
                  fontWeight: "500",
                }}
              >
                {config.label}
              </span>
            </div>
            <div
              style={{ fontSize: "12px", color: "#9ca3af", marginBottom: expanded ? "10px" : 0 }}
            >
              {formatDate(interaction.date)}
            </div>
            {expanded && interaction.notes && (
              <div
                style={{
                  fontSize: "13px",
                  color: "#6b7280",
                  lineHeight: "1.6",
                  padding: "10px 12px",
                  background: "#ffffff",
                  borderRadius: "6px",
                  border: "1px solid #f3f4f6",
                  marginBottom: interaction.reminder ? "8px" : 0,
                }}
              >
                {interaction.notes}
              </div>
            )}
            {expanded && interaction.reminder && (
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: "6px",
                  fontSize: "12px",
                  color: "#d97706",
                  marginTop: "8px",
                }}
              >
                <Bell size={12} />
                Reminder: {formatDate(interaction.reminder)}
              </div>
            )}
          </div>
        </div>
        <button
          onClick={() => setExpanded(!expanded)}
          style={{
            background: "none",
            border: "none",
            cursor: "pointer",
            color: "#9ca3af",
            padding: "2px",
            flexShrink: 0,
            display: "flex",
            alignItems: "center",
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.color = "#111827";
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.color = "#9ca3af";
          }}
        >
          {expanded ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
        </button>
      </div>
    </div>
  );
}

function SecondDegreeConnectionsCard({
  contactId,
  edges,
}: {
  contactId: string;
  edges: SecondDegreeEdge[];
}) {
  const router = useRouter();
  const [name, setName] = useState("");
  const [company, setCompany] = useState("");
  const [role, setRole] = useState("");
  const [evidence, setEvidence] = useState<SecondDegreeEvidence>("other");
  const [confidence, setConfidence] = useState<1 | 2 | 3 | 4 | 5>(3);
  const [notes, setNotes] = useState("");
  const [pending, setPending] = useState(false);
  const [confirmingId, setConfirmingId] = useState<string | null>(null);

  async function handleAdd(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    setPending(true);
    try {
      const res = await fetch("/api/second-degree", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          introducerContactId: contactId,
          targetName: name.trim(),
          targetCompany: company.trim(),
          targetRole: role.trim(),
          evidence,
          confidence,
          notes: notes.trim() || undefined,
        }),
      });
      const data = (await res.json()) as { error?: string };
      if (!res.ok) throw new Error(data.error ?? "Could not save");
      setName("");
      setCompany("");
      setRole("");
      setNotes("");
      router.refresh();
    } catch {
      /* ignore */
    } finally {
      setPending(false);
    }
  }

  async function handleDelete(edgeId: string) {
    if (!window.confirm("Remove this person from their extended network?")) return;
    await fetch(`/api/second-degree?id=${encodeURIComponent(edgeId)}`, { method: "DELETE" });
    router.refresh();
  }

  async function handleConfirmIntro(edgeId: string) {
    setConfirmingId(edgeId);
    try {
      await fetch("/api/second-degree", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: edgeId,
          noteAppend: "Intro made — relationship refreshed in CRM",
        }),
      });
      router.refresh();
    } finally {
      setConfirmingId(null);
    }
  }

  return (
    <div
      style={{
        background: "#ffffff",
        border: "1px solid #e5e7eb",
        borderRadius: "12px",
        padding: "20px",
      }}
    >
      <h3
        style={{
          fontSize: "13px",
          fontWeight: "600",
          color: "#9ca3af",
          textTransform: "uppercase",
          letterSpacing: "0.05em",
          marginBottom: "8px",
          display: "flex",
          alignItems: "center",
          gap: "6px",
        }}
      >
        <GitBranch size={13} />
        Second-degree (who they may know)
      </h3>
      <p style={{ fontSize: "12px", color: "#9ca3af", margin: "0 0 14px", lineHeight: 1.5 }}>
        Add people this contact could introduce you to. These edges power warm-intro suggestions in world search
        and ranking.
      </p>

      <div style={{ display: "flex", flexDirection: "column", gap: "10px", marginBottom: "16px" }}>
        {edges.length === 0 ? (
          <p style={{ fontSize: "13px", color: "#6b7280", margin: 0 }}>No entries yet — add one below.</p>
        ) : (
          edges.map((edge) => (
            <div
              key={edge.id}
              style={{
                display: "flex",
                flexDirection: "column",
                gap: "8px",
                padding: "10px 12px",
                background: "#f8f9fa",
                borderRadius: "8px",
                border: "1px solid #e5e7eb",
              }}
            >
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: "8px" }}>
                <div>
                  <div style={{ fontSize: "13px", fontWeight: "600", color: "#111827" }}>{edge.targetName}</div>
                  <div style={{ fontSize: "11px", color: "#9ca3af" }}>
                    {edge.targetRole}
                    {edge.targetCompany ? ` @ ${edge.targetCompany}` : ""}
                  </div>
                  <div style={{ fontSize: "10px", color: "#9ca3af", marginTop: "4px" }}>
                    {EVIDENCE_LABELS[edge.evidence]} · confidence {edge.confidence}/5 · updated{" "}
                    {formatDate(edge.lastEvidenceAt)}
                  </div>
                </div>
                <div style={{ display: "flex", flexWrap: "wrap", gap: "6px", justifyContent: "flex-end" }}>
                  <button
                    type="button"
                    onClick={() => void handleConfirmIntro(edge.id)}
                    disabled={confirmingId === edge.id}
                    style={{
                      padding: "4px 8px",
                      fontSize: "11px",
                      fontWeight: "600",
                      color: "#059669",
                      background: "rgba(5, 150, 105, 0.08)",
                      border: "1px solid rgba(5, 150, 105, 0.25)",
                      borderRadius: "6px",
                      cursor: confirmingId === edge.id ? "wait" : "pointer",
                    }}
                  >
                    {confirmingId === edge.id ? "…" : "Intro done"}
                  </button>
                  <button
                    type="button"
                    onClick={() => void handleDelete(edge.id)}
                    style={{
                      padding: "4px 8px",
                      fontSize: "11px",
                      fontWeight: "500",
                      color: "#6b7280",
                      background: "#fff",
                      border: "1px solid #e5e7eb",
                      borderRadius: "6px",
                      cursor: "pointer",
                    }}
                  >
                    Remove
                  </button>
                </div>
              </div>
            </div>
          ))
        )}
      </div>

      <form onSubmit={(e) => void handleAdd(e)} style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
        <div style={{ fontSize: "11px", fontWeight: "600", color: "#6b7280" }}>Add connection</div>
        <input
          placeholder="Name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          required
          style={{
            padding: "8px 10px",
            fontSize: "13px",
            borderRadius: "6px",
            border: "1px solid #e5e7eb",
            width: "100%",
            boxSizing: "border-box",
          }}
        />
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "8px" }}>
          <input
            placeholder="Role"
            value={role}
            onChange={(e) => setRole(e.target.value)}
            style={{
              padding: "8px 10px",
              fontSize: "13px",
              borderRadius: "6px",
              border: "1px solid #e5e7eb",
            }}
          />
          <input
            placeholder="Company"
            value={company}
            onChange={(e) => setCompany(e.target.value)}
            style={{
              padding: "8px 10px",
              fontSize: "13px",
              borderRadius: "6px",
              border: "1px solid #e5e7eb",
            }}
          />
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "8px" }}>
          <select
            value={evidence}
            onChange={(e) => setEvidence(e.target.value as SecondDegreeEvidence)}
            style={{
              padding: "8px 10px",
              fontSize: "12px",
              borderRadius: "6px",
              border: "1px solid #e5e7eb",
              background: "#fff",
            }}
          >
            {(Object.keys(EVIDENCE_LABELS) as SecondDegreeEvidence[]).map((k) => (
              <option key={k} value={k}>
                {EVIDENCE_LABELS[k]}
              </option>
            ))}
          </select>
          <select
            value={confidence}
            onChange={(e) => setConfidence(Number(e.target.value) as 1 | 2 | 3 | 4 | 5)}
            style={{
              padding: "8px 10px",
              fontSize: "12px",
              borderRadius: "6px",
              border: "1px solid #e5e7eb",
              background: "#fff",
            }}
          >
            {[1, 2, 3, 4, 5].map((n) => (
              <option key={n} value={n}>
                Relationship strength {n}/5
              </option>
            ))}
          </select>
        </div>
        <textarea
          placeholder="Optional notes (how they know each other)"
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          rows={2}
          style={{
            padding: "8px 10px",
            fontSize: "12px",
            borderRadius: "6px",
            border: "1px solid #e5e7eb",
            resize: "vertical",
            fontFamily: "inherit",
          }}
        />
        <button
          type="submit"
          disabled={pending || !name.trim()}
          style={{
            padding: "8px 14px",
            fontSize: "13px",
            fontWeight: "600",
            color: "#fff",
            background: pending ? "#a5b4fc" : "#4f46e5",
            border: "none",
            borderRadius: "8px",
            cursor: pending ? "wait" : "pointer",
            alignSelf: "flex-start",
          }}
        >
          {pending ? "Saving…" : "Add to extended network"}
        </button>
      </form>
    </div>
  );
}

export default function ContactDetailClient({
  contact,
  allContacts,
  secondDegreeEdges,
}: {
  contact: Contact;
  allContacts: Contact[];
  secondDegreeEdges: SecondDegreeEdge[];
}) {
  const borderColor = strengthColors[contact.connectionStrength] || "#9ca3af";
  const mutualContacts = contact.mutualConnections
    .map((mid) => allContacts.find((c) => c.id === mid))
    .filter(Boolean) as Contact[];

  const hasReminders = contact.interactions.some((i) => i.reminder);

  const sortedInteractions = [...contact.interactions].sort(
    (a, b) => new Date(b.date).getTime() - new Date(a.date).getTime()
  );

  return (
    <div className="detail-container" style={{ padding: "32px 40px", maxWidth: "1200px" }}>
      {/* Back button */}
      <Link
        href="/my-people"
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: "8px",
          color: "#9ca3af",
          textDecoration: "none",
          fontSize: "14px",
          marginBottom: "28px",
          transition: "color 0.15s",
        }}
        onMouseEnter={(e) => {
          (e.currentTarget as HTMLElement).style.color = "#111827";
        }}
        onMouseLeave={(e) => {
          (e.currentTarget as HTMLElement).style.color = "#9ca3af";
        }}
      >
        <ArrowLeft size={16} />
        Back to My People
      </Link>

      <Suspense fallback={null}>
        <IntroFromSearchBannerInner />
      </Suspense>

      {/* Reminders Banner */}
      {hasReminders && (
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: "10px",
            padding: "12px 16px",
            background: "rgba(217, 119, 6, 0.06)",
            border: "1px solid rgba(217, 119, 6, 0.15)",
            borderRadius: "10px",
            marginBottom: "24px",
          }}
        >
          <Bell size={16} style={{ color: "#d97706", flexShrink: 0 }} />
          <span style={{ fontSize: "13px", color: "#d97706" }}>
            You have upcoming reminders for {contact.name}
          </span>
        </div>
      )}

      {/* Profile Header */}
      <div
        style={{
          background: "#ffffff",
          border: "1px solid #e5e7eb",
          borderTop: `3px solid ${borderColor}`,
          borderRadius: "16px",
          padding: "28px",
          marginBottom: "24px",
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "flex-start",
            gap: "20px",
            flexWrap: "wrap",
          }}
        >
          {/* Avatar */}
          <div
            style={{
              width: "72px",
              height: "72px",
              borderRadius: "50%",
              background: contact.avatarColor,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontSize: "22px",
              fontWeight: "800",
              color: "white",
              boxShadow: `0 0 24px ${contact.avatarColor}30`,
              flexShrink: 0,
            }}
          >
            {contact.avatar}
          </div>

          {/* Info */}
          <div style={{ flex: 1, minWidth: "200px" }}>
            <h1
              style={{
                fontSize: "26px",
                fontWeight: "800",
                color: "#111827",
                letterSpacing: "-0.5px",
                marginBottom: "4px",
              }}
            >
              {contact.name}
            </h1>
            <div style={{ fontSize: "15px", color: "#6b7280", marginBottom: "14px" }}>
              {contact.role} at {contact.company}
            </div>
            <div style={{ display: "flex", gap: "10px", flexWrap: "wrap" }}>
              <a
                href={`mailto:${contact.email}`}
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: "6px",
                  padding: "7px 12px",
                  background: "rgba(79, 70, 229, 0.06)",
                  border: "1px solid rgba(79, 70, 229, 0.12)",
                  borderRadius: "6px",
                  color: "#4f46e5",
                  fontSize: "13px",
                  textDecoration: "none",
                  fontWeight: "500",
                  transition: "all 0.15s",
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.background = "rgba(79, 70, 229, 0.1)";
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.background = "rgba(79, 70, 229, 0.06)";
                }}
              >
                <Mail size={13} />
                {contact.email}
              </a>
              <a
                href={contact.linkedIn}
                target="_blank"
                rel="noopener noreferrer"
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: "6px",
                  padding: "7px 12px",
                  background: "rgba(0, 119, 181, 0.06)",
                  border: "1px solid rgba(0, 119, 181, 0.12)",
                  borderRadius: "6px",
                  color: "#0077b5",
                  fontSize: "13px",
                  textDecoration: "none",
                  fontWeight: "500",
                  transition: "all 0.15s",
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.background = "rgba(0, 119, 181, 0.1)";
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.background = "rgba(0, 119, 181, 0.06)";
                }}
              >
                <Linkedin size={13} />
                LinkedIn
              </a>
            </div>
          </div>

          {/* Tags + Strength */}
          <div className="profile-tags" style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: "12px" }}>
            <div style={{ display: "flex", flexWrap: "wrap", gap: "6px", justifyContent: "flex-end" }}>
              {contact.tags.map((tag) => (
                <span
                  key={tag}
                  style={{
                    fontSize: "12px",
                    fontWeight: "500",
                    padding: "4px 10px",
                    borderRadius: "20px",
                    background: "rgba(79, 70, 229, 0.06)",
                    color: "#4f46e5",
                    border: "1px solid rgba(79, 70, 229, 0.12)",
                  }}
                >
                  {tag}
                </span>
              ))}
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
              <span style={{ fontSize: "12px", color: "#9ca3af" }}>Connection strength:</span>
              <div style={{ display: "flex", gap: "4px" }}>
                {[1, 2, 3, 4, 5].map((dot) => (
                  <div
                    key={dot}
                    style={{
                      width: "8px",
                      height: "8px",
                      borderRadius: "50%",
                      background:
                        dot <= contact.connectionStrength ? borderColor : "#e5e7eb",
                      boxShadow: dot <= contact.connectionStrength ? `0 0 4px ${borderColor}60` : "none",
                    }}
                  />
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Two-column layout */}
      <div className="detail-grid" style={{ display: "grid", gridTemplateColumns: "1fr 1.6fr", gap: "24px" }}>
        {/* Left Column */}
        <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
          {/* Notes */}
          <div
            style={{
              background: "#ffffff",
              border: "1px solid #e5e7eb",
              borderRadius: "12px",
              padding: "20px",
            }}
          >
            <h3
              style={{
                fontSize: "13px",
                fontWeight: "600",
                color: "#9ca3af",
                textTransform: "uppercase",
                letterSpacing: "0.05em",
                marginBottom: "12px",
              }}
            >
              Notes
            </h3>
            <p style={{ fontSize: "14px", color: "#6b7280", lineHeight: "1.7" }}>
              {contact.notes}
            </p>
          </div>

          {/* Mutual Connections */}
          {mutualContacts.length > 0 && (
            <div
              style={{
                background: "#ffffff",
                border: "1px solid #e5e7eb",
                borderRadius: "12px",
                padding: "20px",
              }}
            >
              <h3
                style={{
                  fontSize: "13px",
                  fontWeight: "600",
                  color: "#9ca3af",
                  textTransform: "uppercase",
                  letterSpacing: "0.05em",
                  marginBottom: "12px",
                  display: "flex",
                  alignItems: "center",
                  gap: "6px",
                }}
              >
                <Users size={13} />
                Mutual Connections
              </h3>
              <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
                {mutualContacts.map((mc) => {
                  if (!mc) return null;
                  return (
                    <Link
                      key={mc.id}
                      href={`/my-people/${mc.id}`}
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: "10px",
                        textDecoration: "none",
                        padding: "8px 10px",
                        borderRadius: "8px",
                        background: "#f8f9fa",
                        border: "1px solid transparent",
                        transition: "all 0.15s",
                      }}
                      onMouseEnter={(e) => {
                        (e.currentTarget as HTMLElement).style.background =
                          "rgba(79, 70, 229, 0.04)";
                        (e.currentTarget as HTMLElement).style.borderColor =
                          "rgba(79, 70, 229, 0.12)";
                      }}
                      onMouseLeave={(e) => {
                        (e.currentTarget as HTMLElement).style.background =
                          "#f8f9fa";
                        (e.currentTarget as HTMLElement).style.borderColor = "transparent";
                      }}
                    >
                      <div
                        style={{
                          width: "32px",
                          height: "32px",
                          borderRadius: "50%",
                          background: mc.avatarColor,
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "center",
                          fontSize: "11px",
                          fontWeight: "700",
                          color: "white",
                        }}
                      >
                        {mc.avatar}
                      </div>
                      <div>
                        <div style={{ fontSize: "13px", fontWeight: "600", color: "#111827" }}>
                          {mc.name}
                        </div>
                        <div style={{ fontSize: "11px", color: "#9ca3af" }}>
                          {mc.role} @ {mc.company}
                        </div>
                      </div>
                    </Link>
                  );
                })}
              </div>
            </div>
          )}

          <SecondDegreeConnectionsCard contactId={contact.id} edges={secondDegreeEdges} />

          {/* Contact Info */}
          <div
            style={{
              background: "#ffffff",
              border: "1px solid #e5e7eb",
              borderRadius: "12px",
              padding: "20px",
            }}
          >
            <h3
              style={{
                fontSize: "13px",
                fontWeight: "600",
                color: "#9ca3af",
                textTransform: "uppercase",
                letterSpacing: "0.05em",
                marginBottom: "14px",
              }}
            >
              Quick Stats
            </h3>
            <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
              {[
                {
                  icon: <Calendar size={14} style={{ color: "#4f46e5" }} />,
                  label: "Total Interactions",
                  value: contact.interactions.length,
                },
                {
                  icon: <Zap size={14} style={{ color: borderColor }} />,
                  label: "Connection Strength",
                  value: `${contact.connectionStrength}/5`,
                },
                {
                  icon: <Calendar size={14} style={{ color: "#059669" }} />,
                  label: "Last Contact",
                  value: formatDate(contact.lastContact.date),
                },
                {
                  icon: <Users size={14} style={{ color: "#d97706" }} />,
                  label: "Mutual Connections",
                  value: contact.mutualConnections.length,
                },
              ].map(({ icon, label, value }) => (
                <div
                  key={label}
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center",
                  }}
                >
                  <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                    {icon}
                    <span style={{ fontSize: "13px", color: "#9ca3af" }}>{label}</span>
                  </div>
                  <span style={{ fontSize: "13px", fontWeight: "600", color: "#111827" }}>
                    {value}
                  </span>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Right Column: Timeline */}
        <div
          style={{
            background: "#ffffff",
            border: "1px solid #e5e7eb",
            borderRadius: "12px",
            padding: "20px",
          }}
        >
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              marginBottom: "16px",
              flexWrap: "wrap",
              gap: "8px",
            }}
          >
            <h3
              style={{
                fontSize: "13px",
                fontWeight: "600",
                color: "#9ca3af",
                textTransform: "uppercase",
                letterSpacing: "0.05em",
              }}
            >
              Interaction Timeline
            </h3>
            <button
              style={{
                display: "flex",
                alignItems: "center",
                gap: "6px",
                padding: "7px 12px",
                background: "rgba(79, 70, 229, 0.06)",
                border: "1px solid rgba(79, 70, 229, 0.12)",
                borderRadius: "6px",
                color: "#4f46e5",
                fontSize: "12px",
                fontWeight: "500",
                cursor: "pointer",
                transition: "all 0.15s",
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.background = "rgba(79, 70, 229, 0.1)";
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.background = "rgba(79, 70, 229, 0.06)";
              }}
            >
              <Plus size={12} />
              Add Interaction
            </button>
          </div>

          {/* Timeline items */}
          <div
            style={{
              position: "relative",
              paddingLeft: "0",
            }}
          >
            {sortedInteractions.map((interaction, idx) => (
              <div key={interaction.id} style={{ position: "relative" }}>
                {idx < sortedInteractions.length - 1 && (
                  <div
                    style={{
                      position: "absolute",
                      left: "15px",
                      top: "48px",
                      width: "1px",
                      height: "calc(100% - 32px)",
                      background: "linear-gradient(to bottom, #e5e7eb, transparent)",
                      zIndex: 0,
                    }}
                  />
                )}
                <InteractionItem interaction={interaction} />
              </div>
            ))}
          </div>
        </div>
      </div>

      <style>{`
        @media (max-width: 768px) {
          .detail-container { padding: 20px 16px !important; }
          .detail-grid { grid-template-columns: 1fr !important; }
          .profile-tags { align-items: flex-start !important; }
        }
      `}</style>
    </div>
  );
}
